"""Voice-reference selection for zero-shot cloning.

Cloning quality depends mostly on the reference clip: it should be the actor's own voice,
free of music/other speakers, and ideally in the same emotional register as the line being
dubbed (zero-shot TTS copies the reference's prosody, so a shouted reference gives shouted
speech). We build, per speaker, a bank of clean candidate clips from the *separated vocals*.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .audio_utils import active_rms_db, read_audio, write_audio
from .types import Segment

SR_REF = 24000


@dataclass
class Clip:
    seg_id: int
    start: float
    end: float
    emotion: str
    score: float

    @property
    def duration(self) -> float:
        return self.end - self.start


def _overlaps_other(seg: Segment, others: list[Segment]) -> bool:
    return any(o.id != seg.id and o.start < seg.end and o.end > seg.start for o in others)


def score_clip(seg: Segment, acc_to_voice_db: float) -> float:
    """Longer is better up to ~10 s; penalise music bleed (accompaniment loud vs voice)."""
    dur = min(seg.duration, 10.0)
    bleed_pen = max(0.0, acc_to_voice_db + 10.0) * 0.15   # accompaniment within 10 dB of voice
    return dur - bleed_pen


def build_bank(segments: list[Segment], vocals_path: Path, accomp_path: Path,
               min_s: float = 1.5) -> dict[str, list[Clip]]:
    bank: dict[str, list[Clip]] = {}
    for seg in segments:
        if seg.skip or seg.duration < min_s or _overlaps_other(seg, segments):
            continue
        v, sr = read_audio(vocals_path, mono=True, start=seg.start, duration=seg.duration)
        a, _ = read_audio(accomp_path, mono=True, start=seg.start, duration=seg.duration)
        if len(v) < sr:
            continue
        if float(np.max(np.abs(v))) >= 0.999:      # clipped
            continue
        rel = active_rms_db(a, sr) - active_rms_db(v, sr)
        bank.setdefault(seg.speaker, []).append(Clip(seg.id, seg.start, seg.end, seg.emotion,
                                                     score_clip(seg, rel)))
    for clips in bank.values():
        clips.sort(key=lambda c: c.score, reverse=True)
    return bank


def pick_clips(clips: list[Clip], emotion: str | None, max_s: float) -> list[Clip]:
    """Best clips of the wanted emotion first, then the rest, until max_s of audio is reached."""
    ordered = ([c for c in clips if c.emotion == emotion] if emotion else []) + \
              [c for c in clips if not emotion or c.emotion != emotion]
    chosen, total = [], 0.0
    for c in ordered:
        if total >= max_s:
            break
        chosen.append(c)
        total += c.duration
    return chosen


class ReferenceProvider:
    """Writes reference wavs on demand and caches them."""

    def __init__(self, segments: list[Segment], vocals_path: Path, accomp_path: Path, out_dir: Path,
                 mode: str = "auto", min_own_s: float = 3.0, max_s: float = 12.0, embed=None, sim_min: float = 0.35):
        self.embed, self.sim_min = embed, sim_min               # embed: mono 16 kHz audio -> voice embedding (or None)
        self._emb: dict[int, np.ndarray] = {}
        self.segments = {s.id: s for s in segments}
        self.vocals = vocals_path
        self.out_dir = out_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        self.mode, self.min_own_s, self.max_s = mode, min_own_s, max_s
        self.bank = build_bank(segments, vocals_path, accomp_path)
        self._cache: dict[tuple, Path] = {}

    def _render(self, key: tuple, name: str, clips: list[Clip]) -> Path:
        if key in self._cache:
            return self._cache[key]
        parts, gap = [], np.zeros(int(0.15 * SR_REF), dtype=np.float32)
        total = 0.0
        for c in clips:
            x, _ = read_audio(self.vocals, sr=SR_REF, mono=True, start=c.start, duration=min(c.duration, self.max_s - total))
            parts += [x, gap]
            total += len(x) / SR_REF
            if total >= self.max_s:
                break
        path = self.out_dir / f"{name}.wav"
        write_audio(path, np.concatenate(parts), SR_REF)
        self._cache[key] = path
        return path

    def own(self, seg: Segment) -> Path:
        key = ("own", seg.id)
        if key in self._cache:
            return self._cache[key]
        x, _ = read_audio(self.vocals, sr=SR_REF, mono=True, start=seg.start, duration=min(seg.duration, self.max_s))
        path = self.out_dir / f"own_{seg.id:05d}.wav"
        write_audio(path, x, SR_REF)
        self._cache[key] = path
        return path

    def speaker(self, speaker: str, emotion: str | None) -> Path | None:
        clips = self.bank.get(speaker)
        if not clips:
            return None
        return self._render(("spk", speaker, emotion), f"{speaker}_{emotion or 'any'}",
                            pick_clips(clips, emotion, self.max_s))

    def _embedding(self, seg_id: int) -> np.ndarray | None:
        if seg_id not in self._emb:
            s = self.segments[seg_id]
            x, _ = read_audio(self.vocals, sr=16000, mono=True, start=s.start, duration=min(s.duration, 8.0))
            if len(x) < 0.6 * 16000:
                return None
            v = np.asarray(self.embed(x), dtype=np.float64).ravel()
            self._emb[seg_id] = v / (np.linalg.norm(v) + 1e-9)
        return self._emb[seg_id]

    def similar(self, seg: Segment) -> Path | None:
        """Reference for a SHORT line: its own audio first (anchors the identity), then the clean clips that
        ACOUSTICALLY match it - regardless of which speaker label they carry. A wrong speaker label therefore
        cannot pull in someone else's voice."""
        if self.embed is None or seg.duration < 0.8:
            return None
        key = ("sim", seg.id)
        if key in self._cache:
            return self._cache[key]
        e = self._embedding(seg.id)
        if e is None:
            return None
        scored = []
        for clips in self.bank.values():
            for c in clips:
                if c.seg_id == seg.id:
                    continue
                ce = self._embedding(c.seg_id)
                if ce is not None and float(e @ ce) >= self.sim_min:
                    scored.append((float(e @ ce), c))
        scored.sort(key=lambda t: -t[0])
        own = Clip(seg.id, seg.start, seg.end, seg.emotion, 0.0)
        return self._render(key, f"sim_{seg.id:05d}", [own] + [c for _, c in scored])

    def longest(self, speaker: str) -> Path | None:
        """Last resort for a speaker with no clean clips: their longest line, quality filters ignored."""
        cands = [s for s in self.segments.values() if s.speaker == speaker and not s.skip and s.duration >= 0.8]
        return self.own(max(cands, key=lambda s: s.duration)) if cands else None

    def for_segment(self, seg: Segment) -> Path | None:
        """Reference for one line. Chain: the line's own audio (best prosody match) -> the speaker's
        best emotion-matched clean clips -> their longest line -> the line itself -> None.
        Short interjections ("No!", "Yes.") are common in films. With a voice-embedding model available they get
        their own audio plus the acoustically closest clips (robust to speaker-label mistakes)."""
        use_own = self.mode == "segment" or (self.mode == "auto" and seg.duration >= self.min_own_s)
        if use_own and seg.duration >= 1.0:
            return self.own(seg)
        ref = self.similar(seg) or self.speaker(seg.speaker, seg.emotion) or self.longest(seg.speaker)
        if ref is not None:
            return ref
        return self.own(seg) if seg.duration >= 0.6 else None
