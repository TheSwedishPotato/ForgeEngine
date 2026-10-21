"""Emotion per line (neutral / happy / angry / sad) from the *original voice*, using a wav2vec2
classifier trained on IEMOCAP (SUPERB, Apache-2.0). Plain `transformers` - no extra framework.
Drives (a) which reference clip is used and (b) how expressive the cloned line is."""
from __future__ import annotations

from pathlib import Path

from ..audio_utils import read_audio
from ..base import EmotionClassifier, Progress, _noop
from ..config import Config
from ..env import resolve_device
from ..types import Segment

_MAP = {"neu": "neutral", "hap": "happy", "ang": "angry", "sad": "sad"}


class Wav2Vec2Emotion(EmotionClassifier):
    name = "wav2vec2"

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.model = None
        self.fe = None

    def load(self) -> None:
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification
        self.device = resolve_device(self.cfg)
        self.fe = AutoFeatureExtractor.from_pretrained(self.cfg.emotion.model)
        self.model = AutoModelForAudioClassification.from_pretrained(self.cfg.emotion.model).to(self.device).eval()

    def classify(self, wav_path: Path, segments: list[Segment], progress: Progress = _noop) -> None:
        import torch
        for i, s in enumerate(segments):
            if s.skip or s.duration < 0.6:
                continue
            x, _ = read_audio(wav_path, sr=16000, mono=True, start=s.start, duration=min(s.duration, 10.0))
            inputs = self.fe(x, sampling_rate=16000, return_tensors="pt").to(self.device)
            with torch.no_grad():
                probs = torch.softmax(self.model(**inputs).logits[0], dim=-1)
            idx = int(probs.argmax())
            label = str(self.model.config.id2label[idx]).lower()
            s.emotion = _MAP.get(label[:3], "neutral")
            s.emotion_score = float(probs[idx])
            progress((i + 1) / len(segments), "classifying emotion")
