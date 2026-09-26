from __future__ import annotations

import os
from abc import ABC
from pathlib import Path

import numpy as np

from ..config import EmotionConfig
from ..types import Transcript
from ..utils.gpu import free_memory
from ..utils.log import ProgressFn, null_progress
from . import prosody


class EmotionBackend(ABC):
    """Annotates each segment with prosody features and an emotion label.

    Subclasses override `classify` to add a learned classifier; prosody and
    whisper detection always run because they are cheap and very useful.
    """

    name = "base"

    def __init__(self, cfg: EmotionConfig, device: str = "cpu", models_dir: str | os.PathLike | None = None):
        self.cfg = cfg
        self.device = device
        self.models_dir = Path(models_dir) if models_dir else None

    def classify(self, clips: list[np.ndarray], sr: int) -> list[tuple[str, dict[str, float]] | None]:
        return [None] * len(clips)

    def unload(self) -> None:
        free_memory()

    def annotate(self, transcript: Transcript, vocals16k: np.ndarray, progress: ProgressFn = null_progress) -> Transcript:
        sr = 16000
        segs = transcript.segments
        clips = [vocals16k[int(s.speech_start * sr): max(int(s.speech_start * sr) + 1, int(s.speech_end * sr))] for s in segs]
        for s, c in zip(segs, clips):
            s.prosody = prosody.analyze(c, sr)
        # speaker baseline loudness, so "loud" means loud for *this* character
        base: dict[str, list[float]] = {}
        for s in segs:
            if s.prosody["rms_db"] > -70:
                base.setdefault(s.speaker, []).append(s.prosody["rms_db"])
        spk_db = {k: float(np.median(v)) for k, v in base.items()}
        labels = self.classify(clips, sr)
        for i, (s, lab) in enumerate(zip(segs, labels)):
            heur, heur_scores = prosody.heuristic_emotion(s.prosody, spk_db.get(s.speaker), self.cfg.whisper_voiced_ratio)
            if heur == "whisper":  # classifiers don't know whispers; prosody does
                s.emotion, s.emotion_scores = "whisper", heur_scores
            elif lab is not None:
                s.emotion, s.emotion_scores = lab
            else:
                s.emotion, s.emotion_scores = heur, heur_scores
            if i % 50 == 0:
                progress(i / max(1, len(segs)), f"emotion {i}/{len(segs)}")
        progress(1.0, "emotion analysis done")
        return transcript


class ProsodyOnlyEmotion(EmotionBackend):
    name = "prosody"


class NoEmotion(EmotionBackend):
    name = "none"

    def annotate(self, transcript, vocals16k, progress=null_progress):
        for s in transcript.segments:
            s.emotion, s.emotion_scores = "neutral", {"neutral": 1.0}
            s.prosody = prosody.analyze(vocals16k[int(s.start * 16000): int(s.end * 16000)], 16000)
        return transcript
