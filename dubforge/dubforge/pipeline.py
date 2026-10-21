"""Batch dubbing pipeline: video in -> dubbed video out.

Stages (each checkpointed in the work dir, so a crash or a Ctrl-C resumes where it stopped):

  language-independent ("common/")        language-specific ("<target>/")
  extract -> separate -> asr -> diarize   translate -> tts -> mix -> lipsync -> mux
          -> emotion

Run `until="translate"`, edit `<target>/segments.json` (or use the GUI review tab), then run
again: only the lines you changed are re-synthesised.
"""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
import statistics
import time
from pathlib import Path
from typing import Callable

import numpy as np

from . import registry
from .audio_utils import active_rms_db, duration_of, read_audio, write_audio
from .config import Config
from .env import resolve_device, setup_env
from .languages import resolve, tts_backends_for, tts_supports
from .media import FrameReader, FrameWriter, extract_audio, mux, probe, to_mono_16k
from .mix import build_dub_track, final_mix, load_tts_clip, plan_fit
from .refs import ReferenceProvider
from .segmentation import resegment
from .tts.common import looks_broken, style_for
from .types import Segment, load_segments, save_segments

log = logging.getLogger("dubforge")

SOURCE_STAGES = ["extract", "separate", "asr", "diarize", "emotion"]
TARGET_STAGES = ["translate", "tts", "mix", "lipsync", "mux"]
ALL_STAGES = SOURCE_STAGES + TARGET_STAGES
SR = 44100

ProgressFn = Callable[[str, float, str], None]


def _default_progress(stage: str, frac: float, msg: str = "") -> None:
    print(f"  [{stage}] {frac * 100:5.1f}%  {msg}", flush=True)


