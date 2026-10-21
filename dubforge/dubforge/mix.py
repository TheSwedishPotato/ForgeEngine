"""Place dubbed lines on the timeline and mix them with the preserved background.

Pipeline: TTS wavs -> trim -> fit into the actor's time slot (time-stretch, borrow silence)
-> match the original line's loudness -> add to a mono dub track -> blockwise final mix with
the Demucs accompaniment (music + effects) and the gated "leftover vocals" (screams, laughs).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import soundfile as sf

from .audio_utils import (active_rms_db, db_to_gain, fade, read_audio, resample, time_stretch,
                          trim_silence)
from .config import FitCfg, MixCfg
from .types import Segment


# ------------------------------------------------------------------ fitting
@dataclass
class FitPlan:
    seg_id: int
    start: float
    ratio: float                 # >1 = speed up
    out_dur: float
    flags: list[str] = field(default_factory=list)

    @property
    def end(self) -> float:
        return self.start + self.out_dur


def plan_fit(segments: list[Segment], durations: dict[int, float], cfg: FitCfg,
             total_duration: float) -> dict[int, FitPlan]:
    """Decide, per line, how to squeeze the dubbed speech into the original timing.

    Order of preference: (1) fits -> untouched, (2) speed up to <= max_speedup so it ends with
    the original, (3) speed up to max_speedup and spill into the silence that follows,
    (4) compress harder up to hard_speedup, (5) flag `overrun` (it will overlap the next line).
    Slowing speech down is never done: it sounds drugged.
    """
    ordered = sorted(segments, key=lambda s: s.start)
    plans: dict[int, FitPlan] = {}
    for i, seg in enumerate(ordered):
        d = durations.get(seg.id)
        if not d:
            continue
        nxt = ordered[i + 1].start if i + 1 < len(ordered) else total_duration
        soft_end = max(seg.end, seg.start + 0.2)
        hard_end = max(soft_end, min(seg.end + cfg.max_spill_s, nxt - cfg.min_gap_s))
        slot = soft_end - seg.start
        ratio, flags = 1.0, []
        if d > slot * 1.03:
            r_soft = d / slot
            if r_soft <= cfg.max_speedup:
                ratio = r_soft
            else:
                ratio = cfg.max_speedup
                room = hard_end - seg.start
                if d / ratio <= room:
                    flags.append("spill")
                else:
                    ratio = min(cfg.hard_speedup, d / room)
                    flags.append("compressed")
                    if d / ratio > room + 1e-3:
                        flags.append("overrun")
        plans[seg.id] = FitPlan(seg.id, seg.start, ratio, d / ratio, flags)
    return plans


# ------------------------------------------------------------------ dub track
def load_tts_clip(path: str | Path) -> tuple[np.ndarray, int]:
    x, sr = read_audio(path, mono=True)
    return trim_silence(x, sr), sr


def build_dub_track(segments: list[Segment], plans: dict[int, FitPlan], sr_out: int,
                    total_duration: float, fit_cfg: FitCfg, mix_cfg: MixCfg
                    ) -> tuple[np.ndarray, dict[int, tuple[float, float]]]:
    """Mono float32 track of all dubbed lines + the (start, end) actually occupied by each."""
    track = np.zeros(int(total_duration * sr_out) + sr_out, dtype=np.float32)
    placed: dict[int, tuple[float, float]] = {}
    for seg in segments:
        plan = plans.get(seg.id)
        if plan is None or not seg.tts_path:
            continue
        x, sr = load_tts_clip(seg.tts_path)
        x = resample(x, sr, sr_out)
        x = time_stretch(x, sr_out, plan.ratio)
        if fit_cfg.match_loudness and seg.energy_db is not None and len(x):
            target = seg.energy_db + fit_cfg.loudness_offset_db
            gain_db = float(np.clip(target - active_rms_db(x, sr_out), -18.0, 12.0))
            x = x * db_to_gain(gain_db)
        x = fade(x, sr_out) * db_to_gain(mix_cfg.dub_gain_db)
        i0 = int(plan.start * sr_out)
        if i0 >= len(track):
            continue
        i1 = min(len(track), i0 + len(x))
        track[i0:i1] += x[: i1 - i0]
        placed[seg.id] = (plan.start, plan.start + len(x) / sr_out)
    return track, placed


# ------------------------------------------------------------------ residual vocals gate
def residual_gain_curve(segments: list[Segment], total_duration: float, pad_s: float,
                        rate: int = 100) -> np.ndarray:
    """1.0 where NO dubbed speech is playing, 0.0 under dubbed lines (soft edges).
    Applied to the original vocals stem so only untranscribed sounds (screams, laughs,
    breaths, crowd) survive. A line that could not be voiced (or is deliberately skipped, e.g.
    a song) is NOT gated, so the viewer hears the original instead of a hole."""
    n = int(total_duration * rate) + 2
    speech = np.zeros(n, dtype=np.float32)
    for s in segments:
        if s.skip or not s.tts_path:
            continue
        a = max(0, int((s.start - pad_s) * rate))
        b = min(n, int((s.end + pad_s) * rate) + 1)
        speech[a:b] = 1.0
    k = max(1, int(0.08 * rate))
    kernel = np.ones(k, dtype=np.float32) / k
    speech = np.clip(np.convolve(speech, kernel, mode="same") * 1.0, 0.0, 1.0)
    # widen so smoothing never lets a sliver of original speech through
    speech = np.maximum(speech, np.roll(speech, 1))
    return 1.0 - speech


def final_mix(accomp_path: Path, vocals_path: Path, dub: np.ndarray, sr: int, segments: list[Segment],
              out_path: Path, mix_cfg: MixCfg, block_s: float = 30.0) -> float:
    """Blockwise (constant memory) mix. Returns the peak before normalisation."""
    with sf.SoundFile(str(accomp_path)) as fa, sf.SoundFile(str(vocals_path)) as fv:
        if fa.samplerate != sr or fv.samplerate != sr:
            raise ValueError(f"stems must be {sr} Hz, got {fa.samplerate}/{fv.samplerate}")
        total = fa.frames
        curve = residual_gain_curve(segments, total / sr, mix_cfg.residual_pad_s)
        g_acc = db_to_gain(mix_cfg.accompaniment_gain_db)
        g_res = mix_cfg.residual_vocals_gain
        raw = Path(str(out_path) + ".raw.wav")
        peak = 0.0
        block = int(block_s * sr)
        with sf.SoundFile(str(raw), "w", sr, 2, "FLOAT") as fo:
            pos = 0
            while pos < total:
                n = min(block, total - pos)
                a = fa.read(n, dtype="float32", always_2d=True)
                v = fv.read(n, dtype="float32", always_2d=True)
                n = min(len(a), len(v))
                a, v = a[:n], v[:n]
                t = (np.arange(pos, pos + n) / sr) * 100.0
                gate = np.interp(t, np.arange(len(curve)), curve).astype(np.float32)[:, None]
                d = dub[pos:pos + n]
                if len(d) < n:
                    d = np.pad(d, (0, n - len(d)))
                y = a * g_acc + v * gate * g_res + d[:, None]
                peak = max(peak, float(np.max(np.abs(y))) if n else 0.0)
                fo.write(y)
                pos += n
    if peak > 0.99:
        scale = 0.99 / peak
        with sf.SoundFile(str(raw)) as fi, sf.SoundFile(str(out_path), "w", sr, 2, "PCM_24") as fo:
            while True:
                b = fi.read(int(block_s * sr), dtype="float32", always_2d=True)
                if not len(b):
                    break
                fo.write(b * scale)
        raw.unlink()
    else:
        with sf.SoundFile(str(raw)) as fi, sf.SoundFile(str(out_path), "w", sr, 2, "PCM_24") as fo:
            while True:
                b = fi.read(int(block_s * sr), dtype="float32", always_2d=True)
                if not len(b):
                    break
                fo.write(b)
        raw.unlink()
    return peak
