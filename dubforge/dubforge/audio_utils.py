"""Audio helpers: IO, resampling, loudness, silence trimming, time-stretch, energy VAD."""
from __future__ import annotations

from math import gcd
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

from .media import has_ffmpeg_filter, run


# ------------------------------------------------------------------ io
def read_audio(path: str | Path, sr: int | None = None, mono: bool = False,
               start: float = 0.0, duration: float | None = None) -> tuple[np.ndarray, int]:
    """Read (a span of) an audio file as float32. Seeks, so it is cheap on a 2-hour wav."""
    with sf.SoundFile(str(path)) as f:
        file_sr = f.samplerate
        f.seek(min(int(max(start, 0.0) * file_sr), f.frames))
        frames = -1 if duration is None else int(duration * file_sr)
        x = f.read(frames, dtype="float32", always_2d=True)
    if mono and x.shape[1] > 1:
        x = x.mean(axis=1, keepdims=True)
    x = x[:, 0] if x.shape[1] == 1 else x
    if sr and sr != file_sr:
        x = resample(x, file_sr, sr)
        file_sr = sr
    return x, file_sr


def write_audio(path: str | Path, x: np.ndarray, sr: int, subtype: str = "PCM_16") -> Path:
    if subtype.startswith("PCM"):
        x = np.clip(x, -1.0, 1.0)
    sf.write(str(path), x, sr, subtype=subtype)
    return Path(path)


def resample(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out or len(x) == 0:
        return x.astype(np.float32, copy=False)
    g = gcd(sr_in, sr_out)
    return resample_poly(x, sr_out // g, sr_in // g, axis=0).astype(np.float32)


def duration_of(path: str | Path) -> float:
    return sf.info(str(path)).duration


# ------------------------------------------------------------------ levels
def db_to_gain(db: float) -> float:
    return float(10 ** (db / 20))


def rms_db(x: np.ndarray) -> float:
    if len(x) == 0:
        return -120.0
    return float(20 * np.log10(np.sqrt(np.mean(np.square(x, dtype=np.float64))) + 1e-9))


def active_rms_db(x: np.ndarray, sr: int, frame_s: float = 0.05, window_db: float = 30.0) -> float:
    """RMS over the *speaking* frames only (frames within `window_db` of the loudest),
    so pauses inside a line don't drag the level down."""
    n = max(1, int(frame_s * sr))
    m = len(x) // n
    if m == 0:
        return rms_db(x)
    frames = x[: m * n].reshape(m, n)
    e = 10 * np.log10(np.mean(np.square(frames, dtype=np.float64), axis=1) + 1e-12)
    keep = e > e.max() - window_db
    return float(10 * np.log10(np.mean(10 ** (e[keep] / 10)) + 1e-12))


def trim_silence(x: np.ndarray, sr: int, rel_db: float = 40.0, pad_s: float = 0.04) -> np.ndarray:
    """Cut leading/trailing silence (TTS models add some) so durations used for fitting are real."""
    n = max(1, int(0.01 * sr))
    m = len(x) // n
    if m < 3:
        return x
    e = 10 * np.log10(np.mean(np.square(x[: m * n].reshape(m, n), dtype=np.float64), axis=1) + 1e-12)
    voiced = np.where(e > e.max() - rel_db)[0]
    if len(voiced) == 0:
        return x
    pad = int(pad_s * sr)
    lo = max(0, voiced[0] * n - pad)
    hi = min(len(x), (voiced[-1] + 1) * n + pad)
    return x[lo:hi]


def fade(x: np.ndarray, sr: int, ms: float = 8.0) -> np.ndarray:
    k = min(int(ms / 1000 * sr), len(x) // 2)
    if k <= 0:
        return x
    x = x.copy()
    ramp = np.linspace(0.0, 1.0, k, dtype=np.float32)
    x[:k] *= ramp
    x[-k:] *= ramp[::-1]
    return x


# ------------------------------------------------------------------ time stretch
def _tempo_filter(ratio: float) -> str:
    if has_ffmpeg_filter("rubberband"):
        return f"rubberband=tempo={ratio:.5f}:pitchq=quality"
    parts = []
    r = ratio
    while r > 2.0:
        parts.append("atempo=2.0")
        r /= 2.0
    while r < 0.5:
        parts.append("atempo=0.5")
        r /= 0.5
    parts.append(f"atempo={r:.5f}")
    return ",".join(parts)


def time_stretch(x: np.ndarray, sr: int, ratio: float) -> np.ndarray:
    """Change duration by 1/ratio WITHOUT changing pitch. ratio>1 = faster/shorter."""
    if abs(ratio - 1.0) < 0.005 or len(x) < 64:
        return x
    raw = np.ascontiguousarray(x, dtype="<f4").tobytes()
    p = run(["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-",
             "-af", _tempo_filter(ratio), "-f", "f32le", "-ar", str(sr), "-ac", "1", "-"], input_bytes=raw)
    return np.frombuffer(p.stdout, dtype="<f4").astype(np.float32)


# ------------------------------------------------------------------ energy VAD
def energy_speech_spans(x: np.ndarray, sr: int, *, frame_s: float = 0.02, min_speech_s: float = 0.25,
                        min_silence_s: float = 0.4, thresh_db: float | None = None) -> list[tuple[float, float]]:
    """Dependency-free VAD (adaptive noise floor + hysteresis). Used for tests/live fallback;
    real speech detection uses Whisper's built-in Silero VAD."""
    n = max(1, int(frame_s * sr))
    m = len(x) // n
    if m == 0:
        return []
    e = 10 * np.log10(np.mean(np.square(x[: m * n].reshape(m, n), dtype=np.float64), axis=1) + 1e-12)
    if thresh_db is None:
        floor = np.percentile(e, 10)
        thresh_db = max(floor + 12.0, -55.0)
    active = e > thresh_db
    spans: list[tuple[int, int]] = []
    start = None
    last_active = None
    gap_frames = int(min_silence_s / frame_s)
    for i, a in enumerate(active):
        if a:
            if start is None:
                start = i
            last_active = i
        elif start is not None and i - last_active > gap_frames:
            spans.append((start, last_active + 1))
            start = None
    if start is not None:
        spans.append((start, last_active + 1))
    min_frames = int(min_speech_s / frame_s)
    return [(a * frame_s, b * frame_s) for a, b in spans if b - a >= min_frames]
