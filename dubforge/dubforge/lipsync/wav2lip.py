"""Wav2Lip (fast, robust, 96 px mouth region).

Setup (once):
    git clone https://github.com/Rudrabha/Wav2Lip third_party/Wav2Lip
    # put wav2lip_gan.pth in third_party/Wav2Lip/checkpoints/
    # put s3fd.pth       in third_party/Wav2Lip/face_detection/detection/sfd/
Wav2Lip's own dependencies (opencv, librosa, scipy) are already in DubForge's env.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from ..config import resolve_path
from .base import LipSyncBackend, log

RUNNER = Path(__file__).with_name("wav2lip_runner.py")


class Wav2LipSync(LipSyncBackend):
    name = "wav2lip"

    def _paths(self) -> tuple[Path, Path]:
        repo, ckpt = resolve_path(self.cfg.wav2lip_repo), resolve_path(self.cfg.wav2lip_checkpoint)
        assert repo is not None and ckpt is not None
        return repo, ckpt

    def check(self) -> None:
        repo, ckpt = self._paths()
        if not (repo / "models" / "wav2lip.py").exists():
            raise FileNotFoundError(f"Wav2Lip repo not found at {repo} (see README > Lip sync)")
        if not ckpt.exists():
            raise FileNotFoundError(f"Wav2Lip checkpoint missing: {ckpt}")
        s3fd = repo / "face_detection" / "detection" / "sfd" / "s3fd.pth"
        if not s3fd.exists():
            raise FileNotFoundError(f"Face detector weights missing: {s3fd} (see README > Lip sync)")

    def run(self, jobs, fps, workdir, progress=lambda f, m: None):
        self.check()
        repo, ckpt = self._paths()
        todo = [j for j in jobs if not Path(j.out).exists()]
        if todo:
            jobs_file = workdir / "wav2lip_jobs.json"
            jobs_file.write_text(json.dumps([{"id": j.id, "video": j.video, "audio": j.audio, "out": j.out} for j in todo]))
            cmd = [self.cfg.python or sys.executable, str(RUNNER), "--repo", str(repo), "--checkpoint", str(ckpt),
                   "--jobs", str(jobs_file), "--pads", *map(str, self.cfg.wav2lip_pads),
                   "--batch-size", str(self.cfg.wav2lip_batch_size),
                   "--face-batch-size", str(self.cfg.wav2lip_face_batch_size),
                   "--smooth", str(self.cfg.wav2lip_smooth_frames), "--feather", str(self.cfg.wav2lip_feather),
                   "--device", "cuda" if self.device.startswith("cuda") else "cpu"]
            log.info("Running Wav2Lip on %d clips", len(todo))
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                    errors="replace")
            assert proc.stdout is not None
            for line in proc.stdout:
                line = line.strip()
                if line.startswith("PROGRESS"):
                    _, done, total = line.split()
                    progress(int(done) / max(1, int(total)), f"lip sync {done}/{total} clips")
                elif line:
                    log.debug("wav2lip: %s", line)
            if proc.wait() != 0:
                log.error("Wav2Lip runner exited with %s; clips without output keep original frames", proc.returncode)
        return {j.id: j.out for j in jobs if Path(j.out).exists() and Path(j.out).stat().st_size > 0}
