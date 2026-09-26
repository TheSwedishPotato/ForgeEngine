"""Translator interface + length-aware candidate selection (isochrony).

Dubbing is not subtitling: a German line that takes 40% longer to say than the
English one breaks the sync. Every backend returns several candidate
translations; we keep them all in the editable JSON and choose the one whose
estimated spoken length best fits the original line (trading off model rank).
The TTS stage may later fall back to a shorter candidate if a line still doesn't fit.
"""

from __future__ import annotations

import os
import re
from abc import ABC, abstractmethod
from pathlib import Path

import numpy as np

from ..config import TranslationConfig
from ..types import Segment, Transcript
from ..utils.gpu import free_memory
from ..utils.log import ProgressFn, get_logger, null_progress
from . import languages as L

log = get_logger("translate")


def dedupe(cands: list[str]) -> list[str]:
    seen, out = set(), []
    for c in cands:
        c = " ".join(c.split())
        key = re.sub(r"\W+", "", c.lower())
        if c and key not in seen:
            seen.add(key)
            out.append(c)
    return out


def length_score(text: str, rank: int, slot: float, lang: str, rank_penalty: float,
                 calibrator: L.RateCalibrator | None = None) -> float:
    est = calibrator.estimate(text, lang) if calibrator else L.estimate_seconds(text, lang)
    ratio = est / max(slot, 0.25)
    over = max(0.0, ratio - 1.0)
    under = max(0.0, 0.65 - ratio)
    return rank * rank_penalty + 2.0 * over + 0.6 * under


def choose_candidate(cands: list[str], slot: float, lang: str, rank_penalty: float,
                     calibrator: L.RateCalibrator | None = None) -> int:
    scores = [length_score(c, i, slot, lang, rank_penalty, calibrator) for i, c in enumerate(cands)]
    return int(np.argmin(scores)) if scores else 0


class Translator(ABC):
    name = "base"

    def __init__(self, cfg: TranslationConfig, device: str = "cpu", models_dir: str | os.PathLike | None = None):
        self.cfg = cfg
        self.device = device
        self.models_dir = Path(models_dir) if models_dir else None
        self._post = [(re.compile(k), v) for k, v in cfg.post_replace.items()]

    @abstractmethod
    def translate_texts(self, texts: list[str], src: str, tgt: str, n: int,
                        segments: list[Segment] | None = None, audio16k: np.ndarray | None = None,
                        progress: ProgressFn = null_progress) -> list[list[str]]:
        """Return up to n candidates per input text, best first."""

    def unload(self) -> None:
        free_memory()

    def post(self, text: str) -> str:
        for pat, rep in self._post:
            text = pat.sub(rep, text)
        return text.strip()

    def translate(self, transcript: Transcript, src: str, tgt: str, audio16k: np.ndarray | None = None,
                  progress: ProgressFn = null_progress) -> Transcript:
        todo = [s for s in transcript.segments if not s.translation_locked]
        if not todo:
            return transcript
        n = max(1, self.cfg.num_candidates)
        results = self.translate_texts([s.text for s in todo], src, tgt, n, segments=todo, audio16k=audio16k,
                                       progress=progress)
        for seg, cands in zip(todo, results):
            cands = dedupe([self.post(c) for c in cands]) or [seg.text]
            seg.translation_candidates = cands
            idx = choose_candidate(cands, seg.speech_duration or seg.duration, tgt,
                                   self.cfg.max_length_ratio_penalty) if self.cfg.length_aware else 0
            seg.translation = cands[idx]
        transcript.target_language = tgt
        return transcript

    def translate_one(self, text: str, src: str, tgt: str, slot: float | None = None) -> str:
        cands = dedupe([self.post(c) for c in self.translate_texts([text], src, tgt, self.cfg.num_candidates if slot else 1)[0]])
        if not cands:
            return text
        if slot and self.cfg.length_aware:
            return cands[choose_candidate(cands, slot, tgt, self.cfg.max_length_ratio_penalty)]
        return cands[0]


class MockTranslator(Translator):
    """Test backend: tags lines and produces a long and a short variant."""

    name = "mock"

    def translate_texts(self, texts, src, tgt, n, segments=None, audio16k=None, progress=null_progress):
        out = []
        for t in texts:
            words = t.split()
            long = f"[{tgt}] " + " ".join(words + words[: max(1, len(words) // 3)])
            short = f"[{tgt}] " + " ".join(words[: max(1, (2 * len(words)) // 3)])
            out.append([long, f"[{tgt}] {t}", short][:n])
        progress(1.0, "mock translation done")
        return out
