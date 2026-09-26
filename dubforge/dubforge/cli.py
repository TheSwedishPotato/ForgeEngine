"""Command line interface.

    python main.py batch movie.mkv --to de                  # dub a file (best quality)
    python main.py batch movie.mkv --to de --lipsync wav2lip
    python main.py batch movie.mkv --to de --from-stage tts # after editing work/.../script.json
    python main.py live-audio --to en                       # while watching: VB-Cable audio overlay
    python main.py live-video --to en --delay 12            # while watching: delayed, in-sync video
    python main.py gui                                      # local web UI
    python main.py doctor | devices | presets
"""

from __future__ import annotations

import argparse
import json
import sys

from . import __version__
from .config import ConfigError, list_presets, load_config
from .utils.log import setup_logging


def _common(p: argparse.ArgumentParser) -> None:
    p.add_argument("--preset", help=f"one or more of: {', '.join(list_presets())} (comma separated)")
    p.add_argument("--config", help="your own YAML config (overrides preset)")
    p.add_argument("--set", action="append", default=[], metavar="KEY=VALUE",
                   help="override any setting, e.g. --set tts.temperature=0.6 (repeatable)")
    p.add_argument("--from", dest="src", help="source language (default: auto-detect)")
    p.add_argument("--to", dest="tgt", help="target language, e.g. de, en, fr, es, ja")
    p.add_argument("--device", help="cuda | cuda:1 | cpu")
    p.add_argument("--offline", action="store_true", help="forbid all network access for model loading")
    p.add_argument("-v", "--verbose", action="store_true")


def _load(args: argparse.Namespace, extra: list[str] | None = None):
    overrides = list(extra or [])
    if args.src:
        overrides.append(f"source_lang={args.src}")
    if args.tgt:
        overrides.append(f"target_lang={args.tgt}")
    if args.device:
        overrides.append(f"general.device={args.device}")
    if args.offline:
        overrides.append("general.offline=true")
    overrides += args.set
    cfg = load_config(args.config, args.preset, overrides)
    setup_logging("DEBUG" if args.verbose else cfg.general.log_level)
    return cfg


def cmd_batch(args) -> int:
    extra = []
    if args.lipsync:
        extra.append(f"lipsync.backend={args.lipsync}")
    if args.tts:
        extra.append(f"tts.backend={args.tts}")
    if args.translator:
        extra.append(f"translation.backend={args.translator}")
    cfg = _load(args, extra)
    from .pipeline.batch import BatchDubber

    last = {"p": -1}

    def progress(frac: float, msg: str) -> None:
        pct = int(frac * 100)
        if pct != last["p"]:
            last["p"] = pct
            print(f"\r{pct:3d}% {msg[:100]:100s}", end="", flush=True)

    res = BatchDubber(cfg, progress=progress).run(args.input, args.output, args.from_stage, args.to_stage)
    print()
    print(f"\nOutput:      {res.output}")
    print(f"Work folder: {res.workdir}   (edit script.json there, then re-run with --from-stage tts)")
    print("Timings:     " + ", ".join(f"{k} {v:.0f}s" for k, v in res.timings.items()))
    if res.peak_vram_gb:
        print(f"Peak VRAM:   {res.peak_vram_gb} GB")
    return 0


def cmd_live_audio(args) -> int:
    extra = []
    if args.input_device:
        extra.append(f"live.input_device={json.dumps(args.input_device)}")
    if args.output_device:
        extra.append(f"live.output_device={json.dumps(args.output_device)}")
    if args.background:
        extra.append(f"live.background_mode={args.background}")
    cfg = _load(args, extra)
    from .live.audio_overlay import LiveAudioDubber

    LiveAudioDubber(cfg, on_event=_print_event).run_forever()
    return 0


def cmd_live_video(args) -> int:
    extra = [f"live.video.delay_seconds={args.delay}"]
    if args.region:
        extra.append(f"live.video.region=[{args.region}]")
    if args.monitor:
        extra.append(f"live.video.monitor={args.monitor}")
    if args.output:
        extra.append(f"live.video.output={args.output}")
    if args.lipsync:
        extra.append("live.video.lipsync=true")
    if args.input_device:
        extra.append(f"live.input_device={json.dumps(args.input_device)}")
    if args.output_device:
        extra.append(f"live.output_device={json.dumps(args.output_device)}")
    cfg = _load(args, extra)
    from .live.video_buffer import LiveVideoDubber

    LiveVideoDubber(cfg, on_event=_print_event).run_forever()
    return 0


def _print_event(e: dict) -> None:
    if e["type"] == "line":
        extra = f"+{e['latency']}s" if "latency" in e else f"headroom {e.get('headroom')}s"
        print(f"[{e['speaker']}] {e['source']}\n     -> {e['text']}   ({extra})", flush=True)
    else:
        print(f"· {e['type']}: {e.get('message') or e.get('text') or e.get('reason', '')}", flush=True)


