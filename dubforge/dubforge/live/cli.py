"""`python main.py live ...`"""
from __future__ import annotations

import threading
from pathlib import Path

from .. import registry
from ..env import gpu_info, setup_env
from ..languages import resolve, tts_supports


def run_live(cfg, a) -> int:
    from .audio_io import list_devices, run_devices, run_files
    from .core import LiveDubber

    if a.list_devices:
        print(list_devices())
        return 0
    setup_env(cfg)
    src, tgt = resolve(a.src), resolve(a.to)
    if not tts_supports(cfg.tts.backend, tgt.code):
        raise SystemExit(f"TTS backend {cfg.tts.backend!r} cannot speak {tgt.name}.")

    vram = gpu_info().get("vram_gb")
    if not a.mock and vram and vram < 12:
        # Live keeps ASR + MT + TTS resident at once: shrink the first two.
        cfg.asr.model, cfg.asr.compute_type = ("small", "int8_float16") if cfg.asr.model == "large-v3" else (cfg.asr.model, cfg.asr.compute_type)
        cfg.translate.model = "facebook/nllb-200-distilled-600M" if "1.3B" in cfg.translate.model else cfg.translate.model

    asr = registry.create("asr", cfg.asr.backend, cfg)
    tr = registry.create("translate", cfg.translate.backend, cfg)
    tts = registry.create("tts", cfg.tts.backend, cfg)
    for b in (asr, tr, tts):
        b.load()

    def show(src_text: str, dub_text: str) -> None:
        print(f"  {src_text}\n  -> {dub_text}\n", flush=True)

    engine = LiveDubber(cfg, asr, tr, tts, src.code, tgt.code, delay_s=a.delay, bed_gain=a.bed_gain,
                        offset_ms=a.sync_offset_ms, on_text=show)
    if a.video != "off":
        from .video_delay import run_viewer
        threading.Thread(target=run_viewer, kwargs={"delay_s": a.delay + a.sync_offset_ms / 1000, "mode": a.video,
                                                    "monitor": a.monitor}, daemon=True).start()
    try:
        if a.mock and a.in_dev and Path(a.in_dev).suffix == ".wav":     # offline simulation
            out = Path(cfg.output_dir) / "live_simulation.wav"
            out.parent.mkdir(parents=True, exist_ok=True)
            run_files(engine, Path(a.in_dev), out)
            print(f"simulation written to {out}\n{engine.stats.summary()}")
        else:
            run_devices(engine, a.in_dev, a.out_dev)
            print(engine.stats.summary())
    finally:
        for b in (asr, tr, tts):
            b.unload()
    return 0
