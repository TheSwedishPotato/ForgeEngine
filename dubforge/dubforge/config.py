"""Typed configuration tree, loaded from YAML with presets and CLI overrides.

Resolution order (later wins):
    configs/default.yaml -> configs/presets/<preset>.yaml -> --config user.yaml -> --set a.b=c
"""

from __future__ import annotations

import dataclasses
import difflib
import hashlib
import json
import os
from dataclasses import dataclass, field, fields, is_dataclass
from pathlib import Path
from typing import Any, get_args, get_origin, get_type_hints

import yaml

PACKAGE_ROOT = Path(__file__).resolve().parent
PROJECT_ROOT = PACKAGE_ROOT.parent
CONFIG_DIR = PROJECT_ROOT / "configs"
PRESET_DIR = CONFIG_DIR / "presets"


class ConfigError(ValueError):
    pass


# --------------------------------------------------------------------------- sections


@dataclass
class GeneralConfig:
    device: str = "auto"  # auto | cuda | cuda:1 | cpu
    work_dir: str = "work"  # per-video caches live in work_dir/<video name>/
    models_dir: str = "models"
    output_dir: str = "output"
    offline: bool = False  # force HF/transformers offline mode after models are downloaded
    hf_token: str | None = None  # only needed once, to download pyannote diarization
    log_level: str = "INFO"
    seed: int = 1234
    ffmpeg: str = "ffmpeg"
    ffprobe: str = "ffprobe"
    plugins: list[str] = field(default_factory=list)  # modules that call registry.register()


@dataclass
class SeparationConfig:
    backend: str = "demucs"  # demucs | audio_separator | none | mock
    demucs_model: str = "htdemucs_ft"
    shifts: int = 1  # >1 = better quality, linearly slower
    overlap: float = 0.25
    chunk_seconds: float = 240.0  # process long movies in chunks to bound RAM/VRAM
    context_seconds: float = 5.0  # extra audio on each side of a chunk (discarded) to hide seams
    audio_separator_model: str = "model_bs_roformer_ep_317_sdr_12.9755.ckpt"
    sample_rate: int = 44100


@dataclass
class ASRConfig:
    backend: str = "whisperx"  # whisperx | faster_whisper | mock
    model: str = "large-v3"
    compute_type: str = "float16"  # float16 | int8_float16 | int8 | float32
    batch_size: int = 8
    beam_size: int = 5
    initial_prompt: str | None = None  # e.g. character names, to help spelling
    align: bool = True  # whisperx word-level alignment
    diarization: str = "auto"  # auto | pyannote | ecapa | none
    diarization_model: str | None = None  # None = whisperx default pyannote pipeline
    min_speakers: int | None = None
    max_speakers: int | None = None
    speaker_similarity: float = 0.62  # ecapa clustering: cosine similarity to merge
    # segment post-processing
    min_segment_seconds: float = 0.35
    max_segment_seconds: float = 12.0
    merge_gap_seconds: float = 0.3
    drop_no_speech_prob: float = 0.85
    drop_avg_logprob: float = -1.4


@dataclass
class TranslationConfig:
    backend: str = "nllb"  # nllb | seamless | local_llm | mock
    nllb_model: str = "facebook/nllb-200-distilled-1.3B"
    seamless_model: str = "facebook/seamless-m4t-v2-large"
    seamless_input: str = "text"  # text | speech (translate straight from the original audio)
    num_beams: int = 5
    num_candidates: int = 4  # alternative translations kept for length fitting
    batch_size: int = 16
    length_aware: bool = True  # prefer candidates whose spoken length fits the original
    max_length_ratio_penalty: float = 0.35
    llm_url: str = "http://127.0.0.1:8080/v1"  # any OpenAI-compatible LOCAL server
    llm_model: str = "local"
    llm_context_lines: int = 4
    llm_batch_lines: int = 12
    llm_temperature: float = 0.3
    glossary: dict[str, str] = field(default_factory=dict)  # source term -> forced target term
    post_replace: dict[str, str] = field(default_factory=dict)  # regex -> replacement on output


