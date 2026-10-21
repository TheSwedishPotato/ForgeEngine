from __future__ import annotations

from pathlib import Path

from ..base import EmotionClassifier, Progress, _noop
from ..config import Config
from ..types import Segment


class NoEmotion(EmotionClassifier):
    """Skip the classifier; everything stays 'neutral' (loudness-based intensity still applies)."""
    name = "none"

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def classify(self, wav_path: Path, segments: list[Segment], progress: Progress = _noop) -> None:
        pass
