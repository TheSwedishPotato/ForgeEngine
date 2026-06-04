"""Optional voice / background separation.

Separating speech from music & effects lets us keep the original background bed
under the new Swedish voices. A full Demucs integration is heavy, so v1 ships a
safe passthrough (the whole track is treated as speech). Wire Demucs here later;
the rest of the pipeline already accepts an optional background track.
"""
from __future__ import annotations

from typing import Optional, Tuple


def separate(audio_path, settings, mode, job_dir, report) -> Tuple[Optional[str], Optional[str]]:
    """Return ``(speech_path, background_path_or_None)``."""
    report(1.0, "Using full audio (background separation off)")
    return audio_path, None
