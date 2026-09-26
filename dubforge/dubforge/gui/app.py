"""Local web UI (Gradio). Binds to 127.0.0.1 only; nothing is shared or uploaded anywhere."""

from __future__ import annotations

import json
import threading
import traceback
from collections import deque
from pathlib import Path

from .. import registry
from ..config import list_presets, load_config, resolve_path
from ..translation.languages import choices as lang_choices
from ..types import Transcript
from ..utils.gpu import gpu_info, suggest_preset
from ..utils.log import get_logger

log = get_logger("gui")

PRESET = "(preset)"
SCRIPT_COLUMNS = ["id", "speaker", "start", "end", "emotion", "original", "translation", "keep_original", "notes"]


def _workdirs() -> list[str]:
    root = resolve_path(load_config().general.work_dir)
    if not root or not root.exists():
        return []
    return sorted((str(p) for p in root.iterdir() if (p / "script.json").exists()), key=lambda p: -Path(p).stat().st_mtime)


def build_app(default_preset: str | None = None):
    import gradio as gr

    presets = list_presets()
    default_preset = default_preset or suggest_preset()
    langs = lang_choices()
    live_state: dict = {"dubber": None, "events": deque(maxlen=300)}

    # ------------------------------------------------------------------ batch
    def run_batch(upload, path, src, tgt, preset, translator, tts, lipsync, keep_orig, burn, extra,
                  progress=gr.Progress()):
        from ..pipeline.batch import BatchDubber

        video = (path or "").strip().strip('"') or (upload if isinstance(upload, str) else getattr(upload, "name", None))
        if not video:
            raise gr.Error("Choose a video (a local path is best for big movies).")
        overrides = [f"source_lang={src}", f"target_lang={tgt}", f"mix.keep_original_track={keep_orig}",
                     f"mix.burn_subtitles={burn}"]
        for key, value in (("translation.backend", translator), ("tts.backend", tts), ("lipsync.backend", lipsync)):
            if value and value != PRESET:  # "(preset)" keeps whatever the chosen preset says
                overrides.append(f"{key}={value}")
        overrides += [l.strip() for l in (extra or "").splitlines() if l.strip()]
        cfg = load_config(preset=preset, overrides=overrides)
        try:
            res = BatchDubber(cfg, progress=lambda f, m: progress(f, desc=m)).run(video)
        except Exception as e:
            log.error(traceback.format_exc())
            raise gr.Error(str(e)) from e
        report = json.loads((res.workdir / "report.json").read_text(encoding="utf-8"))
        out = str(res.output)
        preview = out if out.lower().endswith((".mp4", ".webm", ".mov")) else None
        return preview, out, json.dumps(report, indent=2, ensure_ascii=False), str(res.workdir)

    # ------------------------------------------------------------------ script editor
    def load_script(wd):
        if not wd:
            return [], ""
        t = Transcript.load(Path(wd) / "script.json")
        rows = [[s.id, s.speaker, round(s.start, 2), round(s.end, 2), s.emotion or "", s.text, s.translation or "",
                 bool(s.keep_original), s.fit_notes] for s in t.segments]
        return rows, f"{len(rows)} lines, {len(t.speakers)} speakers ({t.language} -> {t.target_language})"

    def save_script(wd, table):
        if not wd:
            raise gr.Error("Pick a work folder first")
        path = Path(wd) / "script.json"
        t = Transcript.load(path)
        rows = table.values.tolist() if hasattr(table, "values") else table
        by_id = {s.id: s for s in t.segments}
        changed = 0
        for r in rows:
            s = by_id.get(int(r[0]))
            if s is None:
                continue
            new_tr, keep = str(r[6]).strip(), str(r[7]).lower() in ("true", "1", "yes")
            if new_tr != (s.translation or ""):
                s.translation, s.translation_locked = new_tr, True
                changed += 1
            if keep != s.keep_original:
                s.keep_original = keep
                changed += 1
            s.speaker = str(r[1]).strip() or s.speaker
        t.save(path)
        return f"Saved {changed} change(s). Click 'Re-render' to rebuild only those lines."

    def rerender(wd, progress=gr.Progress()):
        from ..pipeline.batch import BatchDubber

        job = json.loads((Path(wd) / "job.json").read_text(encoding="utf-8"))
        cfg = load_config(config_path=str(Path(wd) / "config.used.yaml"))
        res = BatchDubber(cfg, progress=lambda f, m: progress(f, desc=m)).run(job["input"], from_stage="tts")
        return str(res.output), str(res.output)

    # ------------------------------------------------------------------ live
    def live_devices():
        try:
            from ..live.devices import list_devices

            devs = list_devices()
            ins = [d.name for d in devs if d.max_input > 0]
            outs = ["(system default)"] + [d.name for d in devs if d.max_output > 0]
            return gr.update(choices=sorted(set(ins))), gr.update(choices=list(dict.fromkeys(outs)))
        except Exception as e:
            raise gr.Error(f"sounddevice not available: {e}") from e

    def live_start(mode, preset, src, tgt, in_dev, out_dev, bg_mode, delay, video_out, lip):
        if live_state["dubber"] is not None:
            return "already running"
        overrides = [f"source_lang={src}", f"target_lang={tgt}", f"live.background_mode={bg_mode}",
                     f"live.video.delay_seconds={delay}", f"live.video.output={video_out}", f"live.video.lipsync={lip}"]
        if in_dev:
            overrides.append(f"live.input_device={json.dumps(in_dev)}")
        if out_dev and out_dev != "(system default)":
            overrides.append(f"live.output_device={json.dumps(out_dev)}")
        cfg = load_config(preset=preset, overrides=overrides)
        ev = live_state["events"]
        push = ev.append
        if mode.startswith("Audio"):
            from ..live.audio_overlay import LiveAudioDubber as Cls
        else:
            from ..live.video_buffer import LiveVideoDubber as Cls  # type: ignore[assignment]
        dubber = Cls(cfg, on_event=push)
        live_state["dubber"] = dubber

        def _run():
            try:
                dubber.start()
            except Exception as e:
                push({"type": "error", "message": str(e)})
                live_state["dubber"] = None

        threading.Thread(target=_run, daemon=True).start()
        return "starting..."

    def live_stop():
        d = live_state["dubber"]
        if d is not None:
            d.stop()
            live_state["dubber"] = None
        return "stopped"

    def live_poll():
        lines = []
        for e in list(live_state["events"])[-40:]:
            if e["type"] == "line":
                extra = f"  (+{e['latency']}s)" if "latency" in e else f"  (headroom {e.get('headroom')}s)"
                lines.append(f"[{e['speaker']}] {e['source']}\n    -> {e['text']}{extra}")
            else:
                lines.append(f"· {e['type']}: {e.get('message') or e.get('text') or e.get('reason', '')}")
        return "\n".join(lines)

    # ------------------------------------------------------------------ layout
    with gr.Blocks(title="DubForge", analytics_enabled=False) as demo:
        gr.Markdown("# 🎬 DubForge — private, local AI dubbing\nEverything runs on this computer. "
                    "Use it only with videos you have the rights to process.")
        with gr.Tab("Batch dub (best quality)"):
            with gr.Row():
                with gr.Column():
                    path = gr.Textbox(label="Video path on this PC (recommended for movies)",
                                      placeholder=r"D:\Videos\my_movie.mkv")
                    upload = gr.File(label="...or upload a clip", file_types=["video", "audio"])
                    with gr.Row():
                        src = gr.Dropdown([("Auto-detect", "auto")] + langs, value="auto", label="From")
                        tgt = gr.Dropdown(langs, value="de", label="To")
                    preset = gr.Dropdown(presets, value=default_preset if default_preset in presets else None,
                                         label="Preset (GPU size / quality)")
                    with gr.Row():
                        translator = gr.Dropdown([PRESET] + registry.available("translator"), value=PRESET,
                                                 label="Translation")
                        tts = gr.Dropdown([PRESET] + registry.available("tts"), value=PRESET, label="Voice cloning")
                        lipsync = gr.Dropdown([PRESET] + registry.available("lipsync"), value=PRESET, label="Lip sync")
                    with gr.Row():
                        keep_orig = gr.Checkbox(True, label="Keep original audio track")
                        burn = gr.Checkbox(False, label="Burn in subtitles")
                    extra = gr.Textbox(label="Advanced overrides (one per line, e.g. tts.temperature=0.6)", lines=2)
                    go = gr.Button("Dub it", variant="primary")
                with gr.Column():
                    out_video = gr.Video(label="Result")
                    out_file = gr.File(label="Output file")
                    workdir = gr.Textbox(label="Work folder (script.json lives here)")
                    report = gr.Code(label="Report", language="json")
            go.click(run_batch, [upload, path, src, tgt, preset, translator, tts, lipsync, keep_orig, burn, extra],
                     [out_video, out_file, report, workdir])

        with gr.Tab("Edit script"):
            gr.Markdown("Fix translations, reassign speakers, or tick **keep_original** (songs, names). "
                        "Save, then re-render: only changed lines are re-voiced.")
            with gr.Row():
                wd_pick = gr.Dropdown(_workdirs(), label="Work folder", allow_custom_value=True)
                refresh = gr.Button("↻")
                load_btn = gr.Button("Load")
            info = gr.Markdown()
            table = gr.Dataframe(headers=SCRIPT_COLUMNS, interactive=True, wrap=True)
            with gr.Row():
                save_btn = gr.Button("Save edits")
                rerender_btn = gr.Button("Re-render from TTS", variant="primary")
            status = gr.Markdown()
            re_video = gr.Video(label="Re-rendered")
            re_file = gr.File(label="Output file")
            refresh.click(lambda: gr.update(choices=_workdirs()), None, wd_pick)
            load_btn.click(load_script, wd_pick, [table, info])
            save_btn.click(save_script, [wd_pick, table], status)
            rerender_btn.click(rerender, wd_pick, [re_video, re_file])

        with gr.Tab("While watching (live)"):
            gr.Markdown(
                "**Audio overlay**: set your player's output to *CABLE Input (VB-Audio)*, pick *CABLE Output* below, "
                "and your headphones as output. The dub follows ~1-2 s behind the actor.\n\n"
                "**Delayed video**: captures a screen region + audio, delays both, and plays back an in-sync dub "
                "(optionally lip-synced) in a window or OBS Virtual Camera. Screen capture of DRM-protected players "
                "usually shows black, so this is for capturable sources.")
            with gr.Row():
                mode = gr.Radio(["Audio overlay (low latency)", "Delayed video (in sync)"],
                                value="Audio overlay (low latency)", label="Mode")
                lpreset = gr.Dropdown(presets, value=default_preset if default_preset in presets else None, label="Preset")
            with gr.Row():
                lsrc = gr.Dropdown([("Auto-detect", "auto")] + langs, value="auto", label="From")
                ltgt = gr.Dropdown(langs, value="de", label="To")
            with gr.Row():
                in_dev = gr.Dropdown([], label="Listen on (player output)", allow_custom_value=True)
                out_dev = gr.Dropdown([], label="Play to", allow_custom_value=True)
                scan = gr.Button("Scan devices")
            with gr.Row():
                bg_mode = gr.Dropdown(["duck", "center_cancel", "mute", "passthrough"], value="duck",
                                      label="Original sound (audio overlay)")
                delay = gr.Slider(6, 30, value=12, step=1, label="Delay (video mode, s)")
                video_out = gr.Dropdown(["window", "virtualcam"], value="window", label="Video output")
                lip = gr.Checkbox(False, label="Live lip sync (experimental, Wav2Lip)")
            with gr.Row():
                start = gr.Button("Start", variant="primary")
                stop = gr.Button("Stop")
            live_status = gr.Markdown()
            live_log = gr.Textbox(label="Live transcript", lines=16)
            scan.click(live_devices, None, [in_dev, out_dev])
            start.click(live_start, [mode, lpreset, lsrc, ltgt, in_dev, out_dev, bg_mode, delay, video_out, lip],
                        live_status)
            stop.click(live_stop, None, live_status)
            timer = gr.Timer(1.0)
            timer.tick(live_poll, None, live_log)

        with gr.Tab("System"):
            sys_info = gr.Code(language="json", label="GPU / environment")
            gr.Button("Check").click(lambda: json.dumps(gpu_info(), indent=2), None, sys_info)
    return demo


def launch(preset: str | None = None, port: int = 7860) -> None:
    demo = build_app(preset)
    demo.queue().launch(server_name="127.0.0.1", server_port=port, inbrowser=True, share=False)
