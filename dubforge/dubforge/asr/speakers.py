"""Speaker embeddings (SpeechBrain ECAPA) for diarization without gated models,
and online speaker tracking for live mode."""

from __future__ import annotations

import os
from pathlib import Path

import numpy as np

from ..types import Segment
from ..utils.gpu import free_memory
from ..utils.log import get_logger

log = get_logger("speakers")

ECAPA_SOURCE = "speechbrain/spkrec-ecapa-voxceleb"


class SpeakerEmbedder:
    def __init__(self, device: str = "cpu", models_dir: str | os.PathLike | None = None):
        self.device = device
        self.savedir = Path(models_dir or "models") / "speechbrain" / "spkrec-ecapa-voxceleb"
        self.model = None

    def load(self) -> None:
        if self.model is not None:
            return
        try:
            from speechbrain.inference.speaker import EncoderClassifier
        except ImportError:  # speechbrain < 1.0
            from speechbrain.pretrained import EncoderClassifier  # type: ignore
        self.model = EncoderClassifier.from_hparams(source=ECAPA_SOURCE, savedir=str(self.savedir),
                                                    run_opts={"device": self.device})

    def unload(self) -> None:
        self.model = None
        free_memory()

    def embed(self, wav16k: np.ndarray) -> np.ndarray:
        import torch

        self.load()
        assert self.model is not None
        x = torch.from_numpy(np.ascontiguousarray(wav16k, dtype=np.float32))[None]
        with torch.inference_mode():
            e = self.model.encode_batch(x.to(self.device)).squeeze().float().cpu().numpy()
        return e / (np.linalg.norm(e) + 1e-9)


def cluster_embeddings(emb: np.ndarray, similarity: float, max_speakers: int | None = None,
                       min_speakers: int | None = None) -> np.ndarray:
    """Agglomerative clustering on cosine distance. Returns 0-based labels."""
    from scipy.cluster.hierarchy import fcluster, linkage

    if len(emb) == 1:
        return np.zeros(1, dtype=int)
    z = linkage(emb, method="average", metric="cosine")
    labels = fcluster(z, t=1.0 - similarity, criterion="distance")
    n = len(set(labels))
    if max_speakers and n > max_speakers:
        labels = fcluster(z, t=max_speakers, criterion="maxclust")
    elif min_speakers and n < min_speakers:
        labels = fcluster(z, t=min(min_speakers, len(emb)), criterion="maxclust")
    return labels - 1


def assign_speakers_ecapa(segments: list[Segment], vocals16k: np.ndarray, embedder: SpeakerEmbedder,
                          similarity: float = 0.62, max_speakers: int | None = None,
                          min_speakers: int | None = None, min_seconds: float = 0.9) -> None:
    """Label segments SPEAKER_00.. by clustering per-segment voice embeddings."""
    sr = 16000
    idx, embs = [], []
    for i, s in enumerate(segments):
        a, b = s.speech_start, s.speech_end
        if b - a < min_seconds:
            continue
        clip = vocals16k[int(a * sr): int(min(b, a + 12.0) * sr)]
        if len(clip) < sr * 0.5:
            continue
        idx.append(i)
        embs.append(embedder.embed(clip))
    if not embs:
        for s in segments:
            s.speaker = "SPEAKER_00"
        return
    emb = np.stack(embs)
    labels = cluster_embeddings(emb, similarity, max_speakers, min_speakers)
    centroids = {}
    for lab in set(labels):
        c = emb[labels == lab].mean(axis=0)
        centroids[lab] = c / (np.linalg.norm(c) + 1e-9)
    # order speakers by total speaking time so SPEAKER_00 is the lead
    talk: dict[int, float] = {}
    for i, lab in zip(idx, labels):
        talk[lab] = talk.get(lab, 0.0) + segments[i].duration
    order = {lab: n for n, lab in enumerate(sorted(talk, key=lambda k: -talk[k]))}
    labelled = dict(zip(idx, labels))
    for i, s in enumerate(segments):
        if i in labelled:
            s.speaker = f"SPEAKER_{order[labelled[i]]:02d}"
            continue
        # short lines: try a (noisier) embedding, else inherit from the nearest labelled neighbour
        clip = vocals16k[int(s.start * sr): int(s.end * sr)]
        if len(clip) >= sr * 0.4:
            e = embedder.embed(clip)
            lab = max(centroids, key=lambda k: float(np.dot(e, centroids[k])))
            s.speaker = f"SPEAKER_{order[lab]:02d}"
        else:
            nearest = min(idx, key=lambda j: abs(segments[j].start - s.start))
            s.speaker = f"SPEAKER_{order[labelled[nearest]]:02d}"


class OnlineSpeakerTracker:
    """Live mode: assign each utterance to a known voice or open a new one."""

    def __init__(self, similarity: float = 0.6, max_speakers: int = 12, momentum: float = 0.9):
        self.similarity = similarity
        self.max_speakers = max_speakers
        self.momentum = momentum
        self.centroids: list[np.ndarray] = []

    def assign(self, emb: np.ndarray) -> str:
        if self.centroids:
            sims = [float(np.dot(emb, c)) for c in self.centroids]
            best = int(np.argmax(sims))
            if sims[best] >= self.similarity or len(self.centroids) >= self.max_speakers:
                c = self.momentum * self.centroids[best] + (1 - self.momentum) * emb
                self.centroids[best] = c / (np.linalg.norm(c) + 1e-9)
                return f"SPEAKER_{best:02d}"
        self.centroids.append(emb)
        return f"SPEAKER_{len(self.centroids) - 1:02d}"
