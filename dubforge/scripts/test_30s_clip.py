#!/usr/bin/env python
"""Dub a 30-second excerpt end-to-end and print a quality/speed report.

    # plumbing check without any ML models (seconds, any machine):
    python scripts/test_30s_clip.py --mock

    # real test on your own file, starting at 5:00, English -> German:
    python scripts/test_30s_clip.py "D:\\Videos\\my_movie.mkv" --start 300 --to de --preset gpu_12gb

    # same, with lip sync and an A/B listening file (original 30 s, then the dub):
    python scripts/test_30s_clip.py movie.mkv --start 300 --to de --lipsync wav2lip --ab
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dubforge.config import load_config, resolve_path  # noqa: E402
from dubforge.media import ffmpeg as ff  # noqa: E402
from dubforge.pipeline.batch import BatchDubber  # noqa: E402
from dubforge.utils.gpu import gpu_info, suggest_preset  # noqa: E402
from dubforge.utils.log import setup_logging  # noqa: E402


def make_ab(original: Path, dubbed: Path, out: Path) -> Path:
    """Original clip followed by the dubbed clip, with a beep in between."""
    ff.run(["-i", str(original), "-i", str(dubbed), "-f", "lavfi", "-i", "sine=f=1000:d=0.4",
            "-filter_complex",
            "[0:a:0]aresample=48000,aformat=channel_layouts=stereo[a0];"
            "[2:a]aresample=48000,aformat=channel_layouts=stereo,volume=0.2[b];"
            "[1:a:0]aresample=48000,aformat=channel_layouts=stereo[a1];"
            "[a0][b][a1]concat=n=3:v=0:a=1[out]",
            "-map", "[out]", "-c:a", "aac", "-b:a", "192k", str(out)], "A/B file")
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", nargs="?", help="a video you have the rights to process")
    ap.add_argument("--start", type=float, default=60.0, help="clip start in seconds")
    ap.add_argument("--duration", type=float, default=30.0)
    ap.add_argument("--from", dest="src", default="auto")
    ap.add_argument("--to", dest="tgt", default="de")
    ap.add_argument("--preset", default=None, help="default: chosen from your GPU's VRAM")
    ap.add_argument("--lipsync", choices=["none", "wav2lip", "musetalk"], default="none")
    ap.add_argument("--set", action="append", default=[])
    ap.add_argument("--mock", action="store_true", help="no models: synthetic clip + mock backends")
    ap.add_argument("--ab", action="store_true", help="also write an A/B listening file")
    args = ap.parse_args()
    setup_logging("INFO")

    clips = (resolve_path("work") or ROOT / "work") / "test_clips"
    clips.mkdir(parents=True, exist_ok=True)
    if args.mock:
        from dubforge.utils.synth import make_test_video

        clip = make_test_video(clips / "synthetic_30s.mp4", duration=args.duration)
        preset = "mock"
        overrides = [f"target_lang={args.tgt}", "lipsync.backend=mock"]
    else:
        if not args.input:
            ap.error("give an input video, or use --mock")
        src = Path(args.input).expanduser()
        info = ff.probe(src)
        start = min(args.start, max(0.0, info.duration - args.duration))
        clip = clips / f"{src.stem[:40]}_{int(start)}s_{int(args.duration)}s.mp4"
        if not clip.exists():
            print(f"Cutting {args.duration:.0f}s from {src.name} at {start:.0f}s ...")
            ff.cut_video(src, clip, start, start + args.duration)
        preset = args.preset or suggest_preset()
        overrides = [f"source_lang={args.src}", f"target_lang={args.tgt}", f"lipsync.backend={args.lipsync}"]
    cfg = load_config(preset=preset, overrides=overrides + args.set)

    g = gpu_info()
    print(f"GPU: {g.get('name', 'none')} {g.get('vram_gb', '')} GB | preset: {preset}")
    t0 = time.perf_counter()
    res = BatchDubber(cfg, progress=lambda f, m: print(f"\r{int(f * 100):3d}% {m[:90]:90s}", end="", flush=True)).run(clip)
    elapsed = time.perf_counter() - t0
    print()

    report = json.loads((res.workdir / "report.json").read_text(encoding="utf-8"))
    segs = res.transcript.segments if res.transcript else []
    print("\n================ 30-second test report ================")
    print(f"clip:        {clip}")
    print(f"output:      {res.output}")
    print(f"work folder: {res.workdir}")
    print(f"lines:       {len(segs)}   speakers: {', '.join(report.get('speakers', []))}")
    print(f"time:        {elapsed:.1f}s total  ->  {elapsed / args.duration:.1f}x real time "
          f"(~{elapsed / args.duration * 2:.1f} h for a 2-hour film, first run incl. model loading)")
    print(f"peak VRAM:   {res.peak_vram_gb} GB")
    print("stages:      " + ", ".join(f"{k} {v:.1f}s" for k, v in res.timings.items() if k != "total"))
    print("\nlines:")
    for s in segs:
        flag = f"  [{s.fit_notes}]" if s.fit_notes else ""
        print(f"  {s.speech_start:6.2f}s {s.speaker} ({s.emotion or '-'}): {s.text}")
        print(f"          -> {s.tts_text or s.translation}{flag}")
    if args.ab and res.output.suffix:
        ab = make_ab(clip, res.output, res.output.with_name(res.output.stem + ".AB.m4a"))
        print(f"\nA/B listening file: {ab}")
    print("\nTip: edit script.json in the work folder and re-run with --set ... or `main.py batch ... --from-stage tts`.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
