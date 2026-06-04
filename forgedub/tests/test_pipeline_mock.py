from pathlib import Path

from forge_dub.config import Settings
from forge_dub.pipeline import demo_content, orchestrator
from forge_dub.pipeline.models import Job


def _noop(stage, frac, message):
    pass


def test_full_mock_pipeline(tmp_path):
    settings = Settings(engine_mode="mock", data_dir=tmp_path)
    settings.ensure_dirs()

    job = Job(source_type="url", source="https://example.com/clip", target_lang="sv")
    orchestrator.run_dub(job, settings, _noop)

    assert job.segments, "expected transcript segments"
    first = job.segments[0]
    assert first.text_src  # English present
    # mock translator yields the canned Swedish for known demo lines
    assert first.text_tgt == demo_content.SV_LOOKUP[first.text_src]

    assert job.output_path and Path(job.output_path).exists()
    assert job.output_kind == "audio"  # no ffmpeg/video in mock -> audio deliverable
    assert job.duration > 0


def test_rerender_updates_translation(tmp_path):
    settings = Settings(engine_mode="mock", data_dir=tmp_path)
    settings.ensure_dirs()

    job = Job(source_type="url", source="https://example.com/clip", target_lang="sv")
    orchestrator.run_dub(job, settings, _noop)

    job.segments[0].text_tgt = "Helt ny svensk text"
    orchestrator.rerender(job, settings, _noop)

    assert job.segments[0].text_tgt == "Helt ny svensk text"
    assert Path(job.output_path).exists()
