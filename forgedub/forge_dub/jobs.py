"""In-memory job manager: runs dubbing jobs on background threads.

Progress within each stage (a 0..1 fraction) is mapped onto a global 0..1 bar
using fixed per-stage weights, so the UI bar advances smoothly. The frontend
polls job state, which keeps the threading model simple and robust.
"""
from __future__ import annotations

import dataclasses
import threading
import time
import traceback
from typing import Callable, Dict, List, Optional

from .config import Settings
from .pipeline.models import Job, Stage

# How much of the overall progress bar each stage occupies (sums to 1.0).
STAGE_WEIGHTS = {
    Stage.INTAKE: 0.05,
    Stage.EXTRACT: 0.05,
    Stage.SEPARATE: 0.03,
    Stage.TRANSCRIBE: 0.30,
    Stage.TRANSLATE: 0.10,
    Stage.SYNTHESIZE: 0.30,
    Stage.ALIGN: 0.05,
    Stage.MUX: 0.12,
}
_STAGE_ORDER = [
    Stage.INTAKE, Stage.EXTRACT, Stage.SEPARATE, Stage.TRANSCRIBE,
    Stage.TRANSLATE, Stage.SYNTHESIZE, Stage.ALIGN, Stage.MUX,
]

Runner = Callable[[Job, Settings, Callable], None]


def _stage_base(stage: Stage) -> float:
    base = 0.0
    for current in _STAGE_ORDER:
        if current == stage:
            return base
        base += STAGE_WEIGHTS[current]
    return base


class JobManager:
    def __init__(self, settings: Settings, runner: Runner):
        self._settings = settings
        self._runner = runner
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.RLock()

    def create(self, **kwargs) -> Job:
        job = Job(**kwargs)
        with self._lock:
            self._jobs[job.id] = job
        return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def list(self) -> List[Job]:
        with self._lock:
            return sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)

    def start(self, job: Job, runner: Optional[Runner] = None) -> None:
        thread = threading.Thread(
            target=self._run, args=(job, runner or self._runner),
            daemon=True, name=f"dub-{job.id}",
        )
        thread.start()

    def _job_settings(self, job: Job) -> Settings:
        """Apply this job's per-run options on top of the global settings."""
        return dataclasses.replace(
            self._settings,
            voice_clone=job.voice_clone,
            separate_background=job.separate_background,
            target_lang=job.target_lang,
        )

    def _run(self, job: Job, runner: Runner) -> None:
        def progress(stage: Stage, frac: float, message: str) -> None:
            with self._lock:
                job.stage = stage
                if stage in STAGE_WEIGHTS:
                    job.progress = _stage_base(stage) + frac * STAGE_WEIGHTS[stage]
                if message:
                    job.message = message
                job.status = "running"
                job.updated_at = time.time()

        with self._lock:
            job.status = "running"
            job.error = ""
            job.updated_at = time.time()

        try:
            runner(job, self._job_settings(job), progress)
            with self._lock:
                job.status = "done"
                job.stage = Stage.DONE
                job.progress = 1.0
                job.message = "Done"
                job.updated_at = time.time()
        except Exception as exc:  # noqa: BLE001 - surface any failure to the UI
            with self._lock:
                job.status = "error"
                job.stage = Stage.ERROR
                job.error = str(exc)
                job.message = f"Error: {exc}"
                job.updated_at = time.time()
            traceback.print_exc()
