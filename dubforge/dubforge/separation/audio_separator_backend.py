"""python-audio-separator backend (MDX-Net / BS-RoFormer / MelBand-RoFormer models).

RoFormer vocal models are usually cleaner than Demucs on film dialogue, at the
cost of speed. pip install "audio-separator[gpu]"
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np

from ..media import audio as au
from ..utils.gpu import free_memory
from .base import Separator, log


class AudioSeparator(Separator):
    name = "audio_separator"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.sep = None
        self.tmp = None

    def load(self) -> None:
        if self.sep is not None:
            return
        from audio_separator.separator import Separator as _AS

        self.tmp = tempfile.TemporaryDirectory(prefix="dubforge_sep_")
        model_dir = (self.models_dir / "audio-separator") if self.models_dir else None
        kwargs = dict(output_dir=self.tmp.name, output_format="WAV")
        if model_dir:
            kwargs["model_file_dir"] = str(model_dir)
        self.sep = _AS(**kwargs)
        log.info("Loading audio-separator model %s", self.cfg.audio_separator_model)
        self.sep.load_model(model_filename=self.cfg.audio_separator_model)

    def unload(self) -> None:
        self.sep = None
        if self.tmp is not None:
            self.tmp.cleanup()
            self.tmp = None
        free_memory()

    def separate_array(self, audio: np.ndarray, sr: int) -> np.ndarray:
        assert self.sep is not None and self.tmp is not None
        tmpdir = Path(self.tmp.name)
        for f in tmpdir.glob("*.wav"):
            f.unlink()
        src = au.save(tmpdir / "chunk.wav", audio, sr, subtype="FLOAT")
        outputs = [Path(p) if Path(p).is_absolute() else tmpdir / p for p in self.sep.separate(str(src))]
        vocal_file = next((p for p in outputs if "(vocals)" in p.name.lower()), None)
        if vocal_file is None:
            inst = next((p for p in outputs if "(instrumental)" in p.name.lower()), None)
            if inst is None:
                raise RuntimeError(f"audio-separator produced unexpected files: {outputs}")
            inst_audio, isr = au.load(inst, sr=sr)
            inst_audio = au.match_length(au.to_channels(inst_audio, audio.shape[1]), len(audio))
            return (audio - inst_audio).astype(np.float32)
        vocals, _ = au.load(vocal_file, sr=sr)
        return au.match_length(au.to_channels(vocals, audio.shape[1]), len(audio)).astype(np.float32)
