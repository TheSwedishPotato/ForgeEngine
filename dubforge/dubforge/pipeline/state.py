"""Stage cache for resumable runs: a 2-hour film should never be re-separated or
re-transcribed because you tweaked a TTS setting."""

from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path
from typing import Any


def file_sha(path: str | os.PathLike) -> str:
    h = hashlib.sha1()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()[:16]


def input_identity(path: str | os.PathLike) -> str:
    st = os.stat(path)
    return hashlib.sha1(f"{Path(path).resolve()}|{st.st_size}|{int(st.st_mtime)}".encode()).hexdigest()[:16]


def chain(*parts: Any) -> str:
    return hashlib.sha1(json.dumps(parts, sort_keys=True, default=str).encode()).hexdigest()[:16]


class StageState:
    def __init__(self, path: str | os.PathLike):
        self.path = Path(path)
        self.data: dict[str, dict[str, Any]] = {}
        if self.path.exists():
            try:
                self.data = json.loads(self.path.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                self.data = {}

    def is_done(self, stage: str, key: str, outputs: list[Path]) -> bool:
        entry = self.data.get(stage)
        return bool(entry) and entry.get("key") == key and all(Path(p).exists() for p in outputs)

    def mark(self, stage: str, key: str, **extra: Any) -> None:
        self.data[stage] = {"key": key, "time": time.strftime("%Y-%m-%d %H:%M:%S"), **extra}
        self.save()

    def get(self, stage: str, field: str, default: Any = None) -> Any:
        return self.data.get(stage, {}).get(field, default)

    def invalidate(self, stages: list[str]) -> None:
        for s in stages:
            self.data.pop(s, None)
        self.save()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.data, indent=2), encoding="utf-8")
        os.replace(tmp, self.path)
