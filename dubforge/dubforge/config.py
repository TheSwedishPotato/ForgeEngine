"""Configuration: nested dataclasses, loaded from YAML, strictly validated (typos raise)."""
from __future__ import annotations

import copy
from dataclasses import dataclass, field, fields, is_dataclass, asdict
from pathlib import Path
from typing import Any

import yaml


@dataclass
class SeparateCfg:
    backend: str = "demucs"          # demucs | none
    model: str = "htdemucs"
    chunk_s: float = 240.0           # process long films in chunks (RAM)
    pad_s: float = 3.0               # context either side of each chunk, discarded after
    shifts: int = 1                  # >1 = better quality, slower


@dataclass
class ASRCfg:
    backend: str = "faster_whisper"  # faster_whisper | energy_mock
    model: str = "large-v3"
    compute_type: str = "float16"    # float16 | int8_float16 | int8
    beam_size: int = 5
    vad: bool = True
    min_text_chars: int = 1


@dataclass
class SegmentationCfg:
    merge_gap_s: float = 0.35        # merge mid-sentence fragments closer than this
    max_segment_s: float = 12.0      # split anything longer (TTS + lip-sync work best short)


@dataclass
class DiarizeCfg:
    backend: str = "ecapa"           # ecapa | single
    num_speakers: int | None = None  # None = automatic
    threshold: float = 0.70          # cosine-distance cut (calibrated on 12 LibriSpeech speakers; 0.55 split one actor in two)
    min_seg_s: float = 0.8


@dataclass
class EmotionCfg:
    backend: str = "wav2vec2"        # wav2vec2 | none
    model: str = "superb/wav2vec2-base-superb-er"   # Apache-2.0, IEMOCAP 4-class


@dataclass
class TranslateCfg:
    backend: str = "nllb"            # nllb | ollama | passthrough
    model: str = "facebook/nllb-200-distilled-1.3B"
    beams: int = 4
    batch_size: int = 16
    ollama_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "qwen2.5:14b-instruct"
    context_lines: int = 2           # ollama: previous lines given as context


@dataclass
class TTSCfg:
    backend: str = "chatterbox"      # chatterbox | xtts | mock
    reference_mode: str = "auto"     # auto | segment | speaker
    min_own_ref_s: float = 3.0       # auto: use the line's own audio as reference if >= this
    ref_max_s: float = 12.0
    retries: int = 2                 # regenerate if TTS output looks broken
    cfg_weight: float = 0.5          # chatterbox pacing/adherence
    temperature: float = 0.8
    base_exaggeration: float = 0.5
    max_chars: int = 240             # split longer text into chunks
    xtts_model: str = "tts_models/multilingual/multi-dataset/xtts_v2"
    chatterbox_t3: str = "v3"      # ignored by chatterbox-tts 0.1.7, used by newer releases


@dataclass
class FitCfg:
    max_speedup: float = 1.20        # preferred limit when squeezing speech into the slot
    hard_speedup: float = 1.40       # absolute limit (above this we flag + overlap)
    max_spill_s: float = 0.6         # allowed overflow into the silence after a line
    min_gap_s: float = 0.08
    match_loudness: bool = True      # whispers stay whispers, shouts stay shouts
    loudness_offset_db: float = 0.0


@dataclass
class MixCfg:
    dub_gain_db: float = 0.0
    accompaniment_gain_db: float = 0.0
    residual_vocals_gain: float = 0.8   # keep grunts/screams/laughs the transcript missed
    residual_pad_s: float = 0.25
    keep_original_track: bool = True    # original audio as 2nd track in the output file
    audio_bitrate: str = "256k"


