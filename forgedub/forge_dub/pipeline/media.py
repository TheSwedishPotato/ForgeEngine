"""Audio extraction and final muxing via ffmpeg (with graceful fallbacks)."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path
from typing import Optional, Tuple

# Duration assumed for the demo when we can't probe a real file.
DEMO_DURATION = 24.0


class MediaError(RuntimeError):
    pass


def _ffmpeg() -> Optional[str]:
    return shutil.which("ffmpeg")


def _ffprobe() -> Optional[str]:
    return shutil.which("ffprobe")


def _run(cmd) -> bytes:
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        tail = proc.stderr.decode(errors="ignore")[-1000:]
        raise MediaError(f"command failed: {' '.join(cmd)}\n{tail}")
    return proc.stdout


def probe_duration(path) -> float:
    if not path or not _ffprobe():
        return DEMO_DURATION
    try:
        out = _run(["ffprobe", "-v", "quiet", "-print_format", "json",
                    "-show_format", str(path)])
        return float(json.loads(out)["format"]["duration"])
    except Exception:
        return DEMO_DURATION


def has_video_stream(path) -> bool:
    if not path or not _ffprobe():
        return False
    try:
        out = _run(["ffprobe", "-v", "quiet", "-select_streams", "v",
                    "-show_entries", "stream=codec_type", "-of", "json", str(path)])
        return bool(json.loads(out).get("streams"))
    except Exception:
        return False


def extract_audio(input_path, settings, mode, report) -> Tuple[Optional[str], float]:
    """Return ``(speech_wav_path_or_None, duration_seconds)``.

    In mock mode (or without ffmpeg / a real file) we skip extraction and just
    report a duration; the mock synth produces its own silent clips.
    """
    if mode != "real" or not input_path or not _ffmpeg():
        report(1.0, "Using demo audio timeline")
        return None, probe_duration(input_path)

    duration = probe_duration(input_path)
    out = Path(input_path).with_suffix(".speech.wav")
    report(0.3, "Extracting audio…")
    _run(["ffmpeg", "-y", "-i", str(input_path), "-vn",
          "-ac", "1", "-ar", "16000", "-f", "wav", str(out)])
    report(1.0, "Audio extracted")
    return str(out), duration


def mux(input_path, dubbed_audio, settings, mode, job_dir, report) -> Tuple[str, str]:
    """Combine the dubbed audio with the original video.

    Returns ``(output_path, kind)`` where kind is "video" or "audio".
    Falls back to delivering just the dubbed audio when there's no video stream
    or no ffmpeg.
    """
    job_dir = Path(job_dir)

    if mode == "real" and _ffmpeg() and has_video_stream(input_path):
        out = job_dir / "dubbed.mp4"
        report(0.4, "Muxing audio onto video…")
        _run(["ffmpeg", "-y", "-i", str(input_path), "-i", str(dubbed_audio),
              "-map", "0:v:0", "-map", "1:a:0",
              "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
              "-shortest", str(out)])
        report(1.0, "Video rendered")
        return str(out), "video"

    # Audio-only deliverable.
    out = job_dir / "dubbed.wav"
    if Path(dubbed_audio).resolve() != out.resolve():
        shutil.copyfile(dubbed_audio, out)
    report(1.0, "Audio rendered")
    return str(out), "audio"
