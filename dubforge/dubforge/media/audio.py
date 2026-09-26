"""Audio helpers built on numpy/soundfile only (no torch), so they are fast to import and test.

Convention: audio arrays are float32, shape [samples] (mono) or [samples, channels].
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np
import soundfile as sf

EPS = 1e-9


# --------------------------------------------------------------------------- IO


def load(path: str | os.PathLike, sr: int | None = None, mono: bool = False,
         start: float | None = None, end: float | None = None) -> tuple[np.ndarray, int]:
    """Load a (section of a) file. WAV/FLAC via soundfile, anything else via ffmpeg."""
    path = str(path)
    try:
        info = sf.info(path)
        file_sr = info.samplerate
        s = int(round((start or 0.0) * file_sr))
        e = int(round(end * file_sr)) if end is not None else -1
        audio, file_sr = sf.read(path, start=s, stop=None if e < 0 else e, dtype="float32", always_2d=True)
    except (RuntimeError, sf.LibsndfileError):
        from .ffmpeg import decode_audio

        target_sr = sr or 44100
        audio = decode_audio(path, target_sr, channels=1 if mono else 2)
        file_sr = target_sr
        if start is not None or end is not None:
            s = int(round((start or 0.0) * file_sr))
            e = int(round(end * file_sr)) if end is not None else len(audio)
            audio = audio[s:e]
    if mono:
        audio = to_mono(audio)
    if sr and sr != file_sr:
        audio = resample(audio, file_sr, sr)
        file_sr = sr
    return np.ascontiguousarray(audio, dtype=np.float32), file_sr


def save(path: str | os.PathLike, audio: np.ndarray, sr: int, subtype: str = "PCM_16") -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    data = np.asarray(audio, dtype=np.float32)
    if subtype.startswith("PCM"):
        data = np.clip(data, -1.0, 1.0)
    sf.write(str(path), data, sr, subtype=subtype)
    return path


def duration(path: str | os.PathLike) -> float:
    info = sf.info(str(path))
    return info.frames / float(info.samplerate)


# --------------------------------------------------------------------------- basic DSP


def to_mono(audio: np.ndarray) -> np.ndarray:
    if audio.ndim == 1:
        return audio
    return audio.mean(axis=1).astype(np.float32)


def to_channels(audio: np.ndarray, channels: int) -> np.ndarray:
    if audio.ndim == 1:
        audio = audio[:, None]
    if audio.shape[1] == channels:
        return audio
    if channels == 1:
        return audio.mean(axis=1, keepdims=True)
    if audio.shape[1] == 1:
        return np.repeat(audio, channels, axis=1)
    return audio[:, :channels] if audio.shape[1] > channels else np.pad(audio, ((0, 0), (0, channels - audio.shape[1])), mode="edge")


def resample(audio: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out or len(audio) == 0:
        return audio.astype(np.float32, copy=False)
    try:
        import soxr

        return soxr.resample(audio, sr_in, sr_out, quality="HQ").astype(np.float32)
    except ImportError:
        from math import gcd

        from scipy.signal import resample_poly

        g = gcd(sr_in, sr_out)
        return resample_poly(audio, sr_out // g, sr_in // g, axis=0).astype(np.float32)


def rms(audio: np.ndarray) -> float:
    if audio.size == 0:
        return 0.0
    return float(np.sqrt(np.mean(np.square(audio, dtype=np.float64)) + EPS))


def active_rms(audio: np.ndarray, sr: int, frame_ms: float = 30.0, gate_db: float = -45.0) -> float:
    """RMS over non-silent frames only, so pauses don't make a line look quieter than it is."""
    x = to_mono(audio)
    n = max(1, int(sr * frame_ms / 1000))
    frames = len(x) // n
    if frames == 0:
        return rms(x)
    fr = x[: frames * n].reshape(frames, n)
    levels = np.sqrt(np.mean(fr.astype(np.float64) ** 2, axis=1) + EPS)
    gate = db_to_gain(gate_db)
    active = levels[levels > gate]
    if active.size == 0:
        return rms(x)
    return float(np.sqrt(np.mean(active**2)))


def db_to_gain(db: float) -> float:
    return float(10.0 ** (db / 20.0))


def gain_to_db(g: float) -> float:
    return float(20.0 * np.log10(max(g, EPS)))


def peak(audio: np.ndarray) -> float:
    return float(np.max(np.abs(audio))) if audio.size else 0.0


