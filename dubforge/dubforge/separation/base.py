"""Dialogue / background separation.

We only ask each backend for the *vocals* of a chunk and derive
``background = mix - vocals``. That guarantees background + vocals == original
exactly, so everything we don't re-voice (music, effects, laughs, breaths)
comes back untouched.

Long movies are processed chunk by chunk with extra context on both sides
(thrown away afterwards) so RAM/VRAM stay bounded and there are no seams.
"""

from __future__ import annotations

import os
from abc import ABC, abstractmethod
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import SeparationConfig
from ..utils.gpu import free_memory
from ..utils.log import ProgressFn, get_logger, null_progress

log = get_logger("separation")


class Separator(ABC):
    name = "base"

    def __init__(self, cfg: SeparationConfig, device: str = "cpu", models_dir: str | os.PathLike | None = None):
        self.cfg = cfg
        self.device = device
        self.models_dir = Path(models_dir) if models_dir else None

    def load(self) -> None:  # noqa: B027 - optional hook
        pass

    def unload(self) -> None:  # noqa: B027 - optional hook
        free_memory()

    @abstractmethod
    def separate_array(self, audio: np.ndarray, sr: int) -> np.ndarray:
        """audio: [n, ch] float32 -> vocals with the same shape and sample rate."""

    def separate_file(self, mix_path: str | os.PathLike, vocals_out: str | os.PathLike,
                      background_out: str | os.PathLike, progress: ProgressFn = null_progress) -> None:
        info = sf.info(str(mix_path))
        sr, total, ch = info.samplerate, info.frames, info.channels
        chunk = max(sr, int(self.cfg.chunk_seconds * sr))
        margin = int(self.cfg.context_seconds * sr)
        self.load()
        try:
            with sf.SoundFile(str(mix_path)) as src, \
                    sf.SoundFile(str(vocals_out), "w", sr, ch, subtype="PCM_16") as vo, \
                    sf.SoundFile(str(background_out), "w", sr, ch, subtype="PCM_16") as bo:
                for core_start in range(0, total, chunk):
                    core_end = min(total, core_start + chunk)
                    read_start = max(0, core_start - margin)
                    read_end = min(total, core_end + margin)
                    src.seek(read_start)
                    block = src.read(read_end - read_start, dtype="float32", always_2d=True)
                    vocals = self.separate_array(block, sr)
                    s = core_start - read_start
                    e = s + (core_end - core_start)
                    v = np.clip(vocals[s:e], -1, 1)
                    vo.write(v)
                    bo.write(np.clip(block[s:e] - v, -1, 1))
                    progress(core_end / total, f"separating {core_end / sr / 60:.1f}/{total / sr / 60:.1f} min")
        finally:
            self.unload()


class NoSeparation(Separator):
    """Treat the whole mix as 'vocals' (fastest; background is then lost under dubbed lines)."""

    name = "none"

    def separate_array(self, audio: np.ndarray, sr: int) -> np.ndarray:
        return audio.copy()


class MockSeparator(Separator):
    """Test backend: splits by frequency band (voice band -> 'vocals')."""

    name = "mock"

    def separate_array(self, audio: np.ndarray, sr: int) -> np.ndarray:
        from scipy.signal import butter, sosfiltfilt

        if len(audio) < 64:
            return audio.copy()
        sos = butter(6, [250, 4000], btype="bandpass", fs=sr, output="sos")
        return sosfiltfilt(sos, audio, axis=0).astype(np.float32)
