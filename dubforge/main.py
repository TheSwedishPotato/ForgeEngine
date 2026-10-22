#!/usr/bin/env python
"""DubForge - local AI dubbing. See README.md.

  python main.py doctor
  python main.py models download
  python main.py dub movie.mp4 --to sv                  # batch: whole film
  python main.py dub movie.mp4 --to de --from en --lipsync wav2lip --review
  python main.py gui
  python main.py live --list-devices
  python main.py live --from en --to sv --in "CABLE Output" --out "Speakers"
"""
from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from dubforge.config import Config, parse_override

MOCK = {"separate.backend": "none", "asr.backend": "energy_mock", "diarize.backend": "single",
        "emotion.backend": "none", "translate.backend": "passthrough", "tts.backend": "mock"}


def build_config(a: argparse.Namespace) -> Config:
    """Precedence (low -> high): built-in defaults, VRAM profile, YAML file, --mock, flags, --set."""
    cfg = Config()
    mock = getattr(a, "mock", False)
    if getattr(a, "profile", "auto") == "auto" and not mock:
        from dubforge.env import gpu_info
        g = gpu_info()
        cfg.apply_profile(g.get("vram_gb")) if g else cfg.apply_cpu_profile()
    if a.config:
        cfg.merge_file(a.config)
    if mock:
        for k, v in MOCK.items():
            cfg.set(k, v)
    flag_map = {"tts": "tts.backend", "translator": "translate.backend", "lipsync": "lipsync.backend",
                "asr_model": "asr.model", "device": "device", "work_dir": "work_dir", "output_dir": "output_dir"}
    for attr, key in flag_map.items():
        v = getattr(a, attr, None)
        if v is not None:
            cfg.set(key, v)
    for item in getattr(a, "set", None) or []:
        cfg.set(*parse_override(item))
    return cfg


def add_common(p: argparse.ArgumentParser) -> None:
    p.add_argument("--config", help="YAML config (see configs/default.yaml)")
    p.add_argument("--set", action="append", metavar="KEY=VALUE", help="override any config value, e.g. tts.cfg_weight=0.3")
    p.add_argument("--device", choices=["auto", "cuda", "cpu"])
    p.add_argument("--work-dir", dest="work_dir")
    p.add_argument("--output-dir", dest="output_dir")
    p.add_argument("--profile", default="auto", choices=["auto", "none"], help="auto-size models to your VRAM")
    p.add_argument("-v", "--verbose", action="store_true")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="dubforge", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    d = sub.add_parser("dub", help="dub a video file (batch mode)")
    d.add_argument("video")
    d.add_argument("--to", required=True, help="target language, e.g. sv, swedish, de")
    d.add_argument("--from", dest="src", default="auto", help="source language (default: detect)")
    d.add_argument("--tts", choices=["chatterbox", "xtts", "mock"])
    d.add_argument("--translator", choices=["nllb", "ollama", "passthrough"])
    d.add_argument("--lipsync", choices=["none", "wav2lip", "musetalk"])
    d.add_argument("--asr-model", dest="asr_model")
    d.add_argument("--review", action="store_true", help="stop after translation so you can edit <work>/<lang>/segments.json, then re-run")
    d.add_argument("--redo", metavar="STAGE", help="re-run from this stage on")
    d.add_argument("--mock", action="store_true", help="CPU smoke test with fake models (no GPU, no downloads)")
    add_common(d)

    g = sub.add_parser("gui", help="open the web GUI")
    g.add_argument("--port", type=int, default=7860)
    g.add_argument("--share", action="store_true", help=argparse.SUPPRESS)
    add_common(g)

    lv = sub.add_parser("live", help="live audio-dub overlay (VB-Cable) [+ delayed video]")
    lv.add_argument("--list-devices", action="store_true")
    lv.add_argument("--from", dest="src", default="en")
    lv.add_argument("--to", default="sv")
    lv.add_argument("--in", dest="in_dev", default="CABLE Output", help="capture device (name substring)")
    lv.add_argument("--out", dest="out_dev", default=None, help="playback device (name substring); default = system default")
    lv.add_argument("--delay", type=float, default=12.0, help="seconds the whole show is delayed (dub needs this)")
    lv.add_argument("--bed-gain", type=float, default=0.0, help="level of the delayed original under the dub (0 = off)")
    lv.add_argument("--video", choices=["off", "window", "virtualcam"], default="off", help="delayed video viewer")
    lv.add_argument("--monitor", type=int, default=1, help="screen to capture for --video")
    lv.add_argument("--sync-offset-ms", type=float, default=0.0)
    lv.add_argument("--mock", action="store_true")
    add_common(lv)

    sub.add_parser("doctor", help="check the install").add_argument("--config")

    m = sub.add_parser("models", help="model management")
    m.add_argument("action", choices=["download"])
    m.add_argument("--only", nargs="+", help="whisper nllb chatterbox demucs speechbrain yunet wav2lip xtts")
    m.add_argument("--config")

    a = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if getattr(a, "verbose", False) else logging.INFO,
                        format="%(asctime)s %(levelname)s %(message)s", datefmt="%H:%M:%S")

    if a.cmd == "doctor":
        from dubforge import doctor
        return doctor.run(Config.load(a.config))
    if a.cmd == "models":
        from dubforge import models_dl
        cfg = Config()
        from dubforge.env import gpu_info
        g = gpu_info()
        cfg.apply_profile(g.get("vram_gb")) if g else cfg.apply_cpu_profile()     # fetch the Whisper size this machine will use
        if a.config:
            cfg.merge_file(a.config)
        res = models_dl.download(cfg, a.only)
        for k, v in res.items():
            print(f"{k:<12} {v}")
        return 0 if all(v == "ok" for v in res.values()) else 1

    cfg = build_config(a)
    if a.cmd == "dub":
        from dubforge.pipeline import DubPipeline
        out = DubPipeline(cfg).run(a.video, a.to, a.src, until="translate" if a.review else None, redo_from=a.redo)
        if a.review:
            from dubforge.languages import resolve
            pl = DubPipeline(cfg)
            seg = pl.job_dir(Path(a.video)) / resolve(a.to).code / "segments.json"
            print(f"\nReview/edit the translations in:\n  {seg}\n(fields: translation; set \"skip\": true to keep the original audio)\n"
                  f"then run the same command again without --review.")
        else:
            print(f"\nDone: {out}")
        return 0
    if a.cmd == "gui":
        from dubforge.gui import launch
        launch(cfg, port=a.port, share=a.share)
        return 0
    if a.cmd == "live":
        from dubforge.live.cli import run_live
        return run_live(cfg, a)
    return 1


if __name__ == "__main__":
    sys.exit(main())