@dataclass
class EmotionConfig:
    backend: str = "speechbrain"  # speechbrain | prosody | none | mock
    model: str = "speechbrain/emotion-recognition-wav2vec2-IEMOCAP"
    batch_size: int = 8
    whisper_voiced_ratio: float = 0.25  # below this voiced fraction a segment counts as whispered
    temperature_by_emotion: dict[str, float] = field(
        default_factory=lambda: {
            "neutral": 0.65,
            "happy": 0.8,
            "angry": 0.8,
            "sad": 0.7,
            "whisper": 0.6,
        }
    )


@dataclass
class TTSConfig:
    backend: str = "xtts"  # xtts | gpt_sovits | mock
    xtts_model_dir: str = "models/xtts_v2"
    use_deepspeed: bool = False
    temperature: float = 0.7
    top_k: int = 50
    top_p: float = 0.85
    repetition_penalty: float = 5.0
    length_penalty: float = 1.0
    # prosody transfer: where the "how it's said" conditioning comes from
    #   segment         -> the original line itself (best emotion transfer)
    #   emotion_matched -> the speaker's reference clips with the same emotion
    #   speaker         -> the speaker's generic reference clips (most stable timbre)
    prosody_reference: str = "segment"
    style_mix: float = 0.65  # weight of the segment/emotion style vs the speaker's average style
    min_style_ref_seconds: float = 1.2
    ref_min_seconds: float = 3.0
    ref_max_seconds: float = 12.0
    max_ref_clips: int = 6
    max_ref_total_seconds: float = 45.0
    max_takes: int = 3  # re-roll up to N takes when a take is badly off in length
    match_loudness: bool = True
    gpt_sovits_url: str = "http://127.0.0.1:9880"
    gpt_sovits_timeout: float = 120.0
    gpt_sovits_top_k: int = 15
    verify_asr_model: str | None = None  # e.g. "base": re-transcribe takes to catch hallucinations


@dataclass
class TimingConfig:
    tolerance: float = 0.06  # accept up to 6% longer than the slot without changes
    max_tts_speed: float = 1.25  # speed-up done inside the TTS model (most natural)
    max_stretch: float = 1.2  # extra DSP time-compression after TTS speed-up
    max_overflow_seconds: float = 0.6  # may run into following silence by this much
    min_gap_seconds: float = 0.06  # keep this gap before the same speaker's next line
    allow_slowdown: bool = True
    max_slowdown: float = 0.9  # stretch short lines down to 90% speed at most
    min_fill_ratio: float = 0.75  # only slow down when the dub is shorter than 75% of the slot
    stretch_method: str = "auto"  # auto | rubberband | ffmpeg_rubberband | atempo | librosa
    try_shorter_candidates: bool = True


@dataclass
class MixConfig:
    sample_rate: int = 48000
    keep_nonspeech_vocals: bool = True  # keep laughs/screams/breaths outside dubbed lines
    crossfade_ms: float = 40.0
    speech_mute_pad_ms: float = 60.0
    loudness_match: bool = True  # each dubbed line matches the original line's loudness
    background_gain_db: float = 0.0
    dub_gain_db: float = 0.0
    limiter: bool = True
    keep_original_track: bool = True
    export_srt: bool = True
    burn_subtitles: bool = False
    audio_codec: str = "aac"
    audio_bitrate: str = "256k"


@dataclass
class LipSyncConfig:
    backend: str = "none"  # none | wav2lip | musetalk | mock
    min_segment_seconds: float = 0.4
    pad_seconds: float = 0.12
    python: str | None = None  # interpreter for the lip-sync env (None = this one)
    # Wav2Lip
    wav2lip_repo: str = "third_party/Wav2Lip"
    wav2lip_checkpoint: str = "third_party/Wav2Lip/checkpoints/wav2lip_gan.pth"
    wav2lip_pads: list[int] = field(default_factory=lambda: [0, 12, 0, 0])
    wav2lip_batch_size: int = 64
    wav2lip_face_batch_size: int = 8
    wav2lip_smooth_frames: int = 5
    wav2lip_feather: float = 0.15  # soft blend border as fraction of the face box
    # MuseTalk
    musetalk_repo: str = "third_party/MuseTalk"
    musetalk_version: str = "v15"
    musetalk_batch_size: int = 8
    musetalk_float16: bool = True
    musetalk_tasks_per_run: int = 40
    musetalk_ffmpeg_dir: str | None = None
    # final video encode
    video_codec: str = "auto"  # auto (NVENC if available) | libx264 | h264_nvenc | hevc_nvenc
    crf: int = 17


