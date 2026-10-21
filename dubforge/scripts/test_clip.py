#!/usr/bin/env python
"""30-second smoke test of the whole pipeline.

  # real models, on your GPU (cut 30 s starting at 10 minutes in, dub into Swedish):
  python scripts/test_clip.py movie.mkv --start 00:10:00 --to sv

  # same with lip-sync, 2 speakers known:
  python scripts/test_clip.py movie.mkv --start 00:10:00 --to de --lipsync wav2lip --set diarize.num_speakers=2

  # no GPU, no downloads: synthetic clip + fake models (checks FFmpeg + orchestration only)
  python scripts/test_clip.py --mock

Exit code 0 = every check passed. Checks: output exists, duration matches, dubbed track present,
nothing overran its slot, and most lines were actually voiced.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import numpy as np                       # noqa: E402
import soundfile as sf                   # noqa: E402

from dubforge.config import Config, parse_override   # noqa: E402
from dubforge.media import cut_clip, probe             # noqa: E402
from dubforge.pipeline import DubPipeline              # noqa: E402

MOCK = {"separate.backend": "none", "asr.backend": "energy_mock", "diarize.backend": "single",
        "emotion.backend": "none", "translate.backend": "passthrough", "tts.backend": "mock"}


def synthetic_clip(dst: Path, seconds: int = 30) -> Path:
    sr = 44100
    t = np.arange(seconds * sr) / sr
    x = 0.02 * np.sin(2 * np.pi * 220 * t)
    for a in range(2, seconds - 4, 6):
        m = (t >= a) & (t < a + 3.0)
        x[m] += 0.3 * np.sin(2 * np.pi * 150 * t[m]) * (0.6 + 0.4 * np.sin(2 * np.pi * 4 * t[m]))
    wav = dst.with_suffix(".wav")
    sf.write(wav, np.stack([x, x], 1).astype("float32"), sr)
    subprocess.run(["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", f"testsrc2=size=640x360:rate=25:duration={seconds}",
                    "-i", str(wav), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(dst)], check=True)
    return dst


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", nargs="?")
    ap.add_argument("--start", default="0", help="start time, seconds or HH:MM:SS")
    ap.add_argument("--seconds", type=float, default=30.0)
    ap.add_argument("--to", default="sv")
    ap.add_argument("--from", dest="src", default="auto")
    ap.add_argument("--lipsync", default=None, choices=["none", "wav2lip", "musetalk"])
    ap.add_argument("--config")
    ap.add_argument("--set", action="append", default=[])
    ap.add_argument("--mock", action="store_true", help="synthetic clip + fake models, CPU only")
    a = ap.parse_args()

    cfg = Config()
    if not a.mock:
        from dubforge.env import gpu_info
        cfg.apply_profile(gpu_info().get("vram_gb"))
    if a.config:
        cfg.merge_file(a.config)
    cfg.work_dir, cfg.output_dir = str(ROOT / "work" / "test_clip"), str(ROOT / "output" / "test_clip")
    Path(cfg.work_dir).mkdir(parents=True, exist_ok=True)
    if a.mock:
        for k, v in MOCK.items():
            cfg.set(k, v)
        clip = synthetic_clip(Path(cfg.work_dir) / "synthetic.mp4", int(a.seconds))
    else:
        if not a.video:
            ap.error("give a video file, or use --mock")
        clip = cut_clip(a.video, Path(cfg.work_dir) / "clip.mp4", _secs(a.start), a.seconds)
    if a.lipsync:
        cfg.set("lipsync.backend", a.lipsync)
    for item in a.set:
        cfg.set(*parse_override(item))

    pl = DubPipeline(cfg)
    out = pl.run(clip, a.to, a.src)
    lang_dir = pl.job_dir(clip) / a.to
    report = json.loads((lang_dir / "report.json").read_text())

    src_info, out_info = probe(clip), probe(out)
    checks = {
        "output file exists": out.exists(),
        "duration within 0.5 s of the input": abs(out_info.duration - src_info.duration) < 0.5,
        "dubbed audio track present": out_info.audio_streams >= 1 and out_info.audio_lang is not None,
        "at least one line voiced": report["lines_dubbed"] > 0,
        "no line overran into the next": report["overrun"] == 0,
        "most lines voiced (>=80%)": report["lines_dubbed"] >= 0.8 * max(1, report["lines_total"] - report["lines_left_original"]),
    }
    print("\n=== report ===")
    print(json.dumps({k: v for k, v in report.items() if k != "problem_lines"}, indent=1))
    for p in report["problem_lines"][:8]:
        print("  needs a look:", p)
    print("\n=== checks ===")
    for name, ok in checks.items():
        print(f"  [{'PASS' if ok else 'FAIL'}] {name}")
    print(f"\nDubbed clip:  {out}\nSubtitles:    {out.with_suffix('.srt')}\nWork files:   {lang_dir}")
    return 0 if all(checks.values()) else 1


def _secs(s: str) -> float:
    parts = [float(p) for p in s.split(":")]
    return sum(p * 60 ** i for i, p in enumerate(reversed(parts)))


if __name__ == "__main__":
    sys.exit(main())
