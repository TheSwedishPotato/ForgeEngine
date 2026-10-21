"""Backend registry. Targets are 'module:Class' strings imported lazily, so a missing
optional dependency (e.g. MuseTalk) never breaks the other stages."""
from __future__ import annotations

import importlib
from typing import Any

from .base import Backend

_REG: dict[str, dict[str, str]] = {
    "separate": {
        "demucs": "dubforge.separation:DemucsSeparator",
        "none": "dubforge.separation:PassthroughSeparator",
    },
    "asr": {
        "faster_whisper": "dubforge.asr.faster_whisper_asr:FasterWhisperASR",
        "energy_mock": "dubforge.asr.mock:EnergyMockASR",
    },
    "diarize": {
        "ecapa": "dubforge.diarize.ecapa:EcapaDiarizer",
        "single": "dubforge.diarize.single:SingleSpeaker",
    },
    "emotion": {
        "wav2vec2": "dubforge.emotion.wav2vec2_emotion:Wav2Vec2Emotion",
        "none": "dubforge.emotion.none:NoEmotion",
    },
    "translate": {
        "nllb": "dubforge.translate.nllb:NLLBTranslator",
        "ollama": "dubforge.translate.ollama:OllamaTranslator",
        "passthrough": "dubforge.translate.mock:PassthroughTranslator",
    },
    "tts": {
        "chatterbox": "dubforge.tts.chatterbox_tts:ChatterboxTTS",
        "xtts": "dubforge.tts.xtts:XTTSTTS",
        "mock": "dubforge.tts.mock:MockTTS",
    },
    "lipsync": {
        "wav2lip": "dubforge.lipsync.wav2lip:Wav2LipSync",
        "musetalk": "dubforge.lipsync.musetalk:MuseTalkSync",
    },
}


def register(stage: str, name: str, target: str) -> None:
    """Add or override a backend: register('tts', 'my_tts', 'my_pkg.mod:MyTTS')."""
    _REG.setdefault(stage, {})[name] = target


def available(stage: str) -> list[str]:
    return sorted(_REG.get(stage, {}))


def create(stage: str, name: str, cfg: Any) -> Backend:
    try:
        target = _REG[stage][name]
    except KeyError:
        raise ValueError(f"Unknown {stage} backend {name!r}. Available: {available(stage)}") from None
    module, cls = target.split(":")
    try:
        mod = importlib.import_module(module)
    except ImportError as e:
        raise RuntimeError(
            f"The {stage} backend {name!r} needs packages that are not installed ({e}). "
            f"See README.md -> Install, or run `python main.py doctor`."
        ) from e
    return getattr(mod, cls)(cfg)
