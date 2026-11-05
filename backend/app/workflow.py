"""A configurable demonstration flow, not a clinical decoction calculator."""

from .models import DeviceKind as K

DEVICE_LABELS = {
    K.POT: "煎药锅", K.DISPENSER: "调剂机", K.VERIFICATION: "复核台",
    K.CONVEYOR: "输送单元", K.WATER: "加水单元", K.SOAKING: "浸泡工位",
    K.DECOCTER: "煎煮工位", K.FILTER: "过滤单元", K.PACKER: "包装机",
    K.LABELER: "贴标机", K.QUALITY: "质检台", K.DISPATCH: "配发台",
    K.RESIDUE: "倒渣机", K.WASHER: "清洗机",
}

# User-specified demonstration time per station operation (seconds).
DEFAULT_PROCESSING_SECONDS = {
    K.DISPENSER: 600, K.VERIFICATION: 300, K.CONVEYOR: 300,
    K.WATER: 180, K.SOAKING: 300, K.DECOCTER: 900, K.FILTER: 180,
    K.PACKER: 300, K.LABELER: 300, K.QUALITY: 180, K.DISPATCH: 180,
    K.RESIDUE: 120, K.WASHER: 180,
}


def water_plan(prescription):
    r = prescription["recipe"]
    mass = sum(h["grams_per_dose"] for h in prescription["herbs"]) * prescription["doses"]
    output = prescription["doses"] * prescription["bags_per_dose"] * prescription["bag_volume_ml"]
    boiling = r["first_decoct_seconds"] + r["second_decoct_seconds"]
    if any(h["method"] == "pre_decoct" for h in prescription["herbs"]):
        boiling += r["pre_decoct_seconds"]
    total = round(mass * r["water_ml_per_g"] + output + boiling / 60 * r["evaporation_ml_per_minute"], 2)
    first = round(total * (0.65 if r["second_decoct_seconds"] else 1), 2)
    return {"herb_mass_g": round(mass, 2), "total_water_ml": total,
            "first_water_ml": first, "second_water_ml": round(total - first, 2),
            "target_output_ml": output, "target_bags": output // prescription["bag_volume_ml"],
            "model": "演示估算：药材量×吸水系数+目标药液量+线性蒸发量；非临床模型"}


def make_steps(p):
    r = p["recipe"]
    steps = []

    def add(code, name, kind, seconds, temperature=25):
        steps.append({"code": code, "name": name, "device_kind": str(kind),
                      "duration_seconds": float(seconds), "elapsed_seconds": 0.0,
                      "status": "pending", "device_id": None, "started_at": None,
                      "finished_at": None, "target_temperature_c": temperature})

    add("dispensing", "饮片调剂（含包煎分包）", K.DISPENSER, DEFAULT_PROCESSING_SECONDS[K.DISPENSER])
    add("verification", "调剂复核", K.VERIFICATION, DEFAULT_PROCESSING_SECONDS[K.VERIFICATION])
    add("transport", "药锅输送", K.CONVEYOR, DEFAULT_PROCESSING_SECONDS[K.CONVEYOR])
    add("water_fill", "定量加水", K.WATER, DEFAULT_PROCESSING_SECONDS[K.WATER])
    add("soaking", "浸泡", K.SOAKING, r["soak_seconds"])
    if any(h["method"] == "pre_decoct" for h in p["herbs"]):
        add("pre_decoct", "先煎药组煎煮", K.DECOCTER, r["pre_decoct_seconds"], r["target_temperature_c"])
        add("combine", "常规药组入锅", K.CONVEYOR, DEFAULT_PROCESSING_SECONDS[K.CONVEYOR], r["target_temperature_c"])
    if r["heat_seconds"] > 0:
        add("heating", "武火升温", K.DECOCTER, r["heat_seconds"], r["target_temperature_c"])
    add("first_decoct", "一煎（文火）", K.DECOCTER, r["first_decoct_seconds"], r["target_temperature_c"])
    if r["second_decoct_seconds"] > 0:
        add("first_filter", "一煎滤液暂存", K.FILTER, DEFAULT_PROCESSING_SECONDS[K.FILTER], 80)
        add("second_water", "二煎加水", K.WATER, DEFAULT_PROCESSING_SECONDS[K.WATER], 45)
        if r["heat_seconds"] > 0:
            add("second_heating", "二煎升温", K.DECOCTER, r["heat_seconds"], r["target_temperature_c"])
        add("second_decoct", "二煎（文火）", K.DECOCTER, r["second_decoct_seconds"], r["target_temperature_c"])
    add("filtering", "滤液合并", K.FILTER, DEFAULT_PROCESSING_SECONDS[K.FILTER], 75)
    add("packaging", "自动灌装包装", K.PACKER, DEFAULT_PROCESSING_SECONDS[K.PACKER], 65)
    add("labeling", "贴标", K.LABELER, DEFAULT_PROCESSING_SECONDS[K.LABELER], 45)
    add("quality_check", "成品质检（仿真通过）", K.QUALITY, DEFAULT_PROCESSING_SECONDS[K.QUALITY], 40)
    add("distribution", "成品配发", K.DISPATCH, DEFAULT_PROCESSING_SECONDS[K.DISPATCH], 35)
    add("residue", "自动倒渣", K.RESIDUE, DEFAULT_PROCESSING_SECONDS[K.RESIDUE], 30)
    add("cleaning", "一方一清洗", K.WASHER, DEFAULT_PROCESSING_SECONDS[K.WASHER])
    return steps


def initial_state():
    devices = {}
    counts = {K.POT: 50, K.DISPENSER: 7, K.VERIFICATION: 3, K.CONVEYOR: 5,
              K.WATER: 2, K.SOAKING: 4, K.DECOCTER: 30, K.FILTER: 6,
              K.PACKER: 6, K.LABELER: 6, K.QUALITY: 3, K.DISPATCH: 3,
              K.RESIDUE: 2, K.WASHER: 2}
    for kind, count in counts.items():
        for i in range(1, count + 1):
            ident = f"{kind}-{i:02}"
            devices[ident] = device_record(ident, f"{DEVICE_LABELS[kind]} {i:02}", str(kind), 30000)
    return {"schema_version": 1, "clock": {"now": 0.0, "running": False, "speed": 1.0},
            "prescriptions": {}, "batches": {}, "devices": devices, "alarms": {}}


def device_record(ident, name, kind, capacity_ml):
    return {"id": ident, "name": name, "kind": kind, "capacity_ml": capacity_ml,
            "status": "idle", "batch_id": None, "occupied_seconds": 0.0,
            "productive_seconds": 0.0, "added_at": 0.0}
