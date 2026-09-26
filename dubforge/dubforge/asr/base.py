from __future__ import annotations

import os
from abc import ABC, abstractmethod
from pathlib import Path

import numpy as np

from ..config import ASRConfig
from ..media import audio as au
from ..types import Segment, Transcript, Word
from ..utils.gpu import free_memory
from ..utils.log import ProgressFn, null_progress


class ASRBackend(ABC):
    """Speech -> timed text. Input is always 16 kHz mono (the separated vocals)."""

    name = "base"
    provides_diarization = False

    def __init__(self, cfg: ASRConfig, device: str = "cpu", models_dir: str | os.PathLike | None = None,
                 hf_token: str | None = None):
        self.cfg = cfg
        self.device = device
        self.models_dir = Path(models_dir) if models_dir else None
        self.hf_token = hf_token

    @abstractmethod
    def transcribe(self, audio_path: str | os.PathLike, language: str | None,
                   progress: ProgressFn = null_progress) -> Transcript:
        ...

    def unload(self) -> None:
        free_memory()

    @property
    def compute_type(self) -> str:
        if self.device == "cpu" and "float16" in self.cfg.compute_type:
            return "int8"
        return self.cfg.compute_type


def join_words(words: list[str], language: str | None) -> str:
    if language in ("ja", "zh", "yue", "th", "lo", "my"):
        return "".join(w.strip() for w in words).strip()
    text = "".join(w if w.startswith(" ") else " " + w for w in words)
    return " ".join(text.split())


class MockASR(ASRBackend):
    """Energy-based 'recognizer' for tests: every voiced region becomes a numbered line."""

    name = "mock"

    def transcribe(self, audio_path, language, progress=null_progress) -> Transcript:
        audio, sr = au.load(audio_path, sr=16000, mono=True)
        regions = energy_regions(audio, sr)
        segs = []
        for i, (a, b) in enumerate(regions):
            n_words = max(1, int((b - a) * 2.5))
            words, step = [], (b - a) / n_words
            for k in range(n_words):
                words.append(Word(start=a + k * step, end=a + (k + 1) * step - 0.02, text=f"w{i}_{k}"))
            segs.append(Segment(id=i, start=a, end=b, text=" ".join(w.text for w in words), words=words,
                                avg_logprob=-0.2, no_speech_prob=0.01))
        progress(1.0, "mock transcription done")
        return Transcript(segments=segs, language=language or "en", duration=len(audio) / sr)


def energy_regions(audio: np.ndarray, sr: int, frame_ms: float = 20.0, threshold_db: float = -35.0,
                   min_silence: float = 0.25, min_len: float = 0.25) -> list[tuple[float, float]]:
    """Crude VAD: frames above (peak + threshold_db) grouped into regions."""
    n = int(sr * frame_ms / 1000)
    frames = len(audio) // n
    if frames == 0:
        return []
    levels = np.sqrt(np.mean(audio[: frames * n].reshape(frames, n) ** 2, axis=1) + 1e-12)
    thr = levels.max() * au.db_to_gain(threshold_db)
    voiced = levels > thr
    regions: list[tuple[float, float]] = []
    start = None
    silence = 0
    max_sil = int(min_silence * 1000 / frame_ms)
    for i, v in enumerate(voiced):
        if v:
            if start is None:
                start = i
            silence = 0
        elif start is not None:
            silence += 1
            if silence > max_sil:
                regions.append((start, i - silence + 1))
                start, silence = None, 0
    if start is not None:
        regions.append((start, frames - silence))
    dt = frame_ms / 1000
    return [(a * dt, b * dt) for a, b in regions if (b - a) * dt >= min_len]
