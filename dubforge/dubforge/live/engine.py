"""Shared live worker: utterance -> (clean vocals) -> ASR -> speaker -> translate -> cloned TTS.

All models stay loaded (ASR + MT + TTS + optional Demucs/ECAPA). On 8 GB use the
gpu_8gb preset (int8 Whisper) or the NLLB-600M model.
"""

from __future__ import annotations

import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator

import numpy as np

from .. import registry
from ..asr.faster_whisper_backend import FasterWhisperASR
from ..asr.segmenting import is_hallucination
from ..config import DubConfig, apply_runtime_env, resolve_path
from ..media import audio as au
from ..translation import languages as L
from ..tts.base import StyleRef
from ..tts.voice_bank import REF_SR, RefClip
from ..utils.gpu import resolve_device
from ..utils.log import get_logger
from .vad import Utterance

log = get_logger("live")


@dataclass
class LiveLine:
    utt: Utterance
    speaker: str
    source_text: str
    text: str
    language: str
    vocals: np.ndarray | None = None  # capture rate, [n, ch]
    background: np.ndarray | None = None
    rms_db: float = -30.0
    timings: dict[str, float] = field(default_factory=dict)


class _VoiceMemory:
    """Keeps each tracked speaker's best (longest, loudest) clips as cloning references."""

    def __init__(self, root: Path, max_clips: int = 4):
        self.root = root
        self.max_clips = max_clips
        self.clips: dict[str, list[tuple[float, str, str, float]]] = {}  # speaker -> [(score, path, text, seconds)]
        self.version: dict[str, int] = {}

    def offer(self, speaker: str, wav: np.ndarray, sr: int, text: str, lang: str) -> bool:
        dur = len(wav) / sr
        if dur < 1.5:
            return False
        score = min(dur, 10.0) + au.gain_to_db(au.active_rms(wav, sr)) / 20.0
        clips = self.clips.setdefault(speaker, [])
        if len(clips) >= self.max_clips and score <= min(c[0] for c in clips):
            return False
        n = self.version.get(speaker, 0) + 1
        self.version[speaker] = n
        path = au.save(self.root / f"{speaker}_{n:04d}.wav", au.resample(wav, sr, REF_SR), REF_SR)
        clips.append((score, str(path), text, dur))
        clips.sort(key=lambda c: -c[0])
        del clips[self.max_clips:]
        return True

    def refs(self, speaker: str, lang: str) -> list[RefClip]:
        return [RefClip(p, speaker, 0.0, d, t, lang, None, s) for s, p, t, d in self.clips.get(speaker, [])]


