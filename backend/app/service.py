import secrets
import time
from uuid import uuid4

from . import engine
from .models import PrescriptionCreate
from .store import Store
from .workflow import DEFAULT_PROCESSING_SECONDS, DEVICE_LABELS, device_record, make_steps, water_plan


class DomainError(Exception):
    def __init__(self, code, message, status=409):
        self.code, self.message, self.status = code, message, status


def require(records, ident, name):
    if ident not in records:
        raise DomainError("not_found", f"{name}不存在：{ident}", 404)
    return records[ident]


def ident(prefix):
    return f"{prefix}_{uuid4().hex[:16]}"


class Service:
    def __init__(self, db_path):
        self.store = Store(db_path)
        self.last_wall = time.monotonic()

    def on_start(self):
        with self.store.transaction() as (s, emit):
            s["clock"]["speed"] = 1.0
            if s["clock"]["running"]:
                s["clock"]["running"] = False
                emit("simulation.restart_paused", "simulation", reason="服务重启后等待显式继续")
        self.last_wall = time.monotonic()

    def auto_tick(self):
        # The same lock guards both the wall-time baseline and SQLite state.
        with self.store.lock:
            now = time.monotonic()
            elapsed = now - self.last_wall
            self.last_wall = now
            if not self.store.read()["clock"]["running"]:
                return
            with self.store.transaction() as (s, emit):
                if s["clock"]["running"]:
                    engine.advance(s, elapsed, emit)

    def clock(self, action, value=None):
        if action == "start" and value not in (None, 1):
            raise DomainError("real_time_only", "仅支持真实时间1倍速运行")
        with self.store.lock:
            if action != "step":
                self.auto_tick()
            with self.store.transaction() as (s, emit):
                if action == "step":
                    if s["clock"]["running"]:
                        raise DomainError("clock_running", "自动运行中，请先暂停再手动推进")
                    engine.advance(s, value, emit)
                elif action == "start":
                    s["clock"].update(running=True, speed=1.0)
                    engine.advance(s, 0, emit)
                elif action == "pause":
                    s["clock"]["running"] = False
                emit(f"simulation.{action}", "simulation", value=value)
                result = dict(s["clock"])
            self.last_wall = time.monotonic()
            return result

    def create_prescription(self, request):
        with self.store.transaction() as (s, emit):
            p = self._prescription(s, emit, request.model_dump())
        return p

    @staticmethod
    def _prescription(s, emit, data):
        if any(p["external_no"] == data["external_no"] for p in s["prescriptions"].values()):
            raise DomainError("duplicate_prescription", "处方外部编号已存在")
        p = {**data, "id": ident("rx"), "status": "pending_review", "batch_id": None,
             "created_at": s["clock"]["now"], "review": None}
        s["prescriptions"][p["id"]] = p
        emit("prescription.created", p["id"], external_no=p["external_no"])
        return p

    def review(self, prescription_id, request):
        with self.store.transaction() as (s, emit):
            p = require(s["prescriptions"], prescription_id, "处方")
            if p["status"] != "pending_review":
                raise DomainError("already_reviewed", "该处方已经审核，不能重复审核")
            p["status"] = "approved" if request.approved else "rejected"
            p["review"] = {**request.model_dump(), "sim_time": s["clock"]["now"]}
            emit("prescription.reviewed", p["id"], **p["review"])
        return p

    @staticmethod
    def _batch(s, emit, prescription_id):
        p = require(s["prescriptions"], prescription_id, "处方")
        if p["status"] != "approved":
            raise DomainError("review_required", "处方需人工审核通过后才能生产")
        if p["batch_id"]:
            raise DomainError("duplicate_batch", "该处方已经创建批次")
        b = {"id": ident("batch"), "prescription_id": p["id"],
             "trace_code": f"TCM-{uuid4().hex.upper()}", "sequence": len(s["batches"]) + 1,
             "priority": p["priority"], "status": "queued", "stage_index": 0,
             "steps": make_steps(p), "water_plan": water_plan(p), "pot_id": None,
             "created_at": s["clock"]["now"], "started_at": None, "completed_at": None,
             "temperature_c": 25.0, "late_added": False, "produced_bags": 0,
             "dispatched": False, "cancel_requested": False, "waiting_reason": "等待调度"}
        s["batches"][b["id"]] = b
        p["batch_id"] = b["id"]
        emit("batch.created", b["id"], prescription_id=p["id"], trace_code=b["trace_code"])
        return b

    def create_batch(self, prescription_id):
        with self.store.transaction() as (s, emit):
            b = self._batch(s, emit, prescription_id)
            result = engine.batch_view(s, b)
        return result

    def batch_action(self, batch_id, action, request):
        with self.store.transaction() as (s, emit):
            b = require(s["batches"], batch_id, "批次")
            if b["status"] in engine.TERMINAL:
                raise DomainError("batch_finished", "批次已经结束")
            if action == "pause":
                if b["status"] == "paused":
                    raise DomainError("batch_paused", "批次已暂停")
                b["status"] = "paused"
            elif action == "resume":
                if b["status"] != "paused":
                    raise DomainError("batch_not_paused", "批次未暂停")
                b["status"] = "running" if engine.current_step(b)["status"] == "running" else "queued"
            elif action == "cancel":
                if b["dispatched"]:
                    raise DomainError("already_dispatched", "成品已配发，批次需完成清洗，不能取消")
                if b["cancel_requested"]:
                    raise DomainError("cancellation_pending", "批次正在执行取消后的清洗")
                engine.cancel(s, b, emit)
            emit(f"batch.{action}", batch_id, **request.model_dump())
            engine.dispatch(s, emit)
            result = engine.batch_view(s, b)
        return result

    def create_device(self, request):
        with self.store.transaction() as (s, emit):
            d = device_record(ident(str(request.kind)), request.name, str(request.kind), request.capacity_ml)
            d["added_at"] = s["clock"]["now"]
            s["devices"][d["id"]] = d
            emit("device.created", d["id"], name=d["name"], kind=d["kind"])
        return d

    def device_action(self, device_id, action, request):
        with self.store.transaction() as (s, emit):
            d = require(s["devices"], device_id, "设备")
            if action == "fault":
                if d["status"] not in {"idle", "busy"}:
                    raise DomainError("device_unavailable", "仅可对在线设备注入故障")
                d["status"] = "fault"
                alarm = {"id": ident("alarm"), "device_id": device_id,
                         "batch_id": d["batch_id"], "message": request.reason,
                         "status": "active", "acknowledged": False,
                         "created_at": s["clock"]["now"], "resolved_at": None}
                s["alarms"][alarm["id"]] = alarm
                emit("alarm.raised", alarm["id"], **alarm)
            elif action == "repair":
                if d["status"] != "fault":
                    raise DomainError("device_not_faulted", "该设备未处于故障状态")
                d["status"] = "busy" if d["batch_id"] else "idle"
                for a in s["alarms"].values():
                    if a["device_id"] == device_id and a["status"] == "active":
                        a.update(status="resolved", resolved_at=s["clock"]["now"])
                        emit("alarm.resolved", a["id"], device_id=device_id)
            elif action == "offline":
                if d["status"] != "idle":
                    raise DomainError("device_busy", "仅可停用空闲设备")
                d["status"] = "offline"
            elif action == "online":
                if d["status"] != "offline":
                    raise DomainError("device_not_offline", "该设备未停用")
                d["status"] = "idle"
            emit(f"device.{action}", device_id, **request.model_dump())
            engine.dispatch(s, emit)
        return d

    def acknowledge(self, alarm_id, request):
        with self.store.transaction() as (s, emit):
            alarm = require(s["alarms"], alarm_id, "报警")
            if not alarm["acknowledged"]:
                alarm.update(acknowledged=True, acknowledged_by=request.operator)
                emit("alarm.acknowledged", alarm_id, **request.model_dump())
        return alarm

    def scenario(self, count):
        """Create anonymous samples and approved batches in one atomic operation."""
        with self.store.transaction() as (s, emit):
            ids = []
            prefix = secrets.token_hex(4)
            for i in range(count):
                herbs = [{"name": "演示饮片A", "grams_per_dose": 12, "method": "normal"},
                         {"name": "演示饮片B", "grams_per_dose": 9, "method": "bag"}]
                if i % 3 == 1:
                    herbs.append({"name": "演示先煎组", "grams_per_dose": 10, "method": "pre_decoct"})
                if i % 3 == 2:
                    herbs.append({"name": "演示后下组", "grams_per_dose": 6, "method": "late_add"})
                request = PrescriptionCreate(external_no=f"DEMO-{prefix}-{i+1:03}",
                                             patient_code=f"SIM-{i+1:03}", herbs=herbs,
                                             priority=2 if i == count - 1 else 0)
                p = self._prescription(s, emit, request.model_dump())
                p.update(status="approved", review={"approved": True, "operator": "演示场景生成器",
                         "comment": "匿名模拟处方，演示审核通过", "sim_time": s["clock"]["now"]})
                emit("prescription.reviewed", p["id"], **p["review"])
                b = self._batch(s, emit, p["id"])
                ids.append(b["id"])
        return {"batch_ids": ids, "count": count, "message": "演示批次已创建，请开始真实计时运行"}

    def snapshot(self):
        s = self.store.read()
        return {"clock": s["clock"], "last_event_id": s["last_event_id"],
                "batches": [engine.batch_view(s, b) for b in s["batches"].values()],
                "devices": list(s["devices"].values()), "alarms": list(s["alarms"].values())}

    def batch(self, batch_id):
        s = self.store.read()
        return engine.batch_view(s, require(s["batches"], batch_id, "批次"))

    def trace(self, trace_code, after_id, limit):
        s = self.store.read()
        b = next((b for b in s["batches"].values() if b["trace_code"] == trace_code), None)
        if b is None:
            raise DomainError("not_found", "追溯码不存在", 404)
        # Two streams are paginated independently, preserving original global event IDs.
        return {"batch": engine.batch_view(s, b), "prescription": s["prescriptions"][b["prescription_id"]],
                "batch_events": self.store.events(after_id, limit, b["id"]),
                "prescription_events": self.store.events(after_id, limit, b["prescription_id"])}

    def dashboard(self):
        s = self.store.read()
        batches = list(s["batches"].values())
        counts = {status: sum(b["status"] == status for b in batches)
                  for status in ["queued", "running", "paused", "completed", "cancelled"]}
        dispatched = sum(b["produced_bags"] for b in batches if b["dispatched"])
        devices = []
        for d in s["devices"].values():
            duration = s["clock"]["now"] - d["added_at"]
            devices.append({**d, "kind_name": DEVICE_LABELS[d["kind"]],
                            "default_processing_seconds": DEFAULT_PROCESSING_SECONDS.get(d["kind"]),
                            "utilization_percent": round(d["productive_seconds"] / duration * 100, 2) if duration else 0})
        return {"clock": s["clock"], "total_prescriptions": len(s["prescriptions"]),
                "batch_counts": counts, "dispatched_bags": dispatched,
                "active_alarms": sum(a["status"] == "active" for a in s["alarms"].values()),
                "waiting_batches": sum(bool(b["waiting_reason"]) for b in batches if b["status"] not in engine.TERMINAL),
                "bags_per_virtual_hour": round(dispatched * 3600 / s["clock"]["now"], 2) if s["clock"]["now"] else 0,
                "devices": devices}
