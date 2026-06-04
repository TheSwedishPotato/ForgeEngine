"""Core data structures shared across the pipeline and API."""
from __future__ import annotations

import time
import uuid
from dataclasses import asdict, dataclass, field
from enum import Enum
from typing import List, Optional


class Stage(str, Enum):
    QUEUED = "queued"
    INTAKE = "intake"
    EXTRACT = "extract"
    SEPARATE = "separate"
    TRANSCRIBE = "transcribe"
    TRANSLATE = "translate"
    SYNTHESIZE = "synthesize"
    ALIGN = "align"
    MUX = "mux"
    DONE = "done"
    ERROR = "error"


# Human-readable labels surfaced in the UI.
STAGE_LABELS = {
    Stage.QUEUED: "Queued",
    Stage.INTAKE: "Loading media",
    Stage.EXTRACT: "Extracting audio",
    Stage.SEPARATE: "Separating background",
    Stage.TRANSCRIBE: "Transcribing English",
    Stage.TRANSLATE: "Translating to Swedish",
    Stage.SYNTHESIZE: "Generating Swedish voices",
    Stage.ALIGN: "Aligning timing",
    Stage.MUX: "Rendering video",
    Stage.DONE: "Done",
    Stage.ERROR: "Error",
}


@dataclass
class Segment:
    """A single spoken line with its source/target text and timing."""

    id: int
    start: float
    end: float
    text_src: str = ""
    text_tgt: str = ""
    speaker: Optional[str] = None
    audio_path: Optional[str] = None  # synthesized clip on disk

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)

    def to_dict(self) -> dict:
        data = asdict(self)
        data["duration"] = round(self.duration, 3)
        data.pop("audio_path", None)  # internal detail, not exposed to the UI
        return data


@dataclass
class Transcript:
    language: str
    duration: float
    segments: List[Segment]


def _new_id() -> str:
    return uuid.uuid4().hex[:12]


@dataclass
class Job:
    """A single dubbing request, tracked from submission to finished file."""

    id: str = field(default_factory=_new_id)
    source_type: str = "upload"          # upload | url
    source: str = ""                     # original filename or URL
    title: str = ""

    status: str = "queued"               # queued | running | done | error
    stage: Stage = Stage.QUEUED
    progress: float = 0.0
    message: str = "Queued"
    error: str = ""
    mode: str = "auto"                   # effective engine mode actually used

    # Per-job options (override the global settings for this run)
    target_lang: str = "sv"
    voice_clone: bool = True
    separate_background: bool = False

    duration: float = 0.0
    segments: List[Segment] = field(default_factory=list)

    input_path: Optional[str] = None
    audio_path: Optional[str] = None     # extracted speech track (for re-renders)
    output_path: Optional[str] = None
    output_kind: str = ""                # "video" | "audio"

    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def to_dict(self, include_segments: bool = True) -> dict:
        stage = self.stage.value if isinstance(self.stage, Stage) else self.stage
        data = {
            "id": self.id,
            "source_type": self.source_type,
            "source": self.source,
            "title": self.title or self.source,
            "status": self.status,
            "stage": stage,
            "stage_label": STAGE_LABELS.get(self.stage, stage),
            "progress": round(self.progress, 4),
            "message": self.message,
            "error": self.error,
            "mode": self.mode,
            "target_lang": self.target_lang,
            "voice_clone": self.voice_clone,
            "duration": round(self.duration, 3),
            "output_kind": self.output_kind,
            "has_output": bool(self.output_path),
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }
        if include_segments:
            data["segments"] = [s.to_dict() for s in self.segments]
        else:
            data["segment_count"] = len(self.segments)
        return data