def cmd_gui(args) -> int:
    setup_logging("DEBUG" if args.verbose else "INFO")
    from .gui.app import launch

    launch(args.preset, args.port)
    return 0


def cmd_doctor(args) -> int:
    cfg = _load(args)
    from .doctor import run

    return run(cfg)


def cmd_devices(args) -> int:
    from .live.devices import describe

    print(describe())
    return 0


def cmd_presets(args) -> int:
    for p in list_presets():
        print(p)
    return 0


def cmd_download(args) -> int:
    extra = []
    if args.hf_token:
        extra.append(f"general.hf_token={args.hf_token}")
    cfg = _load(args, extra)
    from .models import download_all

    langs = [l.strip() for l in (args.languages or "en,de").split(",") if l.strip()]
    res = download_all(cfg, args.only.split(",") if args.only else None, langs, args.accept_coqui_license,
                       args.lipsync, args.seamless)
    print("\n" + "\n".join(f"  {'✔' if ok else '✘'} {k}" for k, ok in res.items()))
    print("\nWhen everything you need is ✔, set `general: {offline: true}` in configs/default.yaml.")
    return 0 if all(res.values()) else 1


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="dubforge", description="Private, local AI dubbing.")
    ap.add_argument("--version", action="version", version=f"DubForge {__version__}")
    sub = ap.add_subparsers(dest="cmd", required=True)

    b = sub.add_parser("batch", help="dub a video/audio file")
    b.add_argument("input")
    b.add_argument("-o", "--output")
    b.add_argument("--lipsync", choices=["none", "wav2lip", "musetalk", "mock"])
    b.add_argument("--tts", help="xtts | gpt_sovits | <plugin>")
    b.add_argument("--translator", help="nllb | seamless | local_llm | <plugin>")
    b.add_argument("--from-stage", help="re-run from this stage (e.g. tts after editing script.json)")
    b.add_argument("--to-stage", help="stop after this stage (e.g. translate, to review the script first)")
    _common(b)
    b.set_defaults(fn=cmd_batch)

    la = sub.add_parser("live-audio", help="while watching: dubbed audio overlay via virtual cable")
    la.add_argument("--input-device", help='device to listen on (default "CABLE Output")')
    la.add_argument("--output-device", help="speakers/headphones (default: system default)")
    la.add_argument("--background", choices=["duck", "center_cancel", "mute", "passthrough"])
    _common(la)
    la.set_defaults(fn=cmd_live_audio)

    lv = sub.add_parser("live-video", help="while watching: delayed, in-sync video dub (screen capture)")
    lv.add_argument("--delay", type=float, default=12.0)
    lv.add_argument("--region", help="left,top,width,height of the player on screen")
    lv.add_argument("--monitor", type=int)
    lv.add_argument("--output", choices=["window", "virtualcam"])
    lv.add_argument("--lipsync", action="store_true", help="experimental live Wav2Lip")
    lv.add_argument("--input-device")
    lv.add_argument("--output-device")
    _common(lv)
    lv.set_defaults(fn=cmd_live_video)

    g = sub.add_parser("gui", help="local web UI on http://127.0.0.1:7860")
    g.add_argument("--preset")
    g.add_argument("--port", type=int, default=7860)
    g.add_argument("-v", "--verbose", action="store_true")
    g.set_defaults(fn=cmd_gui)

    d = sub.add_parser("doctor", help="check GPU, packages, models, audio devices")
    _common(d)
    d.set_defaults(fn=cmd_doctor)

    dl = sub.add_parser("download-models", help="fetch all models once (then work offline)")
    dl.add_argument("--only", help="comma list: whisper,align,diarization,nllb,seamless,xtts,speechbrain,demucs,lipsync")
    dl.add_argument("--languages", help="languages to fetch word-alignment models for (default en,de)")
    dl.add_argument("--hf-token", help="Hugging Face token (only for pyannote diarization)")
    dl.add_argument("--accept-coqui-license", action="store_true")
    dl.add_argument("--lipsync", action="store_true", help="also set up Wav2Lip")
    dl.add_argument("--seamless", action="store_true", help="also fetch SeamlessM4T v2 (~10 GB)")
    _common(dl)
    dl.set_defaults(fn=cmd_download)

    sub.add_parser("devices", help="list audio devices").set_defaults(fn=cmd_devices)
    sub.add_parser("presets", help="list config presets").set_defaults(fn=cmd_presets)
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        return args.fn(args)
    except ConfigError as e:
        print(f"Config error: {e}", file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        return 130
