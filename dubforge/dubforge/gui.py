"""Gradio web GUI (runs locally on http://127.0.0.1:7860, nothing leaves your machine)."""
from __future__ import annotations

import json
import traceback
from pathlib import Path

from . import registry
from .config import Config
from .languages import choices, resolve, tts_backends_for
from .pipeline import ALL_STAGES, DubPipeline
from .types import load_segments

# rough share of total wall-time per stage, for the progress bar
WEIGHTS = {"extract": .01, "separate": .07, "asr": .10, "diarize": .02, "emotion": .03, "translate": .05,
           "tts": .45, "mix": .03, "lipsync": .22, "mux": .02}
_ORDER = {s: i for i, s in enumerate(ALL_STAGES)}
COLS = ["id", "start", "end", "speaker", "emotion", "source", "translation", "skip"]


def _progress_fn(progress):
    def cb(stage: str, frac: float, msg: str = "") -> None:
        done = sum(w for s, w in WEIGHTS.items() if _ORDER[s] < _ORDER[stage])
        progress(min(0.999, done + WEIGHTS[stage] * frac), desc=f"{stage}: {msg}")
    return cb


def _make_config(base: Config, tts: str, translator: str, lipsync: str) -> Config:
    cfg = base.copy()
    cfg.tts.backend, cfg.translate.backend, cfg.lipsync.backend = tts, translator, lipsync
    return cfg


def _table(lang_dir: Path):
    segs, _ = load_segments(lang_dir / "segments.json")
    return [[s.id, round(s.start, 2), round(s.end, 2), s.speaker, s.emotion, s.text, s.translation, s.skip]
            for s in segs]


def _apply_table(lang_dir: Path, rows) -> None:
    segs, meta = load_segments(lang_dir / "segments.json")
    by_id = {s.id: s for s in segs}
    from .types import save_segments
    for r in (rows.values.tolist() if hasattr(rows, "values") else rows):
        s = by_id.get(int(r[0]))
        if s is not None:
            s.translation, s.skip = str(r[6] or ""), bool(r[7])
    save_segments(lang_dir / "segments.json", segs, meta)


