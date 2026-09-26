"""Final dub mix, rendered block by block so a 3-hour film never has to fit in RAM.

    out = background
        + original vocals with the dubbed lines muted (keeps laughs, screams, breaths)
        + dubbed lines at their placed positions (already loudness-matched per line)
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import MixConfig
from ..media import audio as au
from ..utils.log import ProgressFn, get_logger, null_progress

log = get_logger("mix")


@dataclass
class Placement:
    path: str  # fitted dub clip (mono)
    start: float  # seconds in the film
    mute_start: float  # original speech span to silence
    mute_end: float


def render_mix(background_path: str | os.PathLike, vocals_path: str | os.PathLike, placements: list[Placement],
               out_path: str | os.PathLike, cfg: MixConfig, progress: ProgressFn = null_progress,
               block_seconds: float = 30.0, dub_only_path: str | os.PathLike | None = None) -> Path:
    out_path = Path(out_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    placements = sorted(placements, key=lambda p: p.start)
    pad = cfg.speech_mute_pad_ms / 1000.0
    regions = [(p.mute_start - pad, p.mute_end + pad) for p in placements]
    bg_gain = au.db_to_gain(cfg.background_gain_db)
    dub_gain = au.db_to_gain(cfg.dub_gain_db)

    with sf.SoundFile(str(background_path)) as bg, sf.SoundFile(str(vocals_path)) as vo:
        sr, ch, total = bg.samplerate, bg.channels, bg.frames
        if vo.samplerate != sr:
            raise ValueError("background and vocals stems must share a sample rate")
        clips: dict[int, tuple[int, np.ndarray]] = {}  # index -> (start sample, audio [n, ch])
        next_clip = 0
        block = int(block_seconds * sr)
        dub_writer = sf.SoundFile(str(dub_only_path), "w", sr, 1, subtype="PCM_16") if dub_only_path else None
        with sf.SoundFile(str(out_path), "w", sr, ch, subtype="PCM_16") as out:
            for b0 in range(0, total, block):
                b1 = min(total, b0 + block)
                n = b1 - b0
                bg.seek(b0)
                vo.seek(b0)
                back = bg.read(n, dtype="float32", always_2d=True) * bg_gain
                voc = vo.read(n, dtype="float32", always_2d=True)
                t0, t1 = b0 / sr, b1 / sr

                if cfg.keep_nonspeech_vocals:
                    local = [(a - t0, b - t0) for a, b in regions if b > t0 - 1 and a < t1 + 1]
                    env = au.crossfade_envelope(n, sr, local, cfg.crossfade_ms, inside=0.0, outside=1.0)
                    mix = back + voc * env[:, None]
                else:
                    mix = back

                # load clips that start before the end of this block
                while next_clip < len(placements) and placements[next_clip].start < t1:
                    p = placements[next_clip]
                    audio, csr = au.load(p.path, mono=True)
                    audio = au.resample(audio, csr, sr)
                    clips[next_clip] = (int(round(p.start * sr)), audio)
                    next_clip += 1
                dub = np.zeros(n, dtype=np.float32)
                for k in list(clips):
                    s, audio = clips[k]
                    au.add_at(dub, audio, s - b0, dub_gain)
                    if s + len(audio) <= b1:
                        del clips[k]
                mix = mix + dub[:, None]
                if cfg.limiter:
                    mix = au.soft_limit(mix, -0.5)
                out.write(np.clip(mix, -1.0, 1.0))
                if dub_writer is not None:
                    dub_writer.write(np.clip(dub, -1.0, 1.0))
                progress(b1 / total, f"mixing {b1 / sr / 60:.1f}/{total / sr / 60:.1f} min")
        if dub_writer is not None:
            dub_writer.close()
    return out_path
