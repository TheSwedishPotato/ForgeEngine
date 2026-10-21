from __future__ import annotations

from pathlib import Path

from ..base import Diarizer
from ..config import Config
from ..types import Segment


class SingleSpeaker(Diarizer):
    """Everything is one voice (monologues, tests)."""
    name = "single"

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def assign(self, wav_path: Path, segments: list[Segment]) -> None:
        for s in segments:
            s.speaker = "SPK0"
