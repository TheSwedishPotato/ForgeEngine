"""GPT-SoVITS via its local HTTP API (api_v2.py), running in its own environment.

Start it once in the GPT-SoVITS folder:
    python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml

GPT-SoVITS speaks zh / en / ja / ko / yue. Its references must be 3-10 s and
it wants the reference transcript, which we have from the ASR stage.
"""

from __future__ import annotations

import io
from urllib.parse import urlparse

import numpy as np
import soundfile as sf

from ..media import audio as au
from ..translation.languages import get as get_lang
from ..utils.log import get_logger
from .base import TTSBackend
from .voice_bank import RefClip

log = get_logger("gpt_sovits")


class GPTSoVITSBackend(TTSBackend):
    name = "gpt_sovits"
    sample_rate = 32000
    supports_speed = True
    languages = {"zh", "en", "ja", "ko", "yue"}

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        host = urlparse(self.cfg.gpt_sovits_url).hostname or ""
        if host not in ("127.0.0.1", "localhost", "::1"):
            raise ValueError("tts.gpt_sovits_url must point to this machine")
        self.voices: dict[str, list[RefClip]] = {}

    def load(self) -> None:
        import requests

        try:
            requests.get(self.cfg.gpt_sovits_url.rstrip("/") + "/docs", timeout=5)
        except Exception as e:
            raise RuntimeError(f"GPT-SoVITS API not reachable at {self.cfg.gpt_sovits_url}. Start api_v2.py first. ({e})") from e

    def set_voice(self, speaker, refs, ref_lang):
        usable = [r for r in refs if 3.0 <= r.duration <= 10.0]
        if not usable:
            raise ValueError(f"GPT-SoVITS needs a 3-10 s reference for {speaker}")
        self.voices[speaker] = usable

    def _prompt_lang(self, lang: str) -> tuple[str, bool]:
        sov = get_lang(lang).sovits
        return (sov, True) if sov else ("en", False)

    def synthesize(self, text, lang, speaker, *, style=None, speed=1.0, temperature=None, seed=None):
        import requests

        target = get_lang(lang).sovits
        if not target:
            raise ValueError(f"GPT-SoVITS cannot speak '{lang}'")
        refs = self.voices[speaker]
        main = refs[0]
        ref_path, ref_text, ref_lang = main.path, main.text, main.lang
        if style is not None and 3.0 <= style.duration <= 10.0:
            ref_path, ref_text, ref_lang = style.path, style.text, style.lang
        prompt_lang, has_prompt = self._prompt_lang(ref_lang)
        payload = {
            "text": text,
            "text_lang": target,
            "ref_audio_path": ref_path,
            "aux_ref_audio_paths": [r.path for r in refs[1:4] if r.path != ref_path],
            "prompt_text": ref_text if has_prompt else "",
            "prompt_lang": prompt_lang,
            "top_k": self.cfg.gpt_sovits_top_k,
            "top_p": self.cfg.top_p,
            "temperature": temperature if temperature is not None else self.cfg.temperature,
            "text_split_method": "cut5",
            "speed_factor": float(speed),
            "seed": int(seed) if seed is not None else -1,
            "media_type": "wav",
            "streaming_mode": False,
        }
        r = requests.post(self.cfg.gpt_sovits_url.rstrip("/") + "/tts", json=payload, timeout=self.cfg.gpt_sovits_timeout)
        if r.status_code != 200:
            raise RuntimeError(f"GPT-SoVITS error {r.status_code}: {r.text[:300]}")
        wav, sr = sf.read(io.BytesIO(r.content), dtype="float32", always_2d=True)
        return au.resample(au.to_mono(wav), sr, self.sample_rate).astype(np.float32)