@dataclass
class LiveVideoConfig:
    monitor: int = 1  # mss monitor index (1 = primary)
    region: list[int] | None = None  # [left, top, width, height] to capture only the player
    fps: float = 24.0
    delay_seconds: float = 12.0
    scale: float = 1.0
    output: str = "window"  # window | virtualcam
    lipsync: bool = False  # experimental: Wav2Lip on the delayed frames


@dataclass
class LiveConfig:
    input_device: str = "CABLE Output"  # substring match; VB-Cable output = what the player plays
    output_device: str | None = None  # None = system default speakers/headphones
    samplerate: int = 48000
    block_ms: int = 20
    background_mode: str = "duck"  # duck | center_cancel | mute | passthrough
    duck_db: float = -16.0
    original_gain_db: float = 0.0
    dub_gain_db: float = 0.0
    asr_model: str = "large-v3-turbo"
    asr_compute_type: str = "float16"
    vad_threshold: float = 0.5
    min_silence_ms: int = 350
    min_utterance_seconds: float = 0.5
    max_utterance_seconds: float = 8.0
    speaker_tracking: bool = True
    speaker_similarity: float = 0.6
    tts_streaming: bool = True
    max_queue_seconds: float = 6.0  # drop stale lines if we fall this far behind
    show_subtitles: bool = True
    video: LiveVideoConfig = field(default_factory=LiveVideoConfig)


@dataclass
class DubConfig:
    source_lang: str = "auto"
    target_lang: str = "de"
    general: GeneralConfig = field(default_factory=GeneralConfig)
    separation: SeparationConfig = field(default_factory=SeparationConfig)
    asr: ASRConfig = field(default_factory=ASRConfig)
    translation: TranslationConfig = field(default_factory=TranslationConfig)
    emotion: EmotionConfig = field(default_factory=EmotionConfig)
    tts: TTSConfig = field(default_factory=TTSConfig)
    timing: TimingConfig = field(default_factory=TimingConfig)
    mix: MixConfig = field(default_factory=MixConfig)
    lipsync: LipSyncConfig = field(default_factory=LipSyncConfig)
    live: LiveConfig = field(default_factory=LiveConfig)

    # ------------------------------------------------------------------ helpers

    def to_dict(self) -> dict[str, Any]:
        return dataclasses.asdict(self)

    def section_hash(self, *names: str, extra: Any = None) -> str:
        """Stable hash of some config sections; used to invalidate stage caches."""
        data = self.to_dict()
        payload = {n: data[n] if n in data else getattr(self, n) for n in names}
        payload["_extra"] = extra
        blob = json.dumps(payload, sort_keys=True, default=str).encode()
        return hashlib.sha1(blob).hexdigest()[:16]

    def path(self, value: str | os.PathLike | None) -> Path | None:
        return resolve_path(value)

    def save(self, path: str | os.PathLike) -> None:
        data = self.to_dict()
        data["general"]["hf_token"] = None  # never write secrets to disk
        Path(path).write_text(yaml.safe_dump(data, sort_keys=False, allow_unicode=True), encoding="utf-8")


# --------------------------------------------------------------------------- loading


def resolve_path(value: str | os.PathLike | None) -> Path | None:
    """Relative paths in the config are relative to the project root, not the CWD."""
    if value is None or value == "":
        return None
    p = Path(os.path.expandvars(os.path.expanduser(str(value))))
    return p if p.is_absolute() else (PROJECT_ROOT / p)