class LiveEngine:
    def __init__(self, cfg: DubConfig, separate_vocals: bool = True):
        apply_runtime_env(cfg)
        registry.load_plugins(cfg.general.plugins)
        self.cfg = cfg
        self.device = resolve_device(cfg.general.device)
        self.models_dir = resolve_path(cfg.general.models_dir)
        self.tmp = Path(tempfile.mkdtemp(prefix="dubforge_live_"))
        self.separate_vocals = separate_vocals
        self.src_lang: str | None = None if cfg.source_lang == "auto" else L.normalize(cfg.source_lang)
        self.tgt_lang = L.normalize(cfg.target_lang)
        self._lang_votes: dict[str, int] = {}
        self.voices = _VoiceMemory(self.tmp)
        self._voice_version: dict[str, int] = {}
        self.asr = None
        self.translator = None
        self.tts = None
        self.separator = None
        self.embedder = None
        self.tracker = None

    def load(self, status: Callable[[str], None] = lambda m: None) -> None:
        cfg = self.cfg
        asr_cfg = type(cfg.asr)(**{**cfg.asr.__dict__, "model": cfg.live.asr_model,
                                   "compute_type": cfg.live.asr_compute_type, "beam_size": 1})
        status("loading speech recognition")
        self.asr = FasterWhisperASR(asr_cfg, self.device, self.models_dir)
        self.asr.load()
        status("loading translation")
        self.translator = registry.create("translator", cfg.translation.backend, cfg.translation,
                                          device=self.device, models_dir=self.models_dir)
        status("loading voice cloning TTS")
        self.tts = registry.create("tts", cfg.tts.backend, cfg.tts, device=self.device, models_dir=self.models_dir)
        self.tts.load()
        if not self.tts.supports_language(self.tgt_lang):
            raise L.UnsupportedLanguage(f"TTS '{cfg.tts.backend}' cannot speak {self.tgt_lang}")
        if self.separate_vocals:
            status("loading dialogue separation")
            try:
                sep_cfg = type(cfg.separation)(**{**cfg.separation.__dict__, "backend": "demucs", "demucs_model": "htdemucs",
                                                  "shifts": 0, "overlap": 0.1})
                self.separator = registry.create("separator", "demucs", sep_cfg, device=self.device,
                                                 models_dir=self.models_dir)
                self.separator.load()
            except Exception as e:
                log.warning("live dialogue separation disabled (%s)", e)
                self.separator = None
        if cfg.live.speaker_tracking:
            try:
                from ..asr.speakers import OnlineSpeakerTracker, SpeakerEmbedder

                self.embedder = SpeakerEmbedder(self.device, self.models_dir)
                self.embedder.load()
                self.tracker = OnlineSpeakerTracker(cfg.live.speaker_similarity)
            except Exception as e:
                log.warning("speaker tracking disabled (%s)", e)
        # warm-up so the first real line isn't slow
        status("warming up")
        self.translator.translate_one("Hello.", "en", self.tgt_lang if self.tgt_lang != "en" else "de")
        status("ready")

    # ------------------------------------------------------------------ steps

    def transcribe(self, utt: Utterance) -> LiveLine | None:
        t0 = time.perf_counter()
        vocals = background = None
        audio = utt.audio
        if self.separator is not None:
            vocals = self.separator.separate_array(au.to_channels(audio, 2), utt.sr)
            background = au.to_channels(audio, 2) - vocals
            speech = vocals
        else:
            speech = audio
        t1 = time.perf_counter()
        v16 = au.resample(au.to_mono(speech), utt.sr, 16000)
        assert self.asr is not None
        text, lang = self.asr.transcribe_array(v16, self.src_lang)
        if not text or is_hallucination(text):
            return None
        try:
            lang = L.normalize(lang)
        except L.UnsupportedLanguage:
            return None
        if self.src_lang is None:  # lock the source language after a few confident votes
            self._lang_votes[lang] = self._lang_votes.get(lang, 0) + 1
            if self._lang_votes[lang] >= 4:
                self.src_lang = lang
                log.info("source language locked to %s", lang)
        t2 = time.perf_counter()
        speaker = "SPEAKER_00"
        if self.tracker is not None and self.embedder is not None and len(v16) > 16000 * 0.8:
            speaker = self.tracker.assign(self.embedder.embed(v16))
        mono = au.to_mono(speech)
        line = LiveLine(utt, speaker, text, "", lang, vocals, background,
                        au.gain_to_db(au.active_rms(mono, utt.sr)),
                        {"separate": t1 - t0, "asr": t2 - t1})
        if self.voices.offer(speaker, mono, utt.sr, text, lang) or speaker not in self._voice_version:
            self._refresh_voice(speaker, lang, mono, utt.sr)
        return line

    def _refresh_voice(self, speaker: str, lang: str, mono: np.ndarray, sr: int) -> None:
        assert self.tts is not None
        refs = self.voices.refs(speaker, lang)
        try:
            if refs:
                self.tts.set_voice(speaker, refs, lang)
            elif hasattr(self.tts, "set_voice_from_audio"):
                self.tts.set_voice_from_audio(speaker, mono, sr, self.tmp)
            else:
                return
            self._voice_version[speaker] = self.voices.version.get(speaker, 0)
        except Exception as e:
            log.debug("voice refresh failed for %s: %s", speaker, e)

    def translate(self, line: LiveLine) -> LiveLine:
        t0 = time.perf_counter()
        assert self.translator is not None
        if line.language == self.tgt_lang:
            line.text = line.source_text
        else:
            line.text = self.translator.translate_one(line.source_text, line.language, self.tgt_lang, slot=line.utt.duration)
        line.timings["translate"] = time.perf_counter() - t0
        return line

    def _style(self, line: LiveLine) -> StyleRef | None:
        if self.cfg.tts.prosody_reference == "speaker" or line.utt.duration < self.cfg.tts.min_style_ref_seconds:
            return None
        src = line.vocals if line.vocals is not None else line.utt.audio
        path = au.save(self.tmp / "style_current.wav", au.resample(au.to_mono(src), line.utt.sr, REF_SR), REF_SR)
        return StyleRef(str(path), line.source_text, line.language, line.utt.duration, None)

    def speak(self, line: LiveLine, stream: bool = True) -> Iterator[np.ndarray]:
        """Yields mono chunks at self.tts.sample_rate, loudness-matched to the original line."""
        assert self.tts is not None
        speaker = line.speaker if line.speaker in self._voice_version else next(iter(self._voice_version), None)
        if speaker is None:
            return
        style = self._style(line)
        gain = None
        target_db = line.rms_db + self.cfg.live.dub_gain_db
        gen = (self.tts.synthesize_stream(line.text, self.tgt_lang, speaker, style=style) if stream else
               iter([self.tts.synthesize(line.text, self.tgt_lang, speaker, style=style)]))
        for chunk in gen:
            if gain is None:
                level = au.active_rms(chunk, self.tts.sample_rate)
                gain = float(np.clip(au.db_to_gain(target_db) / max(level, 1e-4), 0.1, 8.0)) if level > 1e-4 else 1.0
            yield (chunk * gain).astype(np.float32)

    def close(self) -> None:
        for m in (self.asr, self.translator, self.tts, self.separator):
            try:
                if m is not None:
                    m.unload()
            except Exception:
                pass
