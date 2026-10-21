"""Speaker diarization without gated models: SpeechBrain ECAPA-TDNN embeddings per line +
agglomerative clustering. Good enough to give each actor their own cloned voice."""
from __future__ import annotations

from pathlib import Path

import numpy as np

from ..audio_utils import read_audio
from ..base import Diarizer
from ..config import Config
from ..env import resolve_device
from ..types import Segment


def cluster_embeddings(emb: np.ndarray, num_speakers: int | None, threshold: float) -> np.ndarray:
    """Cosine agglomerative clustering. Returns one label per row, ordered by cluster size."""
    from sklearn.cluster import AgglomerativeClustering
    if len(emb) == 0:
        return np.zeros(0, dtype=int)
    if len(emb) == 1:
        return np.zeros(1, dtype=int)
    emb = emb / (np.linalg.norm(emb, axis=1, keepdims=True) + 1e-9)
    if num_speakers:
        model = AgglomerativeClustering(n_clusters=min(num_speakers, len(emb)), metric="cosine", linkage="average")
    else:
        model = AgglomerativeClustering(n_clusters=None, distance_threshold=threshold, metric="cosine",
                                        linkage="average")
    labels = model.fit_predict(emb)
    order = np.argsort(-np.bincount(labels))               # biggest cluster -> SPK0
    remap = {int(old): new for new, old in enumerate(order)}
    return np.array([remap[int(l)] for l in labels])


def assign_short_by_neighbour(segments: list[Segment], labelled: dict[int, int]) -> dict[int, int]:
    """Lines too short for a reliable embedding inherit the closest-in-time labelled line."""
    out = dict(labelled)
    idx = sorted(labelled)
    for i, s in enumerate(segments):
        if i in out or not idx:
            continue
        nearest = min(idx, key=lambda j: abs(segments[j].start - s.start))
        out[i] = labelled[nearest]
    return out


class EcapaDiarizer(Diarizer):
    name = "ecapa"

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.classifier = None

    def load(self) -> None:
        from ..compat import patch_speechbrain_hub
        patch_speechbrain_hub()
        from speechbrain.inference.speaker import EncoderClassifier
        self.classifier = EncoderClassifier.from_hparams(
            source="speechbrain/spkrec-ecapa-voxceleb",
            savedir=str(Path(self.cfg.models_dir) / "speechbrain" / "spkrec-ecapa-voxceleb"),
            run_opts={"device": resolve_device(self.cfg)})

    def assign(self, wav_path: Path, segments: list[Segment]) -> None:
        import torch
        d = self.cfg.diarize
        embs, idxs = [], []
        for i, s in enumerate(segments):
            if s.duration < d.min_seg_s:
                continue
            x, _ = read_audio(wav_path, sr=16000, mono=True, start=s.start, duration=min(s.duration, 8.0))
            with torch.no_grad():
                e = self.classifier.encode_batch(torch.from_numpy(x)[None]).squeeze().cpu().numpy()
            embs.append(e)
            idxs.append(i)
        if not embs:
            for s in segments:
                s.speaker = "SPK0"
            return
        labels = cluster_embeddings(np.stack(embs), d.num_speakers, d.threshold)
        labelled = assign_short_by_neighbour(segments, {i: int(l) for i, l in zip(idxs, labels)})
        for i, s in enumerate(segments):
            s.speaker = f"SPK{labelled.get(i, 0)}"
