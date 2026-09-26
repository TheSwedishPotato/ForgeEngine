"""Meta NLLB-200 text translation (200 languages; 600M / 1.3B / 3.3B checkpoints)."""

from __future__ import annotations

from ..utils.gpu import free_memory
from . import languages as L
from .base import Translator, log


class NLLBTranslator(Translator):
    name = "nllb"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.model = None
        self.tok = None

    def load(self) -> None:
        if self.model is not None:
            return
        import torch
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer

        dtype = torch.float16 if self.device.startswith("cuda") else torch.float32
        log.info("Loading %s (%s) on %s", self.cfg.nllb_model, dtype, self.device)
        self.tok = AutoTokenizer.from_pretrained(self.cfg.nllb_model)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(self.cfg.nllb_model, dtype=dtype).to(self.device).eval()

    def unload(self) -> None:
        self.model = None
        self.tok = None
        free_memory()

    def translate_texts(self, texts, src, tgt, n, segments=None, audio16k=None, progress=lambda f, m: None):
        import torch

        self.load()
        assert self.model is not None and self.tok is not None
        self.tok.src_lang = L.get(src).nllb
        tgt_id = self.tok.convert_tokens_to_ids(L.get(tgt).nllb)
        n_ret = max(1, min(n, self.cfg.num_beams))
        beams = max(self.cfg.num_beams, n_ret)
        order = sorted(range(len(texts)), key=lambda i: len(texts[i]))
        out: list[list[str]] = [[] for _ in texts]
        bs = max(1, self.cfg.batch_size)
        for b in range(0, len(order), bs):
            idxs = order[b: b + bs]
            enc = self.tok([texts[i] for i in idxs], return_tensors="pt", padding=True, truncation=True,
                           max_length=256).to(self.device)
            max_new = int(enc["input_ids"].shape[1] * 2.2) + 16
            with torch.inference_mode():
                gen = self.model.generate(**enc, forced_bos_token_id=tgt_id, num_beams=beams,
                                          num_return_sequences=n_ret, max_new_tokens=max_new, early_stopping=True)
            dec = self.tok.batch_decode(gen, skip_special_tokens=True)
            for j, i in enumerate(idxs):
                out[i] = dec[j * n_ret:(j + 1) * n_ret]
            progress(min(1.0, (b + bs) / len(order)), f"translated {min(b + bs, len(order))}/{len(order)} lines")
        return out
