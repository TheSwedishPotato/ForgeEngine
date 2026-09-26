"""Lightweight prosody features (numpy only): loudness, pitch, voicing, speaking rate.

Used to (a) detect whispers and shouts, (b) match the dub's loudness per line,
(c) pick emotionally matching reference clips for the voice clone.
"""

from __future__ import annotations

import numpy as np

from ..media import audio as au


def frame_signal(x: np.ndarray, frame: int, hop: int) -> np.ndarray:
    if len(x) < frame:
        x = np.pad(x, (0, frame - len(x)))
    n = 1 + (len(x) - frame) // hop
    idx = np.arange(frame)[None, :] + hop * np.arange(n)[:, None]
    return x[idx]


def pitch_track(x: np.ndarray, sr: int, fmin: float = 70.0, fmax: float = 450.0,
                frame_ms: float = 40.0, hop_ms: float = 10.0, voicing_threshold: float = 0.45) -> tuple[np.ndarray, np.ndarray]:
    """Normalized-autocorrelation pitch tracker. Returns (f0 Hz per frame, voiced mask)."""
    frame = int(sr * frame_ms / 1000)
    hop = int(sr * hop_ms / 1000)
    frames = frame_signal(x.astype(np.float64), frame, hop)
    frames = frames - frames.mean(axis=1, keepdims=True)
    energy = np.sqrt(np.mean(frames**2, axis=1))
    lag_min, lag_max = int(sr / fmax), min(int(sr / fmin), frame - 1)
    nfft = 1 << (2 * frame - 1).bit_length()
    spec = np.fft.rfft(frames, nfft, axis=1)
    ac = np.fft.irfft(np.abs(spec) ** 2, nfft, axis=1)[:, :frame]
    ac0 = ac[:, :1] + 1e-12
    nac = ac / ac0
    window = nac[:, lag_min:lag_max]
    best = np.argmax(window, axis=1)
    strength = window[np.arange(len(window)), best]
    lags = best + lag_min
    f0 = sr / np.maximum(lags, 1)
    gate = energy > (energy.max() * 0.05 + 1e-6)
    voiced = (strength > voicing_threshold) & gate
    return np.where(voiced, f0, 0.0), voiced


def analyze(clip: np.ndarray, sr: int) -> dict[str, float]:
    x = au.to_mono(clip)
    if len(x) < sr * 0.1:
        return {"rms_db": -80.0, "voiced_ratio": 0.0, "f0_median": 0.0, "f0_range": 0.0, "energy_var": 0.0}
    rms_db = au.gain_to_db(au.active_rms(x, sr))
    f0, voiced = pitch_track(x, sr)
    frames = frame_signal(x, int(sr * 0.04), int(sr * 0.01))
    energy = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1) + 1e-12)
    active = energy > energy.max() * 0.05
    voiced_ratio = float(voiced.sum() / max(1, active.sum()))
    vf = f0[voiced]
    f0_med = float(np.median(vf)) if vf.size else 0.0
    f0_rng = float(np.percentile(vf, 90) - np.percentile(vf, 10)) if vf.size > 5 else 0.0
    e_db = 20 * np.log10(energy[active] + 1e-9) if active.any() else np.zeros(1)
    return {
        "rms_db": round(rms_db, 2),
        "voiced_ratio": round(voiced_ratio, 3),
        "f0_median": round(f0_med, 1),
        "f0_range": round(f0_rng, 1),
        "energy_var": round(float(np.std(e_db)), 2),
    }


def heuristic_emotion(p: dict[str, float], speaker_rms_db: float | None = None,
                      whisper_voiced_ratio: float = 0.25) -> tuple[str, dict[str, float]]:
    """Cheap rule-based label when no classifier is available (or to add 'whisper')."""
    if p["rms_db"] < -70:
        return "neutral", {"neutral": 1.0}
    rel = p["rms_db"] - (speaker_rms_db if speaker_rms_db is not None else -24.0)
    if p["voiced_ratio"] < whisper_voiced_ratio:
        return "whisper", {"whisper": 1.0}
    if rel > 6 and p["f0_range"] > 80:
        return "angry", {"angry": 0.7, "happy": 0.3}
    if rel > 4 and p["f0_range"] > 60:
        return "happy", {"happy": 0.6, "angry": 0.4}
    if rel < -5 and p["f0_range"] < 40:
        return "sad", {"sad": 0.7, "neutral": 0.3}
    return "neutral", {"neutral": 1.0}
