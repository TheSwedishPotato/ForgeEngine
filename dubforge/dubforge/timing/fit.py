"""Isochrony: make each dubbed line fit the time the actor actually speaks.

For each line we compute a *target* (the original speech span) and a hard
*limit* (how far we may run into the following silence before colliding with
the next line). A line that is too long is fixed, in order of naturalness:
  1. choose a shorter translation candidate (TTS stage)
  2. ask the TTS model to speak faster (XTTS/GPT-SoVITS `speed`)
  3. DSP time-compression (pitch preserved)
  4. overflow into the following silence
  5. last resort: fade out at the limit
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from ..config import TimingConfig
from ..types import Segment
from .stretch import time_stretch


@dataclass
class Window:
    start: float  # where the dub starts (original first word)
    target_end: float  # where the original speech ends
    limit_end: float  # hard stop

    @property
    def target(self) -> float:
        return max(0.05, self.target_end - self.start)

    @property
    def limit(self) -> float:
        return max(self.target, self.limit_end - self.start)


def compute_windows(segments: list[Segment], cfg: TimingConfig, total_duration: float | None = None) -> dict[int, Window]:
    segs = sorted(segments, key=lambda s: s.start)
    out: dict[int, Window] = {}
    for i, s in enumerate(segs):
        start, end = s.speech_start, s.speech_end
        nxt = next((o for o in segs[i + 1:] if o.speech_start > start + 0.05), None)
        limit = end + cfg.max_overflow_seconds
        if nxt is not None:
            limit = min(limit, nxt.speech_start - cfg.min_gap_seconds)
        if total_duration:
            limit = min(limit, total_duration)
        out[s.id] = Window(start=start, target_end=end, limit_end=max(end, limit))
    return out


def speed_for(duration: float, window: Window, cfg: TimingConfig) -> float:
    """TTS-side speed factor to request (1.0 = don't re-synthesize)."""
    if duration <= window.target * (1 + cfg.tolerance):
        return 1.0
    return float(min(cfg.max_tts_speed, duration / window.target))


@dataclass
class FitResult:
    audio: np.ndarray
    rate: float
    trimmed: bool
    notes: str


def fit_audio(x: np.ndarray, sr: int, window: Window, cfg: TimingConfig) -> FitResult:
    dur = len(x) / sr
    notes = []
    rate = 1.0
    if dur > window.target * (1 + cfg.tolerance):
        rate = min(cfg.max_stretch, dur / window.target)
        # if even the max stretch overflows the hard limit, allow up to 15% more squeeze
        if dur / rate > window.limit:
            rate = min(cfg.max_stretch * 1.15, dur / window.limit)
        notes.append(f"compress x{rate:.2f}")
    elif cfg.allow_slowdown and dur < window.target * cfg.min_fill_ratio:
        rate = max(cfg.max_slowdown, dur / (window.target * cfg.min_fill_ratio))
        notes.append(f"slow x{rate:.2f}")
    y = time_stretch(x, sr, rate, cfg.stretch_method) if abs(rate - 1) > 0.01 else x
    trimmed = False
    max_n = int(window.limit * sr)
    if len(y) > max_n:
        fade_n = min(len(y), int(0.08 * sr))
        y = y[:max_n].copy()
        y[-fade_n:] *= np.linspace(1.0, 0.0, fade_n, dtype=np.float32)
        trimmed = True
        notes.append("trimmed")
    return FitResult(y.astype(np.float32), rate, trimmed, ", ".join(notes))
