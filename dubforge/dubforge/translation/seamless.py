"""Meta SeamlessM4T v2: text->text, or speech->text straight from the original audio.

Speech input (`translation.seamless_input: speech`) skips ASR errors, since the
model hears the actor directly. We still use our own voice-cloning TTS for the
output, because SeamlessM4T's built-in speech output is a generic voice.
"""

from __future__ import annotations

import inspect

import numpy as np

from ..utils.gpu import free_memory
from . import languages as L
from .base import Translator, log


class SeamlessTranslator(Translator):
    name = "seamless"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.model = None
        self.processor = None
        self.mode = None

    def load(self, mode: str) -> None:
        if self.model is not None and self.mode == mode:
            return
        import torch
        from transformers import AutoProcessor

        if mode == "speech":
            from transformers import SeamlessM4Tv2ForSpeechToText as Model
        else:
            from transformers import SeamlessM4Tv2ForTextToText as Model
        dtype = torch.float16 if self.device.startswith("cuda") else torch.float32
        log.info("Loading %s (%s input) on %s", self.cfg.seamless_model, mode, self.device)
        self.processor = AutoProcessor.from_pretrained(self.cfg.seamless_model)
        self.model = Model.from_pretrained(self.cfg.seamless_model, dtype=dtype).to(self.device).eval()
        self.mode = mode

    def unload(self) -> None:
        self.model = None
        self.processor = None
        free_memory()

    def _audio_kwarg(self) -> str:
        params = inspect.signature(self.processor.__call__).parameters  # type: ignore[union-attr]
        return "audio" if "audio" in params else "audios"

    def translate_texts(self, texts, src, tgt, n, segments=None, audio16k=None, progress=lambda f, m: None):
        import torch

        use_speech = self.cfg.seamless_input == "speech" and segments is not None and audio16k is not None
        self.load("speech" if use_speech else "text")
        assert self.model is not None and self.processor is not None
        tgt_code = L.get(tgt).seamless
        src_code = L.get(src).seamless
        if not tgt_code:
            raise L.UnsupportedLanguage(f"SeamlessM4T has no code for '{tgt}'")
        n_ret = max(1, min(n, self.cfg.num_beams))
        out: list[list[str]] = []
        bs = max(1, self.cfg.batch_size // (2 if use_speech else 1))
        dtype = next(self.model.parameters()).dtype
        for b in range(0, len(texts), bs):
            if use_speech:
                assert segments is not None and audio16k is not None
                clips = [audio16k[int(s.start * 16000): int(s.end * 16000)] for s in segments[b: b + bs]]
                clips = [c if len(c) > 1600 else np.pad(c, (0, 1600 - len(c))) for c in clips]
                inputs = self.processor(**{self._audio_kwarg(): clips}, sampling_rate=16000, return_tensors="pt",
                                        padding=True)
            else:
                inputs = self.processor(text=texts[b: b + bs], src_lang=src_code, return_tensors="pt", padding=True)
            inputs = {k: (v.to(self.device, dtype) if v.dtype.is_floating_point else v.to(self.device))
                      for k, v in inputs.items()}
            with torch.inference_mode():
                gen = self.model.generate(**inputs, tgt_lang=tgt_code, num_beams=max(self.cfg.num_beams, n_ret),
                                          num_return_sequences=n_ret, max_new_tokens=256)
            seqs = gen.sequences if hasattr(gen, "sequences") else gen
            if isinstance(seqs, (tuple, list)):
                seqs = seqs[0]
            dec = self.processor.batch_decode(seqs, skip_special_tokens=True)
            for j in range(len(dec) // n_ret):
                out.append(dec[j * n_ret:(j + 1) * n_ret])
            progress(min(1.0, (b + bs) / len(texts)), f"translated {min(b + bs, len(texts))}/{len(texts)} lines")
        return out
