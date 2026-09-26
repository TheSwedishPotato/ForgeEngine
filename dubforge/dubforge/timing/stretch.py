"""Pitch-preserving time stretching with graceful fallbacks.

rate > 1 makes audio shorter/faster, rate < 1 longer/slower.
Order for method="auto": Rubber Band (best) -> FFmpeg's rubberband filter ->
FFmpeg atempo -> built-in WSOLA (numpy, always available).
"""

from __future__ import annotations

import shutil
import subprocess

import numpy as np

from ..utils.log import get_logger

log = get_logger("stretch")


def _pyrubberband(x: np.ndarray, sr: int, rate: float) -> np.ndarray:
    if not shutil.which("rubberband"):
        raise RuntimeError("rubberband CLI not installed")
    import pyrubberband as pyrb

    return pyrb.time_stretch(x, sr, rate, rbargs={"--fine": ""}).astype(np.float32)


def _ffmpeg_filter(x: np.ndarray, sr: int, filt: str) -> np.ndarray:
    from ..media.ffmpeg import ffmpeg_bin

    cmd = [ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-",
           "-af", filt, "-f", "f32le", "-ar", str(sr), "-ac", "1", "-"]
    proc = subprocess.run(cmd, input=np.ascontiguousarray(x, dtype=np.float32).tobytes(),
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode(errors="replace")[-300:])
    return np.frombuffer(proc.stdout, dtype=np.float32).copy()


def _ffmpeg_rubberband(x: np.ndarray, sr: int, rate: float) -> np.ndarray:
    from ..media.ffmpeg import filter_available

    if not filter_available("rubberband"):
        raise RuntimeError("ffmpeg built without librubberband")
    return _ffmpeg_filter(x, sr, f"rubberband=tempo={rate:.5f}:pitchq=quality:transients=smooth")


def _atempo(x: np.ndarray, sr: int, rate: float) -> np.ndarray:
    chain, r = [], rate
    while r > 2.0:
        chain.append("atempo=2.0")
        r /= 2.0
    while r < 0.5:
        chain.append("atempo=0.5")
        r /= 0.5
    chain.append(f"atempo={r:.5f}")
    return _ffmpeg_filter(x, sr, ",".join(chain))


def _librosa(x: np.ndarray, sr: int, rate: float) -> np.ndarray:
    import librosa

    return librosa.effects.time_stretch(x, rate=rate).astype(np.float32)


def wsola(x: np.ndarray, sr: int, rate: float, frame_ms: float = 32.0, tol_ms: float = 12.0) -> np.ndarray:
    """Waveform-similarity overlap-add. Decent for speech, zero dependencies."""
    x = np.asarray(x, dtype=np.float64)
    n = int(sr * frame_ms / 1000) // 2 * 2
    hs = n // 2
    tol = int(sr * tol_ms / 1000)
    ha = hs * rate
    if len(x) <= n:
        idx = np.clip((np.arange(int(len(x) / rate)) * rate).astype(int), 0, max(0, len(x) - 1))
        return x[idx].astype(np.float32)
    win = np.hanning(n)
    frames = int((len(x) - n) / ha) + 1
    xp = np.pad(x, (tol, n + tol + hs + 1))
    y = np.zeros(frames * hs + n)
    wsum = np.zeros_like(y)
    prev = None
    for k in range(frames):
        ideal = int(round(k * ha)) + tol
        if prev is None:
            best = ideal
        else:
            target = xp[prev + hs: prev + hs + n]
            lo = max(0, ideal - tol)
            region = xp[lo: ideal + tol + n]
            if len(region) < n:
                best = ideal
            else:
                corr = np.correlate(region, target, mode="valid")
                best = lo + int(np.argmax(corr))
        y[k * hs: k * hs + n] += xp[best: best + n] * win
        wsum[k * hs: k * hs + n] += win
        prev = best
    y /= np.maximum(wsum, 1e-3)
    return y[: int(round(len(x) / rate))].astype(np.float32)


_METHODS = {
    "rubberband": _pyrubberband,
    "ffmpeg_rubberband": _ffmpeg_rubberband,
    "atempo": _atempo,
    "librosa": _librosa,
    "wsola": wsola,
}
_warned: set[str] = set()


def time_stretch(x: np.ndarray, sr: int, rate: float, method: str = "auto") -> np.ndarray:
    if abs(rate - 1.0) < 0.005 or len(x) == 0:
        return x.astype(np.float32, copy=False)
    order = ["rubberband", "ffmpeg_rubberband", "atempo", "wsola"] if method == "auto" else [method, "wsola"]
    for m in order:
        try:
            return _METHODS[m](x, sr, rate)
        except Exception as e:
            if m not in _warned and method != "auto":
                log.warning("time-stretch '%s' unavailable (%s); falling back", m, e)
            _warned.add(m)
    return wsola(x, sr, rate)
