"""SpeechBrain wav2vec2 emotion classifier (IEMOCAP: neutral / angry / happy / sad)."""

from __future__ import annotations

import numpy as np

from ..utils.gpu import free_memory
from ..utils.log import get_logger
from .base import EmotionBackend

log = get_logger("emotion")

LABELS = {"neu": "neutral", "ang": "angry", "hap": "happy", "sad": "sad", "exc": "happy", "fru": "angry"}


class SpeechBrainEmotion(EmotionBackend):
    name = "speechbrain"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.model = None

    def load(self) -> None:
        if self.model is not None:
            return
        try:
            from speechbrain.inference.interfaces import foreign_class
        except ImportError:
            from speechbrain.pretrained.interfaces import foreign_class  # type: ignore
        savedir = (self.models_dir or __import__("pathlib").Path("models")) / "speechbrain" / "emotion"
        self.model = foreign_class(source=self.cfg.model, pymodule_file="custom_interface.py",
                                   classname="CustomEncoderWav2vec2Classifier", savedir=str(savedir),
                                   run_opts={"device": self.device})

    def unload(self) -> None:
        self.model = None
        free_memory()

    def classify(self, clips, sr):
        import torch

        self.load()
        assert self.model is not None
        out: list = []
        # sort by length so padding is minimal
        order = sorted(range(len(clips)), key=lambda i: len(clips[i]))
        results: dict[int, tuple[str, dict[str, float]] | None] = {}
        bs = max(1, self.cfg.batch_size)
        for b in range(0, len(order), bs):
            idxs = order[b: b + bs]
            batch = [clips[i][: sr * 10] for i in idxs]
            if max(len(c) for c in batch) < sr * 0.4:
                for i in idxs:
                    results[i] = None
                continue
            n = max(len(c) for c in batch)
            wavs = np.zeros((len(batch), n), dtype=np.float32)
            lens = np.zeros(len(batch), dtype=np.float32)
            for j, c in enumerate(batch):
                wavs[j, : len(c)] = c
                lens[j] = len(c) / n
            try:
                with torch.inference_mode():
                    probs, _score, _idx, labs = self.model.classify_batch(torch.from_numpy(wavs).to(self.device),
                                                                          torch.from_numpy(lens).to(self.device))
                probs = torch.softmax(probs, dim=-1).float().cpu().numpy() if probs.min() < 0 else probs.float().cpu().numpy()
                names = [LABELS.get(l, l) for l in self.model.hparams.label_encoder.decode_ndim(torch.arange(probs.shape[1]))]
                for j, i in enumerate(idxs):
                    scores: dict[str, float] = {}
                    for name, p in zip(names, probs[j]):
                        scores[name] = scores.get(name, 0.0) + float(p)
                    results[i] = (LABELS.get(labs[j], labs[j]), {k: round(v, 3) for k, v in scores.items()})
            except Exception as e:  # never let the optional classifier kill a 2-hour job
                log.warning("emotion classifier failed on a batch (%s); using prosody heuristics", e)
                for i in idxs:
                    results[i] = None
        for i in range(len(clips)):
            out.append(results.get(i))
        return out
