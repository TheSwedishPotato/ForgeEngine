"""Live-mode audio logic without real audio devices or models."""

import numpy as np

from dubforge.live.audio_overlay import LiveAudioDubber
from dubforge.live.video_buffer import LiveVideoDubber


def test_center_cancel_removes_centre_dialogue(mock_cfg):
    d = LiveAudioDubber(mock_cfg("live.background_mode=center_cancel", "live.samplerate=16000"))
    t = np.arange(16000) / 16000
    dialogue = 0.3 * np.sin(2 * np.pi * 800 * t)  # centred voice
    side = 0.2 * np.sin(2 * np.pi * 1300 * t)  # stereo-wide music
    x = np.stack([dialogue + side, dialogue - side], axis=1).astype(np.float32)
    y = d._process_original(x, dub_active=False)
    spec_in = np.abs(np.fft.rfft(x[:, 0]))
    spec_out = np.abs(np.fft.rfft(y[:, 0]))
    assert spec_out[800] < 0.05 * spec_in[800]  # voice gone
    assert spec_out[1300] > 0.9 * spec_in[1300]  # music kept


def test_duck_mode_lowers_original_while_dubbing(mock_cfg):
    d = LiveAudioDubber(mock_cfg("live.background_mode=duck", "live.duck_db=-20", "live.samplerate=16000"))
    x = np.ones((1600, 2), np.float32) * 0.5
    for _ in range(20):
        y = d._process_original(x, dub_active=True)
    assert np.allclose(y[-1], 0.05, atol=0.01)
    for _ in range(60):
        y = d._process_original(x, dub_active=False)
    assert np.allclose(y[-1], 0.5, atol=0.02)


def test_output_mix_passthrough_and_dub(mock_cfg):
    d = LiveAudioDubber(mock_cfg("live.background_mode=mute", "live.samplerate=16000"))
    d.dub.write(np.full(800, 0.25, np.float32))
    d._on_input(np.full((320, 2), 0.5, np.float32), 320, None, None)
    out = np.zeros((1000, 2), np.float32)
    d._on_output(out, 1000, None, None)
    assert np.allclose(out[:800], 0.25, atol=0.01) and np.allclose(out[800:], 0.0)


def test_delayed_video_replaces_dialogue_in_place(mock_cfg):
    sr = 8000
    v = LiveVideoDubber(mock_cfg("live.samplerate=8000", "live.video.delay_seconds=1"))
    block = 400
    # 2 s of "original" audio at 0.5
    for _ in range(0, 2 * sr, block):
        v._on_input(np.full((block, 2), 0.5, np.float32), block, None, None)
    # the worker dubbed 0.25-0.5 s: background there is 0.1, dub adds 0.2
    start, n = int(0.25 * sr), int(0.25 * sr)
    v.bg.write(start, np.full((n, 2), 0.1, np.float32))
    v.mask.write(start, np.ones((n, 1), np.float32))
    v.dubtl.write(start, np.full(n, 0.2, np.float32), add=True)
    v.write_idx = sr  # pretend exactly `delay` is buffered
    out = np.zeros((sr, 2), np.float32)
    v._on_output(out, sr, None, None)  # starts the clock (silence)
    assert np.allclose(out, 0) and v.play_idx == 0
    v.play_idx = 0  # write_idx - play_idx == delay: no drift correction
    out = np.zeros((sr, 2), np.float32)
    v._on_output(out, sr, None, None)
    assert np.allclose(out[: start - 10], 0.5, atol=1e-3)
    assert np.allclose(out[start + 10: start + n - 10], 0.3, atol=1e-3)  # bg 0.1 + dub 0.2
    assert np.allclose(out[start + n + 10:], 0.5, atol=1e-3)
