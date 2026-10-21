"""Chatterbox Multilingual (Resemble AI, MIT): zero-shot voice cloning in 23 languages incl. Swedish.

The reference clip carries voice AND delivery; `exaggeration` scales emotional intensity.
Note: Chatterbox embeds an inaudible Perth watermark in its output (provenance marker).
"""
from __future__ import annotations

import numpy as np

from ..base import Style, TTS
from ..config import Config
from ..env import resolve_device
from ..languages import CHATTERBOX_LANGS
from .common import concat_chunks, normalize_text, split_text


class ChatterboxTTS(TTS):
    name = "chatterbox"

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.model = None
        self.sample_rate = 24000

    def supports(self, lang: str) -> bool:
        return lang in CHATTERBOX_LANGS

    def load(self) -> None:
        from chatterbox.mtl_tts import ChatterboxMultilingualTTS
        dev = resolve_device(self.cfg)
        try:
            try:
                self.model = ChatterboxMultilingualTTS.from_pretrained(device=dev, t3_model=self.cfg.tts.chatterbox_t3)
            except TypeError as e:             # chatterbox-tts 0.1.7 has no t3_model switch
                if "t3_model" not in str(e):
                    raise
                self.model = ChatterboxMultilingualTTS.from_pretrained(device=dev)
        except TypeError as e:
            if "NoneType" in str(e):
                raise RuntimeError("Chatterbox's watermarker failed to import (resemble-perth needs `pkg_resources`). "
                                   "Fix: pip install \"setuptools<81\"") from e
            raise
        self.sample_rate = int(self.model.sr)

    def synthesize(self, text: str, lang: str, reference_wav, style: Style) -> np.ndarray:
        import torch
        c = self.cfg.tts
        if style.seed is not None:
            torch.manual_seed(style.seed)
        chunks = []
        for piece in split_text(normalize_text(text), c.max_chars):
            wav = self.model.generate(piece, language_id=lang, audio_prompt_path=str(reference_wav),
                                      exaggeration=style.exaggeration, cfg_weight=c.cfg_weight,
                                      temperature=c.temperature)
            chunks.append(wav.squeeze().detach().cpu().numpy().astype(np.float32))
        return concat_chunks(chunks, self.sample_rate)
