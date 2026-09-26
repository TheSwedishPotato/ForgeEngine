from __future__ import annotations

import hashlib
import os
from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

import numpy as np

from ..config import TTSConfig
from ..utils.gpu import free_memory
from .voice_bank import RefClip


@dataclass
class StyleRef:
    """'How to say it' conditioning: usually the original line itself."""

    path: str
    text: str = ""
    lang: str = "en"
    duration: float = 0.0
    emotion: str | None = None


class TTSBackend(ABC):
    name = "base"
    sample_rate = 24000
    supports_speed = False  # can the model itself speak faster (more natural than DSP stretching)?
    languages: set[str] = set()  # DubForge language codes (see translation.languages)

    def __init__(self, cfg: TTSConfig, device: str = "cpu", models_dir: str | os.PathLike | None = None):
        self.cfg = cfg
        self.device = device
        self.models_dir = Path(models_dir) if models_dir else None

    def load(self) -> None:  # noqa: B027
        pass

    def unload(self) -> None:  # noqa: B027
        free_memory()

    def supports_language(self, lang: str) -> bool:
        return not self.languages or lang in self.languages

    @abstractmethod
    def set_voice(self, speaker: str, refs: list[RefClip], ref_lang: str) -> None:
        """Register a speaker's reference clips (timbre)."""

    @abstractmethod
    def synthesize(self, text: str, lang: str, speaker: str, *, style: StyleRef | None = None,
                   speed: float = 1.0, temperature: float | None = None, seed: int | None = None) -> np.ndarray:
        """Return mono float32 audio at self.sample_rate."""

    def synthesize_stream(self, text: str, lang: str, speaker: str, *, style: StyleRef | None = None,
                          speed: float = 1.0, temperature: float | None = None,
                          seed: int | None = None) -> Iterator[np.ndarray]:
        yield self.synthesize(text, lang, speaker, style=style, speed=speed, temperature=temperature, seed=seed)


class MockTTS(TTSBackend):
    """Test backend: a buzzy 'voice' whose length follows the text and whose pitch identifies the speaker."""

    name = "mock"
    sample_rate = 24000
    supports_speed = True

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.voices: dict[str, float] = {}

    def set_voice(self, speaker, refs, ref_lang):
        h = int(hashlib.md5(speaker.encode()).hexdigest()[:6], 16)
        self.voices[speaker] = 110.0 + (h % 120)

    def synthesize(self, text, lang, speaker, *, style=None, speed=1.0, temperature=None, seed=None):
        from ..translation.languages import estimate_seconds

        rng = np.random.default_rng(seed if seed is not None else 0)
        dur = max(0.3, estimate_seconds(text, lang) / max(speed, 0.1)) * float(rng.uniform(0.95, 1.08))
        n = int(dur * self.sample_rate)
        t = np.arange(n) / self.sample_rate
        f0 = self.voices.get(speaker, 150.0)
        tone = sum(np.sin(2 * np.pi * f0 * k * t) / k for k in range(1, 6))
        syll = 0.55 + 0.45 * np.sin(2 * np.pi * 4.5 * t) ** 2
        out = 0.15 * tone * syll
        return np.pad(out.astype(np.float32), (int(0.05 * self.sample_rate), int(0.08 * self.sample_rate)))
