"""Live engine, tested offline: ring buffer, utterance detection, output scheduling, and a full
simulated run (audio in -> dubbed audio out) with fake models."""
from __future__ import annotations

import numpy as np

from dubforge.audio_utils import energy_speech_spans, read_audio, write_audio
from dubforge.asr.mock import EnergyMockASR
from dubforge.config import Config
from dubforge.live.audio_io import run_files
from dubforge.live.core import LiveDubber, OutputMixer, RingBuffer, UtteranceSegmenter
from dubforge.live.video_delay import DelayLine
from dubforge.translate.mock import PassthroughTranslator
from dubforge.tts.mock import MockTTS

SR = 16000


def burst(dur, f=200, amp=0.25):
    t = np.arange(int(dur * SR)) / SR
    return (amp * np.sin(2 * np.pi * f * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t))).astype(np.float32)


def timeline(total, bursts):
    x = np.zeros(int(total * SR), np.float32)
    rng = np.random.default_rng(0)
    x += 1e-4 * rng.standard_normal(len(x)).astype(np.float32)
    for a, d in bursts:
        b = burst(d)
        x[int(a * SR):int(a * SR) + len(b)] += b
    return x


def test_ring_buffer_wraps_and_forgets():
    r = RingBuffer(100)
    r.write(np.arange(70, dtype=np.float32))
    r.write(np.arange(70, 130, dtype=np.float32))                 # wraps
    assert r.total == 130
    assert list(r.read(110, 5)) == [110, 111, 112, 113, 114]
    assert list(r.read(25, 3)) == [0, 0, 0]                        # overwritten (older than capacity)
    r.write(np.arange(130, 400, dtype=np.float32))                 # block larger than capacity
    assert r.total == 400 and list(r.read(398, 2)) == [398, 399] and r.read(300, 1)[0] == 300


def test_segmenter_emits_only_finished_utterances_once():
    x = timeline(12, [(1.0, 1.5), (5.0, 2.0)])
    ring = RingBuffer(SR * 40)
    seg = UtteranceSegmenter(SR, lambda a, sr: energy_speech_spans(a, sr, min_silence_s=0.5), min_silence_s=0.6)
    found = []
    for i in range(0, len(x), SR // 10):
        ring.write(x[i:i + SR // 10])
        found += seg.poll(ring)
        if ring.total == int(6.5 * SR):                              # second utterance still open at t=6.5 (ends 7.0)
            assert len(found) == 1
    assert len(found) == 2
    (a0, b0), (a1, b1) = found
    assert abs(a0 / SR - 1.0) < 0.15 and abs(b0 / SR - 2.5) < 0.15
    assert abs(a1 / SR - 5.0) < 0.15 and abs(b1 / SR - 7.0) < 0.15


def test_segmenter_force_cuts_endless_speech():
    x = timeline(30, [(1.0, 24.0)])
    ring = RingBuffer(SR * 60)
    seg = UtteranceSegmenter(SR, lambda a, sr: energy_speech_spans(a, sr, min_silence_s=0.5), max_utt_s=10.0, min_silence_s=0.6)
    found = []
    for i in range(0, len(x), SR // 10):
        ring.write(x[i:i + SR // 10])
        found += seg.poll(ring)
    assert len(found) >= 3 and all((b - a) / SR <= 10.5 for a, b in found)
    assert all(found[i][1] <= found[i + 1][0] + 1 for i in range(len(found) - 1))   # contiguous, no overlap


def test_mixer_places_clip_at_delay_and_flags_late():
    ring = RingBuffer(SR * 60)
    m = OutputMixer(SR, delay_s=5.0, ring=ring, bed_gain=0.0)
    ring.write(np.zeros(SR * 10, np.float32))                        # input clock at t=10 s
    clip = np.full(SR // 2, 0.5, np.float32)
    assert m.schedule(start=int(7 * SR), audio=clip, input_total=ring.total)   # input t=7 -> due at output head 7
    outs = []
    for _ in range(40):                                              # pull 4 s of output in 0.1 s blocks
        outs.append(m.pull(SR // 10, ring.total))                    # (audio callbacks: output reads, then input advances)
        ring.write(np.zeros(SR // 10, np.float32))
    y = np.concatenate(outs)[:, 0]
    first = np.argmax(np.abs(y) > 0.1)
    # head started at input_total(10) - delay(5) = 5 s; clip due at 7 s -> 2 s into the stream
    assert abs(first / SR - 2.0) < 0.01 and abs(np.count_nonzero(np.abs(y) > 0.1) / SR - 0.5) < 0.01
    late = m.schedule(start=int(3 * SR), audio=clip, input_total=ring.total)
    assert late is False                                              # head already past 3 s


def test_delay_line_releases_frames_after_delay():
    t = [0.0]
    d = DelayLine(10.0, clock=lambda: t[0])
    d.push(b"A")
    t[0] = 4.0
    d.push(b"B")
    t[0] = 9.9
    assert d.pop_due() is None
    t[0] = 10.1
    assert d.pop_due() == b"A"
    t[0] = 14.5
    assert d.pop_due() == b"B" and len(d) == 0


def _engine(delay):
    cfg = Config()
    cfg.tts.backend = "mock"
    return LiveDubber(cfg, EnergyMockASR(cfg), PassthroughTranslator(cfg), MockTTS(cfg), "en", "sv",
                      sr=SR, delay_s=delay, sync=True,
                      vad=lambda a, sr: energy_speech_spans(a, sr, min_silence_s=0.5))


def test_simulated_live_run_dubs_each_line_at_the_delayed_position(tmp_path):
    src = tmp_path / "in.wav"
    write_audio(src, timeline(14, [(1.0, 2.0), (6.0, 2.5)]), SR)
    eng = _engine(delay=8.0)
    run_files(eng, src, tmp_path / "out.wav")
    assert eng.stats.dubbed == 2 and eng.stats.late == 0 and eng.stats.errors == 0
    y, _ = read_audio(tmp_path / "out.wav", mono=True)
    env = np.sqrt(np.convolve(y ** 2, np.ones(SR // 10) / (SR // 10), mode="same"))
    active = env > 0.02
    # nothing audible before the first delayed line (original is NOT passed through: bed_gain=0)
    first = np.argmax(active) / SR
    assert 8.7 < first < 9.4                                           # original at 1.0 s -> heard at ~9.0 s
    mid = active[int(11.5 * SR):int(13.5 * SR)]
    assert mid.mean() < 0.05                                           # gap between lines stays quiet
    second = np.argmax(active[int(13.5 * SR):]) / SR + 13.5
    assert 13.7 < second < 14.4                                        # original at 6.0 s -> heard at ~14.0 s


def test_too_short_delay_is_reported_late(tmp_path):
    src = tmp_path / "in.wav"
    write_audio(src, timeline(10, [(1.0, 3.0)]), SR)
    eng = _engine(delay=0.5)                                          # shorter than the sentence itself
    msgs = []
    eng.on_text = lambda s, t: msgs.append(t)
    run_files(eng, src, tmp_path / "out.wav")
    assert eng.stats.late == 1 and any("LATE" in m for m in msgs)
