"""Runs the full dubbing pipeline for a job, reporting progress per stage."""
from __future__ import annotations

from pathlib import Path

from . import align, asr, intake, media, separate, translate, tts
from .models import Stage


def _reporter(progress, stage):
    """Bind a stage so modules just report a 0..1 fraction and a message."""
    def report(frac: float, message: str = "") -> None:
        progress(stage, max(0.0, min(1.0, frac)), message)
    return report


def run_dub(job, settings, progress) -> None:
    """Full pipeline: intake -> ... -> mux. Mutates ``job`` as it goes."""
    mode = settings.effective_mode()
    job.mode = mode
    job_dir = Path(settings.jobs_dir) / job.id
    job_dir.mkdir(parents=True, exist_ok=True)

    # 1. Intake (file already on disk, or download from URL)
    report = _reporter(progress, Stage.INTAKE)
    report(0.1, "Loading media…")
    input_path, title = intake.prepare(job, settings, mode, job_dir, report)
    job.input_path = str(input_path) if input_path else None
    if title and not job.title:
        job.title = title

    # 2. Extract the speech audio track
    report = _reporter(progress, Stage.EXTRACT)
    speech_path, duration = media.extract_audio(input_path, settings, mode, report)
    job.audio_path = str(speech_path) if speech_path else None
    job.duration = duration

    # 3. Optionally separate voice from background music/FX
    report = _reporter(progress, Stage.SEPARATE)
    background_path = None
    if settings.separate_background:
        speech_path, background_path = separate.separate(
            speech_path, settings, mode, job_dir, report)
    else:
        report(1.0, "Background separation skipped")

    # 4. Transcribe English
    report = _reporter(progress, Stage.TRANSCRIBE)
    report(0.05, "Transcribing English…")
    transcript = asr.transcribe(speech_path, settings, mode, duration, report)
    job.segments = transcript.segments
    job.duration = transcript.duration or duration

    # 5. Translate to the target language
    report = _reporter(progress, Stage.TRANSLATE)
    report(0.05, "Translating…")
    translate.translate_segments(transcript.segments, settings, mode, report)

    # 6. Synthesize the target-language voices (clone the original if enabled)
    _synthesize(job, transcript.segments, speech_path, settings, mode, job_dir, progress)

    # 7. Assemble the dubbed track keeping the original timing
    report = _reporter(progress, Stage.ALIGN)
    report(0.1, "Aligning timing…")
    dubbed_audio = align.assemble(
        transcript.segments, job.duration, settings, mode, job_dir, background_path, report)

    # 8. Render the final file
    report = _reporter(progress, Stage.MUX)
    report(0.1, "Rendering…")
    output_path, kind = media.mux(input_path, dubbed_audio, settings, mode, job_dir, report)
    job.output_path = str(output_path)
    job.output_kind = kind


def rerender(job, settings, progress) -> None:
    """Re-run synth -> align -> mux after the user edits the translation."""
    mode = job.mode or settings.effective_mode()
    job_dir = Path(settings.jobs_dir) / job.id
    job_dir.mkdir(parents=True, exist_ok=True)

    _synthesize(job, job.segments, job.audio_path, settings, mode, job_dir, progress)

    report = _reporter(progress, Stage.ALIGN)
    report(0.1, "Aligning timing…")
    dubbed_audio = align.assemble(
        job.segments, job.duration, settings, mode, job_dir, None, report)

    report = _reporter(progress, Stage.MUX)
    report(0.1, "Rendering…")
    output_path, kind = media.mux(job.input_path, dubbed_audio, settings, mode, job_dir, report)
    job.output_path = str(output_path)
    job.output_kind = kind


def _synthesize(job, segments, speech_path, settings, mode, job_dir, progress) -> None:
    report = _reporter(progress, Stage.SYNTHESIZE)
    report(0.02, "Generating voices…")
    reference = None
    if settings.voice_clone:
        reference = tts.make_reference(speech_path, segments, settings, mode, job_dir)
    tts.synthesize(segments, reference, settings, mode, job_dir, report)
