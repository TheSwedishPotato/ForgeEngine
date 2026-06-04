"""Media intake: uploaded files and web-link (URL) imports.

URL import uses yt-dlp when available (the "search the web / paste a link"
feature). In demo mode it is simulated so the rest of the flow still runs.
"""
from __future__ import annotations

from pathlib import Path
from typing import Optional, Tuple

from ..capabilities import has_ytdlp


def prepare(job, settings, mode, job_dir, report) -> Tuple[Optional[str], str]:
    """Resolve the job's source into a local file path. Returns (path, title)."""
    if job.source_type == "url":
        return _prepare_url(job.source, mode, job_dir, report)

    # Uploaded file: already saved to disk by the API layer.
    path = job.input_path
    report(1.0, "File ready")
    title = Path(path).stem if path else (job.title or "Uploaded video")
    return path, title


def _prepare_url(url, mode, job_dir, report) -> Tuple[Optional[str], str]:
    if mode == "real" and has_ytdlp():
        return _download(url, job_dir, report)
    report(1.0, "Demo mode: URL import simulated (install yt-dlp for real downloads)")
    return None, _title_from_url(url)


def _download(url, job_dir, report) -> Tuple[Optional[str], str]:
    import yt_dlp

    out_tmpl = str(Path(job_dir) / "source.%(ext)s")

    def hook(d):
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            done = d.get("downloaded_bytes") or 0
            if total:
                report(min(0.97, done / total), "Downloading video…")
        elif d.get("status") == "finished":
            report(0.99, "Download finished, processing…")

    opts = {
        "outtmpl": out_tmpl,
        "format": "bv*+ba/b",
        "merge_output_format": "mp4",
        "progress_hooks": [hook],
        "quiet": True,
        "noprogress": True,
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
        path = Path(ydl.prepare_filename(info))

    if not path.exists():
        # When streams are merged the extension becomes the merge format.
        candidate = path.with_suffix(".mp4")
        if candidate.exists():
            path = candidate

    report(1.0, "Download complete")
    return str(path), (info.get("title") or _title_from_url(url))


def _title_from_url(url: str) -> str:
    tail = url.rstrip("/").rsplit("/", 1)[-1]
    return (tail[:80] or "Imported video") if url else "Imported video"
