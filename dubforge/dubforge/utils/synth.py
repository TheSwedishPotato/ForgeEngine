"""Synthetic test media: a 'film' with two voices talking over music, no models needed.

Used by the unit tests and by `scripts/test_30s_clip.py --mock` to prove the
plumbing (ffmpeg, separation, mixing, splicing, muxing) works on your machine.
"""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np

from ..media import audio as au
from ..media import ffmpeg as ff


def synth_dialogue(duration: float = 12.0, sr: int = 44100, seed: int = 0) -> np.ndarray:
    rng = np.random.default_rng(seed)
    n = int(duration * sr)
    t = np.arange(n) / sr
    # background "music": soft chord + noise
    music = 0.05 * (np.sin(2 * np.pi * 55 * t) + np.sin(2 * np.pi * 82.4 * t) + np.sin(2 * np.pi * 110 * t))
    music += 0.002 * rng.standard_normal(n)
    voice = np.zeros(n)
    cursor, speaker = 0.6, 0
    while cursor < duration - 1.5:
        length = float(rng.uniform(1.2, 3.0))
        a, b = int(cursor * sr), int(min(duration, cursor + length) * sr)
        tt = t[a:b] - t[a]
        f0 = (130.0 if speaker == 0 else 210.0) * (1 + 0.05 * np.sin(2 * np.pi * 0.7 * tt))
        phase = 2 * np.pi * np.cumsum(f0) / sr
        v = sum(np.sin(k * phase) / k for k in range(1, 8))
        v *= 0.5 + 0.5 * np.sin(2 * np.pi * 4.0 * tt) ** 2  # syllables
        v *= np.minimum(1, np.minimum(tt, tt[::-1]) / 0.05)
        voice[a:b] += 0.25 * v
        cursor += length + float(rng.uniform(0.5, 1.2))
        speaker = 1 - speaker
    mix = np.stack([music + voice, music * 0.9 + voice], axis=1)
    return au.soft_limit(mix.astype(np.float32), -1.0)


def make_test_video(path: str | os.PathLike, duration: float = 12.0, width: int = 320, height: int = 240,
                    fps: int = 25) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    wav = path.with_suffix(".src.wav")
    au.save(wav, synth_dialogue(duration), 44100)
    ff.run(["-f", "lavfi", "-i", f"testsrc2=size={width}x{height}:rate={fps}:duration={duration}", "-i", str(wav),
            "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
            "-shortest", str(path)], "make test video")
    wav.unlink(missing_ok=True)
    return path
