"""Process environment: keep every model cache inside the project, and enforce offline mode."""
from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

from .config import Config


def setup_env(cfg: Config, online: bool = False) -> None:
    """Point HF / torch caches at ./models so the whole tool is self-contained and portable.
    With cfg.offline (default) no library may touch the network; `models download` passes online=True."""
    models = Path(cfg.models_dir).resolve()
    models.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("HF_HOME", str(models / "hf"))
    os.environ.setdefault("TORCH_HOME", str(models / "torch"))
    os.environ.setdefault("SPEECHBRAIN_CACHE", str(models / "speechbrain"))
    os.environ.setdefault("TOKENIZERS_PARALLELISM", "false")
    if cfg.offline and not online:
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
    else:
        os.environ.pop("HF_HUB_OFFLINE", None)
        os.environ.pop("TRANSFORMERS_OFFLINE", None)
    try:
        # Importing torch first loads its bundled CUDA/cuDNN DLLs, which CTranslate2 (faster-whisper)
        # then reuses. Without this, Windows often fails with "cudnn_ops64_9.dll not found".
        import torch  # noqa: F401
    except ImportError:
        pass


def resolve_device(cfg: Config) -> str:
    if cfg.device != "auto":
        return cfg.device
    try:
        import torch
        return "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu"


def gpu_info() -> dict:
    """(name, total VRAM in GB) via torch, falling back to nvidia-smi. Empty dict if no GPU."""
    try:
        import torch
        if torch.cuda.is_available():
            p = torch.cuda.get_device_properties(0)
            return {"name": p.name, "vram_gb": round(p.total_memory / 1024 ** 3, 1)}
    except Exception:
        pass
    if shutil.which("nvidia-smi"):
        try:
            out = subprocess.run(["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                                 stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=10).stdout.decode()
            name, mem = out.strip().splitlines()[0].split(",")
            return {"name": name.strip(), "vram_gb": round(float(mem) / 1024, 1)}
        except Exception:
            pass
    return {}


def torch_device_str(cfg: Config) -> str:
    return resolve_device(cfg)
