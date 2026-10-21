"""MuseTalk (higher quality latent-space inpainting) via subprocess.

MuseTalk pins old torch/mmcv versions, so it lives in its OWN conda env; set
`lipsync.musetalk_python` to that env's python and `lipsync.musetalk_repo` to the checkout.
Each window is a separate process call (slow startup) - use for final renders, not drafts.

EXPERIMENTAL: written against MuseTalk's documented `scripts.inference` CLI; I could not run it
in the build sandbox (no GPU). Expect to adjust flags to your MuseTalk version.
"""
from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import yaml

from ..audio_utils import write_audio
from ..base import LipSync
from ..config import Config
from ..media import FrameReader, FrameWriter, MediaInfo
from fractions import Fraction


class MuseTalkSync(LipSync):
    name = "musetalk"

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def load(self) -> None:
        lc = self.cfg.lipsync
        if not lc.musetalk_python or not Path(lc.musetalk_python).exists():
            raise RuntimeError("Set lipsync.musetalk_python to the python executable of your MuseTalk env.")
        if not (Path(lc.musetalk_repo) / "scripts" / "inference.py").exists():
            raise RuntimeError(f"MuseTalk repo not found at {lc.musetalk_repo} (git clone https://github.com/TMElyralab/MuseTalk).")

    def sync_clip(self, frames: list[np.ndarray], audio_16k: np.ndarray, fps: float):
        lc = self.cfg.lipsync
        repo = Path(lc.musetalk_repo).resolve()
        h, w = frames[0].shape[:2]
        info = MediaInfo(Path("clip"), len(frames) / fps, True, w, h, Fraction(fps).limit_denominator(1001), 1, None)
        lossless = SimpleNamespace(encoder="libx264", crf=0, preset="ultrafast")
        with tempfile.TemporaryDirectory(prefix="musetalk_") as td:
            td = Path(td)
            vid, wav, res = td / "in.mp4", td / "in.wav", td / "out"
            with FrameWriter(vid, info, lossless) as fw:
                for f in frames:
                    fw.write(f)
            write_audio(wav, audio_16k, 16000)
            (td / "task.yaml").write_text(yaml.safe_dump({"task_0": {"video_path": str(vid), "audio_path": str(wav)}}))
            ver = lc.musetalk_version
            cmd = [lc.musetalk_python, "-m", "scripts.inference", "--inference_config", str(td / "task.yaml"),
                   "--result_dir", str(res), "--fps", str(int(round(fps))), "--version", ver]
            if ver == "v15":
                cmd += ["--unet_model_path", "models/musetalkV15/unet.pth",
                        "--unet_config", "models/musetalkV15/musetalk.json", "--use_float16"]
            p = subprocess.run(cmd, cwd=repo, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            outs = sorted(res.rglob("*.mp4"), key=lambda q: q.stat().st_mtime)
            if p.returncode != 0 or not outs:
                return None                                # no usable face / failure: keep the original frames
            with FrameReader(outs[-1], MediaInfo(outs[-1], 0, True, w, h, info.fps, 1, None)) as fr:
                got = list(fr)
        if not got:
            return None
        got = (got + [got[-1]] * len(frames))[: len(frames)]       # absorb +-1 frame drift
        return got
