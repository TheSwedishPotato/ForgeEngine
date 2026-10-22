"""End-to-end batch pipeline with fake models: proves orchestration, timing, mixing, muxing,
resume-from-checkpoint and the lip-sync frame pass (with a fake lip-sync backend)."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from conftest import DURATION, LINES, SR, make_stems
from dubforge import registry
from dubforge.audio_utils import read_audio
from dubforge.base import LipSync
from dubforge.media import FrameReader, probe
from dubforge.pipeline import DubPipeline, lipsync_windows
from dubforge.types import load_segments


def test_batch_dub_end_to_end(film, cfg):
    out = DubPipeline(cfg, progress=lambda *a: None).run(film, "sv")
    assert out.exists() and out.suffix == ".mp4"
    info = probe(out)
    assert info.has_video and info.audio_streams == 2                 # dubbed + original track
    assert abs(info.duration - DURATION) < 0.5
    assert info.audio_lang == "swe"
    assert out.with_suffix(".srt").exists()

    lang = next(Path(cfg.work_dir).glob("film_*")) / "sv"
    segs, meta = load_segments(lang / "segments.json")
    assert len(segs) == len(LINES) and meta["target_lang"] == "sv"
    assert all(s.tts_path and s.translation.startswith("[sv]") for s in segs)
    rep = json.loads((lang / "report.json").read_text())
    assert rep["lines_dubbed"] == 3 and rep["overrun"] == 0

    # Music is preserved between the lines (accompaniment passes through untouched)...
    mix, sr = read_audio(lang / "dub_mix.wav", mono=True)
    _, music = make_stems()
    gap = slice(int(6.5 * sr), int(7.5 * sr))
    ref_rms = np.sqrt(np.mean(music[gap, 0] ** 2))
    assert abs(np.sqrt(np.mean(mix[gap] ** 2)) / ref_rms - 1) < 0.1
    # ...and dubbed speech sits where the original speech was.
    dub, _ = read_audio(lang / "dub_vocals.wav", mono=True)
    for a, b in LINES:
        assert np.sqrt(np.mean(dub[int(a * sr):int(b * sr)] ** 2)) > 0.02
    assert np.sqrt(np.mean(dub[int(6.5 * sr):int(7.5 * sr)] ** 2)) < 1e-4


def test_resume_and_edit_only_resynthesises_changed_line(film, cfg):
    pl = DubPipeline(cfg, progress=lambda *a: None)
    assert pl.run(film, "de", until="translate") is None            # review mode
    job = next(Path(cfg.work_dir).glob("film_*"))
    seg_file = job / "de" / "segments.json"
    data = json.loads(seg_file.read_text())
    data["segments"][1]["translation"] = "Ein ganz anderer, deutlich laengerer Satz als vorher."
    seg_file.write_text(json.dumps(data))

    pl.run(film, "de")
    before = {p.name: p.stat().st_mtime_ns for p in (job / "de" / "tts").glob("*.wav")}
    assert len(before) == 3
    data["segments"][2]["translation"] = "Noch ein neuer Text."
    seg_file.write_text(json.dumps(data))
    pl.run(film, "de", redo_from="tts")
    after = {p.name: p.stat().st_mtime_ns for p in (job / "de" / "tts").glob("*.wav")}
    unchanged = [n for n in after if n in before and before[n] == after[n]]
    assert len(after) == 3 and len(unchanged) == 2                  # only line 2 was re-synthesised


def test_same_language_rejected(film, cfg):
    with pytest.raises(ValueError, match="both"):
        DubPipeline(cfg, progress=lambda *a: None).run(film, "en", "en")


def test_tts_backend_language_guard(film, cfg):
    cfg.tts.backend = "xtts"              # XTTS has no Swedish -> clear error before any model loads
    pl = DubPipeline(cfg, progress=lambda *a: None)
    with pytest.raises(ValueError, match="cannot speak Swedish"):
        pl.run(film, "sv")


class RedBoxLipSync(LipSync):
    """Paints a red square: lets the test see exactly which frames went through the lip-sync pass."""
    name = "redbox"
    calls: list[tuple[int, float]] = []

    def __init__(self, cfg):
        self.cfg = cfg

    def sync_clip(self, frames, audio_16k, fps):
        RedBoxLipSync.calls.append((len(frames), float(np.abs(audio_16k).max())))
        out = []
        for f in frames:
            g = f.copy()
            g[:60, :60] = (0, 0, 255)
            out.append(g)
        return out


def test_lipsync_pass_only_touches_dubbed_windows(film, cfg):
    registry.register("lipsync", "redbox", "test_pipeline_e2e:RedBoxLipSync")
    cfg.lipsync.backend = "redbox"
    out = DubPipeline(cfg, progress=lambda *a: None).run(film, "sv")
    info = probe(out)
    red = []
    with FrameReader(out, info) as r:
        for f in r:
            red.append(f[10:50, 10:50, 2].mean() > 200 and f[10:50, 10:50, 1].mean() < 80)
    red = np.array(red)
    assert len(red) >= int(DURATION * 25) - 2                      # frame count preserved
    t = np.arange(len(red)) / 25
    in_line = np.zeros(len(red), bool)
    for a, b in LINES:
        in_line |= (t >= a + 0.1) & (t < b - 0.1)
    assert red[in_line].mean() > 0.9                                # speaking frames re-rendered
    quiet = (t > 6.4) & (t < 7.6)
    assert red[quiet].mean() < 0.05                                 # silence untouched
    assert all(n <= 6.0 * 25 + 1 for n, _ in RedBoxLipSync.calls)   # windows respect max_clip_s
    assert all(peak > 0.01 for _, peak in RedBoxLipSync.calls)      # each window got real dub audio


def test_lipsync_windows_merge_and_split():
    w = lipsync_windows([(1.0, 2.0), (2.1, 3.0), (10.0, 20.0)], fps=25, max_clip_s=6.0)
    assert w[0] == (25, 75)                          # first two merged (gap 0.1 s < 0.25 s)
    assert all(b - a <= 150 for a, b in w)
    assert sum(b - a for a, b in w if a >= 250) == 250   # 10 s of frames, split into <=6 s pieces
    assert lipsync_windows([], 25, 6) == []
    capped = lipsync_windows([(0.0, 10.0)], fps=60, max_clip_s=6.0, max_frames=100)   # huge frames: RAM cap wins
    assert all(b - a <= 100 for a, b in capped) and sum(b - a for a, b in capped) == 600


def test_per_line_lipsync_veto_and_voice_report(film, cfg):
    """A line with lipsync=false keeps its original frames; the QA fields exist in the report."""
    registry.register("lipsync", "redbox", "test_pipeline_e2e:RedBoxLipSync")
    cfg.lipsync.backend = "redbox"
    pl = DubPipeline(cfg, progress=lambda *a: None)
    assert pl.run(film, "sv", until="translate") is None
    seg_file = next(Path(cfg.work_dir).glob("film_*")) / "sv" / "segments.json"
    data = json.loads(seg_file.read_text())
    data["segments"][2]["lipsync"] = False                           # veto the third line's shot
    seg_file.write_text(json.dumps(data))
    out = pl.run(film, "sv")
    t_red = []
    with FrameReader(out, probe(out)) as r:
        for f in r:
            t_red.append(f[10:50, 10:50, 2].mean() > 200 and f[10:50, 10:50, 1].mean() < 80)
    t_red, t = np.array(t_red), np.arange(len(t_red)) / 25
    first = (t >= LINES[0][0] + 0.1) & (t < LINES[0][1] - 0.1)
    vetoed = (t >= LINES[2][0] + 0.1) & (t < LINES[2][1] - 0.1)
    assert t_red[first].mean() > 0.9 and t_red[vetoed].mean() < 0.05
    rep = json.loads((next(Path(cfg.work_dir).glob("film_*")) / "sv" / "report.json").read_text())
    assert rep["voice_flagged"] == 0 and rep["similar_speaker_pairs"] == []
    assert (next(Path(cfg.work_dir).glob("film_*")) / "common" / "speakers.txt").read_text().startswith("SPK0")
