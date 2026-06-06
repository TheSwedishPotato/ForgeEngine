"""Text-to-speech, including voice cloning.

Real engines:
  * **xtts**  — Coqui XTTS-v2, multilingual + voice cloning from a reference clip
                of the original speaker (the "sounds like the original" magic).
  * **piper** — fast Swedish neural voice (no cloning); needs FORGEDUB_PIPER_MODEL.
Mock engine: writes silent clips matching each line's duration so the timeline
and player still work without any models.
"""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path
from typing import Optional

from ..capabilities import has_piper, has_xtts
from .wavutil import write_silence


def make_reference(speech_path, segments, settings, mode, job_dir) -> Optional[str]:
    """Cut a clean reference clip of the original speaker for voice cloning."""
    if mode != "real" or not speech_path or not shutil.which("ffmpeg") or not segments:
        return None

    longest = max(segments, key=lambda s: s.duration)
    start = max(0.0, longest.start)
    length = min(15.0, max(6.0, longest.duration or 8.0))
    ref = Path(job_dir) / "reference.wav"
    proc = subprocess.run(
        ["ffmpeg", "-y", "-i", str(speech_path), "-ss", str(start), "-t", str(length),
         "-ac", "1", "-ar", "22050", str(ref)],
        stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    return str(ref) if proc.returncode == 0 and ref.exists() else None


def synthesize(segments, ref_audio, settings, mode, job_dir, report) -> None:
    seg_dir = Path(job_dir) / "segments"
    seg_dir.mkdir(parents=True, exist_ok=True)

    engine = _resolve_engine(settings) if mode == "real" else "mock"
    if engine == "xtts":
        _synth_xtts(segments, ref_audio, settings, seg_dir, report)
    elif engine == "piper":
        _synth_piper(segments, settings, seg_dir, report)
    else:
        _synth_mock(segments, seg_dir, report)


def _resolve_engine(settings) -> str:
    pref = settings.tts_engine
    if pref in ("xtts", "piper", "mock"):
        return pref
    if has_xtts():
        return "xtts"
    if has_piper():
        return "piper"
    return "mock"


def _synth_xtts(segments, ref_audio, settings, seg_dir, report) -> None:
    from TTS.api import TTS

    device = settings.resolved_device()
    model = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)

    count = len(segments) or 1
    for index, seg in enumerate(segments):
        out = seg_dir / f"seg_{seg.id:04d}.wav"
        text = (seg.text_tgt or seg.text_src or "…").strip()
        kwargs = {"text": text, "file_path": str(out), "language": settings.target_lang}
        if ref_audio:
            kwargs["speaker_wav"] = ref_audio
        model.tts_to_file(**kwargs)
        seg.audio_path = str(out)
        report((index + 1) / count, f"Synthesizing… {index + 1}/{count}")


def _synth_piper(segments, settings, seg_dir, report) -> None:
    model_path = os.environ.get("FORGEDUB_PIPER_MODEL")
    piper_bin = shutil.which("piper")
    if not model_path or not piper_bin:
        # Misconfigured Piper — fall back to silent clips rather than crash.
        _synth_mock(segments, seg_dir, report)
        return

    count = len(segments) or 1
    for index, seg in enumerate(segments):
        out = seg_dir / f"seg_{seg.id:04d}.wav"
        text = (seg.text_tgt or seg.text_src or "…").strip()
        subprocess.run(
            [piper_bin, "--model", model_path, "--output_file", str(out)],
            input=text.encode("utf-8"),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        seg.audio_path = str(out)
        report((index + 1) / count, f"Synthesizing… {index + 1}/{count}")


def _synth_mock(segments, seg_dir, report) -> None:
    count = len(segments) or 1
    for index, seg in enumerate(segments):
        out = seg_dir / f"seg_{seg.id:04d}.wav"
        write_silence(out, max(0.4, seg.duration))
        seg.audio_path = str(out)
        report((index + 1) / count, f"Synthesizing… {index + 1}/{count}")
