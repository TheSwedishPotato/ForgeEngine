"""Batch mode: dub a whole video file, one resumable stage at a time.

    work/<name>-<id>/
      audio/mix.wav, vocals.wav, background.wav, vocals16k.wav
      transcript.json      source-language transcript (+ speakers, emotions)
      script.json          translated script  <- EDIT THIS, then re-run: only changed lines re-render
      voices/              per-character reference clips
      tts/                 one fitted wav per line
      audio/dub_mix.wav    final dubbed soundtrack
      lipsync/             per-line lip-sync clips (if enabled)
      report.json          timings + per-line fitting notes
"""

from __future__ import annotations

import hashlib
import json
import re
import time
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from .. import registry
from ..asr import segmenting
from ..asr.speakers import SpeakerEmbedder, assign_speakers_ecapa
from ..config import DubConfig, apply_runtime_env, resolve_path
from ..media import audio as au
from ..media import ffmpeg as ff
from ..mixing.mixer import Placement, render_mix
from ..translation import languages as L
from ..tts.voice_bank import VoiceBank
from ..types import Transcript
from ..utils.gpu import free_memory, peak_vram_gb, resolve_device
from ..utils.log import ProgressFn, get_logger, null_progress, timed
from .state import StageState, chain, file_sha, input_identity
from .subtitles import write_srt
from .tts_stage import TTSStage

log = get_logger("batch")

STAGES = ["extract", "separate", "transcribe", "emotion", "translate", "voices", "tts", "mix", "lipsync", "mux"]
VIDEO_EXTS = {".mp4", ".mkv", ".mov", ".m4v", ".avi", ".webm", ".ts", ".m2ts", ".wmv", ".flv"}


@dataclass
class RunResult:
    output: Path
    workdir: Path
    transcript: Transcript | None
    timings: dict[str, float] = field(default_factory=dict)
    peak_vram_gb: float = 0.0
    subtitles: list[Path] = field(default_factory=list)


def safe_name(stem: str) -> str:
    return re.sub(r"[^\w.-]+", "_", stem).strip("._")[:60] or "video"


