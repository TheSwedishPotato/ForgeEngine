"""TTS helpers shared by all engines: text prep, chunking, emotion->style, sanity checks."""
from __future__ import annotations

import re

import numpy as np

from ..base import Style
from ..config import TTSCfg
from ..types import Segment

# Base expressiveness per detected emotion (Chatterbox "exaggeration"; 0.5 = neutral).
EMOTION_EXAGGERATION = {"neutral": 0.5, "happy": 0.7, "angry": 0.9, "sad": 0.4}

_BRACKETS = re.compile(r"[\[\(][^\])]*[\]\)]")
_WS = re.compile(r"\s+")


def normalize_text(text: str) -> str:
    t = _BRACKETS.sub(" ", text)                    # [laughs], (sighs) stage directions
    t = t.replace("♪", " ").replace("…", "...")
    t = _WS.sub(" ", t).strip()
    return t


def split_text(text: str, max_chars: int) -> list[str]:
    """Split at sentence ends, then at commas, then at spaces so no chunk exceeds max_chars."""
    if len(text) <= max_chars:
        return [text]
    parts = re.split(r"(?<=[.!?…])\s+", text)
    out: list[str] = []
    for p in parts:
        if len(p) <= max_chars:
            out.append(p)
            continue
        sub = re.split(r"(?<=[,;:])\s+", p)
        cur = ""
        for s in sub:
            while len(s) > max_chars:
                cut = s.rfind(" ", 0, max_chars)
                cut = cut if cut > 0 else max_chars
                if cur:
                    out.append(cur)
                    cur = ""
                out.append(s[:cut].strip())
                s = s[cut:].strip()
            if len(cur) + len(s) + 1 <= max_chars:
                cur = (cur + " " + s).strip()
            else:
                out.append(cur)
                cur = s
        if cur:
            out.append(cur)
    return [o for o in out if o]


def style_for(seg: Segment, speaker_median_db: float | None, cfg: TTSCfg) -> Style:
    """Emotion label sets the base; how much louder/quieter than the speaker's norm nudges it."""
    base = EMOTION_EXAGGERATION.get(seg.emotion, 0.5) - 0.5 + cfg.base_exaggeration
    arousal = 0.0
    if seg.energy_db is not None and speaker_median_db is not None:
        arousal = float(np.clip((seg.energy_db - speaker_median_db) / 9.0, -1.0, 1.0))
    ex = float(np.clip(base + 0.2 * arousal, 0.25, 1.4))
    return Style(emotion=seg.emotion, exaggeration=ex, arousal=arousal)


def expected_duration(text: str, lang: str) -> float:
    cps = {"ja": 8, "zh": 5, "ko": 9}.get(lang, 14)
    return max(0.4, len(text) / cps)


def looks_broken(wav: np.ndarray, sr: int, text: str, lang: str) -> bool:
    """Generative TTS occasionally babbles, loops or returns silence. Catch the obvious cases."""
    if len(wav) < 0.15 * sr or not np.isfinite(wav).all():
        return True
    if float(np.max(np.abs(wav))) < 1e-3:
        return True
    dur = len(wav) / sr
    exp = expected_duration(text, lang)
    return dur > max(3.0 * exp, exp + 5.0)


def concat_chunks(chunks: list[np.ndarray], sr: int, gap_s: float = 0.18) -> np.ndarray:
    if len(chunks) == 1:
        return chunks[0]
    gap = np.zeros(int(gap_s * sr), dtype=np.float32)
    out = []
    for c in chunks:
        out += [c, gap]
    return np.concatenate(out[:-1])
