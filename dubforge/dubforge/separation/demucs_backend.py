"""Demucs v4 (htdemucs / htdemucs_ft) vocal separation."""

from __future__ import annotations

import numpy as np

from ..media.audio import resample, to_channels
from ..utils.gpu import free_memory
from .base import Separator, log


class DemucsSeparator(Separator):
    name = "demucs"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.model = None

    def load(self) -> None:
        if self.model is not None:
            return
        from demucs.pretrained import get_model

        log.info("Loading Demucs '%s' on %s", self.cfg.demucs_model, self.device)
        self.model = get_model(self.cfg.demucs_model)
        self.model.to(self.device)
        self.model.eval()

    def unload(self) -> None:
        self.model = None
        free_memory()

    def separate_array(self, audio: np.ndarray, sr: int) -> np.ndarray:
        import torch
        from demucs.apply import apply_model

        assert self.model is not None
        msr = self.model.samplerate
        n_in, ch_in = audio.shape
        x = to_channels(audio, self.model.audio_channels)
        x = resample(x, sr, msr)
        wav = torch.from_numpy(np.ascontiguousarray(x.T)).float()
        ref = wav.mean(0)
        mean, std = ref.mean(), ref.std() + 1e-8
        wav = (wav - mean) / std
        with torch.inference_mode():
            sources = apply_model(self.model, wav[None], device=self.device, shifts=self.cfg.shifts,
                                  split=True, overlap=self.cfg.overlap, progress=False)[0]
        sources = sources * std + mean
        vocals = sources[self.model.sources.index("vocals")].cpu().numpy().T
        vocals = resample(vocals, msr, sr)
        vocals = to_channels(vocals, ch_in)
        if len(vocals) < n_in:
            vocals = np.pad(vocals, ((0, n_in - len(vocals)), (0, 0)))
        return vocals[:n_in].astype(np.float32)
