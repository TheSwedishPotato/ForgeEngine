"""Coqui XTTS-v2 via the maintained `coqui-tts` fork. 17 languages - NO Swedish.

License: Coqui Public Model License (non-commercial). Install it in its own env if its
dependency pins clash with Chatterbox's (see README).
"""
from __future__ import annotations

import os

import numpy as np

from ..base import Style, TTS
from ..config import Config
from ..env import resolve_device
from ..languages import XTTS_LANGS
from .common import concat_chunks, normalize_text, split_text


class XTTSTTS(TTS):
    name = "xtts"

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.model = None
        self.sample_rate = 24000

    def supports(self, lang: str) -> bool:
        return lang in XTTS_LANGS

    def load(self) -> None:
        if os.environ.get("COQUI_TOS_AGREED") != "1":
            raise RuntimeError("XTTS-v2 is released under the Coqui Public Model License (non-commercial). "
                               "If you accept it, set the environment variable COQUI_TOS_AGREED=1.")
        from TTS.api import TTS as CoquiTTS
        self.model = CoquiTTS(self.cfg.tts.xtts_model).to(resolve_device(self.cfg))
        self.sample_rate = int(self.model.synthesizer.output_sample_rate)

    def synthesize(self, text: str, lang: str, reference_wav, style: Style) -> np.ndarray:
        import torch
        c = self.cfg.tts
        if style.seed is not None:
            torch.manual_seed(style.seed)
        code = "zh-cn" if lang == "zh" else lang
        chunks = []
        for piece in split_text(normalize_text(text), min(c.max_chars, 220)):
            wav = self.model.tts(text=piece, speaker_wav=str(reference_wav), language=code,
                                 split_sentences=False, temperature=c.temperature)
            chunks.append(np.asarray(wav, dtype=np.float32))
        return concat_chunks(chunks, self.sample_rate)