def _coerce(value: Any, hint: Any, where: str) -> Any:
    if is_dataclass(hint):
        if not isinstance(value, dict):
            raise ConfigError(f"{where}: expected a mapping, got {type(value).__name__}")
        return _build(hint, value, where)
    origin = get_origin(hint)
    args = get_args(hint)
    if value is None:
        return None
    if origin is None:
        if hint is float and isinstance(value, int) and not isinstance(value, bool):
            return float(value)
        if hint is int and isinstance(value, float) and value.is_integer():
            return int(value)
        if hint in (int, float, str, bool) and not isinstance(value, hint):
            raise ConfigError(f"{where}: expected {hint.__name__}, got {value!r}")
        return value
    # Optional[X] / X | None
    non_none = [a for a in args if a is not type(None)]
    if origin in (list, dict):
        return value
    if len(non_none) == 1:
        return _coerce(value, non_none[0], where)
    return value


def _build(cls: type, data: dict[str, Any], where: str = "") -> Any:
    hints = get_type_hints(cls)
    known = {f.name for f in fields(cls)}
    kwargs: dict[str, Any] = {}
    for key, value in data.items():
        if key not in known:
            close = difflib.get_close_matches(key, known, n=1)
            hint = f" (did you mean '{close[0]}'?)" if close else ""
            raise ConfigError(f"Unknown config key '{where}{key}'{hint}")
        kwargs[key] = _coerce(value, hints[key], f"{where}{key}")
    return cls(**kwargs)


def deep_merge(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for k, v in (override or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict) and k not in ("glossary", "post_replace", "temperature_by_emotion"):
            out[k] = deep_merge(out[k], v)
        else:
            out[k] = v
    return out


def parse_override(expr: str) -> dict[str, Any]:
    """'tts.temperature=0.6' -> {'tts': {'temperature': 0.6}} (values parsed as YAML)."""
    if "=" not in expr:
        raise ConfigError(f"Override must look like key.path=value, got '{expr}'")
    key, raw = expr.split("=", 1)
    value = yaml.safe_load(raw) if raw.strip() != "" else ""
    node: dict[str, Any] = {}
    cur = node
    parts = key.strip().split(".")
    for p in parts[:-1]:
        cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value
    return node


def list_presets() -> list[str]:
    return sorted(p.stem for p in PRESET_DIR.glob("*.yaml"))


def _read_yaml(path: Path) -> dict[str, Any]:
    data = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    if not isinstance(data, dict):
        raise ConfigError(f"{path} must contain a mapping at the top level")
    return data


def load_config(
    config_path: str | os.PathLike | None = None,
    preset: str | None = None,
    overrides: list[str] | None = None,
    extra: dict[str, Any] | None = None,
) -> DubConfig:
    data: dict[str, Any] = {}
    default = CONFIG_DIR / "default.yaml"
    if default.exists():
        data = deep_merge(data, _read_yaml(default))
    for name in [p.strip() for p in (preset or "").split(",") if p.strip()]:  # "gpu_12gb,hollywood"
        preset_path = Path(name)
        if not preset_path.exists():
            preset_path = PRESET_DIR / f"{name}.yaml"
        if not preset_path.exists():
            raise ConfigError(f"Unknown preset '{name}'. Available: {', '.join(list_presets())}")
        data = deep_merge(data, _read_yaml(preset_path))
    if config_path:
        data = deep_merge(data, _read_yaml(Path(config_path)))
    if extra:
        data = deep_merge(data, extra)
    for expr in overrides or []:
        data = deep_merge(data, parse_override(expr))
    cfg = _build(DubConfig, data)
    if cfg.general.hf_token is None:
        cfg.general.hf_token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
    return cfg


def apply_runtime_env(cfg: DubConfig) -> None:
    """Environment switches that must be set before heavy libraries are imported."""
    models = resolve_path(cfg.general.models_dir)
    assert models is not None
    models.mkdir(parents=True, exist_ok=True)
    # Keep every downloaded model inside the project so the whole thing is self-contained.
    os.environ.setdefault("HF_HOME", str(models / "huggingface"))
    os.environ.setdefault("TORCH_HOME", str(models / "torch"))
    os.environ.setdefault("XDG_CACHE_HOME", str(models / "cache"))
    if cfg.general.offline:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_DATASETS_OFFLINE"] = "1"
    # No telemetry from any library, ever.
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")
    os.environ.setdefault("DO_NOT_TRACK", "1")
    os.environ.setdefault("GRADIO_ANALYTICS_ENABLED", "False")
