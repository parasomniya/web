"""
Строит длинный сценарий телеметрии по zone_config.json (как в logicjs + test_zones).
Нарушения: перегруз по зоне 1, недогруз по зоне 2, остаточный вес > 200 после выгрузки.

Запуск: python generate_full_scenario.py
Пишет: scenarios/06_full_batch_from_zones.json
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000.0, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def base_telemetry(lat: float, lon: float, weight: float, t_ms: int) -> dict:
    return {
        "device_id": "emu_loader_fullpath",
        "timestamp": iso(t_ms),
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "gps_valid": True,
        "gps_satellites": 12,
        "weight": round(weight, 2),
        "weight_valid": True,
        "gps_quality": 4,
        "wifi_clients": ["emu-wifi"],
        "cpu_temp_c": 51.0,
        "lte_rssi_dbm": -70,
        "lte_access_tech": "LTE",
        "events_reader_ok": True,
    }


def lerp(a: float, b: float, n: int) -> list[float]:
    if n <= 1:
        return [a]
    return [a + (b - a) * i / (n - 1) for i in range(n)]


def main() -> None:
    root = Path(__file__).resolve().parent
    cfg = json.loads((root / "zone_config.json").read_text(encoding="utf-8"))
    thresh = float(cfg["WEIGHT_THRESHOLD_W"])
    eps = float(cfg["WEIGHT_EPSILON"])
    batch_end = int(cfg["BATCH_END_DELAY_SEC"])
    remain_max = float(cfg["ACCEPTABLE_REMAINING_WEIGHT"])
    unload_c = cfg["UNLOAD_ZONE"]["center"]
    load_zones = cfg["LOADING_ZONES"]
    park = cfg["PARKING_OUTSIDE"]

    frames: list[dict] = []
    t_ms = int(datetime.now(tz=timezone.utc).timestamp() * 1000)
    delay_between = 1000

    def push(lat: float, lon: float, w: float, dly: int | None = None) -> None:
        nonlocal t_ms
        f = base_telemetry(lat, lon, w, t_ms)
        if dly is not None:
            f["delay_ms"] = dly
        frames.append(f)
        t_ms += delay_between

    # --- до старта: парковка, вес ниже порога ---
    for w in [0.0, 40.0, 70.0]:
        push(park["lat"], park["lon"], w, dly=0 if w == 0 else delay_between)

    z1 = load_zones[0]["center"]
    z2 = load_zones[1]["center"]
    z3 = load_zones[2]["center"]

    # подъезд к зоне 1
    for la, lo in zip(
        lerp(park["lat"], z1[0], 6),
        lerp(park["lon"], z1[1], 6),
    ):
        push(la, lo, 70.0)

    # старт батча: пересечь порог в зоне 1, затем грузить до 5300 (+300 к идеалу 5000 => violation)
    target_z1_total = 5300.0
    w = 70.0
    step_load = 85.0
    while w < target_z1_total - 1:
        nw = min(w + step_load, target_z1_total)
        if nw <= thresh and w < thresh:
            nw = thresh + 15.0
        push(z1[0], z1[1], nw)
        w = nw

    # переезд во 2-ю зону
    for la, lo in zip(lerp(z1[0], z2[0], 10), lerp(z1[1], z2[1], 10)):
        push(la, lo, target_z1_total)

    # зона 2: недогруз (накопить только +4000 к весу, идеал 4500, 5% = 225 => violation)
    add_z2 = 4000.0
    target_after_z2 = target_z1_total + add_z2
    w = target_z1_total
    while w < target_after_z2 - 1:
        w = min(w + step_load, target_after_z2)
        push(z2[0], z2[1], w)

    # переезд в зону 3
    for la, lo in zip(lerp(z2[0], z3[0], 10), lerp(z2[1], z3[1], 10)):
        push(la, lo, target_after_z2)

    # зона 3: ровно +3000 (без нарушения по этой компоненте)
    add_z3 = 3000.0
    target_after_z3 = target_after_z2 + add_z3
    w = target_after_z2
    while w < target_after_z3 - 1:
        w = min(w + step_load, target_after_z3)
        push(z3[0], z3[1], w)

    # к точке выгрузки
    for la, lo in zip(lerp(z3[0], unload_c[0], 12), lerp(z3[1], unload_c[1], 12)):
        push(la, lo, target_after_z3)

    # выгрузка: резкие отрицательные шаги (в зоне разгрузки)
    w = target_after_z3
    final_residue = 50.0
    unload_step = -450.0
    while w > final_residue + abs(unload_step):
        w += unload_step
        if w < final_residue:
            w = final_residue
        push(unload_c[0], unload_c[1], max(w, final_residue))

    w = final_residue
    push(unload_c[0], unload_c[1], w)

    # В tracker время берётся из timestamp кадров: нужно ≥ BATCH_END_DELAY сек между первым «stable» и завершением.
    first_stable_t = t_ms + 500
    for i in range(batch_end + 2):
        tm = first_stable_t + i * 1000
        fr = base_telemetry(unload_c[0], unload_c[1], final_residue, tm)
        fr["delay_ms"] = 400 if i == 0 else 1000
        frames.append(fr)

    out = root / "scenarios" / "06_full_batch_from_zones.json"
    out.write_text(json.dumps(frames, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(frames)} frames to {out}")


if __name__ == "__main__":
    main()
