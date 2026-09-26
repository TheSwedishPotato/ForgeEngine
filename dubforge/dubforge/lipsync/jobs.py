"""Cut the film into lip-sync jobs and splice the results back, frame-exactly.

Both the cutting and the splicing decode the film sequentially through the
same constant-frame-rate pipe, so frame N always means the same picture.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..config import LipSyncConfig
from ..media import audio as au
from ..media.ffmpeg import FrameReader, FrameWriter, MediaInfo
from ..mixing.mixer import Placement
from ..utils.log import ProgressFn, get_logger, null_progress
from .base import LipSyncJob

log = get_logger("lipsync")

JOB_SR = 16000


@dataclass
class Span:
    start_frame: int
    end_frame: int  # exclusive
    placements: list[tuple[int, Placement]] = field(default_factory=list)  # (segment id, placement)


def plan_spans(placements: dict[int, Placement], clip_durations: dict[int, float], fps: float, total_frames: int,
               cfg: LipSyncConfig) -> list[Span]:
    spans: list[Span] = []
    for seg_id, p in sorted(placements.items(), key=lambda kv: kv[1].start):
        dur = clip_durations.get(seg_id, 0.0)
        a = min(p.start, p.mute_start) - cfg.pad_seconds
        b = max(p.start + dur, p.mute_end) + cfg.pad_seconds
        if b - a < cfg.min_segment_seconds:
            continue
        sf_, ef = max(0, int(np.floor(a * fps))), min(total_frames, int(np.ceil(b * fps)))
        if ef - sf_ < 2:
            continue
        if spans and sf_ <= spans[-1].end_frame:  # overlapping/adjacent lines -> one job
            spans[-1].end_frame = max(spans[-1].end_frame, ef)
            spans[-1].placements.append((seg_id, p))
        else:
            spans.append(Span(sf_, ef, [(seg_id, p)]))
    return spans


def build_jobs(video_path: str, info: MediaInfo, spans: list[Span], workdir: Path,
               progress: ProgressFn = null_progress) -> list[LipSyncJob]:
    """One sequential decode pass writes every span's original frames + its dub audio."""
    workdir.mkdir(parents=True, exist_ok=True)
    fps = info.fps
    jobs: list[LipSyncJob] = []
    for k, sp in enumerate(spans):
        n = sp.end_frame - sp.start_frame
        wav = np.zeros(int(round(n / fps * JOB_SR)) + 1, dtype=np.float32)
        t0 = sp.start_frame / fps
        for _seg_id, p in sp.placements:
            clip, csr = au.load(p.path, mono=True)
            au.add_at(wav, au.resample(clip, csr, JOB_SR), int(round((p.start - t0) * JOB_SR)))
        # Wav2Lip rejects digital silence (NaN mels): add inaudible dither
        wav += np.random.default_rng(k).normal(0, 1e-5, len(wav)).astype(np.float32)
        audio_path = workdir / f"job_{k:05d}_dub.wav"
        au.save(audio_path, wav, JOB_SR)
        jobs.append(LipSyncJob(id=k, start_frame=sp.start_frame, n_frames=n,
                               video=str(workdir / f"job_{k:05d}_src.mp4"), audio=str(audio_path),
                               out=str(workdir / f"job_{k:05d}_out.mp4"), seg_ids=[s for s, _ in sp.placements]))
    todo = [j for j in jobs if not Path(j.video).exists()]
    if not todo:
        return jobs
    reader = FrameReader(video_path, info.width, info.height, fps=fps)
    try:
        idx = 0
        it = iter(todo)
        job = next(it, None)
        writer = None
        last = todo[-1].start_frame + todo[-1].n_frames
        for frame in reader:
            if job is None or idx >= last:
                break
            if idx == job.start_frame:
                writer = FrameWriter(job.video, info.width, info.height, fps, codec="libx264", crf=10)
            if writer is not None:
                writer.write(frame)
                if idx == job.start_frame + job.n_frames - 1:
                    writer.close()
                    writer = None
                    job = next(it, None)
            idx += 1
            if idx % 500 == 0:
                progress(idx / max(1, last), f"extracting lip-sync clips {idx}/{last} frames")
        if writer is not None:
            writer.close()
    finally:
        reader.close()
    return jobs


def splice(video_path: str, info: MediaInfo, results: list[tuple[int, int, str]], out_path: Path,
           codec: str = "auto", crf: int = 17, progress: ProgressFn = null_progress) -> Path:
    """Re-encode the film, replacing frame ranges with lip-synced clips.

    results: (start_frame, n_frames, clip_path). Shorter clips fall back to the original frames.
    """
    results = sorted(results)
    total = info.frame_count
    w, h, fps = info.width, info.height, info.fps
    reader = FrameReader(video_path, w, h, fps=fps)
    ri = 0
    clip_reader: FrameReader | None = None
    clip_end = -1
    replaced = 0
    try:
        with FrameWriter(out_path, w, h, fps, codec=codec, crf=crf) as writer:
            for idx, frame in enumerate(reader):
                if clip_reader is None and ri < len(results) and idx == results[ri][0]:
                    start, n, path = results[ri]
                    clip_reader = FrameReader(path, w, h)
                    clip_end = start + n
                    ri += 1
                out = frame
                if clip_reader is not None:
                    cf = clip_reader.read()
                    if cf is not None:
                        out = cf
                        replaced += 1
                    if idx + 1 >= clip_end or cf is None:
                        clip_reader.close()
                        clip_reader = None
                while clip_reader is None and ri < len(results) and results[ri][0] <= idx:
                    ri += 1  # skip results we can no longer honour (overlapping ranges)
                writer.write(out)
                if idx % 1000 == 0:
                    progress(idx / max(1, total), f"encoding video {idx}/{total} frames")
    finally:
        reader.close()
        if clip_reader is not None:
            clip_reader.close()
    log.info("spliced %d lip-synced frames into %s", replaced, out_path)
    return out_path
