"""Tiny WAV helpers built on the standard library only.

Used by the mock engine (and by the real engine for assembling the final
timeline) so that basic audio handling never depends on numpy/ffmpeg.
All helpers work with mono 16-bit PCM.
"""
from __future__ import annotations

import wave
from pathlib import Path
from typing import Iterable

SAMPLE_RATE = 16000
SAMPLE_WIDTH = 2  # bytes -> 16-bit
CHANNELS = 1
_SILENT_FRAME = b"\x00\x00"


def write_silence(path, duration: float, sample_rate: int = SAMPLE_RATE):
    """Write a silent mono WAV of ``duration`` seconds."""
    nframes = max(0, int(round(duration * sample_rate)))
    with wave.open(str(path), "wb") as w:
        w.setnchannels(CHANNELS)
        w.setsampwidth(SAMPLE_WIDTH)
        w.setframerate(sample_rate)
        w.writeframes(_SILENT_FRAME * nframes)
    return path


def duration_of(path) -> float:
    with wave.open(str(path), "rb") as r:
        rate = r.getframerate() or SAMPLE_RATE
        return r.getnframes() / float(rate)


def _read_pcm(path) -> bytes:
    """Read raw frames from a 16-bit mono PCM WAV. Returns b'' on failure."""
    try:
        with wave.open(str(path), "rb") as r:
            return r.readframes(r.getnframes())
    except Exception:
        return b""


def concat_timeline(segments: Iterable, total_duration: float, out_path,
                    sample_rate: int = SAMPLE_RATE):
    """Place each segment's WAV clip at its ``start`` time on a silent bed.

    Gaps are filled with silence; the result is padded to ``total_duration``.
    This is deliberately simple (later clips overwrite earlier ones where they
    overlap) which is exactly what we want for sequential dialogue.
    """
    buf = bytearray()

    def ensure(nbytes: int) -> None:
        if len(buf) < nbytes:
            buf.extend(b"\x00" * (nbytes - len(buf)))

    for seg in segments:
        start_byte = int(round(seg.start * sample_rate)) * SAMPLE_WIDTH
        ensure(start_byte)
        clip = _read_pcm(seg.audio_path) if getattr(seg, "audio_path", None) else b""
        if clip:
            end_byte = start_byte + len(clip)
            ensure(end_byte)
            buf[start_byte:end_byte] = clip

    total_bytes = int(round(max(total_duration, 0.0) * sample_rate)) * SAMPLE_WIDTH
    ensure(total_bytes)

    with wave.open(str(out_path), "wb") as w:
        w.setnchannels(CHANNELS)
        w.setsampwidth(SAMPLE_WIDTH)
        w.setframerate(sample_rate)
        w.writeframes(bytes(buf))
    return out_path
