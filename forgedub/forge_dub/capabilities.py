"""Runtime capability detection.

ForgeDub runs in two modes:

* **real**  — the full AI engine (ffmpeg + Whisper + translator + TTS) is
  installed, so it produces genuine Swedish dubs.
* **mock**  — none of the heavy dependencies are present, so it runs a built-in
  demo that exercises the whole pipeline without any models. This lets the app
  start anywhere (including this cloud container) and lets you click through the
  UI before installing the model pack.

This module figures out which pieces are available. Detection is cached because
it never changes during a run; call :func:`refresh` after installing something.
"""
from __future__ import annotations

import importlib.util
import shutil
from dataclasses import asdict, dataclass
from functools import lru_cache


def _has_module(name: str) -> bool:
    try:
        return importlib.util.find_spec(name) is not None
    except (ImportError, ValueError):
        return False


def has_ffmpeg() -> bool:
    return shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def has_whisper() -> bool:
    return _has_module("faster_whisper")


def has_translator() -> bool:
    return _has_module("argostranslate")


def has_xtts() -> bool:
    return _has_module("TTS")


def has_piper() -> bool:
    return _has_module("piper") or shutil.which("piper") is not None


def has_ytdlp() -> bool:
    return _has_module("yt_dlp") or shutil.which("yt-dlp") is not None


def has_cuda() -> bool:
    if not _has_module("torch"):
        return False
    try:
        import torch  # heavy; only imported when actually present

        return bool(torch.cuda.is_available())
    except Exception:
        return False


@dataclass(frozen=True)
class Capabilities:
    ffmpeg: bool
    whisper: bool
    translator: bool
    xtts: bool
    piper: bool
    ytdlp: bool
    cuda: bool

    @property
    def tts(self) -> bool:
        return self.xtts or self.piper

    @property
    def real_ready(self) -> bool:
        """Minimum needed for a genuine dub: audio I/O + ASR + MT + TTS."""
        return self.ffmpeg and self.whisper and self.translator and self.tts

    def to_dict(self) -> dict:
        d = asdict(self)
        d["tts"] = self.tts
        d["real_ready"] = self.real_ready
        return d


@lru_cache(maxsize=1)
def detect() -> Capabilities:
    return Capabilities(
        ffmpeg=has_ffmpeg(),
        whisper=has_whisper(),
        translator=has_translator(),
        xtts=has_xtts(),
        piper=has_piper(),
        ytdlp=has_ytdlp(),
        cuda=has_cuda(),
    )


def refresh() -> Capabilities:
    """Clear the cache and re-detect (use after installing the model pack)."""
    detect.cache_clear()
    return detect()
