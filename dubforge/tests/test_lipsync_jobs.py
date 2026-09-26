import numpy as np
import pytest

from conftest import needs_ffmpeg
from dubforge.config import LipSyncConfig
from dubforge.lipsync.base import MockLipSync
from dubforge.lipsync.jobs import build_jobs, plan_spans, splice
from dubforge.media import audio as au
from dubforge.media import ffmpeg as ff
from dubforge.mixing.mixer import Placement


def test_plan_spans_merges_overlaps(tmp_path):
    cfg = LipSyncConfig(pad_seconds=0.1, min_segment_seconds=0.3)
    p = {0: Placement("a.wav", 1.0, 1.0, 2.0), 1: Placement("b.wav", 2.05, 2.05, 3.0), 2: Placement("c.wav", 6.0, 6.0, 7.0)}
    spans = plan_spans(p, {0: 1.0, 1: 0.9, 2: 1.0}, fps=25, total_frames=250, cfg=cfg)
    assert len(spans) == 2
    assert [s for s, _ in spans[0].placements] == [0, 1]
    assert spans[0].start_frame == int(0.9 * 25)


@needs_ffmpeg
def test_jobs_and_splice_keep_frame_count(tmp_path):
    src = tmp_path / "v.mp4"
    ff.run(["-f", "lavfi", "-i", "testsrc2=size=160x120:rate=25:duration=4", "-c:v", "libx264", "-pix_fmt", "yuv420p",
            str(src)], "make")
    info = ff.probe(src)
    au.save(tmp_path / "d.wav", np.full(8000, 0.1, np.float32), 16000)
    p = {0: Placement(str(tmp_path / "d.wav"), 1.0, 1.0, 1.5)}
    spans = plan_spans(p, {0: 0.5}, info.fps, info.frame_count, LipSyncConfig())
    jobs = build_jobs(str(src), info, spans, tmp_path / "jobs")
    assert len(jobs) == 1 and jobs[0].n_frames == spans[0].end_frame - spans[0].start_frame
    clip = ff.probe(jobs[0].video)
    assert abs(clip.frame_count - jobs[0].n_frames) <= 1
    results = MockLipSync(LipSyncConfig()).run(jobs, info.fps, tmp_path / "jobs")
    out = splice(str(src), info, [(jobs[0].start_frame, jobs[0].n_frames, results[0])], tmp_path / "o.mp4",
                 codec="libx264")
    assert ff.probe(out).frame_count == pytest.approx(info.frame_count, abs=1)
