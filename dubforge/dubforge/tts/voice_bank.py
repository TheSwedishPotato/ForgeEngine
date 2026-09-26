"""Builds each character's voice reference set from the separated dialogue track.

Good zero-shot cloning lives or dies by its reference audio. We pick, per
speaker, the cleanest lines: long enough (3-12 s), not overlapping anyone
else, high dialogue-to-background ratio, confident ASR, and a spread of
emotions so emotion-matched prosody has something to choose from.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import TTSConfig
from ..media import audio as au
from ..types import Segment, Transcript
from ..utils.log import get_logger

log = get_logger("voices")

REF_SR = 24000


@dataclass
class RefClip:
    path: str
    speaker: str
    start: float
    end: float
    text: str
    lang: str
    emotion: str | None = None
    score: float = 0.0

    @property
    def duration(self) -> float:
        return self.end - self.start


def _overlaps_other(seg: Segment, others: list[Segment]) -> bool:
    return any(o.speaker != seg.speaker and o.start < seg.end and o.end > seg.start for o in others)


def _read(sf_file: sf.SoundFile, start: float, end: float) -> np.ndarray:
    sr = sf_file.samplerate
    sf_file.seek(max(0, int(start * sr)))
    return sf_file.read(max(0, int((end - start) * sr)), dtype="float32", always_2d=True)


class VoiceBank:
    def __init__(self, root: str | os.PathLike):
        self.root = Path(root)
        self.clips: dict[str, list[RefClip]] = {}

    @property
    def manifest(self) -> Path:
        return self.root / "voices.json"

    def build(self, transcript: Transcript, vocals_path: str | os.PathLike,
              background_path: str | os.PathLike | None, cfg: TTSConfig) -> dict[str, list[RefClip]]:
        self.root.mkdir(parents=True, exist_ok=True)
        segs = transcript.segments
        self.clips = {}
        vf = sf.SoundFile(str(vocals_path))
        bf = sf.SoundFile(str(background_path)) if background_path and Path(background_path).exists() else None
        try:
            for speaker, own in transcript.by_speaker().items():
                scored: list[tuple[float, Segment]] = []
                for s in own:
                    a, b = s.speech_start - 0.05, s.speech_end + 0.08
                    d = b - a
                    if d < cfg.ref_min_seconds or d > cfg.ref_max_seconds or _overlaps_other(s, segs):
                        continue
                    v = au.to_mono(_read(vf, a, b))
                    snr = au.gain_to_db(au.active_rms(v, vf.samplerate))
                    if bf is not None:
                        snr -= au.gain_to_db(au.rms(au.to_mono(_read(bf, a, b))))
                    conf = s.avg_logprob if s.avg_logprob is not None else -0.3
                    score = min(snr, 30.0) / 10.0 + conf * 2.0 - abs(d - 8.0) * 0.08
                    if s.emotion == "whisper":
                        score -= 1.0  # whispers make poor *timbre* references
                    scored.append((score, s))
                scored.sort(key=lambda x: -x[0])
                chosen = self._pick_diverse(scored, cfg)
                if not chosen:
                    chosen = self._fallback(own, cfg)
                clips = []
                for k, (score, s) in enumerate(chosen):
                    a, b = s.speech_start - 0.05, s.speech_end + 0.08
                    wav = au.resample(au.to_mono(_read(vf, a, b)), vf.samplerate, REF_SR)
                    wav = au.fade(wav, REF_SR, 15, 30)
                    path = self.root / speaker / f"ref_{k:02d}.wav"
                    au.save(path, wav, REF_SR)
                    clips.append(RefClip(str(path), speaker, a, b, s.text, transcript.language, s.emotion, round(score, 3)))
                if clips:
                    self.clips[speaker] = clips
                    log.info("voice %s: %d reference clips (%.1fs)", speaker, len(clips), sum(c.duration for c in clips))
                else:
                    log.warning("voice %s: no usable reference audio", speaker)
        finally:
            vf.close()
            if bf is not None:
                bf.close()
        self.save()
        return self.clips

    def _pick_diverse(self, scored: list[tuple[float, Segment]], cfg: TTSConfig) -> list[tuple[float, Segment]]:
        chosen: list[tuple[float, Segment]] = []
        total = 0.0
        seen_emotions: set[str] = set()
        # pass 1: best clip of each emotion; pass 2: fill with the best remaining
        for want_new_emotion in (True, False):
            for score, s in scored:
                if len(chosen) >= cfg.max_ref_clips or total >= cfg.max_ref_total_seconds:
                    break
                if any(c is s for _, c in chosen):
                    continue
                if want_new_emotion and (s.emotion or "neutral") in seen_emotions:
                    continue
                chosen.append((score, s))
                total += s.speech_duration
                seen_emotions.add(s.emotion or "neutral")
        chosen.sort(key=lambda x: -x[0])
        return chosen

    def _fallback(self, own: list[Segment], cfg: TTSConfig) -> list[tuple[float, Segment]]:
        """Speaker only has short lines: take the longest few anyway."""
        longest = sorted(own, key=lambda s: -s.speech_duration)[: cfg.max_ref_clips]
        return [(-10.0, s) for s in longest if s.speech_duration >= 1.0]

    def save(self) -> None:
        data = {k: [asdict(c) for c in v] for k, v in self.clips.items()}
        self.manifest.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

    def load(self) -> dict[str, list[RefClip]]:
        data = json.loads(self.manifest.read_text(encoding="utf-8"))
        self.clips = {k: [RefClip(**c) for c in v] for k, v in data.items()}
        return self.clips

    def refs_for(self, speaker: str, emotion: str | None = None, fallback_speakers: list[str] | None = None) -> list[RefClip]:
        clips = self.clips.get(speaker)
        if not clips:
            for other in fallback_speakers or []:
                if self.clips.get(other):
                    clips = self.clips[other]
                    break
        if not clips:
            return []
        if emotion:
            matched = [c for c in clips if c.emotion == emotion]
            if matched:
                return matched + [c for c in clips if c.emotion != emotion]
        return list(clips)