class DubPipeline:
    def __init__(self, cfg: Config, progress: ProgressFn | None = None):
        self.cfg = cfg
        self.progress = progress or _default_progress
        setup_env(cfg)

    # ------------------------------------------------------------ job layout
    def job_dir(self, video: Path) -> Path:
        st = video.stat()
        key = hashlib.sha1(f"{video.resolve()}|{st.st_size}|{int(st.st_mtime)}".encode()).hexdigest()[:8]
        return Path(self.cfg.work_dir) / f"{video.stem}_{key}"

    def _state(self, d: Path) -> dict:
        p = d / "state.json"
        return json.loads(p.read_text()) if p.exists() else {"done": []}

    def _mark(self, d: Path, stage: str) -> None:
        s = self._state(d)
        if stage not in s["done"]:
            s["done"].append(stage)
        (d / "state.json").write_text(json.dumps(s))

    def _clear_from(self, d: Path, stages: list[str], start: str) -> None:
        if start not in stages:
            return
        drop = set(stages[stages.index(start):])
        s = self._state(d)
        s["done"] = [x for x in s["done"] if x not in drop]
        (d / "state.json").write_text(json.dumps(s))

    def _backend(self, stage: str, name: str):
        return registry.create(stage, name, self.cfg)

    def _prog(self, stage: str):
        return lambda frac, msg="": self.progress(stage, frac, msg)

    # ------------------------------------------------------------ public API
    def run(self, video: str | Path, target: str, source: str | None = None, *, until: str | None = None,
            redo_from: str | None = None) -> Path | None:
        video = Path(video)
        if not video.exists():
            raise FileNotFoundError(video)
        tgt = resolve(target)
        src = resolve(source) if source and source != "auto" else None
        if until and until not in ALL_STAGES:
            raise ValueError(f"until must be one of {ALL_STAGES}")
        job = self.job_dir(video)
        common, lang = job / "common", job / tgt.code
        common.mkdir(parents=True, exist_ok=True)
        lang.mkdir(parents=True, exist_ok=True)
        if redo_from:
            self._clear_from(common, SOURCE_STAGES, redo_from)
            self._clear_from(lang, TARGET_STAGES, redo_from)
            if redo_from in SOURCE_STAGES:           # source changed -> everything downstream is stale
                self._clear_from(lang, TARGET_STAGES, "translate")

        t0 = time.time()
        for stage in ALL_STAGES:
            scope = common if stage in SOURCE_STAGES else lang
            if stage not in self._state(scope)["done"]:
                self.progress(stage, 0.0, "start")
                getattr(self, f"_stage_{stage}")(video, common, lang, src, tgt)
                self._mark(scope, stage)
                self.progress(stage, 1.0, "done")
            if until == stage:
                log.info("stopped after %s (%.0fs)", stage, time.time() - t0)
                return None
        out = self._output_path(video, tgt.code)
        log.info("finished in %.0fs -> %s", time.time() - t0, out)
        return out

    def _output_path(self, video: Path, code: str) -> Path:
        ext = ".mp4" if probe(video).has_video else ".wav"
        return Path(self.cfg.output_dir) / f"{video.stem}.{code}{ext}"

    # ------------------------------------------------------------ source-side stages
    def _stage_extract(self, video, common, lang, src, tgt):
        info = probe(video)
        extract_audio(video, common / "audio_full.wav", sr=SR, channels=2)
        (common / "media.json").write_text(json.dumps({
            "duration": info.duration, "fps": info.fps_str, "width": info.width, "height": info.height,
            "has_video": info.has_video, "audio_lang": info.audio_lang}))

    def _stage_separate(self, video, common, lang, src, tgt):
        with self._backend("separate", self.cfg.separate.backend) as sep:
            sep.separate(common / "audio_full.wav", common / "stems", self._prog("separate"))
        to_mono_16k(common / "stems" / "vocals.wav", common / "vocals_16k.wav")

    def _stage_asr(self, video, common, lang, src, tgt):
        with self._backend("asr", self.cfg.asr.backend) as asr:
            segs, detected = asr.transcribe(common / "vocals_16k.wav", src.code if src else None, self._prog("asr"))
        segs = resegment(segs, self.cfg.segmentation)
        vocals = common / "stems" / "vocals.wav"
        for s in segs:
            x, sr = read_audio(vocals, mono=True, start=s.start, duration=s.duration)
            s.energy_db = active_rms_db(x, sr) if len(x) else None
        save_segments(common / "segments.json", segs, {"source_lang": detected})
        log.info("transcribed %d lines, language=%s", len(segs), detected)

    def _stage_diarize(self, video, common, lang, src, tgt):
        segs, meta = load_segments(common / "segments.json")
        with self._backend("diarize", self.cfg.diarize.backend) as d:
            d.assign(common / "vocals_16k.wav", segs)
        save_segments(common / "segments.json", segs, meta)
        log.info("speakers: %s", sorted({s.speaker for s in segs}))

    def _stage_emotion(self, video, common, lang, src, tgt):
        segs, meta = load_segments(common / "segments.json")
        with self._backend("emotion", self.cfg.emotion.backend) as e:
            e.classify(common / "vocals_16k.wav", segs, self._prog("emotion"))
        save_segments(common / "segments.json", segs, meta)

    # ------------------------------------------------------------ target-side stages
    def _stage_translate(self, video, common, lang, src, tgt):
        segs, meta = load_segments(common / "segments.json")
        source_lang = src.code if src else meta["source_lang"]
        if source_lang == tgt.code:
            raise ValueError(f"Source and target language are both {tgt.name}.")
        with self._backend("translate", self.cfg.translate.backend) as tr:
            tr.translate(segs, source_lang, tgt.code, self._prog("translate"))
        meta = {**meta, "source_lang": source_lang, "target_lang": tgt.code}
        save_segments(lang / "segments.json", segs, meta)

    def _stage_tts(self, video, common, lang, src, tgt):
        segs, meta = load_segments(lang / "segments.json")        # may have been hand-edited
        c = self.cfg.tts
        if not tts_supports(c.backend, tgt.code):
            alt = tts_backends_for(tgt.code)
            raise ValueError(f"TTS backend {c.backend!r} cannot speak {tgt.name}. Backends that can: {alt or 'none registered'}.")
        stems = common / "stems"
        refs = ReferenceProvider(segs, stems / "vocals.wav", stems / "accompaniment.wav", lang / "refs",
                                 c.reference_mode, c.min_own_ref_s, c.ref_max_s)
        med: dict[str, float] = {}
        for spk in {s.speaker for s in segs}:
            vals = [s.energy_db for s in segs if s.speaker == spk and s.energy_db is not None]
            if vals:
                med[spk] = statistics.median(vals)
        todo = [s for s in segs if not s.skip and s.translation.strip()]
        (lang / "tts").mkdir(exist_ok=True)
        with self._backend("tts", c.backend) as tts:
            for i, s in enumerate(todo):
                self._synth_one(tts, s, refs, med.get(s.speaker), lang / "tts", tgt.code)
                if i % 10 == 0:
                    save_segments(lang / "segments.json", segs, meta)
                self.progress("tts", (i + 1) / max(1, len(todo)), f"line {i + 1}/{len(todo)}")
        save_segments(lang / "segments.json", segs, meta)

    def _synth_one(self, tts, s: Segment, refs: ReferenceProvider, med_db, out_dir: Path, lang: str) -> None:
        s.notes = [n for n in s.notes if not n.startswith(("no_reference", "tts_unstable"))]
        ref = refs.for_segment(s)
        if ref is None:
            s.notes.append("no_reference: too short to clone, original audio kept")
            s.tts_path = None
            return
        style = style_for(s, med_db, self.cfg.tts)
        key = hashlib.sha1("|".join([tts.name, lang, s.translation, hashlib.md5(ref.read_bytes()).hexdigest(),
                                     f"{style.exaggeration:.2f}", str(self.cfg.tts.cfg_weight),
                                     str(self.cfg.tts.temperature)]).encode()).hexdigest()[:10]
        path = out_dir / f"seg_{s.id:05d}_{key}.wav"
        if not path.exists():
            best = None
            for attempt in range(1 + self.cfg.tts.retries):
                style.seed = s.id * 100 + attempt
                wav = tts.synthesize(s.translation, lang, ref, style)
                broken = looks_broken(wav, tts.sample_rate, s.translation, lang)
                if best is None or (not broken) or (len(wav) < len(best)):
                    best = wav
                if not broken:
                    break
            else:
                s.notes.append("tts_unstable: kept shortest of several attempts")
            write_audio(path, best, tts.sample_rate)
        for old in out_dir.glob(f"seg_{s.id:05d}_*.wav"):           # drop stale takes of this line
            if old != path:
                old.unlink()
        s.tts_path = str(path)
        s.tts_duration = duration_of(path)

    def _stage_mix(self, video, common, lang, src, tgt):
        segs, meta = load_segments(lang / "segments.json")
        media = json.loads((common / "media.json").read_text())
        total = float(media["duration"])
        durations = {}
        for s in segs:
            if s.tts_path and Path(s.tts_path).exists():
                x, sr = load_tts_clip(s.tts_path)
                durations[s.id] = len(x) / sr
        plans = plan_fit(segs, durations, self.cfg.fit, total)
        track, placed = build_dub_track(segs, plans, SR, total, self.cfg.fit, self.cfg.mix)
        for s in segs:
            p = plans.get(s.id)
            s.fit = {"ratio": round(p.ratio, 3), "flags": p.flags, "start": round(p.start, 3),
                     "end": round(placed.get(s.id, (0, 0))[1], 3)} if p else {}
        write_audio(lang / "dub_vocals.wav", track[: int(total * SR)], SR, "PCM_16")
        stems = common / "stems"
        peak = final_mix(stems / "accompaniment.wav", stems / "vocals.wav", track, SR, segs,
                         lang / "dub_mix.wav", self.cfg.mix)
        save_segments(lang / "segments.json", segs, meta)
        self._write_report(lang, segs, peak)
        (lang / "placed.json").write_text(json.dumps({str(k): v for k, v in placed.items()}))

    def _write_report(self, lang: Path, segs: list[Segment], peak: float) -> None:
        def count(flag):
            return sum(flag in s.fit.get("flags", []) for s in segs)
        rep = {
            "lines_total": len(segs),
            "lines_dubbed": sum(bool(s.tts_path) for s in segs),
            "lines_left_original": sum(s.skip for s in segs),
            "lines_without_reference": sum(any(n.startswith("no_reference") for n in s.notes) for s in segs),
            "spilled_into_silence": count("spill"), "compressed": count("compressed"), "overrun": count("overrun"),
            "tts_unstable": sum(any(n.startswith("tts_unstable") for n in s.notes) for s in segs),
            "mix_peak_before_normalise": round(peak, 3),
            "problem_lines": [{"id": s.id, "t": round(s.start, 1), "text": s.translation[:80], "flags": s.fit.get("flags", []),
                               "notes": s.notes} for s in segs if s.fit.get("flags") and "spill" not in s.fit["flags"]
                              or s.notes],
        }
        (lang / "report.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1))
        log.info("QA: %s", {k: v for k, v in rep.items() if k != "problem_lines"})

    # ------------------------------------------------------------ video
    def _stage_lipsync(self, video, common, lang, src, tgt):
        name = self.cfg.lipsync.backend
        out = lang / "video_lipsync.mp4"
        out.unlink(missing_ok=True)
        info = probe(video)
        if name == "none" or not info.has_video:
            return
        placed = {int(k): tuple(v) for k, v in json.loads((lang / "placed.json").read_text()).items()}
        segs, _ = load_segments(lang / "segments.json")
        # Cover the ORIGINAL line too: if the dub is shorter, the actor's lips would otherwise keep
        # speaking the old language after the dub ends. The model renders a closed mouth there.
        spans = [(min(s.start, placed[s.id][0]), max(s.end, placed[s.id][1])) for s in segs if s.id in placed]
        windows = lipsync_windows(spans, float(info.fps), self.cfg.lipsync.max_clip_s)
        with self._backend("lipsync", name) as ls:
            self._lipsync_pass(video, info, windows, lang / "dub_vocals.wav", ls, out)

    def _lipsync_pass(self, video: Path, info, windows, dub_wav: Path, backend, out: Path) -> None:
        fps = float(info.fps)
        wi, buf, synced, tried = 0, [], 0, 0

        def flush(win):
            nonlocal buf, synced, tried
            if not buf:
                return
            f0, _ = win
            audio, _ = read_audio(dub_wav, sr=16000, mono=True, start=f0 / fps, duration=len(buf) / fps)
            res = backend.sync_clip(buf, audio, fps)
            tried += 1
            if res is not None and len(res) == len(buf):
                synced += 1
                buf = res
            for fr in buf:
                writer.write(fr)
            buf = []

        tmp = out.with_suffix(".tmp.mp4")
        with FrameReader(video, info) as reader, FrameWriter(tmp, info, self.cfg.video) as writer:
            for i, frame in enumerate(reader):
                while wi < len(windows) and i >= windows[wi][1]:
                    wi += 1
                if wi < len(windows) and windows[wi][0] <= i < windows[wi][1]:
                    buf.append(frame)
                    if i == windows[wi][1] - 1:
                        flush(windows[wi])
                else:
                    writer.write(frame)
                if i % 250 == 0 and info.duration:
                    self.progress("lipsync", min(0.99, i / fps / info.duration), f"{synced}/{tried} windows synced")
            if buf:
                flush(windows[min(wi, len(windows) - 1)])
        tmp.replace(out)
        log.info("lip-sync: %d/%d windows had a usable face", synced, tried)

    def _stage_mux(self, video, common, lang, src, tgt):
        out = self._output_path(video, tgt.code)
        out.parent.mkdir(parents=True, exist_ok=True)
        segs, meta = load_segments(lang / "segments.json")
        write_srt(segs, out.with_suffix(".srt"))
        info = probe(video)
        if not info.has_video:
            shutil.copy(lang / "dub_mix.wav", out)
            return
        lip = lang / "video_lipsync.mp4"
        mux(lip if lip.exists() else video, lang / "dub_mix.wav", out, original=video,
            keep_original=self.cfg.mix.keep_original_track, tgt_iso3=tgt.iso3,
            src_iso3=resolve(meta["source_lang"]).iso3 if meta.get("source_lang") else None,
            copy_video=True, bitrate=self.cfg.mix.audio_bitrate)


def lipsync_windows(spans: list[tuple[float, float]], fps: float, max_clip_s: float,
                    merge_gap_s: float = 0.25) -> list[tuple[int, int]]:
    """Dubbed-speech time spans -> frame windows [f0, f1), merged when close, cut to <= max_clip_s."""
    if not spans:
        return []
    spans = sorted(spans)
    merged = [list(spans[0])]
    for a, b in spans[1:]:
        if a - merged[-1][1] <= merge_gap_s:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    max_f = max(1, int(max_clip_s * fps))
    out: list[tuple[int, int]] = []
    for a, b in merged:
        f0, f1 = int(np.floor(a * fps)), int(np.ceil(b * fps))
        while f1 - f0 > max_f:
            out.append((f0, f0 + max_f))
            f0 += max_f
        if f1 > f0:
            out.append((f0, f1))
    return out


def _srt_time(t: float) -> str:
    ms = int(round(t * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def write_srt(segs: list[Segment], path: Path) -> None:
    lines = []
    n = 0
    for s in segs:
        if s.translation.strip() and not s.skip:
            n += 1
            lines += [str(n), f"{_srt_time(s.start)} --> {_srt_time(s.end)}", s.translation.strip(), ""]
    path.write_text("\n".join(lines), encoding="utf-8")
