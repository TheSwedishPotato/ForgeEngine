"""Backend interfaces. Every swappable model implements one of these.

To add a model: subclass the interface, then register it in `dubforge/registry.py`
(one line). Nothing else in the pipeline changes.
"""
from __future__ import annotations

import gc
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from .types import Segment

Progress = Callable[[float, str], None]


def _noop(frac: float, msg: str = "") -> None:
    pass


class Backend(ABC):
    """Heavy models are loaded lazily and released after their stage so an 8 GB card
    only ever holds one model at a time."""

    name = "backend"

    def load(self) -> None:          # noqa: B027 - optional
        pass

    def unload(self) -> None:
        for attr in list(vars(self)):
            if attr.startswith("_model") or attr in ("model", "pipe", "classifier"):
                setattr(self, attr, None)
        gc.collect()
        try:
            import torch
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except Exception:
            pass

    def __enter__(self):
        self.load()
        return self

    def __exit__(self, *exc):
        self.unload()


class Separator(Backend):
    @abstractmethod
    def separate(self, audio_path: Path, out_dir: Path, progress: Progress = _noop) -> tuple[Path, Path]:
        """Split a stereo wav into (vocals.wav, accompaniment.wav) at the same sample rate."""


class ASR(Backend):
    @abstractmethod
    def transcribe(self, wav_path: Path, language: str | None, progress: Progress = _noop
                   ) -> tuple[list[Segment], str]:
        """Return timed segments (with word timings if available) and the language code."""

    def transcribe_array(self, audio_16k: np.ndarray, language: str | None) -> tuple[list[Segment], str]:
        """In-memory variant for live mode (mono float32, 16 kHz). Optional."""
        raise NotImplementedError(f"{self.name} does not support live transcription")


class Diarizer(Backend):
    @abstractmethod
    def assign(self, wav_path: Path, segments: list[Segment]) -> None:
        """Set `segment.speaker` in place."""


class EmotionClassifier(Backend):
    @abstractmethod
    def classify(self, wav_path: Path, segments: list[Segment], progress: Progress = _noop) -> None:
        """Set `segment.emotion` / `emotion_score` in place."""


class Translator(Backend):
    @abstractmethod
    def translate(self, segments: list[Segment], src: str, tgt: str, progress: Progress = _noop) -> None:
        """Set `segment.translation` in place."""


@dataclass
class Style:
    emotion: str = "neutral"
    exaggeration: float = 0.5     # 0..1+, expressiveness (Chatterbox)
    arousal: float = 0.0          # -1 (quiet/calm) .. +1 (loud/intense) vs the speaker's norm
    seed: int | None = None


class TTS(Backend):
    sample_rate: int = 24000

    def supports(self, lang: str) -> bool:
        return True

    @abstractmethod
    def synthesize(self, text: str, lang: str, reference_wav: Path, style: Style) -> np.ndarray:
        """Mono float32 speech in the reference speaker's voice."""


class LipSync(Backend):
    @abstractmethod
    def sync_clip(self, frames: list[np.ndarray], audio_16k: np.ndarray, fps: float
                  ) -> list[np.ndarray] | None:
        """Re-render mouths so `frames` match `audio_16k`. BGR uint8 frames in/out, same count.
        Return None if the clip should stay untouched (no usable face)."""
