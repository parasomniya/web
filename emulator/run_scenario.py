"""
Отправка кадров телеметрии из JSON на выбранный URL (POST).
По умолчанию отправляет на локальный сервер: http://localhost:3000/api/telemetry/host
(можно переопределить аргументом --url или env TEST_URL).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

import requests


DEFAULT_URL = os.environ.get("TEST_URL", "http://localhost:3000/api/telemetry/host")


def load_frames(path: Path) -> list[dict[str, Any]]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return raw
    if isinstance(raw, dict) and "frames" in raw:
        frames = raw["frames"]
        if isinstance(frames, list):
            return frames
    raise ValueError("Ожидается массив кадров или объект с ключом 'frames'")


def post_frame(url: str, body: dict[str, Any], timeout: float) -> requests.Response:
    return requests.post(
        url,
        json=body,
        headers={"Content-Type": "application/json"},
        timeout=timeout,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Отправить сценарий телеметрии (POST JSON кадры).")
    parser.add_argument("scenario", type=Path, help="Путь к .json со списком кадров")
    parser.add_argument(
        "--url",
        default=DEFAULT_URL,
        help=f"Полный URL POST (по умолчанию: из http://45.67.57.227 или {DEFAULT_URL!r})",
    )
    parser.add_argument("--timeout", type=float, default=10.0)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Только печать кадров, без HTTP",
    )
    args = parser.parse_args()

    if not args.scenario.is_file():
        print(f"Файл не найден: {args.scenario}", file=sys.stderr)
        return 1

    frames = load_frames(args.scenario)
    for i, frame in enumerate(frames):
        delay_ms = frame.get("delay_ms")
        body = {k: v for k, v in frame.items() if k != "delay_ms"}
        if delay_ms is not None:
            time.sleep(float(delay_ms) / 1000.0)

        if args.dry_run:
            print(f"[{i}] {json.dumps(body, ensure_ascii=False)}")
            continue

        try:
            r = post_frame(args.url, body, args.timeout)
            print(f"[{i}] {r.status_code} {r.text[:200]}")
        except requests.RequestException as e:
            print(f"[{i}] Ошибка запроса: {e}", file=sys.stderr)
            return 2

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
