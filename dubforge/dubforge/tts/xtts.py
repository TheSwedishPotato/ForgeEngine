"""Coqui XTTS-v2 zero-shot voice cloning with prosody transfer.

XTTS conditions on two things:
  * speaker_embedding  -> timbre ("who"), averaged over the speaker's best clips
  * gpt_cond_latent    -> speaking style ("how"): rhythm, energy, emotion
We compute the timbre once per character, and the style per line from the
original line's own audio (blended with the character's average style), so an
angry line is re-voiced angrily and a whisper stays a whisper.

Install: pip install coqui-tts  (model license: Coqui Public Model License, non-commercial)
"""

from __future__ import annotations

import hashlib
import math
from pathlib import Path

import numpy as np

from ..config import resolve_path
from ..media import audio as au
from ..utils.gpu import free_memory
from ..utils.log import get_logger
from .base import StyleRef, TTSBackend

log = get_logger("xtts")

XTTS_LANGS = {"en": "en", "es": "es", "fr": "fr", "de": "de", "it": "it", "pt": "pt", "pl": "pl", "tr": "tr",
              "ru": "ru", "nl": "nl", "cs": "cs", "ar": "ar", "zh": "zh-cn", "ja": "ja", "hu": "hu", "ko": "ko",
              "hi": "hi"}


class XTTSBackend(TTSBackend):
    name = "xtts"
    sample_rate = 24000
    supports_speed = True
    languages = set(XTTS_LANGS)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.model = None
        self.voices: dict[str, tuple] = {}
        self._style_cache: dict[str, object] = {}

    # ------------------------------------------------------------------ lifecycle

    def model_dir(self) -> Path:
        p = resolve_path(self.cfg.xtts_model_dir)
        assert p is not None
        return p

    def load(self) -> None:
        if self.model is not None:
            return
        from TTS.tts.configs.xtts_config import XttsConfig
        from TTS.tts.models.xtts import Xtts

        d = self.model_dir()
        if not (d / "config.json").exists():
            raise FileNotFoundError(f"XTTS-v2 not found in {d}. Run: python scripts/download_models.py --only xtts")
        config = XttsConfig()
        config.load_json(str(d / "config.json"))
        model = Xtts.init_from_config(config)
        model.load_checkpoint(config, checkpoint_dir=str(d), use_deepspeed=self.cfg.use_deepspeed)
        model.to(self.device)
        model.eval()
        self.model = model
        self.sample_rate = int(getattr(config.audio, "output_sample_rate", 24000) or 24000)
        log.info("XTTS-v2 loaded on %s", self.device)

    def unload(self) -> None:
        self.model = None
        self.voices.clear()
        self._style_cache.clear()
        free_memory()

    # ------------------------------------------------------------------ voices

    def set_voice(self, speaker, refs, ref_lang):
        import torch

        self.load()
        assert self.model is not None
        if not refs:
            raise ValueError(f"no reference audio for {speaker}")
        paths = [r.path for r in refs]
        key = hashlib.sha1("|".join(paths).encode()).hexdigest()[:12]
        cache = Path(paths[0]).parent / f"xtts_latents_{key}.pt"
        if cache.exists():
            data = torch.load(cache, map_location=self.device)
            self.voices[speaker] = (data["gpt"], data["spk"])
            return
        gpt, spk = self.model.get_conditioning_latents(audio_path=paths, gpt_cond_len=30, gpt_cond_chunk_len=4,
                                                       max_ref_length=30)
        self.voices[speaker] = (gpt, spk)
        torch.save({"gpt": gpt.cpu(), "spk": spk.cpu()}, cache)

    def _style_latent(self, style: StyleRef):
        if style.path in self._style_cache:
            return self._style_cache[style.path]
        assert self.model is not None
        dur = style.duration or au.duration(style.path)
        length = max(1, int(math.ceil(min(dur, 12.0))))
        gpt, _ = self.model.get_conditioning_latents(audio_path=[style.path], gpt_cond_len=length,
                                                     gpt_cond_chunk_len=min(4, length), max_ref_length=15)
        if len(self._style_cache) > 256:
            self._style_cache.clear()
        self._style_cache[style.path] = gpt
        return gpt

    def _conditioning(self, speaker: str, style: StyleRef | None):
        gpt, spk = self.voices[speaker]
        gpt, spk = gpt.to(self.device), spk.to(self.device)
        if style is not None and self.cfg.style_mix > 0:
            try:
                sg = self._style_latent(style).to(self.device)
                if sg.shape == gpt.shape:
                    w = float(self.cfg.style_mix)
                    gpt = w * sg + (1.0 - w) * gpt
            except Exception as e:  # too short / silent reference: keep the speaker's average style
                log.debug("style latent failed for %s: %s", style.path, e)
        return gpt, spk

    # ------------------------------------------------------------------ synthesis

    def _kwargs(self, temperature: float | None, speed: float) -> dict:
        return dict(temperature=temperature if temperature is not None else self.cfg.temperature,
                    length_penalty=self.cfg.length_penalty, repetition_penalty=self.cfg.repetition_penalty,
                    top_k=self.cfg.top_k, top_p=self.cfg.top_p, speed=float(speed), enable_text_splitting=True)

    def synthesize(self, text, lang, speaker, *, style=None, speed=1.0, temperature=None, seed=None):
        import torch

        self.load()
        assert self.model is not None
        if seed is not None:
            torch.manual_seed(seed)
        gpt, spk = self._conditioning(speaker, style)
        out = self.model.inference(text, XTTS_LANGS[lang], gpt, spk, **self._kwargs(temperature, speed))
        wav = out["wav"]
        wav = wav.detach().cpu().numpy() if hasattr(wav, "detach") else np.asarray(wav)
        return wav.astype(np.float32).reshape(-1)

    def synthesize_stream(self, text, lang, speaker, *, style=None, speed=1.0, temperature=None, seed=None):
        import torch

        self.load()
        assert self.model is not None
        if seed is not None:
            torch.manual_seed(seed)
        gpt, spk = self._conditioning(speaker, style)
        for chunk in self.model.inference_stream(text, XTTS_LANGS[lang], gpt, spk, stream_chunk_size=20,
                                                 **self._kwargs(temperature, speed)):
            yield chunk.detach().float().cpu().numpy().reshape(-1)

    def set_voice_from_audio(self, speaker: str, wav: np.ndarray, sr: int, tmp_dir: Path) -> None:
        """Live mode: (re)build a voice from an in-memory clip."""
        path = au.save(Path(tmp_dir) / f"{speaker}_live_ref.wav", au.resample(wav, sr, 24000), 24000)
        self.load()
        assert self.model is not None
        gpt, spk = self.model.get_conditioning_latents(audio_path=[str(path)], gpt_cond_len=12, gpt_cond_chunk_len=4)
        self.voices[speaker] = (gpt, spk)
