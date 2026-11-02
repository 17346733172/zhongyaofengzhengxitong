"""Deterministic discrete-event scheduler; no wall-clock reads or database access."""

EPS = 1e-8
TERMINAL = {"completed", "cancelled"}


def current_step(batch):
    i = batch["stage_index"]
    return batch["steps"][i] if i < len(batch["steps"]) else None


def release(device):
    device["batch_id"] = None
    if device["status"] == "busy":
        device["status"] = "idle"


def blocker(state, batch):
    if batch["status"] in TERMINAL:
        return None
    if batch["status"] == "paused":
        return "批次已人工暂停"
    for ident in [batch["pot_id"], (current_step(batch) or {}).get("device_id")]:
        if ident and state["devices"][ident]["status"] in {"fault", "offline"}:
            return f"设备不可用：{state['devices'][ident]['name']}"
    return None


def dispatch(state, emit):
    # Stable FIFO within priority. A started stage is never preempted.
    batches = sorted(state["batches"].values(), key=lambda b: (-b["priority"], b["sequence"]))
    for b in batches:
        if b["status"] in TERMINAL:
            continue
        b["waiting_reason"] = blocker(state, b)
        if b["waiting_reason"]:
            continue
        step = current_step(b)
        if step["status"] == "running":
            continue
        if not b["pot_id"]:
            pots = [d for d in state["devices"].values() if d["kind"] == "pot"
                    and d["status"] == "idle" and d["capacity_ml"] >= b["water_plan"]["total_water_ml"]]
            if not pots:
                b["waiting_reason"] = "等待空闲且容量足够的洁净煎药锅"
                continue
        else:
            pots = []
        stations = [d for d in state["devices"].values() if d["kind"] == step["device_kind"]
                    and d["status"] == "idle"]
        if not stations:
            b["waiting_reason"] = f"等待 {step['name']} 工位"
            continue
        if pots:
            pot = min(pots, key=lambda d: (d["capacity_ml"], d["id"]))
            pot.update(status="busy", batch_id=b["id"])
            b["pot_id"] = pot["id"]
            emit("pot.reserved", b["id"], device_id=pot["id"])
        station = stations[0]
        station.update(status="busy", batch_id=b["id"])
        step.update(status="running", device_id=station["id"], started_at=state["clock"]["now"],
                    start_temperature_c=b["temperature_c"])
        b["status"] = "running"
        if b["started_at"] is None:
            b["started_at"] = state["clock"]["now"]
            emit("batch.started", b["id"], pot_id=b["pot_id"])
        emit("stage.started", b["id"], stage=step["code"], name=step["name"], device_id=station["id"])
        telemetry(state, b, emit)


def late_threshold(state, batch, step):
    p = state["prescriptions"][batch["prescription_id"]]
    if step["code"] != "first_decoct" or batch["late_added"]:
        return None
    if not any(h["method"] == "late_add" for h in p["herbs"]):
        return None
    return step["duration_seconds"] - p["recipe"]["late_add_seconds"]


def telemetry(state, batch, emit):
    step = current_step(batch)
    emit("telemetry.point", batch["id"], stage=step["code"] if step else None,
         temperature_c=round(batch["temperature_c"], 2), pressure_kpa=0,
         stage_elapsed_seconds=round(step["elapsed_seconds"], 4) if step else 0,
         produced_bags=batch["produced_bags"])


