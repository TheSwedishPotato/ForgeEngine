"""Shared fixtures: a synthetic 12-second film with known 'speech' bursts and 'music'.

The fake separator returns the known stems so music preservation can be asserted exactly,
without needing Demucs or a GPU.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dubforge import registry                      # noqa: E402
from dubforge.base import Separator                # noqa: E402
from dubforge.config import Config                 # noqa: E402

SR = 44100
DURATION = 12.0
# (start, end) of the three spoken lines in the synthetic film
LINES = [(1.0, 3.2), (4.5, 6.0), (8.0, 11.0)]


def make_stems() -> tuple[np.ndarray, np.ndarray]:
    t = np.arange(int(DURATION * SR)) / SR
    music = 0.12 * np.sin(2 * np.pi * 220 * t) + 0.08 * np.sin(2 * np.pi * 330 * t)
    voice = np.zeros_like(t)
    for a, b in LINES:
        m = (t >= a) & (t < b)
        env = 0.5 * (1 + np.sin(2 * np.pi * 4 * t[m]))
        voice[m] = 0.35 * np.sin(2 * np.pi * 150 * t[m]) * env + 0.1 * np.sin(2 * np.pi * 300 * t[m])
    return np.stack([voice, voice], 1).astype(np.float32), np.stack([music, music], 1).astype(np.float32)


class FakeSeparator(Separator):
    """Returns the exact stems the test film was built from."""
    name = "fake"

    def __init__(self, cfg):
        self.cfg = cfg

    def separate(self, audio_path, out_dir, progress=lambda f, m="": None):
        out_dir.mkdir(parents=True, exist_ok=True)
        voice, music = make_stems()
        sf.write(out_dir / "vocals.wav", voice, SR, subtype="PCM_16")
        sf.write(out_dir / "accompaniment.wav", music, SR, subtype="PCM_16")
        return out_dir / "vocals.wav", out_dir / "accompaniment.wav"


registry.register("separate", "fake", "conftest:FakeSeparator")


@pytest.fixture(scope="session")
def film(tmp_path_factory) -> Path:
    d = tmp_path_factory.mktemp("film")
    voice, music = make_stems()
    wav = d / "mix.wav"
    sf.write(wav, voice + music, SR, subtype="PCM_16")
    out = d / "film.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size=320x240:rate=25:duration={DURATION}",
                    "-i", str(wav), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(out)], check=True)
    return out


@pytest.fixture()
def cfg(tmp_path) -> Config:
    c = Config()
    c.work_dir, c.output_dir, c.models_dir = str(tmp_path / "work"), str(tmp_path / "out"), str(tmp_path / "models")
    c.separate.backend = "fake"
    c.asr.backend = "energy_mock"
    c.diarize.backend = "single"
    c.emotion.backend = "none"
    c.translate.backend = "passthrough"
    c.tts.backend = "mock"
    c.device = "cpu"
    return c


@pytest.fixture(scope="session")
def rotated_film(tmp_path_factory) -> Path:
    """Phone-style file: stored PORTRAIT (240x320) with a 90 degree display-rotation flag, i.e. it plays
    as 320x240 landscape. This is what iPhone/Android screen recordings look like, and what broke the
    first version of the frame reader (it read frames at the stored size -> scrambled picture)."""
    d = tmp_path_factory.mktemp("rot")
    voice, music = make_stems()
    wav = d / "mix.wav"
    sf.write(wav, voice + music, SR, subtype="PCM_16")
    stored = d / "stored.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size=240x320:rate=25:duration={DURATION}",
                    "-i", str(wav), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(stored)], check=True)
    out = d / "rotated.mp4"
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-display_rotation", "90", "-i", str(stored), "-c", "copy", str(out)], check=True)
    return out