def fade(audio: np.ndarray, sr: int, fade_in_ms: float = 10.0, fade_out_ms: float = 10.0) -> np.ndarray:
    out = audio.astype(np.float32, copy=True)
    n_in = min(len(out), int(sr * fade_in_ms / 1000))
    n_out = min(len(out), int(sr * fade_out_ms / 1000))
    shape = (-1,) + (1,) * (out.ndim - 1)
    if n_in > 0:
        out[:n_in] *= np.linspace(0.0, 1.0, n_in, dtype=np.float32).reshape(shape)
    if n_out > 0:
        out[-n_out:] *= np.linspace(1.0, 0.0, n_out, dtype=np.float32).reshape(shape)
    return out


def trim_silence(audio: np.ndarray, sr: int, threshold_db: float = -42.0, pad_ms: float = 25.0,
                 frame_ms: float = 10.0) -> tuple[np.ndarray, int, int]:
    """Trim leading/trailing silence relative to the clip's own peak level.

    Returns (trimmed, start_sample, end_sample)."""
    x = to_mono(audio)
    if len(x) == 0:
        return audio, 0, 0
    n = max(1, int(sr * frame_ms / 1000))
    frames = int(np.ceil(len(x) / n))
    padded = np.pad(x, (0, frames * n - len(x)))
    levels = np.sqrt(np.mean(padded.reshape(frames, n) ** 2, axis=1) + EPS)
    ref = max(levels.max(), EPS)
    loud = np.nonzero(levels > ref * db_to_gain(threshold_db))[0]
    if loud.size == 0:
        return audio[:0], 0, 0
    pad = int(sr * pad_ms / 1000)
    s = max(0, loud[0] * n - pad)
    e = min(len(x), (loud[-1] + 1) * n + pad)
    return audio[s:e], s, e


def match_length(audio: np.ndarray, n: int) -> np.ndarray:
    if len(audio) == n:
        return audio
    if len(audio) > n:
        return audio[:n]
    pad = [(0, n - len(audio))] + [(0, 0)] * (audio.ndim - 1)
    return np.pad(audio, pad)


def soft_limit(audio: np.ndarray, ceiling_db: float = -1.0) -> np.ndarray:
    """Transparent-ish peak limiter: tanh knee above the ceiling, linear below."""
    ceiling = db_to_gain(ceiling_db)
    out = audio.astype(np.float32, copy=True)
    knee = 0.8 * ceiling
    over = np.abs(out) > knee
    if np.any(over):
        s = np.sign(out[over])
        excess = (np.abs(out[over]) - knee) / (ceiling - knee)
        out[over] = s * (knee + (ceiling - knee) * np.tanh(excess))
    return out


def add_at(dst: np.ndarray, src: np.ndarray, start: int, gain: float = 1.0) -> None:
    """dst[start:start+len(src)] += src*gain, clipped to dst bounds (in place)."""
    if start >= len(dst) or len(src) == 0:
        return
    s0 = max(0, -start)
    d0 = max(0, start)
    n = min(len(src) - s0, len(dst) - d0)
    if n <= 0:
        return
    seg = src[s0 : s0 + n]
    if dst.ndim == 2 and seg.ndim == 1:
        seg = seg[:, None]
    dst[d0 : d0 + n] += seg * gain


def crossfade_envelope(n_total: int, sr: int, regions: list[tuple[float, float]], fade_ms: float,
                       inside: float = 0.0, outside: float = 1.0) -> np.ndarray:
    """Gain envelope that is `inside` within regions (seconds) and `outside` elsewhere, with ramps."""
    mask = np.zeros(n_total, dtype=np.float32)  # 1 = fully "inside"
    ramp = max(1, int(sr * fade_ms / 1000))
    for a, b in regions:
        s = max(0, int(a * sr))
        e = min(n_total, int(b * sr))
        if e <= s:
            continue
        mask[s:e] = 1.0
        rs = max(0, s - ramp)
        if s > rs:
            mask[rs:s] = np.maximum(mask[rs:s], np.linspace(0.0, 1.0, s - rs, dtype=np.float32))
        re = min(n_total, e + ramp)
        if re > e:
            mask[e:re] = np.maximum(mask[e:re], np.linspace(1.0, 0.0, re - e, dtype=np.float32))
    return (outside + (inside - outside) * mask).astype(np.float32)
