"""Stem separation: keep the music and sound effects, replace only the voices."""
from __future__ import annotations

from pathlib import Path

import numpy as np
import soundfile as sf

from .base import Progress, Separator, _noop
from .config import Config
from .env import resolve_device


class DemucsSeparator(Separator):
    """htdemucs, run in overlapping chunks so a 2-hour film never needs more than a few GB of RAM.

    Chunks carry `pad_s` of context on both sides which is discarded, so stitching is seamless.
    `accompaniment` is the sum of drums+bass+other (not mix-minus-vocals), which keeps it clean.
    """

    name = "demucs"

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.model = None

    def load(self) -> None:
        import torch
        from demucs.pretrained import get_model
        self.device = resolve_device(self.cfg)
        self.model = get_model(self.cfg.separate.model)
        self.model.to(self.device).eval()
        self._torch = torch

    def separate(self, audio_path: Path, out_dir: Path, progress: Progress = _noop) -> tuple[Path, Path]:
        import torch
        from demucs.apply import apply_model

        c = self.cfg.separate
        sr = self.model.samplerate
        out_dir.mkdir(parents=True, exist_ok=True)
        voc_path, acc_path = out_dir / "vocals.wav", out_dir / "accompaniment.wav"
        vi = self.model.sources.index("vocals")
        with sf.SoundFile(str(audio_path)) as src:
            if src.samplerate != sr:
                raise ValueError(f"expected {sr} Hz audio for {self.model}, got {src.samplerate}")
            total = src.frames
            chunk, pad = int(c.chunk_s * sr), int(c.pad_s * sr)
            with sf.SoundFile(str(voc_path), "w", sr, 2, "PCM_16") as fv, \
                    sf.SoundFile(str(acc_path), "w", sr, 2, "PCM_16") as fa:
                for start in range(0, total, chunk):
                    lo, hi = max(0, start - pad), min(total, start + chunk + pad)
                    src.seek(lo)
                    x = src.read(hi - lo, dtype="float32", always_2d=True)
                    if x.shape[1] == 1:
                        x = np.repeat(x, 2, axis=1)
                    wav = torch.from_numpy(x.T.copy())                      # [2, T]
                    ref = wav.mean(0)
                    mean, std = ref.mean(), ref.std().clamp_min(1e-8)
                    with torch.no_grad():
                        out = apply_model(self.model, ((wav - mean) / std)[None].to(self.device),
                                          shifts=c.shifts, split=True, overlap=0.25,
                                          device=self.device, progress=False)[0]
                    out = (out * std + mean).cpu()
                    voc = out[vi]
                    acc = sum(out[i] for i in range(out.shape[0]) if i != vi)
                    s0 = start - lo
                    s1 = s0 + min(chunk, total - start)
                    fv.write(voc[:, s0:s1].T.numpy())
                    fa.write(acc[:, s0:s1].T.numpy())
                    progress(min(1.0, (start + chunk) / total), "separating voices from music/effects")
        return voc_path, acc_path


class PassthroughSeparator(Separator):
    """No separation: whole track is 'vocals', accompaniment is silent. Tests/CPU smoke runs only —
    the dub will have no background music."""

    name = "none"

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def separate(self, audio_path: Path, out_dir: Path, progress: Progress = _noop) -> tuple[Path, Path]:
        out_dir.mkdir(parents=True, exist_ok=True)
        voc_path, acc_path = out_dir / "vocals.wav", out_dir / "accompaniment.wav"
        with sf.SoundFile(str(audio_path)) as src, \
                sf.SoundFile(str(voc_path), "w", src.samplerate, src.channels, "PCM_16") as fv, \
                sf.SoundFile(str(acc_path), "w", src.samplerate, src.channels, "PCM_16") as fa:
            while True:
                b = src.read(src.samplerate * 30, dtype="float32", always_2d=True)
                if not len(b):
                    break
                fv.write(b)
                fa.write(np.zeros_like(b))
        return voc_path, acc_path
