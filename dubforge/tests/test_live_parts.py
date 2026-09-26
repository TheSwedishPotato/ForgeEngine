import numpy as np

from dubforge.asr.speakers import OnlineSpeakerTracker, cluster_embeddings
from dubforge.live.rings import FifoRing, TimelineRing
from dubforge.live.vad import StreamingSegmenter


def test_fifo_ring():
    r = FifoRing(2, 100)
    r.write(np.ones((30, 2), np.float32))
    out = r.read(40)
    assert out[:30].sum() == 60 and out[30:].sum() == 0
    r.write(np.ones((150, 2), np.float32))  # overflow drops the oldest
    assert r.available() <= 150


def test_timeline_ring_wraps():
    r = TimelineRing(1, 10)
    r.write(8, np.arange(4, dtype=np.float32)[:, None])
    assert r.read(8, 4)[:, 0].tolist() == [0, 1, 2, 3]
    r.write(8, np.ones((4, 1), np.float32), add=True)
    assert r.read(8, 4)[:, 0].tolist() == [1, 2, 3, 4]


def test_streaming_segmenter_finds_bursts():
    sr = 48000
    t = np.arange(int(0.8 * sr)) / sr
    burst = (0.3 * np.sin(2 * np.pi * 200 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t))).astype(np.float32)
    silence = np.zeros(int(0.8 * sr), np.float32)
    sig = np.concatenate([silence, burst, silence, burst, silence])
    sig = np.stack([sig, sig], 1) + 1e-4 * np.random.default_rng(0).standard_normal((len(sig), 2)).astype(np.float32)
    seg = StreamingSegmenter(sr, threshold=0.5, min_silence_ms=300, min_utterance_s=0.3, use_silero=False)
    utts = []
    block = 960
    for i in range(0, len(sig), block):
        utts += seg.feed(sig[i:i + block], i)
    assert len(utts) == 2
    for u, expected_start in zip(utts, (0.8, 2.4)):
        assert abs(u.start_idx / sr - expected_start) < 0.35
        assert 0.6 < u.duration < 1.4


def test_clustering_and_tracking():
    rng = np.random.default_rng(1)
    a, b = rng.standard_normal(16), rng.standard_normal(16)
    embs = np.stack([a + 0.05 * rng.standard_normal(16) for _ in range(4)] + [b + 0.05 * rng.standard_normal(16) for _ in range(3)])
    embs /= np.linalg.norm(embs, axis=1, keepdims=True)
    labels = cluster_embeddings(embs, similarity=0.8)
    assert len(set(labels[:4])) == 1 and len(set(labels[4:])) == 1 and labels[0] != labels[4]
    tr = OnlineSpeakerTracker(similarity=0.8)
    ids = [tr.assign(e) for e in embs]
    assert ids[:4] == ["SPEAKER_00"] * 4 and ids[4:] == ["SPEAKER_01"] * 3