class BatchDubber:
    def __init__(self, cfg: DubConfig, progress: ProgressFn = null_progress):
        self.cfg = cfg
        self.progress_cb = progress
        apply_runtime_env(cfg)
        registry.load_plugins(cfg.general.plugins)
        ff.configure(cfg.general.ffmpeg, cfg.general.ffprobe)
        self.device = resolve_device(cfg.general.device)
        self.models_dir = resolve_path(cfg.general.models_dir)
        assert self.models_dir is not None
        self.timings: dict[str, float] = {}

    # ------------------------------------------------------------------ helpers

    def workdir_for(self, input_path: Path) -> Path:
        root = resolve_path(self.cfg.general.work_dir)
        assert root is not None
        h = hashlib.sha1(str(input_path.resolve()).encode()).hexdigest()[:8]
        return root / f"{safe_name(input_path.stem)}-{h}-{self.cfg.target_lang}"

    def _progress(self, stage: str, frac: float, msg: str) -> None:
        i = STAGES.index(stage)
        self.progress_cb(min(1.0, (i + max(0.0, min(1.0, frac))) / len(STAGES)), f"[{i + 1}/{len(STAGES)} {stage}] {msg}")

    def _stage_progress(self, stage: str) -> ProgressFn:
        return lambda f, m: self._progress(stage, f, m)

    def _create(self, kind: str, name: str, section):
        kwargs = {"device": self.device, "models_dir": self.models_dir}
        if kind == "asr":
            kwargs["hf_token"] = self.cfg.general.hf_token
        return registry.create(kind, name, section, **kwargs)

    def preflight(self, info: ff.MediaInfo) -> None:
        tgt = L.normalize(self.cfg.target_lang)
        self.cfg.target_lang = tgt
        if self.cfg.source_lang != "auto":
            self.cfg.source_lang = L.normalize(self.cfg.source_lang)
        tts_cls = registry.resolve("tts", self.cfg.tts.backend)
        langs = getattr(tts_cls, "languages", set())
        if langs and tgt not in langs:
            raise L.UnsupportedLanguage(
                f"TTS backend '{self.cfg.tts.backend}' cannot speak {L.get(tgt).name}. "
                f"It supports: {', '.join(sorted(langs))}")
        if not info.has_audio:
            raise ValueError(f"{info.path} has no audio stream")
        if self.device == "cpu" and self.cfg.tts.backend != "mock":
            log.warning("No CUDA GPU detected - this will be VERY slow. Check your PyTorch CUDA install (python main.py doctor).")
        if info.has_video and self.cfg.lipsync.backend not in ("none",):
            self._create("lipsync", self.cfg.lipsync.backend, self.cfg.lipsync).check()

    # ------------------------------------------------------------------ run

    def run(self, input_path: str | Path, output_path: str | Path | None = None,
            from_stage: str | None = None, to_stage: str | None = None) -> RunResult:
        t_start = time.perf_counter()
        src = Path(input_path).expanduser().resolve()
        if not src.exists():
            raise FileNotFoundError(src)
        info = ff.probe(src)
        is_video = info.has_video and src.suffix.lower() in VIDEO_EXTS
        self.preflight(info)
        wd = self.workdir_for(src)
        (wd / "audio").mkdir(parents=True, exist_ok=True)
        self.cfg.save(wd / "config.used.yaml")
        (wd / "job.json").write_text(json.dumps({"input": str(src), "source_lang": self.cfg.source_lang,
                                                 "target_lang": self.cfg.target_lang}, indent=2), encoding="utf-8")
        state = StageState(wd / "state.json")
        if from_stage:
            if from_stage not in STAGES:
                raise ValueError(f"from_stage must be one of {STAGES}")
            state.invalidate(STAGES[STAGES.index(from_stage):])
        last = STAGES.index(to_stage) if to_stage else len(STAGES) - 1
        log.info("Working directory: %s", wd)
        cfg = self.cfg
        A = wd / "audio"
        mix, vocals, background, vocals16k = A / "mix.wav", A / "vocals.wav", A / "background.wav", A / "vocals16k.wav"
        transcript_path, script_path = wd / "transcript.json", wd / "script.json"
        transcript: Transcript | None = None
        script: Transcript | None = None
        peak_vram_gb(reset=True)

        def should_stop(stage: str) -> bool:
            return STAGES.index(stage) > last

        # 1. extract ---------------------------------------------------------
        k_extract = chain(input_identity(src), cfg.separation.sample_rate, "v2")
        if not state.is_done("extract", k_extract, [mix]):
            with timed("extract audio", self.timings):
                self._progress("extract", 0.0, "decoding audio")
                # put the audio on the video's timeline (some files delay the audio stream)
                offset = (info.audio_start - info.video_start) if is_video else 0.0
                ff.extract_audio(src, mix, sr=cfg.separation.sample_rate, channels=2, offset=offset)
            state.mark("extract", k_extract)
        if should_stop("separate"):
            return self._result(src, wd, None, t_start)

        # 2. separate --------------------------------------------------------
        k_sep = chain(k_extract, cfg.section_hash("separation"))
        if not state.is_done("separate", k_sep, [vocals, background, vocals16k]):
            with timed("separate dialogue", self.timings):
                sep = self._create("separator", cfg.separation.backend, cfg.separation)
                sep.separate_file(mix, vocals, background, progress=self._stage_progress("separate"))
                ff.run(["-i", str(vocals), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(vocals16k)], "vocals16k")
            state.mark("separate", k_sep)
        if should_stop("transcribe"):
            return self._result(src, wd, None, t_start)

        v16, _ = au.load(vocals16k, sr=16000, mono=True)

        # 3. transcribe ------------------------------------------------------
        k_asr = chain(k_sep, cfg.section_hash("asr"), cfg.source_lang)
        if not state.is_done("transcribe", k_asr, [transcript_path]):
            with timed("transcribe", self.timings):
                transcript = self._transcribe(vocals16k, v16)
                transcript.save(transcript_path)
            state.mark("transcribe", k_asr)
        transcript = Transcript.load(transcript_path)
        log.info("%d lines, %d speakers, language=%s", len(transcript.segments), len(transcript.speakers), transcript.language)
        if should_stop("emotion"):
            return self._result(src, wd, transcript, t_start)

        # 4. emotion ---------------------------------------------------------
        k_emo = chain(k_asr, cfg.section_hash("emotion"))
        if not state.is_done("emotion", k_emo, [transcript_path]):
            with timed("emotion analysis", self.timings):
                emo = self._create("emotion", cfg.emotion.backend, cfg.emotion)
                emo.annotate(transcript, v16, progress=self._stage_progress("emotion"))
                emo.unload()
                transcript.save(transcript_path)
            state.mark("emotion", k_emo)
            transcript = Transcript.load(transcript_path)
        if should_stop("translate"):
            return self._result(src, wd, transcript, t_start)

        # 5. translate -------------------------------------------------------
        k_tr = chain(k_emo, cfg.section_hash("translation"), cfg.target_lang)
        if not state.is_done("translate", k_tr, [script_path]):
            with timed("translate", self.timings):
                script = self._translate(transcript, v16, script_path)
                script.save(script_path)
            state.mark("translate", k_tr, script_sha=file_sha(script_path))
        script = Transcript.load(script_path)
        self._detect_manual_edits(script, script_path, state)
        del v16
        if should_stop("voices"):
            return self._result(src, wd, script, t_start)

        # 6. voices ----------------------------------------------------------
        bank = VoiceBank(wd / "voices")
        k_voice = chain(k_emo, cfg.section_hash("tts"))
        if not state.is_done("voices", k_voice, [bank.manifest]):
            with timed("build voice bank", self.timings):
                bank.build(script, vocals, background, cfg.tts)
            state.mark("voices", k_voice)
        if should_stop("tts"):
            return self._result(src, wd, script, t_start)

        # 7. tts (per-line cache inside) -------------------------------------
        with timed("voice-cloned TTS", self.timings):
            tts = self._create("tts", cfg.tts.backend, cfg.tts)
            stage = TTSStage(cfg, tts, wd, vocals, self.models_dir, self.device)
            placements = stage.run(script, progress=self._stage_progress("tts"))
            tts.unload()
            free_memory()
            script.save(script_path)
            state.mark("tts", chain(k_voice, k_tr), script_sha=file_sha(script_path))
            state.data.setdefault("translate", {})["script_sha"] = file_sha(script_path)
            state.save()
        tts_key = chain(sorted((k, v.path, v.start) for k, v in placements.items()),
                        [file_sha(v.path) for _, v in sorted(placements.items())])
        if should_stop("mix"):
            return self._result(src, wd, script, t_start)

        # 8. mix -------------------------------------------------------------
        dub_mix, dub_voice = A / "dub_mix.wav", A / "dub_voice.wav"
        k_mix = chain(tts_key, cfg.section_hash("mix"))
        if not state.is_done("mix", k_mix, [dub_mix]):
            with timed("mix", self.timings):
                render_mix(background, vocals, list(placements.values()), dub_mix, cfg.mix,
                           progress=self._stage_progress("mix"), dub_only_path=dub_voice)
            state.mark("mix", k_mix)
        subs = self._subtitles(script, wd)
        if should_stop("lipsync"):
            return self._result(src, wd, script, t_start, subs=subs)

        # 9. lipsync ---------------------------------------------------------
        video_for_mux = src
        copy_video = True
        if is_video and cfg.lipsync.backend != "none" and placements:
            lip_video = wd / "video_lipsync.mp4"
            k_lip = chain(tts_key, cfg.section_hash("lipsync"))
            if not state.is_done("lipsync", k_lip, [lip_video]):
                with timed("lip sync", self.timings):
                    self._lipsync(src, info, script, placements, wd, lip_video)
                state.mark("lipsync", k_lip)
            video_for_mux, copy_video = lip_video, True
        if should_stop("mux"):
            return self._result(src, wd, script, t_start, subs=subs)

        # 10. mux ------------------------------------------------------------
        out = self._output_path(src, output_path, is_video)
        with timed("mux", self.timings):
            self._progress("mux", 0.2, "writing output file")
            if is_video:
                # the lip-synced video is re-encoded from t=0; a stream-copied original keeps its start time
                start = info.video_start if video_for_mux == src else 0.0
                self._mux(video_for_mux, copy_video, dub_mix, mix, subs, out, script, start)
            else:
                ff.run(["-i", str(dub_mix), "-c:a", cfg.mix.audio_codec, "-b:a", cfg.mix.audio_bitrate,
                        "-ar", str(cfg.mix.sample_rate), str(out)], "encode audio")
        self._progress("mux", 1.0, f"done -> {out}")
        return self._result(src, wd, script, t_start, out=out, subs=subs)

    # ------------------------------------------------------------------ stage bodies

    def _transcribe(self, vocals16k: Path, v16: np.ndarray) -> Transcript:
        cfg = self.cfg
        asr = self._create("asr", cfg.asr.backend, cfg.asr)
        lang = None if cfg.source_lang == "auto" else cfg.source_lang
        t = asr.transcribe(vocals16k, lang, progress=self._stage_progress("transcribe"))
        asr.unload()
        try:
            t.language = L.normalize(t.language)
        except L.UnsupportedLanguage:
            log.warning("Detected language '%s' is not in DubForge's language table", t.language)
        t = segmenting.postprocess(t, cfg.asr)
        diarized = bool(t.meta.get("diarized"))
        if not diarized and cfg.asr.diarization in ("auto", "ecapa") and t.segments:
            self._progress("transcribe", 0.9, "clustering speakers (ECAPA)")
            emb = SpeakerEmbedder(self.device, self.models_dir)
            try:
                assign_speakers_ecapa(t.segments, v16, emb, cfg.asr.speaker_similarity, cfg.asr.max_speakers,
                                      cfg.asr.min_speakers)
            except Exception as e:
                log.warning("speaker clustering failed (%s); treating everything as one speaker", e)
            emb.unload()
            t = segmenting.postprocess(t, cfg.asr)  # re-merge now that speakers are known
        t.refresh_speakers()
        return t

    def _translate(self, transcript: Transcript, v16: np.ndarray, script_path: Path) -> Transcript:
        cfg = self.cfg
        script = transcript.copy()
        # keep lines the user edited by hand in a previous run
        if script_path.exists():
            old = {s.id: s for s in Transcript.load(script_path).segments}
            for s in script.segments:
                o = old.get(s.id)
                if o and o.translation_locked and o.text == s.text:
                    s.translation, s.translation_candidates, s.translation_locked = o.translation, o.translation_candidates, True
                if o and o.text == s.text:
                    s.keep_original = o.keep_original
        src, tgt = script.language, cfg.target_lang
        if src == tgt:
            for s in script.segments:
                if not s.translation_locked:
                    s.translation, s.translation_candidates = s.text, [s.text]
            script.target_language = tgt
            return script
        tr = self._create("translator", cfg.translation.backend, cfg.translation)
        tr.translate(script, src, tgt, audio16k=v16, progress=self._stage_progress("translate"))
        tr.unload()
        return script

    def _detect_manual_edits(self, script: Transcript, path: Path, state: StageState) -> None:
        recorded = state.get("tts", "script_sha") or state.get("translate", "script_sha")
        if recorded and recorded != file_sha(path):
            changed = 0
            for s in script.segments:
                if s.translation and not s.translation_locked and s.translation not in s.translation_candidates:
                    s.translation_locked = True
                    changed += 1
            if changed:
                log.info("Detected %d hand-edited lines in script.json - they are now locked", changed)
            script.save(path)
            state.data.setdefault("translate", {})["script_sha"] = file_sha(path)
            state.save()

    def _subtitles(self, script: Transcript, wd: Path) -> list[Path]:
        if not self.cfg.mix.export_srt:
            return []
        tgt = script.target_language or self.cfg.target_lang
        return [write_srt(script, wd / f"subtitles.{tgt}.srt", translated=True),
                write_srt(script, wd / f"subtitles.{script.language}.srt", translated=False)]

    def _lipsync(self, src: Path, info: ff.MediaInfo, script: Transcript, placements: dict[int, Placement],
                 wd: Path, out_video: Path) -> None:
        from ..lipsync.jobs import build_jobs, plan_spans, splice

        cfg = self.cfg
        backend = self._create("lipsync", cfg.lipsync.backend, cfg.lipsync)
        durations = {k: au.duration(p.path) for k, p in placements.items()}
        spans = plan_spans(placements, durations, info.fps, info.frame_count, cfg.lipsync)
        log.info("lip sync: %d clips covering %.1f%% of the frames", len(spans),
                 100.0 * sum(s.end_frame - s.start_frame for s in spans) / max(1, info.frame_count))
        jobs_dir = wd / "lipsync"
        jobs = build_jobs(str(src), info, spans, jobs_dir, progress=self._stage_progress("lipsync"))
        results = backend.run(jobs, info.fps, jobs_dir, progress=self._stage_progress("lipsync"))
        log.info("lip sync succeeded on %d/%d clips", len(results), len(jobs))
        free_memory()
        by_id = {j.id: j for j in jobs}
        splice(str(src), info, [(by_id[i].start_frame, by_id[i].n_frames, p) for i, p in results.items()], out_video,
               codec=cfg.lipsync.video_codec, crf=cfg.lipsync.crf, progress=self._stage_progress("lipsync"))

    def _output_path(self, src: Path, output_path: str | Path | None, is_video: bool) -> Path:
        if output_path:
            return Path(output_path).expanduser().resolve()
        out_dir = resolve_path(self.cfg.general.output_dir)
        assert out_dir is not None
        out_dir.mkdir(parents=True, exist_ok=True)
        if not is_video:
            return out_dir / f"{src.stem}.{self.cfg.target_lang}.m4a"
        ext = src.suffix.lower() if src.suffix.lower() in (".mp4", ".mkv", ".mov") else ".mkv"
        return out_dir / f"{src.stem}.{self.cfg.target_lang}{ext}"

    def _mux(self, video: Path, copy_video: bool, dub_mix: Path, original_mix: Path, subs: list[Path], out: Path,
             script: Transcript, video_start: float = 0.0) -> None:
        cfg = self.cfg
        tgt = L.get(script.target_language or cfg.target_lang)
        try:
            src_l = L.get(script.language)
            src_iso, src_name = src_l.iso3, src_l.name
        except L.UnsupportedLanguage:
            src_iso, src_name = None, "Original"
        tracks = [ff.AudioTrack(str(dub_mix), tgt.iso3, f"{tgt.name} (DubForge)", default=True)]
        if cfg.mix.keep_original_track:
            tracks.append(ff.AudioTrack(str(original_mix), src_iso, f"{src_name} (original)"))
        soft = [] if cfg.mix.burn_subtitles else [ff.SubtitleTrack(str(p), None, p.stem) for p in subs[:1]]
        if soft:
            soft[0].language = tgt.iso3
        ff.mux(video, tracks, out, subtitles=soft, copy_video=copy_video, audio_codec=cfg.mix.audio_codec,
               audio_bitrate=cfg.mix.audio_bitrate, burn_srt=str(subs[0]) if (cfg.mix.burn_subtitles and subs) else None,
               video_codec=cfg.lipsync.video_codec, crf=cfg.lipsync.crf, audio_sr=cfg.mix.sample_rate,
               audio_offset=video_start)

    def _result(self, src: Path, wd: Path, transcript: Transcript | None, t_start: float, out: Path | None = None,
                subs: list[Path] | None = None) -> RunResult:
        self.timings["total"] = time.perf_counter() - t_start
        res = RunResult(output=out or wd, workdir=wd, transcript=transcript, timings=dict(self.timings),
                        peak_vram_gb=round(peak_vram_gb(), 2), subtitles=subs or [])
        report = {"input": str(src), "output": str(res.output), "timings_s": {k: round(v, 1) for k, v in self.timings.items()},
                  "peak_vram_gb": res.peak_vram_gb}
        if transcript is not None:
            segs = transcript.segments
            report["lines"] = len(segs)
            report["speakers"] = transcript.speakers
            report["lines_needing_fit"] = [
                {"id": s.id, "speaker": s.speaker, "text": s.tts_text or s.translation, "notes": s.fit_notes}
                for s in segs if s.fit_notes]
        (wd / "report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
        return res
