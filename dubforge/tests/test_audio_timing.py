import numpy as np
import pytest

from dubforge.config import MixConfig, TimingConfig
from dubforge.media import audio as au
from dubforge.mixing.mixer import Placement, render_mix
from dubforge.timing.fit import Window, compute_windows, fit_audio, speed_for
from dubforge.timing.stretch import time_stretch, wsola
from dubforge.types import Segment

SR = 24000


def tone(seconds, f=220.0, sr=SR):
    t = np.arange(int(seconds * sr)) / sr
    return (0.3 * np.sin(2 * np.pi * f * t)).astype(np.float32)


def test_wsola_length_and_pitch():
    x = tone(2.0)
    y = wsola(x, SR, 1.25)
    assert abs(len(y) / SR - 1.6) < 0.02
    spec = np.abs(np.fft.rfft(y[2000:14000]))
    peak = np.argmax(spec) * SR / 12000
    assert abs(peak - 220) < 5  # pitch preserved


def test_time_stretch_auto_fallback():
    y = time_stretch(tone(1.0), SR, 0.8)
    assert abs(len(y) / SR - 1.25) < 0.03


def test_trim_silence():
    x = np.concatenate([np.zeros(SR), tone(0.5), np.zeros(SR)])
    y, s, e = au.trim_silence(x, SR)
    assert 0.5 <= len(y) / SR < 0.6
    assert s > 0.9 * SR


def test_envelope_and_add_at():
    env = au.crossfade_envelope(SR, SR, [(0.25, 0.5)], 20, inside=0.0, outside=1.0)
    assert env[0] == 1.0 and env[int(0.4 * SR)] == 0.0 and env[-1] == 1.0
    boost = au.crossfade_envelope(SR, SR, [(0.25, 0.5)], 20, inside=1.0, outside=0.0)
    assert boost[int(0.4 * SR)] == 1.0 and boost[0] == 0.0
    dst = np.zeros(10, np.float32)
    au.add_at(dst, np.ones(5, np.float32), -2)
    au.add_at(dst, np.ones(5, np.float32), 8)
    assert dst.tolist() == [1, 1, 1, 0, 0, 0, 0, 0, 1, 1]


def test_soft_limit_bounds():
    y = au.soft_limit(np.linspace(-3, 3, 1000).astype(np.float32), -1.0)
    assert np.max(np.abs(y)) <= au.db_to_gain(-1.0) + 1e-6


def _seg(i, a, b):
    return Segment(id=i, start=a, end=b, text="x")


def test_windows_respect_next_line():
    cfg = TimingConfig(max_overflow_seconds=0.6, min_gap_seconds=0.1)
    w = compute_windows([_seg(0, 1.0, 2.0), _seg(1, 2.3, 3.0), _seg(2, 5.0, 6.0)], cfg, total_duration=6.2)
    assert w[0].limit_end == pytest.approx(2.2)  # stops before line 1
    assert w[1].limit_end == pytest.approx(3.6)  # free silence after it
    assert w[2].limit_end == pytest.approx(6.2)  # end of film


def test_fit_compresses_and_trims():
    cfg = TimingConfig(max_stretch=1.2, tolerance=0.05)
    w = Window(0.0, 1.0, 1.1)
    r = fit_audio(tone(1.15), SR, w, cfg)
    assert r.rate > 1.0 and not r.trimmed
    assert len(r.audio) / SR <= 1.1
    r2 = fit_audio(tone(3.0), SR, w, cfg)
    assert r2.trimmed and len(r2.audio) / SR <= 1.1 + 1e-3
    r3 = fit_audio(tone(0.5), SR, Window(0, 1.0, 1.2), cfg)
    assert r3.rate < 1.0  # short line gently slowed down
    assert speed_for(1.5, w, cfg) == pytest.approx(1.25)  # capped by max_tts_speed
    assert speed_for(0.9, w, cfg) == 1.0


def test_mixer_keeps_original_outside_dub(tmp_path):
    sr = 16000
    n = sr * 3
    rng = np.random.default_rng(0)
    bg = (0.1 * rng.standard_normal((n, 2))).astype(np.float32)
    vo = (0.2 * rng.standard_normal((n, 2))).astype(np.float32)
    au.save(tmp_path / "bg.wav", bg, sr, "FLOAT")
    au.save(tmp_path / "vo.wav", vo, sr, "FLOAT")
    dub = np.full(sr // 2, 0.25, np.float32)
    au.save(tmp_path / "dub.wav", dub, sr, "FLOAT")
    cfg = MixConfig(limiter=False, crossfade_ms=10, speech_mute_pad_ms=0)
    out = render_mix(tmp_path / "bg.wav", tmp_path / "vo.wav", [Placement(str(tmp_path / "dub.wav"), 1.0, 1.0, 1.5)],
                     tmp_path / "mix.wav", cfg, block_seconds=0.7)
    mix, _ = au.load(out)
    # outside the dubbed line: original (bg + vocals); inside: bg + dub
    a = slice(0, int(0.9 * sr))
    assert np.allclose(mix[a], np.clip(bg[a] + vo[a], -1, 1), atol=2e-4)
    b = slice(int(1.1 * sr), int(1.4 * sr))
    assert np.allclose(mix[b], np.clip(bg[b] + 0.25, -1, 1), atol=2e-4)