def build(cfg: Config):
    import gradio as gr

    langs = choices()
    src_choices = [("Detect automatically", "auto")] + langs

    def check_tts(tts: str, target: str) -> str:
        ok = tts_backends_for(target)
        if tts != "mock" and tts not in ok:
            return (f"⚠️ {tts} cannot speak {resolve(target).name}. Use: {', '.join(ok) or 'no installed backend'}.")
        return ""

    def _resolve_video(upload, path_text) -> Path:
        p = (path_text or "").strip().strip('"') or upload
        if not p:
            raise gr.Error("Drop a video file or paste a path to one.")
        if not Path(p).exists():
            raise gr.Error(f"File not found: {p}")
        return Path(p)

    def analyse(upload, path_text, src, tgt, tts, translator, lipsync, progress=gr.Progress()):
        try:
            video = _resolve_video(upload, path_text)
            warn = check_tts(tts, tgt)
            if warn:
                raise gr.Error(warn)
            pl = DubPipeline(_make_config(cfg, tts, translator, lipsync), _progress_fn(progress))
            pl.run(video, tgt, src, until="translate")
            lang_dir = pl.job_dir(video) / resolve(tgt).code
            return _table(lang_dir), "Edit the **translation** column (tick *skip* to keep the original audio), then press *Voice & render*."
        except gr.Error:
            raise
        except Exception as e:
            raise gr.Error(f"{type(e).__name__}: {e}\n{traceback.format_exc()[-800:]}")

    def render(upload, path_text, src, tgt, tts, translator, lipsync, rows, progress=gr.Progress()):
        try:
            video = _resolve_video(upload, path_text)
            pl = DubPipeline(_make_config(cfg, tts, translator, lipsync), _progress_fn(progress))
            lang_dir = pl.job_dir(video) / resolve(tgt).code
            if rows is not None and len(rows) and (lang_dir / "segments.json").exists():
                _apply_table(lang_dir, rows)
            out = pl.run(video, tgt, src, redo_from="tts" if (lang_dir / "segments.json").exists() else None)
            rep = json.loads((lang_dir / "report.json").read_text())
            return str(out), rep, [str(out)] + [str(p) for p in (out.with_suffix(".srt"),) if p.exists()]
        except gr.Error:
            raise
        except Exception as e:
            raise gr.Error(f"{type(e).__name__}: {e}\n{traceback.format_exc()[-800:]}")

    def one_click(upload, path_text, src, tgt, tts, translator, lipsync, progress=gr.Progress()):
        video = _resolve_video(upload, path_text)
        warn = check_tts(tts, tgt)
        if warn:
            raise gr.Error(warn)
        try:
            pl = DubPipeline(_make_config(cfg, tts, translator, lipsync), _progress_fn(progress))
            out = pl.run(video, tgt, src)
            rep = json.loads((pl.job_dir(video) / resolve(tgt).code / "report.json").read_text())
            return str(out), rep, [str(out)] + [str(p) for p in (out.with_suffix(".srt"),) if p.exists()]
        except Exception as e:
            raise gr.Error(f"{type(e).__name__}: {e}\n{traceback.format_exc()[-800:]}")

    def devices() -> str:
        try:
            from .live.audio_io import list_devices
            return list_devices()
        except Exception as e:
            return f"Could not list audio devices: {e}"

    def doctor_text() -> str:
        import contextlib
        import io
        from . import doctor
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            doctor.run(cfg)
        return buf.getvalue()

    with gr.Blocks(title="DubForge") as demo:
        gr.Markdown("# DubForge — local AI dubbing\nEverything runs on this computer. "
                    "Only use footage you have the right to process, and voices you have the right to clone.")
        with gr.Tab("Dub a video"):
            with gr.Row():
                with gr.Column(scale=1):
                    upload = gr.Video(label="Drop a video (short clips)", sources=["upload"])
                    path_text = gr.Textbox(label="…or path to a video on this computer (best for full movies)",
                                           placeholder=r"C:\Videos\movie.mkv  or  /home/me/movie.mp4")
                    with gr.Row():
                        src = gr.Dropdown(src_choices, value="auto", label="Original language")
                        tgt = gr.Dropdown(langs, value="sv", label="Dub into")
                    with gr.Row():
                        tts = gr.Dropdown(["chatterbox", "xtts"], value=cfg.tts.backend if cfg.tts.backend in ("chatterbox", "xtts") else "chatterbox",
                                          label="Voice engine")
                        translator = gr.Dropdown(["nllb", "ollama"], value=cfg.translate.backend if cfg.translate.backend in ("nllb", "ollama") else "nllb",
                                                 label="Translator")
                        lipsync = gr.Dropdown(["none", "wav2lip", "musetalk"], value=cfg.lipsync.backend, label="Lip-sync")
                    warn = gr.Markdown()
                    tgt.change(check_tts, [tts, tgt], warn)
                    tts.change(check_tts, [tts, tgt], warn)
                    with gr.Row():
                        go = gr.Button("Dub it (no review)", variant="primary")
                        step1 = gr.Button("1 · Analyse & translate (review first)")
                with gr.Column(scale=1):
                    result = gr.Video(label="Dubbed result")
                    files = gr.File(label="Files", file_count="multiple")
                    report = gr.JSON(label="Quality report (lines that needed squeezing, failures…)")
            gr.Markdown("### Review the translation (optional but recommended for anything you care about)")
            table = gr.Dataframe(headers=COLS, datatype=["number", "number", "number", "str", "str", "str", "str", "bool"],
                                 interactive=True, wrap=True, label="Dialogue")
            hint = gr.Markdown()
            step2 = gr.Button("2 · Voice & render with my edits")
            args = [upload, path_text, src, tgt, tts, translator, lipsync]
            go.click(one_click, args, [result, report, files])
            step1.click(analyse, args, [table, hint])
            step2.click(render, args + [table], [result, report, files])

        with gr.Tab("Live (audio overlay)"):
            gr.Markdown("""
**Live mode runs from the terminal** (it needs low-latency audio threads):

```
python main.py live --list-devices
python main.py live --from en --to sv --in "CABLE Output" --out "Headphones" --delay 12
```
1. Install the free **VB-CABLE** driver. 2. Set Netflix/your browser's *output* to **CABLE Input** (it goes silent in
your speakers). 3. Run the command: it listens on **CABLE Output** and plays the dub to your headphones.

The dub can only start *after* a sentence has been spoken, so the show runs `--delay` seconds late.
Netflix video cannot be delayed to match (the screen capture of protected video is blank); expect the audio to
trail the picture by the delay unless you use a source you can delay (local file, non-protected video).
""")
            dev_btn = gr.Button("List audio devices")
            dev_out = gr.Textbox(label="Devices", lines=12)
            dev_btn.click(devices, None, dev_out)

        with gr.Tab("System check"):
            chk = gr.Button("Run doctor")
            chk_out = gr.Textbox(lines=22, label="Result")
            chk.click(doctor_text, None, chk_out)
    return demo


def launch(cfg: Config, port: int = 7860, share: bool = False) -> None:
    from .env import setup_env
    setup_env(cfg)
    demo = build(cfg)
    demo.queue().launch(server_name="127.0.0.1", server_port=port, share=False, inbrowser=True)
