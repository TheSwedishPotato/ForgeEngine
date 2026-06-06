"""FastAPI app: upload/import, run the pipeline, serve progress and results."""
from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from . import APP_NAME, __version__
from .capabilities import detect
from .config import Settings
from .jobs import JobManager
from .pipeline import orchestrator

_SAFE_NAME = re.compile(r"[^A-Za-z0-9._-]+")


def _safe_filename(name: str) -> str:
    base = Path(name or "video").name
    cleaned = _SAFE_NAME.sub("_", base).strip("_.")
    return cleaned or "video"


class SegmentEdit(BaseModel):
    id: int
    text_tgt: str


class RerenderRequest(BaseModel):
    segments: List[SegmentEdit] = []


def create_app(settings: Settings) -> FastAPI:
    settings.ensure_dirs()
    manager = JobManager(settings, orchestrator.run_dub)

    app = FastAPI(title=f"{APP_NAME} API", version=__version__)
    app.state.settings = settings
    app.state.manager = manager

    # ------------------------------------------------------------------ meta
    @app.get("/api/health")
    def health():
        caps = detect()
        return {
            "app": APP_NAME,
            "version": __version__,
            "mode": settings.effective_mode(),
            "capabilities": caps.to_dict(),
            "settings": settings.summary(),
        }

    # ------------------------------------------------------------------ jobs
    @app.post("/api/jobs")
    async def create_job(
        file: Optional[UploadFile] = File(default=None),
        url: Optional[str] = Form(default=None),
        voice_clone: bool = Form(default=True),
        separate_background: bool = Form(default=False),
        target_lang: str = Form(default="sv"),
    ):
        if not file and not (url and url.strip()):
            raise HTTPException(status_code=400, detail="Provide a video file or a URL.")

        job = manager.create(
            source_type="upload" if file else "url",
            source=(file.filename if file else url.strip()),
            voice_clone=voice_clone,
            separate_background=separate_background,
            target_lang=target_lang or "sv",
        )

        if file:
            dest = settings.uploads_dir / f"{job.id}_{_safe_filename(file.filename)}"
            with dest.open("wb") as out:
                shutil.copyfileobj(file.file, out)
            job.input_path = str(dest)
            job.title = Path(file.filename).stem

        manager.start(job)
        return JSONResponse(job.to_dict(), status_code=201)

    @app.get("/api/jobs")
    def list_jobs():
        return {"jobs": [j.to_dict(include_segments=False) for j in manager.list()]}

    @app.get("/api/jobs/{job_id}")
    def get_job(job_id: str):
        job = manager.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        return job.to_dict()

    @app.post("/api/jobs/{job_id}/rerender")
    def rerender_job(job_id: str, req: RerenderRequest):
        job = manager.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        if job.status == "running":
            raise HTTPException(status_code=409, detail="Job is still running")

        edits = {edit.id: edit.text_tgt for edit in req.segments}
        for seg in job.segments:
            if seg.id in edits:
                seg.text_tgt = edits[seg.id]

        manager.start(job, runner=orchestrator.rerender)
        return job.to_dict()

    # -------------------------------------------------------------- delivery
    @app.get("/api/jobs/{job_id}/preview")
    def preview(job_id: str):
        job, path = _require_output(manager, job_id)
        media_type = "video/mp4" if job.output_kind == "video" else "audio/wav"
        return FileResponse(path, media_type=media_type)

    @app.get("/api/jobs/{job_id}/download")
    def download(job_id: str):
        job, path = _require_output(manager, job_id)
        ext = Path(path).suffix
        name = f"{_safe_filename(job.title or 'forgedub')}.{job.target_lang}{ext}"
        return FileResponse(path, filename=name)

    @app.get("/api/jobs/{job_id}/source")
    def source(job_id: str):
        job = manager.get(job_id)
        if not job or not job.input_path or not Path(job.input_path).exists():
            raise HTTPException(status_code=404, detail="Source not available")
        return FileResponse(job.input_path)

    # ----------------------------------------------------------------- web UI
    web_dir = Path(settings.web_dir)
    if web_dir.exists():
        app.mount("/static", StaticFiles(directory=str(web_dir)), name="static")

        @app.get("/")
        def index():
            return FileResponse(web_dir / "index.html")

    return app


def _require_output(manager: JobManager, job_id: str):
    job = manager.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job.output_path or not Path(job.output_path).exists():
        raise HTTPException(status_code=409, detail="Output not ready")
    return job, job.output_path
