"""Speech-to-text (transcription) with word timing.

Real engine: faster-whisper (CTranslate2 Whisper) — CPU or CUDA.
Mock engine: emits canned demo lines spread across the duration.
"""
from __future__ import annotations

from . import demo_content
from .models import Segment, Transcript


def transcribe(audio_path, settings, mode, duration, report) -> Transcript:
    if mode == "real" and audio_path:
        return _transcribe_real(audio_path, settings, report)
    return _transcribe_mock(duration, report)


def _transcribe_real(audio_path, settings, report) -> Transcript:
    from faster_whisper import WhisperModel

    device = settings.resolved_device()
    compute_type = "float16" if device == "cuda" else "int8"
    model = WhisperModel(settings.whisper_model, device=device, compute_type=compute_type)

    segments_iter, info = model.transcribe(
        audio_path,
        language=settings.source_lang,
        vad_filter=True,
    )
    total = getattr(info, "duration", 0.0) or 0.0

    segments = []
    for index, seg in enumerate(segments_iter):
        text = (seg.text or "").strip()
        if not text:
            continue
        segments.append(Segment(
            id=len(segments),
            start=float(seg.start or 0.0),
            end=float(seg.end or 0.0),
            text_src=text,
            speaker="Speaker 1",
        ))
        if total:
            report(min(0.99, (seg.end or 0.0) / total), f"Transcribing… {len(segments)} lines")

    resolved = total or (segments[-1].end if segments else 0.0)
    return Transcript(language=settings.source_lang, duration=resolved, segments=segments)


def _transcribe_mock(duration, report) -> Transcript:
    pairs = demo_content.DEMO_PAIRS
    count = len(pairs)
    duration = duration or (count * 3.0)
    slot = max(2.0, duration / count)

    segments = []
    cursor = 0.0
    for index, (english, _swedish) in enumerate(pairs):
        start = cursor
        end = duration if index == count - 1 else min(duration, cursor + slot)
        segments.append(Segment(
            id=index,
            start=round(start, 3),
            end=round(end, 3),
            text_src=english,
            speaker="Speaker 1",
        ))
        cursor = end
        report((index + 1) / count, f"Transcribing… {index + 1}/{count}")

    return Transcript(language="en", duration=duration, segments=segments)
