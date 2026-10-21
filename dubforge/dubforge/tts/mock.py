from __future__ import annotations

import numpy as np

from ..base import Style, TTS
from ..config import Config
from .common import expected_duration, normalize_text


class MockTTS(TTS):
    """Speech-shaped noise bursts whose length follows the text. Pipeline smoke tests only."""
    name = "mock"

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.sample_rate = 24000

    def synthesize(self, text: str, lang: str, reference_wav, style: Style) -> np.ndarray:
        dur = expected_duration(normalize_text(text), lang)
        n = int(dur * self.sample_rate)
        t = np.arange(n) / self.sample_rate
        f0 = 140 + 40 * style.exaggeration
        syll = 0.5 * (1 + np.sin(2 * np.pi * 4.0 * t))                      # ~4 syllables/s envelope
        x = (np.sin(2 * np.pi * f0 * t) + 0.5 * np.sin(2 * np.pi * 2 * f0 * t)) * syll
        x = np.concatenate([np.zeros(int(0.05 * self.sample_rate)), x, np.zeros(int(0.05 * self.sample_rate))])
        return (0.3 * x / (np.max(np.abs(x)) + 1e-9)).astype(np.float32)
