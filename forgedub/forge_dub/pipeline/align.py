"""Assemble per-line clips into one dubbed track, keeping original timing.

Translated speech is rarely the same length as the source line. To stay in sync
we gently time-stretch each synthesized clip to fit its slot (speeding up when
the Swedish is longer; never slowing down past the slot, since trailing silence
sounds more natural). Clips are then placed at their original start times.

The placement step reuses the pure-Python WAV timeline builder, so each clip is
first normalised to 16 kHz mono PCM via ffmpeg in real mode.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .wavutil import concat_timeline


def assemble(segments, duration, settings, mode, job_dir, bg_path, report) -> str:
    out = Path(job_dir) / "voice_track.wav"

    if mode == "real" and shutil.which("ffmpeg"):
        _fit_and_normalize(segments, report)
        concat_timeline(segments, duration, out)
        if bg_path:
            out = _mix_background(out, bg_path, job_dir, report)
        report(1.0, "Timeline assembled")
        return str(out)

    concat_timeline(segments, duration, out)
    report(1.0, "Timeline assembled")
    return str(out)


def _fit_and_normalize(segments, report) -> None:
    """Time-fit each clip to its slot and normalise to 16 kHz mono PCM."""
    count = len(segments) or 1
    for index, seg in enumerate(segments):
        src = seg.audio_path
        if not src or not Path(src).exists():
            continue

        clip_dur = _probe_seconds(src)
        slot = seg.duration
        ratio = (clip_dur / slot) if (slot > 0 and clip_dur > 0) else 1.0

        filters = ["aresample=16000", "aformat=channel_layouts=mono"]
        # Only speed up to fit; clamp so voices never become chipmunks.
        if ratio > 1.02:
            filters.insert(0, _atempo_chain(min(ratio, 3.0)))

        dst = Path(src).with_suffix(".fit.wav")
        proc = subprocess.run(
            ["ffmpeg", "-y", "-i", str(src), "-filter:a", ",".join(filters),
             "-ac", "1", "-ar", "16000", str(dst)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        if proc.returncode == 0 and dst.exists():
            seg.audio_path = str(dst)
        report((index + 1) / count, f"Aligning… {index + 1}/{count}")


def _atempo_chain(ratio: float) -> str:
    """ffmpeg's atempo accepts 0.5–2.0; chain filters for larger factors."""
    factors = []
    remaining = ratio
    while remaining > 2.0:
        factors.append(2.0)
        remaining /= 2.0
    factors.append(round(remaining, 4))
    return ",".join(f"atempo={f}" for f in factors)


def _mix_background(voice_wav, bg_path, job_dir, report):
    out = Path(job_dir) / "dubbed_mixed.wav"
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", str(voice_wav), "-i", str(bg_path),
         "-filter_complex", "[1:a]volume=0.5[bg];[0:a][bg]amix=inputs=2:duration=first[a]",
         "-map", "[a]", "-ac", "1", "-ar", "16000", str(out)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    if proc.returncode == 0 and out.exists():
        report(0.95, "Mixed background")
        return out
    return Path(voice_wav)


def _probe_seconds(path) -> float:
    if not shutil.which("ffprobe"):
        return 0.0
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
             "-of", "default=nw=1:nk=1", str(path)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        return float(out.stdout.decode().strip() or 0.0)
    except Exception:
        return 0.0
