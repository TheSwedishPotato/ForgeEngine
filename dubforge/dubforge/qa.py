"""Voice-identity checks: is each dubbed line in the voice of the person who actually spoke it?

Two failure modes matter to a viewer:
  1. diarization put a line under the wrong speaker  -> the clone uses someone else's reference
  2. the clone drifted toward another character       -> sounds like a different person

Both are caught the same way: build a voice print per speaker from their ORIGINAL lines, then compare
every dubbed line with every speaker's print. Pure functions on top of an `embed` callable, so the
logic is testable without a model.
"""
from __future__ import annotations

from typing import Callable

import numpy as np

from .types import Segment

Embed = Callable[[np.ndarray], np.ndarray]     # mono 16 kHz audio -> embedding vector


def _unit(v: np.ndarray) -> np.ndarray:
    v = np.asarray(v, dtype=np.float64).ravel()
    return v / (np.linalg.norm(v) + 1e-9)


def voice_prints(segments: list[Segment], embed: Embed, read_original: Callable[[Segment], np.ndarray],
                 min_s: float = 1.5, max_lines: int = 8) -> dict[str, np.ndarray]:
    """Mean unit embedding of each speaker's longer, non-skipped original lines."""
    prints: dict[str, np.ndarray] = {}
    for spk in sorted({s.speaker for s in segments}):
        lines = sorted((s for s in segments if s.speaker == spk and not s.skip and s.duration >= min_s),
                       key=lambda s: -s.duration)[:max_lines]
        if lines:
            prints[spk] = _unit(np.mean([_unit(embed(read_original(s))) for s in lines], axis=0))
    return prints


def similar_speaker_pairs(prints: dict[str, np.ndarray], thresh: float = 0.70) -> list[dict]:
    """Two 'speakers' whose prints are nearly identical are probably one person split in two."""
    names = sorted(prints)
    out = []
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            sim = float(prints[a] @ prints[b])
            if sim >= thresh:
                out.append({"a": a, "b": b, "similarity": round(sim, 3)})
    return out


def check_dubbed_lines(segments: list[Segment], prints: dict[str, np.ndarray], embed: Embed,
                       read_dub: Callable[[Segment], np.ndarray], min_margin: float = 0.05,
                       min_sim: float = 0.20) -> dict[int, dict]:
    """Per dubbed line: similarity to the assigned speaker, the best competing speaker, and a verdict.

    wrong_voice : another speaker's print is clearly closer (by `min_margin`) than the assigned one
    weak_voice  : no speaker is close (< min_sim) - the clone is generic / unstable
    """
    res: dict[int, dict] = {}
    for s in segments:
        if not s.tts_path or s.skip or s.speaker not in prints:
            continue
        e = _unit(embed(read_dub(s)))
        sims = {spk: float(e @ p) for spk, p in prints.items()}
        own = sims[s.speaker]
        rival, rival_sim = max(((k, v) for k, v in sims.items() if k != s.speaker), key=lambda kv: kv[1],
                               default=(None, -1.0))
        verdict = "ok"
        if rival is not None and rival_sim > own + min_margin:
            verdict = "wrong_voice"
        elif own < min_sim:
            verdict = "weak_voice"
        res[s.id] = {"speaker": s.speaker, "sim_assigned": round(own, 3),
                     "best_other": rival, "sim_other": round(rival_sim, 3) if rival else None, "verdict": verdict}
    return res


def refine_labels(emb: np.ndarray, labels: np.ndarray, iters: int = 2) -> np.ndarray:
    """k-means-style cleanup after agglomerative clustering: move each item to the nearest cluster
    centroid (cosine). Fixes lines clustered early on thin evidence. Clusters never vanish."""
    labels = labels.copy()
    if len(set(labels.tolist())) < 2:
        return labels
    X = np.stack([_unit(e) for e in emb])
    for _ in range(iters):
        ids = sorted(set(labels.tolist()))
        cents = np.stack([_unit(X[labels == k].mean(axis=0)) for k in ids])
        new = np.array([ids[int(np.argmax(cents @ x))] for x in X])
        for k in ids:                                     # never empty a cluster
            if not (new == k).any():
                new[np.argmax(X @ cents[ids.index(k)])] = k
        if (new == labels).all():
            break
        labels = new
    return labels


def speaker_overview(segments: list[Segment], per_speaker: int = 3) -> str:
    """Plain-text 'who is who' sheet so a human can verify the speaker labels in 30 seconds."""
    lines = []
    for spk in sorted({s.speaker for s in segments}):
        mine = [s for s in segments if s.speaker == spk]
        total = sum(s.duration for s in mine)
        lines.append(f"{spk}: {len(mine)} lines, {total:.0f}s of speech")
        for s in sorted(mine, key=lambda s: -s.duration)[:per_speaker]:
            t = int(s.start)
            lines.append(f"    {t // 60:02d}:{t % 60:02d}  \"{s.text[:70]}\"")
    return "\n".join(lines)
