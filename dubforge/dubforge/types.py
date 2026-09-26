"""Core data structures shared by every stage.

The transcript is saved as human-editable JSON between stages, so you can fix a
translation (or mark a line ``keep_original``) and re-run from the TTS stage.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any, Iterable


@dataclass
class Word:
    start: float
    end: float
    text: str
    prob: float = 1.0
    speaker: str | None = None


@dataclass
class Segment:
    id: int
    start: float
    end: float
    text: str
    speaker: str = "SPEAKER_00"
    words: list[Word] = field(default_factory=list)
    avg_logprob: float | None = None
    no_speech_prob: float | None = None

    # translation stage
    translation: str | None = None
    translation_candidates: list[str] = field(default_factory=list)
    translation_locked: bool = False  # user-edited: never swap for a shorter candidate

    # emotion / prosody stage
    emotion: str | None = None
    emotion_scores: dict[str, float] = field(default_factory=dict)
    prosody: dict[str, float] = field(default_factory=dict)

    # user flags
    keep_original: bool = False  # e.g. songs, names shouted, lines you like in the original

    # tts / timing stage
    tts_text: str | None = None  # what was actually spoken (may be a shorter candidate)
    tts_path: str | None = None
    tts_take: int | None = None
    tts_speed: float | None = None
    stretch: float | None = None
    placed_start: float | None = None
    placed_end: float | None = None
    fit_notes: str = ""

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)

    @property
    def speech_start(self) -> float:
        """Start of the first word (Whisper segment bounds often include silence)."""
        if self.words:
            return max(self.start, min(w.start for w in self.words))
        return self.start

    @property
    def speech_end(self) -> float:
        if self.words:
            return min(self.end, max(w.end for w in self.words))
        return self.end

    @property
    def speech_duration(self) -> float:
        return max(0.0, self.speech_end - self.speech_start)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Segment":
        known = {f.name for f in fields(cls)}
        data = {k: v for k, v in d.items() if k in known}
        data["words"] = [Word(**w) for w in d.get("words", [])]
        return cls(**data)


@dataclass
class Transcript:
    segments: list[Segment]
    language: str
    duration: float
    target_language: str | None = None
    speakers: list[str] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)

    def refresh_speakers(self) -> None:
        totals: dict[str, float] = {}
        for s in self.segments:
            totals[s.speaker] = totals.get(s.speaker, 0.0) + s.duration
        self.speakers = sorted(totals, key=lambda k: -totals[k])

    def renumber(self) -> None:
        self.segments.sort(key=lambda s: (s.start, s.end))
        for i, s in enumerate(self.segments):
            s.id = i

    def by_speaker(self) -> dict[str, list[Segment]]:
        out: dict[str, list[Segment]] = {}
        for s in self.segments:
            out.setdefault(s.speaker, []).append(s)
        return out

    def dubbable(self) -> Iterable[Segment]:
        return (s for s in self.segments if not s.keep_original and (s.translation or "").strip())

    def to_dict(self) -> dict[str, Any]:
        return {
            "language": self.language,
            "target_language": self.target_language,
            "duration": self.duration,
            "speakers": self.speakers,
            "meta": self.meta,
            "segments": [s.to_dict() for s in self.segments],
        }

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "Transcript":
        return cls(
            segments=[Segment.from_dict(s) for s in d.get("segments", [])],
            language=d.get("language", "en"),
            duration=float(d.get("duration", 0.0)),
            target_language=d.get("target_language"),
            speakers=list(d.get("speakers", [])),
            meta=dict(d.get("meta", {})),
        )

    def save(self, path: str | os.PathLike) -> None:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(path.suffix + ".tmp")
        tmp.write_text(json.dumps(self.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(tmp, path)

    @classmethod
    def load(cls, path: str | os.PathLike) -> "Transcript":
        return cls.from_dict(json.loads(Path(path).read_text(encoding="utf-8")))

    def copy(self) -> "Transcript":
        return Transcript.from_dict(json.loads(json.dumps(self.to_dict())))


EMOTIONS = ("neutral", "happy", "angry", "sad", "whisper")
