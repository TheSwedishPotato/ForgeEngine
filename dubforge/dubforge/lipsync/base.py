"""Lip-sync backends operate on short per-line clips, never on the whole film.

Only frames where a dubbed line is spoken are re-rendered; everything else is
the untouched original. If a backend fails on a clip (no face, side profile,
speaker off-screen) that clip simply keeps its original frames.
"""

from __future__ import annotations

import os
import shutil
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from pathlib import Path

from ..config import LipSyncConfig
from ..utils.log import ProgressFn, get_logger, null_progress

log = get_logger("lipsync")


@dataclass
class LipSyncJob:
    id: int
    start_frame: int
    n_frames: int
    video: str  # original frames of this span (video only)
    audio: str  # dub voice for exactly this span (wav)
    out: str  # where the backend writes the lip-synced clip
    seg_ids: list[int] = field(default_factory=list)


class LipSyncBackend(ABC):
    name = "base"

    def __init__(self, cfg: LipSyncConfig, device: str = "cpu", models_dir: str | os.PathLike | None = None):
        self.cfg = cfg
        self.device = device
        self.models_dir = Path(models_dir) if models_dir else None

    def check(self) -> None:  # noqa: B027
        """Raise early (before hours of TTS) if the backend is not installed."""

    @abstractmethod
    def run(self, jobs: list[LipSyncJob], fps: float, workdir: Path,
            progress: ProgressFn = null_progress) -> dict[int, str]:
        """Process jobs; return {job.id: output clip} for the ones that succeeded."""


class NoLipSync(LipSyncBackend):
    name = "none"

    def run(self, jobs, fps, workdir, progress=null_progress):
        return {}


class MockLipSync(LipSyncBackend):
    """Test backend: 'lip-syncs' by copying the input clip."""

    name = "mock"

    def run(self, jobs, fps, workdir, progress=null_progress):
        out = {}
        for i, j in enumerate(jobs):
            shutil.copy(j.video, j.out)
            out[j.id] = j.out
            progress((i + 1) / len(jobs), f"mock lipsync {i + 1}/{len(jobs)}")
        return out
