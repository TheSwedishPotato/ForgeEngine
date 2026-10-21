"""Shared data types. Segments are the unit every pipeline stage reads and writes."""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any


@dataclass
class Word:
    start: float
    end: float
    text: str


@dataclass
class Segment:
    id: int
    start: float
    end: float
    text: str                                   # source-language text
    speaker: str = "SPK0"
    words: list[Word] = field(default_factory=list)
    emotion: str = "neutral"
    emotion_score: float = 0.0
    energy_db: float | None = None              # active RMS of the original vocals (dBFS)
    translation: str = ""
    skip: bool = False                          # e.g. lyrics / music notes: leave original audio
    tts_path: str | None = None
    tts_duration: float | None = None
    fit: dict[str, Any] = field(default_factory=dict)
    notes: list[str] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Segment":
        known = {f.name for f in fields(cls)}
        d = {k: v for k, v in d.items() if k in known}
        d["words"] = [Word(**w) if isinstance(w, dict) else w for w in d.get("words", [])]
        return cls(**d)


def save_segments(path: str | Path, segments: list[Segment], meta: dict[str, Any] | None = None) -> None:
    payload = {"meta": meta or {}, "segments": [s.to_dict() for s in segments]}
    tmp = Path(str(path) + ".tmp")
    tmp.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(path)


def load_segments(path: str | Path) -> tuple[list[Segment], dict[str, Any]]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    return [Segment.from_dict(d) for d in payload["segments"]], payload.get("meta", {})
