"""MuseTalk 1.5 (higher quality, 256 px face region, latent-space inpainting).

MuseTalk pins old torch/mmcv versions, so it lives in its OWN conda env:
    git clone https://github.com/TMElyralab/MuseTalk third_party/MuseTalk
    (follow its README: conda env "musetalk", mim install mmcv/mmdet/mmpose,
     then download_weights.bat / download_weights.sh)
and in DubForge's config:
    lipsync: {backend: musetalk, python: C:/Users/you/miniconda3/envs/musetalk/python.exe}

We feed MuseTalk many clips per invocation through its YAML task list, so its
models are loaded once per batch instead of once per line.
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

from ..config import resolve_path
from .base import LipSyncBackend, log


class MuseTalkSync(LipSyncBackend):
    name = "musetalk"

    def repo(self) -> Path:
        p = resolve_path(self.cfg.musetalk_repo)
        assert p is not None
        return p

    def check(self) -> None:
        repo = self.repo()
        if not (repo / "scripts" / "inference.py").exists():
            raise FileNotFoundError(f"MuseTalk repo not found at {repo} (see README > Lip sync)")
        v = "musetalkV15" if self.cfg.musetalk_version == "v15" else "musetalk"
        if not (repo / "models" / v).exists():
            raise FileNotFoundError(f"MuseTalk weights missing in {repo / 'models'} (run its download_weights script)")
        if " " in str(repo):
            raise ValueError("MuseTalk's scripts break on paths with spaces; move the MuseTalk folder")

    def run(self, jobs, fps, workdir, progress=lambda f, m: None):
        self.check()
        repo = self.repo()
        # MuseTalk builds ffmpeg command lines without quoting -> keep its scratch space inside its own repo
        scratch = repo / "results" / f"dubforge_{hashlib.md5(str(workdir).encode()).hexdigest()[:8]}"
        scratch.mkdir(parents=True, exist_ok=True)
        todo = [j for j in jobs if not Path(j.out).exists()]
        v = self.cfg.musetalk_version
        model_dir = repo / "models" / ("musetalkV15" if v == "v15" else "musetalk")
        unet = model_dir / ("unet.pth" if v == "v15" else "pytorch_model.bin")
        per_run = max(1, self.cfg.musetalk_tasks_per_run)
        done = 0
        for r in range(0, len(todo), per_run):
            batch = todo[r: r + per_run]
            tasks = {}
            for j in batch:
                src = scratch / f"job_{j.id:05d}_src.mp4"
                aud = scratch / f"job_{j.id:05d}_dub.wav"
                shutil.copy(j.video, src)
                shutil.copy(j.audio, aud)
                tasks[f"task_{j.id}"] = {"video_path": str(src), "audio_path": str(aud),
                                         "result_name": f"job_{j.id:05d}_out.mp4"}
            cfg_path = scratch / f"tasks_{r:05d}.yaml"
            cfg_path.write_text(yaml.safe_dump(tasks))
            cmd = [self.cfg.python or sys.executable, "-m", "scripts.inference", "--inference_config", str(cfg_path),
                   "--result_dir", str(scratch), "--unet_model_path", str(unet.relative_to(repo)),
                   "--unet_config", str((model_dir / "musetalk.json").relative_to(repo)), "--version", v,
                   "--batch_size", str(self.cfg.musetalk_batch_size), "--fps", str(int(round(fps)))]
            if self.cfg.musetalk_float16:
                cmd.append("--use_float16")
            if self.cfg.musetalk_ffmpeg_dir:
                cmd += ["--ffmpeg_path", self.cfg.musetalk_ffmpeg_dir]
            log.info("MuseTalk: %d clips (batch %d)", len(batch), r // per_run + 1)
            proc = subprocess.run(cmd, cwd=str(repo), stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
                                  encoding="utf-8", errors="replace")
            if proc.returncode != 0:
                log.error("MuseTalk exited with %s:\n%s", proc.returncode, proc.stdout[-1500:])
            for j in batch:
                produced = scratch / v / f"job_{j.id:05d}_out.mp4"
                if produced.exists() and produced.stat().st_size > 0:
                    shutil.move(str(produced), j.out)
                else:
                    log.warning("MuseTalk produced nothing for clip %d (no face?); keeping original frames", j.id)
            done += len(batch)
            progress(done / max(1, len(todo)), f"lip sync {done}/{len(todo)} clips")
        return {j.id: j.out for j in jobs if Path(j.out).exists() and Path(j.out).stat().st_size > 0}
