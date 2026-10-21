"""`python main.py doctor` - what works on this machine and what to install."""
from __future__ import annotations

import importlib
import logging
import shutil
import sys
from pathlib import Path

from .config import Config
from .env import gpu_info
from .media import has_ffmpeg_filter

CHECKS = [
    ("faster_whisper", "transcription (faster-whisper)"),
    ("demucs", "music/voice separation (Demucs)"),
    ("transformers", "NLLB translation"),
    ("speechbrain", "speaker clustering (ECAPA)"),
    ("chatterbox", "voice cloning TTS (Chatterbox, 23 languages incl. Swedish)"),
    ("TTS", "XTTS-v2 (optional, non-commercial, no Swedish)"),
    ("librosa", "Wav2Lip audio front-end"),
    ("cv2", "video/face handling (opencv)"),
    ("gradio", "web GUI"),
    ("sounddevice", "live mode audio devices"),
    ("mss", "live mode screen capture (optional)"),
    ("pyvirtualcam", "live mode virtual camera (optional)"),
]


def run(cfg: Config) -> int:
    bad = 0
    print(f"python      {sys.version.split()[0]}")
    for tool in ("ffmpeg", "ffprobe"):
        ok = shutil.which(tool) is not None
        bad += not ok
        print(f"{tool:<11} {'OK' if ok else 'MISSING  -> install FFmpeg and add it to PATH'}")
    if shutil.which("ffmpeg"):
        print(f"{'rubberband':<11} {'OK (best time-stretch)' if has_ffmpeg_filter('rubberband') else 'not in this ffmpeg build - falling back to atempo (fine)'}")
    g = gpu_info()
    try:
        import torch
        print(f"torch       {torch.__version__}  cuda={torch.cuda.is_available()}")
    except ImportError:
        print("torch       MISSING (see README: install the CUDA build first)")
        bad += 1
    if g:
        print(f"GPU         {g['name']}  {g['vram_gb']} GB VRAM")
        c = Config()
        c.apply_profile(g["vram_gb"])
        print(f"  suggested: whisper={c.asr.model}/{c.asr.compute_type}  translate={c.translate.model}")
    else:
        print("GPU         none detected - CPU only works but is very slow (hours per film)")
    for mod, why in CHECKS:
        logging.disable(logging.CRITICAL)            # some libraries (SpeechBrain) log loudly on import
        try:
            importlib.import_module(mod)
            ok, err = True, None
        except Exception as e:
            ok, err = False, e
        finally:
            logging.disable(logging.NOTSET)
        if ok:
            print(f"{mod:<14} OK       {why}")
        else:
            opt = "optional" in why
            bad += not opt
            print(f"{mod:<14} {'skip' if opt else 'MISSING'}  {why}  ({type(err).__name__})")
    for label, p in (("Wav2Lip weights", cfg.lipsync.wav2lip_checkpoint), ("Wav2Lip repo", cfg.lipsync.wav2lip_repo),
                     ("face detector", cfg.lipsync.face_model)):
        print(f"{label:<16} {'OK' if Path(p).exists() else 'not found'}  ({p})")
    print("\nNext: python main.py models download   (needs internet once, then runs offline)")
    return 1 if bad else 0