@dataclass
class LipSyncCfg:
    backend: str = "none"            # none | wav2lip | musetalk
    max_clip_s: float = 6.0          # frames of one window are held in RAM
    min_face_px: int = 72            # ignore faces smaller than this (wide shots)
    wav2lip_repo: str = "third_party/Wav2Lip"
    wav2lip_checkpoint: str = "models/wav2lip/wav2lip_gan.pth"
    wav2lip_batch: int = 64
    face_model: str = "models/face/face_detection_yunet_2023mar.onnx"
    musetalk_repo: str = "third_party/MuseTalk"
    musetalk_python: str = ""        # python of the MuseTalk env (it needs its own env)
    musetalk_version: str = "v15"


@dataclass
class VideoCfg:
    encoder: str = "libx264"         # libx264 | h264_nvenc | libx265
    crf: int = 16
    preset: str = "medium"


@dataclass
class Config:
    device: str = "auto"             # auto | cuda | cpu
    work_dir: str = "work"
    output_dir: str = "output"
    models_dir: str = "models"
    offline: bool = True             # block all network access to model hubs
    separate: SeparateCfg = field(default_factory=SeparateCfg)
    asr: ASRCfg = field(default_factory=ASRCfg)
    segmentation: SegmentationCfg = field(default_factory=SegmentationCfg)
    diarize: DiarizeCfg = field(default_factory=DiarizeCfg)
    emotion: EmotionCfg = field(default_factory=EmotionCfg)
    translate: TranslateCfg = field(default_factory=TranslateCfg)
    tts: TTSCfg = field(default_factory=TTSCfg)
    fit: FitCfg = field(default_factory=FitCfg)
    mix: MixCfg = field(default_factory=MixCfg)
    lipsync: LipSyncCfg = field(default_factory=LipSyncCfg)
    video: VideoCfg = field(default_factory=VideoCfg)

    # ------------------------------------------------------------------ io
    @classmethod
    def load(cls, path: str | Path | None = None, overrides: dict[str, Any] | None = None) -> "Config":
        cfg = cls()
        if path:
            cfg.merge_file(path)
        if overrides:
            _update(cfg, overrides)
        return cfg

    def merge_file(self, path: str | Path) -> None:
        _update(self, yaml.safe_load(Path(path).read_text(encoding="utf-8")) or {})

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def copy(self) -> "Config":
        return copy.deepcopy(self)

    def set(self, dotted: str, value: Any) -> None:
        _update(self, _nest(dotted, value))

    def apply_profile(self, vram_gb: float | None) -> None:
        """Pick model sizes that fit the card. Stages run one at a time, so peak VRAM is the
        largest single stage (Chatterbox/XTTS or Whisper), not the sum."""
        if vram_gb is None:
            return
        if vram_gb < 6:
            self.asr.model, self.asr.compute_type = "medium", "int8_float16"
            self.translate.model = "facebook/nllb-200-distilled-600M"
        elif vram_gb < 10:
            self.asr.compute_type = "int8_float16"
        elif vram_gb >= 20:
            self.translate.model = "facebook/nllb-200-3.3B"


def _nest(dotted: str, value: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    cur = out
    parts = dotted.split(".")
    for p in parts[:-1]:
        cur[p] = {}
        cur = cur[p]
    cur[parts[-1]] = value
    return out


def _update(obj: Any, data: dict[str, Any]) -> None:
    valid = {f.name: f for f in fields(obj)}
    for key, val in data.items():
        if key not in valid:
            raise KeyError(f"Unknown config key {key!r} in {type(obj).__name__}; valid: {sorted(valid)}")
        cur = getattr(obj, key)
        if is_dataclass(cur):
            if not isinstance(val, dict):
                raise TypeError(f"Config section {key!r} must be a mapping")
            _update(cur, val)
        else:
            setattr(obj, key, val)


def parse_override(text: str) -> tuple[str, Any]:
    """'tts.cfg_weight=0.3' -> ('tts.cfg_weight', 0.3) using YAML scalar rules."""
    if "=" not in text:
        raise ValueError(f"--set expects key=value, got {text!r}")
    k, v = text.split("=", 1)
    return k.strip(), yaml.safe_load(v)
