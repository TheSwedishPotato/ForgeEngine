"""NLLB-200 text translation (200 languages incl. Swedish). Runs fully local."""
from __future__ import annotations

from ..base import Progress, Translator, _noop
from ..config import Config
from ..env import resolve_device
from ..languages import resolve
from ..types import Segment


class NLLBTranslator(Translator):
    name = "nllb"

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.model = None
        self.tok = None

    def load(self) -> None:
        import torch
        import transformers
        from transformers import AutoModelForSeq2SeqLM, AutoTokenizer
        self.device = resolve_device(self.cfg)
        dtype = torch.float16 if self.device == "cuda" else torch.float32
        kw = {"dtype": dtype} if int(transformers.__version__.split(".")[0]) >= 5 else {"torch_dtype": dtype}
        self.tok = AutoTokenizer.from_pretrained(self.cfg.translate.model)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(self.cfg.translate.model, **kw).to(self.device).eval()

    def translate_texts(self, texts: list[str], src: str, tgt: str) -> list[str]:
        import torch
        c = self.cfg.translate
        self.tok.src_lang = resolve(src).nllb
        bos = self.tok.convert_tokens_to_ids(resolve(tgt).nllb)
        order = sorted(range(len(texts)), key=lambda i: len(texts[i]))     # length-sorted batches = less padding
        out = [""] * len(texts)
        for b in range(0, len(order), c.batch_size):
            idx = order[b:b + c.batch_size]
            enc = self.tok([texts[i] for i in idx], return_tensors="pt", padding=True, truncation=True,
                           max_length=256).to(self.device)
            with torch.no_grad():
                gen = self.model.generate(**enc, forced_bos_token_id=bos, num_beams=c.beams,
                                          max_new_tokens=int(enc["input_ids"].shape[1] * 2.2) + 16,
                                          no_repeat_ngram_size=4)
            for i, t in zip(idx, self.tok.batch_decode(gen, skip_special_tokens=True)):
                out[i] = t.strip()
        return out

    def translate(self, segments: list[Segment], src: str, tgt: str, progress: Progress = _noop) -> None:
        todo = [s for s in segments if not s.skip and s.text.strip()]
        texts = self.translate_texts([s.text for s in todo], src, tgt)
        for s, t in zip(todo, texts):
            s.translation = t
        progress(1.0, "translating")
