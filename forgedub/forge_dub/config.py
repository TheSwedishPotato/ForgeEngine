"""Application settings, loaded from environment variables with sane defaults."""
from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from .capabilities import detect

BASE_DIR = Path(__file__).resolve().parent.parent  # the forgedub/ folder
WEB_DIR = BASE_DIR / "web"
DEFAULT_DATA_DIR = BASE_DIR / "data"


def _env(name: str, default: str) -> str:
    value = os.environ.get(name)
    return value if value not in (None, "") else default


def _env_bool(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value in (None, ""):
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


@dataclass
class Settings:
    # Languages (ForgeDub is tuned for English -> Swedish, but configurable)
    source_lang: str = "en"
    target_lang: str = "sv"

    # Engine selection
    engine_mode: str = "auto"          # auto | real | mock
    device: str = "auto"               # auto | cpu | cuda
    whisper_model: str = "base"        # tiny | base | small | medium | large-v3
    translate_engine: str = "argos"    # argos | mock
    tts_engine: str = "auto"           # auto | xtts | piper | mock
    voice_clone: bool = True
    separate_background: bool = False

    # I/O and server
    data_dir: Path = DEFAULT_DATA_DIR
    web_dir: Path = WEB_DIR
    max_upload_mb: int = 4096
    host: str = "127.0.0.1"
    port: int = 8765

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            source_lang=_env("FORGEDUB_SRC", "en"),
            target_lang=_env("FORGEDUB_TGT", "sv"),
            engine_mode=_env("FORGEDUB_ENGINE", "auto"),
            device=_env("FORGEDUB_DEVICE", "auto"),
            whisper_model=_env("FORGEDUB_WHISPER_MODEL", "base"),
            translate_engine=_env("FORGEDUB_TRANSLATE", "argos"),
            tts_engine=_env("FORGEDUB_TTS", "auto"),
            voice_clone=_env_bool("FORGEDUB_VOICE_CLONE", True),
            separate_background=_env_bool("FORGEDUB_SEPARATE_BG", False),
            data_dir=Path(_env("FORGEDUB_DATA_DIR", str(DEFAULT_DATA_DIR))),
            max_upload_mb=int(_env("FORGEDUB_MAX_UPLOAD_MB", "4096")),
            host=_env("FORGEDUB_HOST", "127.0.0.1"),
            port=int(_env("FORGEDUB_PORT", "8765")),
        )

    @property
    def uploads_dir(self) -> Path:
        return self.data_dir / "uploads"

    @property
    def jobs_dir(self) -> Path:
        return self.data_dir / "jobs"

    def ensure_dirs(self) -> None:
        for path in (self.data_dir, self.uploads_dir, self.jobs_dir):
            path.mkdir(parents=True, exist_ok=True)

    def effective_mode(self) -> str:
        """Resolve 'auto' to 'real' or 'mock' based on what's installed."""
        if self.engine_mode in ("real", "mock"):
            return self.engine_mode
        return "real" if detect().real_ready else "mock"

    def resolved_device(self) -> str:
        if self.device != "auto":
            return self.device
        return "cuda" if detect().cuda else "cpu"

    def summary(self) -> dict:
        return {
            "source_lang": self.source_lang,
            "target_lang": self.target_lang,
            "engine_mode": self.engine_mode,
            "effective_mode": self.effective_mode(),
            "device": self.resolved_device(),
            "whisper_model": self.whisper_model,
            "tts_engine": self.tts_engine,
            "voice_clone": self.voice_clone,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings.from_env()
    settings.ensure_dirs()
    return settings
