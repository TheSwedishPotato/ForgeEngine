"""End-to-end batch pipeline with mock backends (no ML models, needs ffmpeg)."""

import json

import numpy as np
import pytest

from conftest import needs_ffmpeg
from dubforge import registry
from dubforge.media import audio as au
from dubforge.media import ffmpeg as ff
from dubforge.pipeline.batch import BatchDubber
from dubforge.types import Transcript
from dubforge.utils.synth import make_test_video


@pytest.fixture(scope="module")
def video(tmp_path_factory):
    if not ff.encoder_works("libx264"):
        pytest.skip("ffmpeg with libx264 required")
    return make_test_video(tmp_path_factory.mktemp("media") / "film.mp4", duration=10)


@needs_ffmpeg
def test_full_run_and_outputs(video, mock_cfg):
    res = BatchDubber(mock_cfg()).run(video)
    info = ff.probe(res.output)
    assert info.has_video and info.audio_streams == 2  # dub + original
    assert abs(info.duration - 10) < 0.3
    script = Transcript.load(res.workdir / "script.json")
    assert len(script.segments) >= 3
    assert all(s.translation and s.translation.startswith("[de]") for s in script.segments)
    assert all(s.tts_path for s in script.segments)
    assert (res.workdir / "subtitles.de.srt").read_text(encoding="utf-8").count("-->") == len(script.segments)
    report = json.loads((res.workdir / "report.json").read_text())
    assert report["lines"] == len(script.segments)


@needs_ffmpeg
def test_resume_and_script_edit(video, mock_cfg):
    cfg = mock_cfg()
    first = BatchDubber(cfg).run(video)
    wd = first.workdir
    index_before = json.loads((wd / "tts" / "index.json").read_text())
    mtimes = {p.name: p.stat().st_mtime_ns for p in (wd / "tts").glob("seg_*.wav")}

    # hand-edit one line + mark another as keep_original
    script = Transcript.load(wd / "script.json")
    script.segments[0].translation = "Eine handgeschriebene Zeile."
    script.segments[1].keep_original = True
    script.save(wd / "script.json")

    second = BatchDubber(mock_cfg()).run(video)
    script2 = Transcript.load(wd / "script.json")
    assert script2.segments[0].translation_locked
    assert script2.segments[0].tts_text == "Eine handgeschriebene Zeile."
    index_after = json.loads((wd / "tts" / "index.json").read_text())
    assert index_after["0"]["key"] != index_before["0"]["key"]
    # untouched lines were not re-synthesized
    for p in (wd / "tts").glob("seg_*.wav"):
        if p.name not in ("seg_00000.wav",) and p.name in mtimes:
            assert p.stat().st_mtime_ns == mtimes[p.name]
    # keep_original line: original vocals remain in the mix at that spot
    s1 = script2.segments[1]
    mix, sr = au.load(wd / "audio" / "dub_mix.wav", mono=True)
    orig, _ = au.load(wd / "audio" / "mix.wav", mono=True)
    a, b = int((s1.speech_start + 0.1) * sr), int((s1.speech_end - 0.1) * sr)
    assert np.corrcoef(mix[a:b], orig[a:b])[0, 1] > 0.98
    assert second.output == first.output


@needs_ffmpeg
def test_audio_only_input(tmp_path, mock_cfg):
    from dubforge.utils.synth import synth_dialogue

    wav = au.save(tmp_path / "podcast.wav", synth_dialogue(8.0), 44100)
    res = BatchDubber(mock_cfg("target_lang=fr")).run(wav)
    assert res.output.suffix == ".m4a" and res.output.exists()


def test_registry_errors_and_plugins():
    with pytest.raises(registry.BackendError, match="Available"):
        registry.resolve("tts", "does_not_exist")
    registry.register("tts", "mock2", "dubforge.tts.base:MockTTS")
    assert "mock2" in registry.available("tts")


def test_unsupported_tts_language(tmp_path, mock_cfg, video):
    cfg = mock_cfg("tts.backend=xtts", "target_lang=sv", "lipsync.backend=none")
    with pytest.raises(Exception, match="cannot speak Swedish"):
        BatchDubber(cfg).run(video)
