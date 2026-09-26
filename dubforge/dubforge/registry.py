"""Plugin registry: every pipeline stage is looked up by (kind, name).

Backends are referenced as "module:Class" strings and imported lazily, so the
heavy ML libraries of a backend are only imported when you actually use it.

Add your own model without touching DubForge:

    # my_plugins.py
    from dubforge.registry import register
    register("tts", "f5", "my_plugins.f5_backend:F5TTS")

    # config.yaml
    general: {plugins: [my_plugins]}
    tts: {backend: f5}
"""

from __future__ import annotations

import importlib
from typing import Any

_REGISTRY: dict[str, dict[str, str]] = {
    "separator": {
        "demucs": "dubforge.separation.demucs_backend:DemucsSeparator",
        "audio_separator": "dubforge.separation.audio_separator_backend:AudioSeparator",
        "none": "dubforge.separation.base:NoSeparation",
        "mock": "dubforge.separation.base:MockSeparator",
    },
    "asr": {
        "whisperx": "dubforge.asr.whisperx_backend:WhisperXASR",
        "faster_whisper": "dubforge.asr.faster_whisper_backend:FasterWhisperASR",
        "mock": "dubforge.asr.base:MockASR",
    },
    "translator": {
        "nllb": "dubforge.translation.nllb:NLLBTranslator",
        "seamless": "dubforge.translation.seamless:SeamlessTranslator",
        "local_llm": "dubforge.translation.local_llm:LocalLLMTranslator",
        "mock": "dubforge.translation.base:MockTranslator",
    },
    "emotion": {
        "speechbrain": "dubforge.emotion.speechbrain_backend:SpeechBrainEmotion",
        "prosody": "dubforge.emotion.base:ProsodyOnlyEmotion",
        "none": "dubforge.emotion.base:NoEmotion",
        "mock": "dubforge.emotion.base:ProsodyOnlyEmotion",
    },
    "tts": {
        "xtts": "dubforge.tts.xtts:XTTSBackend",
        "gpt_sovits": "dubforge.tts.gpt_sovits:GPTSoVITSBackend",
        "mock": "dubforge.tts.base:MockTTS",
    },
    "lipsync": {
        "wav2lip": "dubforge.lipsync.wav2lip:Wav2LipSync",
        "musetalk": "dubforge.lipsync.musetalk:MuseTalkSync",
        "none": "dubforge.lipsync.base:NoLipSync",
        "mock": "dubforge.lipsync.base:MockLipSync",
    },
}


class BackendError(RuntimeError):
    pass


def register(kind: str, name: str, target: str | type) -> None:
    if isinstance(target, type):
        target = f"{target.__module__}:{target.__qualname__}"
    _REGISTRY.setdefault(kind, {})[name] = target


def available(kind: str) -> list[str]:
    return sorted(_REGISTRY.get(kind, {}))


def resolve(kind: str, name: str) -> type:
    try:
        target = _REGISTRY[kind][name]
    except KeyError:
        raise BackendError(
            f"Unknown {kind} backend '{name}'. Available: {', '.join(available(kind))}"
        ) from None
    module_name, _, attr = target.partition(":")
    try:
        module = importlib.import_module(module_name)
    except ImportError as e:
        raise BackendError(
            f"The '{name}' {kind} backend needs a package that isn't installed: {e}. "
            f"See README > Installation, or pick another backend."
        ) from e
    return getattr(module, attr)


def create(kind: str, name: str, *args: Any, **kwargs: Any) -> Any:
    return resolve(kind, name)(*args, **kwargs)


def load_plugins(modules: list[str]) -> None:
    for m in modules:
        importlib.import_module(m)
