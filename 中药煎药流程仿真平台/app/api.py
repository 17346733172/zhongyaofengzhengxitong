import asyncio
import hmac
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, FastAPI, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.security import APIKeyHeader

from .engine import batch_view
from .models import (BatchCreate, ClockStart, ClockStep, DeviceCreate, OperatorAction,
                     PrescriptionCreate, Review, ScenarioCreate)
from .service import DomainError, Service, require
from .workflow import DEVICE_LABELS, make_steps

log = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parent.parent


def page(items, offset, limit):
    return {"items": items[offset:offset + limit], "total": len(items), "offset": offset, "limit": limit}


def create_app(db_path=None, api_key=None, enable_runner=True):
    db_path = db_path or os.environ.get("DECOCTION_DB", str(ROOT / "data" / "simulation.db"))
    service = Service(db_path)
    key = api_key if api_key is not None else os.environ.get("DECOCTION_API_KEY", "")

    async def runner(app):
        while True:
            await asyncio.sleep(0.25)
            try:
                await asyncio.to_thread(service.auto_tick)
            except Exception:
                log.exception("Simulation scheduler failed")
                app.state.runner_error = True
                with service.store.transaction() as (s, emit):
                    s["clock"]["running"] = False
                    emit("simulation.runner_failed", "simulation", reason="调度器异常，已暂停")

    @asynccontextmanager
    async def lifespan(app):
        service.on_start()
        task = asyncio.create_task(runner(app)) if enable_runner else None
        try:
            yield
        finally:
            if task:
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
            service.clock("pause")

    app = FastAPI(title="中药煎药流程仿真平台", version="0.1.0", lifespan=lifespan,
                  description="参考厚达智能北京本草方源案例的教学与流程仿真后端。"
                              "所有时间单位为虚拟秒，温度和水量为演示参数。单进程运行。")
    app.state.service = service
    app.state.runner_error = False
    origins = os.environ.get("DECOCTION_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173")
    app.add_middleware(CORSMiddleware, allow_origins=[v.strip() for v in origins.split(",") if v.strip()],
                       allow_credentials=False, allow_methods=["GET", "POST"],
                       allow_headers=["Content-Type", "X-API-Key"])
    security = APIKeyHeader(name="X-API-Key", auto_error=False)

    def authorize(provided: str | None = Depends(security)):
        if key and not hmac.compare_digest((provided or "").encode(), key.encode()):
            raise DomainError("unauthorized", "API Key 无效", 401)

    router = APIRouter(prefix="/api/v1", dependencies=[Depends(authorize)])

    @app.exception_handler(DomainError)
    async def domain_error(_request, error):
        return JSONResponse(status_code=error.status, content={"error": {"code": error.code, "message": error.message}})

    @app.get("/", include_in_schema=False)
    def root():
        return {"name": app.title, "version": app.version, "docs": "/docs", "health": "/health",
                "notice": "流程仿真演示；不连接或控制真实设备"}

    @app.get("/health", tags=["系统"])
    def health():
        try:
            service.store.read()
        except Exception:
            return JSONResponse(status_code=503, content={"status": "error", "database": "unavailable"})
        return JSONResponse(status_code=503 if app.state.runner_error else 200,
                            content={"status": "degraded" if app.state.runner_error else "ok",
                                     "database": "ok", "version": app.version})

    @router.get("/workflow", tags=["流程定义"], summary="获取流程模板、设备类型和参考来源")
    def workflow():
        sample = PrescriptionCreate(external_no="template", patient_code="SIM",
                                    herbs=[{"name": "演示先煎组", "grams_per_dose": 10, "method": "pre_decoct"},
                                           {"name": "演示后下组", "grams_per_dose": 5, "method": "late_add"}])
        return {"reference_url": "http://www.houdar.com/prodetail.html?appid=1.2",
                "reference_title": "北京本草方源煎药中心应用案例",
                "time_unit": "virtual_seconds", "pressure_model": "常压，表压恒为0 kPa",
                "device_kinds": [{"code": str(k), "name": v} for k, v in DEVICE_LABELS.items()],
                "herb_methods": {"normal": "常规", "pre_decoct": "先煎", "late_add": "后下（一煎末段）", "bag": "包煎"},
                "steps": make_steps(sample.model_dump()),
                "assumptions": ["先煎组与常规浸泡组分开处理，先煎后合药，分组细节不建模",
                                "复核及成品质检为模拟通过，不执行药学审方或真实质量检测",
                                "每锅对应一张处方，药锅从调剂占用至清洗结束",
                                "工位间排队期间保持上一时刻温度，不模拟热损失",
                                "参数是演示假设，并非厂商设备参数或临床建议"]}

    @router.post("/prescriptions", status_code=201, tags=["处方"], summary="录入匿名仿真处方")
    def create_prescription(body: PrescriptionCreate):
        return service.create_prescription(body)

    @router.get("/prescriptions", tags=["处方"])
    def prescriptions(status: Literal["pending_review", "approved", "rejected"] | None = None,
                      offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
        items = list(service.store.read()["prescriptions"].values())
        return page([p for p in items if status is None or p["status"] == status], offset, limit)

    @router.get("/prescriptions/{prescription_id}", tags=["处方"])
    def prescription(prescription_id: str):
        return require(service.store.read()["prescriptions"], prescription_id, "处方")

    @router.post("/prescriptions/{prescription_id}/review", tags=["处方"], summary="人工审核通过或驳回")
    def review(prescription_id: str, body: Review):
        return service.review(prescription_id, body)

    @router.post("/batches", status_code=201, tags=["批次"])
    def create_batch(body: BatchCreate):
        return service.create_batch(body.prescription_id)

    @router.get("/batches", tags=["批次"])
    def batches(status: Literal["queued", "running", "paused", "completed", "cancelled"] | None = None,
                offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
        s = service.store.read()
        items = [batch_view(s, b) for b in s["batches"].values() if status is None or b["status"] == status]
        return page(items, offset, limit)

    @router.get("/batches/{batch_id}", tags=["批次"])
    def batch(batch_id: str):
        return service.batch(batch_id)

    @router.post("/batches/{batch_id}/{action}", tags=["批次"], summary="暂停、继续或取消批次")
    def batch_action(batch_id: str, action: Literal["pause", "resume", "cancel"], body: OperatorAction):
        return service.batch_action(batch_id, action, body)

    @router.get("/devices", tags=["设备"])
    def devices():
        return {"items": list(service.store.read()["devices"].values())}

    @router.post("/devices", status_code=201, tags=["设备"], summary="添加仿真工位或药锅")
    def create_device(body: DeviceCreate):
        return service.create_device(body)

    @router.post("/devices/{device_id}/{action}", tags=["设备"], summary="注入故障、修复、停用或启用设备")
    def device_action(device_id: str, action: Literal["fault", "repair", "offline", "online"], body: OperatorAction):
        return service.device_action(device_id, action, body)

    @router.get("/alarms", tags=["报警"])
    def alarms(status: Literal["active", "resolved"] | None = None,
               offset: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200)):
        items = [a for a in service.store.read()["alarms"].values() if status is None or a["status"] == status]
        return page(items, offset, limit)

    @router.post("/alarms/{alarm_id}/acknowledge", tags=["报警"])
    def acknowledge(alarm_id: str, body: OperatorAction):
        return service.acknowledge(alarm_id, body)

    @router.get("/simulation", tags=["仿真控制"], summary="完整仿真快照")
    def snapshot():
        return service.snapshot()

    @router.post("/simulation/start", tags=["仿真控制"], summary="按指定倍率自动运行")
    def start(body: ClockStart):
        result = service.clock("start", body.speed)
        app.state.runner_error = False
        return result

    @router.post("/simulation/pause", tags=["仿真控制"])
    def pause():
        return service.clock("pause")

    @router.post("/simulation/step", tags=["仿真控制"], summary="手动推进虚拟时间，精确处理工序边界")
    def step(body: ClockStep):
        return service.clock("step", body.seconds)

    @router.post("/simulation/scenarios", status_code=201, tags=["仿真控制"], summary="生成含普通、先煎、后下药组的匿名演示场景")
    def scenario(body: ScenarioCreate):
        return service.scenario(body.count)

    @router.get("/events", tags=["追溯"], summary="按全局递增事件ID增量读取")
    def events(after_id: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=1000),
               entity_id: str | None = None, event_type: str | None = None):
        items = service.store.events(after_id, limit, entity_id, event_type)
        return {"items": items, "next_after_id": items[-1]["id"] if items else after_id}

    @router.get("/batches/{batch_id}/telemetry", tags=["追溯"], summary="读取温度曲线采样点")
    def telemetry(batch_id: str, after_id: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=1000)):
        service.batch(batch_id)
        items = service.store.events(after_id, limit, batch_id, "telemetry.point")
        return {"items": items, "next_after_id": items[-1]["id"] if items else after_id}

    @router.get("/trace/{trace_code}", tags=["追溯"])
    def trace(trace_code: str, after_id: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=1000)):
        return service.trace(trace_code, after_id, limit)

    @router.get("/dashboard", tags=["统计"])
    def dashboard():
        return service.dashboard()

    app.include_router(router)

    @app.websocket("/ws/simulation")
    async def websocket(ws: WebSocket):
        origin = ws.headers.get("origin")
        allowed = [v.strip() for v in origins.split(",") if v.strip()]
        if origin and origin not in allowed:
            await ws.close(code=1008)
            return
        await ws.accept()
        try:
            if key:
                # A browser cannot set arbitrary WebSocket request headers.
                # Authenticate via first message to avoid credentials in URL logs.
                try:
                    auth = await asyncio.wait_for(ws.receive_json(), timeout=5)
                    provided = auth.get("api_key", "") if isinstance(auth, dict) else ""
                    if not isinstance(provided, str) or not hmac.compare_digest(provided.encode(), key.encode()):
                        await ws.close(code=1008)
                        return
                except (ValueError, asyncio.TimeoutError):
                    await ws.close(code=1008)
                    return
            previous = None
            while True:
                data = await asyncio.to_thread(service.snapshot)
                fingerprint = (data["last_event_id"], data["clock"]["now"],
                               data["clock"]["running"], data["clock"]["speed"])
                if fingerprint != previous:
                    await ws.send_json({"type": "snapshot", "data": data})
                    previous = fingerprint
                # Heartbeat detects disconnected idle clients and bounds resource use.
                else:
                    await ws.send_json({"type": "heartbeat", "last_event_id": data["last_event_id"]})
                await asyncio.sleep(0.5)
        except (WebSocketDisconnect, RuntimeError, OSError):
            pass

    return app
