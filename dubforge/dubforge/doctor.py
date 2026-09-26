"""`python main.py doctor`: checks the environment and tells you exactly what's missing."""

from __future__ import annotations

import importlib
import importlib.metadata as md
import platform
import shutil
import sys

from .config import DubConfig, resolve_path
from .models import check_offline_ready, models_size_gb
from .utils.gpu import gpu_info, suggest_preset

PACKAGES = [
    ("torch", "core"), ("torchaudio", "core"), ("numpy", "core"), ("soundfile", "core"),
    ("faster_whisper", "ASR"), ("whisperx", "ASR + alignment + diarization"),
    ("transformers", "NLLB / SeamlessM4T"), ("sentencepiece", "NLLB tokenizer"),
    ("TTS", "Coqui XTTS-v2 (pip install coqui-tts)"), ("demucs", "dialogue separation"),
    ("speechbrain", "emotion + speaker embeddings"), ("silero_vad", "live VAD"),
    ("sounddevice", "live audio"), ("mss", "live screen capture"), ("cv2", "video / lip sync"),
    ("pyvirtualcam", "virtual camera (optional)"), ("gradio", "web UI"),
    ("audio_separator", "RoFormer separation (optional)"), ("pyrubberband", "best time-stretch (optional)"),
]

DIST_NAMES = {"TTS": "coqui-tts", "cv2": "opencv-python", "faster_whisper": "faster-whisper",
              "silero_vad": "silero-vad", "audio_separator": "audio-separator"}


def _version(mod: str) -> str | None:
    try:
        return md.version(DIST_NAMES.get(mod, mod))
    except md.PackageNotFoundError:
        try:
            m = importlib.import_module(mod)
            return getattr(m, "__version__", "installed")
        except Exception:
            return None


def run(cfg: DubConfig) -> int:
    ok = True
    print(f"Python {sys.version.split()[0]} on {platform.system()} {platform.release()}")
    if not (3, 10) <= sys.version_info[:2] <= (3, 12):
        print("  ! Python 3.10-3.12 recommended (3.11 is the tested version)")
    g = gpu_info()
    if g.get("cuda"):
        print(f"GPU: {g['name']} ({g['vram_gb']} GB, compute {g['capability']}), torch {g['torch']}, CUDA {g['cuda_version']}, cuDNN {g['cudnn']}")
        print(f"  -> suggested preset: --preset {suggest_preset()}")
    else:
        ok = False
        print(f"GPU: NOT AVAILABLE (torch {g.get('torch')}). Install the CUDA build of PyTorch - see README step 3.")
    for tool in (cfg.general.ffmpeg, cfg.general.ffprobe):
        path = shutil.which(tool)
        print(f"{tool}: {path or 'MISSING'}")
        ok &= bool(path)
    rb = shutil.which("rubberband")
    print(f"rubberband CLI: {rb or 'not found (optional; ffmpeg atempo / WSOLA fallback is used)'}")
    print("\nPython packages:")
    for mod, why in PACKAGES:
        v = _version(mod)
        print(f"  {'✔' if v else '✘'} {mod:16s} {v or 'missing':12s} {why}")
    models = resolve_path(cfg.general.models_dir)
    print(f"\nModels folder: {models} ({models_size_gb(cfg)} GB)")
    missing = check_offline_ready(cfg)
    if missing:
        print("  missing: " + ", ".join(missing) + "  ->  python scripts/download_models.py")
    for name, path in (("Wav2Lip", cfg.lipsync.wav2lip_repo), ("MuseTalk", cfg.lipsync.musetalk_repo)):
        p = resolve_path(path)
        print(f"{name}: {'found at ' + str(p) if p and p.exists() else 'not installed (optional, see README > Lip sync)'}")
    try:
        from .live.devices import list_devices

        cable = [d.name for d in list_devices() if "cable" in d.name.lower()]
        print(f"Virtual audio cable: {', '.join(sorted(set(cable))) if cable else 'not found (needed for live mode, see README)'}")
    except Exception as e:
        print(f"Audio devices: unavailable ({e})")
    print("\nAll good!" if ok else "\nSome required pieces are missing (see above).")
    return 0 if ok else 1
