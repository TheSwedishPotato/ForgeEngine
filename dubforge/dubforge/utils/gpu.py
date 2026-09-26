"""Device selection and VRAM hygiene.

Stages run one after another and each unloads its model, so an 8 GB card only
ever holds one large model at a time.
"""

from __future__ import annotations

import gc
from typing import Any

from .log import get_logger

log = get_logger("gpu")


def torch_available() -> bool:
    try:
        import torch  # noqa: F401
    except Exception:
        return False
    return True


def resolve_device(device: str = "auto") -> str:
    if device != "auto":
        return device
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def gpu_info() -> dict[str, Any]:
    info: dict[str, Any] = {"cuda": False}
    try:
        import torch
    except Exception:
        info["torch"] = None
        return info
    info["torch"] = torch.__version__
    info["cuda"] = torch.cuda.is_available()
    if info["cuda"]:
        idx = torch.cuda.current_device()
        props = torch.cuda.get_device_properties(idx)
        info.update(
            name=props.name,
            vram_gb=round(props.total_memory / 1024**3, 1),
            capability=f"{props.major}.{props.minor}",
            cuda_version=torch.version.cuda,
            cudnn=torch.backends.cudnn.version(),
            bf16=torch.cuda.is_bf16_supported(),
        )
    return info


def free_memory() -> None:
    gc.collect()
    try:
        import torch

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.ipc_collect()
    except Exception:
        pass


def vram_used_gb() -> float:
    try:
        import torch

        if torch.cuda.is_available():
            return torch.cuda.memory_allocated() / 1024**3
    except Exception:
        pass
    return 0.0


def peak_vram_gb(reset: bool = False) -> float:
    try:
        import torch

        if torch.cuda.is_available():
            v = torch.cuda.max_memory_allocated() / 1024**3
            if reset:
                torch.cuda.reset_peak_memory_stats()
            return v
    except Exception:
        pass
    return 0.0


def suggest_preset() -> str:
    info = gpu_info()
    if not info.get("cuda"):
        return "cpu"
    vram = info.get("vram_gb", 0)
    if vram >= 20:
        return "gpu_24gb"
    if vram >= 11:
        return "gpu_12gb"
    return "gpu_8gb"