def advance(state, seconds, emit):
    remaining = seconds
    dispatch(state, emit)
    while remaining > EPS:
        active = [b for b in state["batches"].values() if b["status"] == "running"
                  and current_step(b)["status"] == "running" and not blocker(state, b)]
        delta = remaining
        for b in active:
            step = current_step(b)
            delta = min(delta, step["duration_seconds"] - step["elapsed_seconds"])
            threshold = late_threshold(state, b, step)
            if threshold is not None and threshold > step["elapsed_seconds"] + EPS:
                delta = min(delta, threshold - step["elapsed_seconds"])
        for d in state["devices"].values():
            if d["batch_id"]:
                d["occupied_seconds"] += delta
        state["clock"]["now"] += delta
        remaining -= delta
        for b in active:
            step = current_step(b)
            step["elapsed_seconds"] = min(step["duration_seconds"], step["elapsed_seconds"] + delta)
            ratio = step["elapsed_seconds"] / step["duration_seconds"]
            b["temperature_c"] = step["start_temperature_c"] + (step["target_temperature_c"] - step["start_temperature_c"]) * ratio
            for ident in [step["device_id"], b["pot_id"]]:
                state["devices"][ident]["productive_seconds"] += delta
            threshold = late_threshold(state, b, step)
            if threshold is not None and step["elapsed_seconds"] + EPS >= threshold:
                b["late_added"] = True
                p = state["prescriptions"][b["prescription_id"]]
                emit("ingredient.late_added", b["id"], stage=step["code"],
                     herbs=[h["name"] for h in p["herbs"] if h["method"] == "late_add"])
            if step["elapsed_seconds"] + EPS >= step["duration_seconds"]:
                finish_step(state, b, emit)
        dispatch(state, emit)
    # Samples are emitted only for progressing batches; full sensor physics is out of scope.
    if seconds > 0:
        for b in state["batches"].values():
            if b["status"] == "running" and current_step(b)["status"] == "running" and not blocker(state, b):
                telemetry(state, b, emit)


def finish_step(state, b, emit):
    step = current_step(b)
    step.update(status="completed", finished_at=state["clock"]["now"])
    release(state["devices"][step["device_id"]])
    if step["code"] == "packaging":
        b["produced_bags"] = b["water_plan"]["target_bags"]
    if step["code"] == "distribution":
        b["dispatched"] = True
        emit("product.dispatched", b["id"], bags=b["produced_bags"], trace_code=b["trace_code"])
    emit("stage.completed", b["id"], stage=step["code"], name=step["name"], device_id=step["device_id"])
    telemetry(state, b, emit)
    b["stage_index"] += 1
    if b["stage_index"] == len(b["steps"]):
        pot = state["devices"][b["pot_id"]]
        release(pot)
        b.update(status="cancelled" if b["cancel_requested"] else "completed",
                 completed_at=state["clock"]["now"], waiting_reason=None)
        emit("pot.cleaned", b["id"], device_id=pot["id"])
        emit(f"batch.{b['status']}", b["id"], produced_bags=b["produced_bags"])


def cancel(state, batch, emit):
    """Keep the dirty pot reserved until residue removal and washing finish."""
    batch["cancel_requested"] = True
    if not batch["pot_id"]:
        for step in batch["steps"]:
            step["status"] = "skipped"
        batch.update(status="cancelled", stage_index=len(batch["steps"]),
                     completed_at=state["clock"]["now"], waiting_reason=None)
        emit("batch.cancelled", batch["id"], produced_bags=0)
        return
    step = current_step(batch)
    # Cancellation during cleanup must retain completed/ongoing cleanup progress.
    if step["code"] not in {"residue", "cleaning"}:
        if step["device_id"]:
            release(state["devices"][step["device_id"]])
        residue_index = next(i for i, s in enumerate(batch["steps"]) if s["code"] == "residue")
        for s in batch["steps"][batch["stage_index"]:residue_index]:
            s.update(status="skipped", finished_at=state["clock"]["now"])
        batch["stage_index"] = residue_index
    batch["status"] = "running" if current_step(batch)["status"] == "running" else "queued"
    batch["waiting_reason"] = None
    emit("batch.cleanup_required", batch["id"], pot_id=batch["pot_id"])


def batch_view(state, b):
    step = current_step(b)
    total = sum(s["duration_seconds"] for s in b["steps"])
    elapsed = sum(s["elapsed_seconds"] for s in b["steps"])
    return {**b, "current_stage": step["code"] if step else None,
            "current_stage_name": step["name"] if step else None,
            "progress_percent": round(elapsed / total * 100, 2),
            "temperature_c": round(b["temperature_c"], 2),
            "waiting_reason": blocker(state, b) or b["waiting_reason"],
            "planned_processing_seconds": total,
            "remaining_processing_seconds": round(sum(s["duration_seconds"] - s["elapsed_seconds"]
                                                       for s in b["steps"] if s["status"] != "skipped"), 4)}
