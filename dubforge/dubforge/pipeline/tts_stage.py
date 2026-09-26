"""The heart of the dub: per-line voice-cloned synthesis with prosody transfer and timing fit.

Per line:
  1. pick the style reference (original line audio / emotion-matched clip / none)
  2. synthesize up to `max_takes` takes; score each take against its expected
     length (catches XTTS babbling or cut-offs) and optionally an ASR check
  3. if nothing fits even with all tricks, try the next shorter translation
  4. re-synthesize faster inside the model if needed, then DSP-fit the rest
  5. match the original line's loudness (whispers stay whispers)
Each line is cached by a content hash, so editing one line re-renders only that line.
"""

from __future__ import annotations

import difflib
import json
import math
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import soundfile as sf

from ..config import DubConfig
from ..media import audio as au
from ..mixing.mixer import Placement
from ..timing.fit import Window, compute_windows, fit_audio, speed_for
from ..translation.languages import RateCalibrator
from ..tts.base import StyleRef, TTSBackend
from ..tts.voice_bank import REF_SR, VoiceBank
from ..types import Segment, Transcript
from ..utils.log import ProgressFn, get_logger, null_progress
from .state import chain

log = get_logger("tts")


@dataclass
class Take:
    text: str
    wav: np.ndarray
    seed: int
    score: float
    duration: float


class ASRVerifier:
    """Optional: re-transcribe takes with a small Whisper to catch hallucinated/garbled audio."""

    def __init__(self, model: str, device: str, models_dir: Path):
        from faster_whisper import WhisperModel

        dev = "cuda" if device.startswith("cuda") else "cpu"
        self.model = WhisperModel(model, device=dev, compute_type="int8_float16" if dev == "cuda" else "int8",
                                  download_root=str(models_dir / "faster-whisper"))

    def error(self, wav: np.ndarray, sr: int, text: str, lang: str) -> float:
        segs, _ = self.model.transcribe(au.resample(wav, sr, 16000), language=lang.split("-")[0], beam_size=1,
                                        vad_filter=False, without_timestamps=True)
        hyp = " ".join(s.text for s in segs).lower()
        return 1.0 - difflib.SequenceMatcher(None, _norm(text), _norm(hyp)).ratio()


def _norm(t: str) -> str:
    return "".join(ch for ch in t.lower() if ch.isalnum())


class TTSStage:
    def __init__(self, cfg: DubConfig, tts: TTSBackend, workdir: Path, vocals_path: Path, models_dir: Path,
                 device: str):
        self.cfg = cfg
        self.tts = tts
        self.wd = workdir
        self.vocals_path = vocals_path
        self.out_dir = workdir / "tts"
        self.style_dir = workdir / "style"
        self.out_dir.mkdir(parents=True, exist_ok=True)
        self.style_dir.mkdir(parents=True, exist_ok=True)
        self.index_path = self.out_dir / "index.json"
        self.index: dict[str, dict] = json.loads(self.index_path.read_text()) if self.index_path.exists() else {}
        self.bank = VoiceBank(workdir / "voices")
        self.bank.load()
        self.voices_ready: set[str] = set()
        self.voice_alias: dict[str, str] = {}  # speaker without usable audio -> borrowed voice
        self.calibrator = RateCalibrator()
        self.verifier = ASRVerifier(cfg.tts.verify_asr_model, device, models_dir) if cfg.tts.verify_asr_model else None
        self.cfg_key = cfg.section_hash("tts", "timing", "emotion", extra=tts.name)

    # ------------------------------------------------------------------ voices & styles

    def _ensure_voice(self, speaker: str, script: Transcript, vocals: sf.SoundFile) -> str:
        """Returns the speaker id whose voice will actually be used."""
        if speaker in self.voices_ready:
            return speaker
        if speaker in self.voice_alias:
            return self.voice_alias[speaker]
        refs = self.bank.refs_for(speaker)
        if not refs:
            refs = self._concat_ref(speaker, script, vocals)
        try:
            if refs:
                self.tts.set_voice(speaker, refs, script.language)
                self.voices_ready.add(speaker)
                return speaker
        except Exception as e:
            log.warning("could not build voice for %s (%s)", speaker, e)
        for other in script.speakers:  # borrow the most talkative character's voice
            if other != speaker and self.bank.refs_for(other):
                log.warning("%s has no usable reference audio; borrowing %s's voice", speaker, other)
                self.voice_alias[speaker] = self._ensure_voice(other, script, vocals)
                return self.voice_alias[speaker]
        raise RuntimeError(f"No reference audio at all for {speaker}")

    def _concat_ref(self, speaker: str, script: Transcript, vocals: sf.SoundFile):
        from ..tts.voice_bank import RefClip

        parts, total = [], 0.0
        for s in sorted((s for s in script.segments if s.speaker == speaker), key=lambda s: -s.speech_duration):
            wav = _read_mono(vocals, s.speech_start, s.speech_end)
            parts += [au.resample(wav, vocals.samplerate, REF_SR), np.zeros(int(0.25 * REF_SR), np.float32)]
            total += s.speech_duration
            if total >= 12:
                break
        if total < 1.5:
            return []
        path = au.save(self.bank.root / speaker / "ref_concat.wav", np.concatenate(parts), REF_SR)
        return [RefClip(str(path), speaker, 0.0, total, "", script.language, None, -20.0)]

    def _style(self, seg: Segment, vocals: sf.SoundFile, speaker: str) -> StyleRef | None:
        mode = self.cfg.tts.prosody_reference
        if mode == "speaker":
            return None
        if mode == "segment" and seg.speech_duration >= self.cfg.tts.min_style_ref_seconds:
            path = self.style_dir / f"seg_{seg.id:05d}.wav"
            if not path.exists():
                wav = _read_mono(vocals, seg.speech_start - 0.03, seg.speech_end + 0.05)
                au.save(path, au.fade(au.resample(wav, vocals.samplerate, REF_SR), REF_SR, 10, 20), REF_SR)
            return StyleRef(str(path), seg.text, self.script.language, seg.speech_duration + 0.08, seg.emotion)
        # emotion_matched (or segment too short): best reference clip with the same emotion
        refs = [r for r in self.bank.refs_for(speaker, seg.emotion) if r.emotion == seg.emotion]
        if refs:
            r = refs[0]
            return StyleRef(r.path, r.text, r.lang, r.duration, r.emotion)
        return None

    # ------------------------------------------------------------------ main loop

    def run(self, script: Transcript, progress: ProgressFn = null_progress) -> dict[int, Placement]:
        self.script = script
        tgt = script.target_language or self.cfg.target_lang
        dubbable = list(script.dubbable())
        windows = compute_windows(dubbable, self.cfg.timing, script.duration)
        placements: dict[int, Placement] = {}
        with sf.SoundFile(str(self.vocals_path)) as vocals:
            for n, seg in enumerate(dubbable):
                w = windows[seg.id]
                key = chain(self.cfg_key, seg.translation, seg.translation_candidates if not seg.translation_locked else None,
                            seg.speaker, seg.emotion, round(w.start, 3), round(w.target_end, 3), round(w.limit_end, 3),
                            self.cfg.tts.prosody_reference)
                cached = self.index.get(str(seg.id))
                out_path = self.out_dir / f"seg_{seg.id:05d}.wav"
                if cached and cached.get("key") == key and out_path.exists():
                    for f in ("tts_text", "tts_take", "tts_speed", "stretch", "placed_start", "placed_end", "fit_notes"):
                        setattr(seg, f, cached.get(f))
                    seg.tts_path = str(out_path)
                else:
                    try:
                        self._render(seg, w, tgt, vocals, out_path)
                    except Exception as e:
                        log.error("line %d failed (%s): keeping the original audio for it", seg.id, e)
                        seg.fit_notes = f"FAILED: {e}"
                        seg.tts_path = None
                        continue
                    self.index[str(seg.id)] = {"key": key, **{f: getattr(seg, f) for f in (
                        "tts_text", "tts_take", "tts_speed", "stretch", "placed_start", "placed_end", "fit_notes")}}
                    if n % 10 == 0:
                        self._save_index()
                if seg.tts_path and seg.placed_start is not None:
                    placements[seg.id] = Placement(seg.tts_path, seg.placed_start, seg.speech_start, seg.speech_end)
                progress((n + 1) / max(1, len(dubbable)), f"voicing line {n + 1}/{len(dubbable)}")
        self._save_index()
        return placements

    def _save_index(self) -> None:
        self.index_path.write_text(json.dumps(self.index, indent=1, ensure_ascii=False), encoding="utf-8")

    def _render(self, seg: Segment, w: Window, tgt: str, vocals: sf.SoundFile, out_path: Path) -> None:
        cfg, tcfg = self.cfg, self.cfg.timing
        sr = self.tts.sample_rate
        speaker = self._ensure_voice(seg.speaker, self.script, vocals)
        style = self._style(seg, vocals, speaker)
        temperature = cfg.emotion.temperature_by_emotion.get(seg.emotion or "neutral", cfg.tts.temperature)
        max_squeeze = (tcfg.max_tts_speed if self.tts.supports_speed else 1.0) * tcfg.max_stretch
        texts = [seg.translation or ""]
        if not seg.translation_locked and tcfg.try_shorter_candidates:
            first = self.calibrator.estimate(texts[0], tgt)
            shorter = sorted((c for c in seg.translation_candidates if c != texts[0]),
                             key=lambda c: self.calibrator.estimate(c, tgt))
            texts += [c for c in shorter if self.calibrator.estimate(c, tgt) < first * 0.95][:2]

        best: Take | None = None
        for ti, text in enumerate(texts):
            expected = max(0.3, self.calibrator.estimate(text, tgt))
            for take in range(max(1, cfg.tts.max_takes)):
                seed = cfg.general.seed + seg.id * 101 + take * 7 + ti * 1009
                wav = self.tts.synthesize(text, tgt, speaker, style=style, speed=1.0, temperature=temperature, seed=seed)
                wav, _, _ = au.trim_silence(wav, sr)
                if len(wav) < sr * 0.1:
                    continue
                dur = len(wav) / sr
                plausibility = abs(math.log(dur / expected))
                overflow = max(0.0, math.log(dur / (w.limit * max_squeeze)))
                score = plausibility + 2.0 * overflow + 0.2 * ti
                if self.verifier is not None:
                    score += 2.0 * self.verifier.error(wav, sr, text, tgt)
                if best is None or score < best.score:
                    best = Take(text, wav, seed, score, dur)
                if plausibility < 0.3 and self.verifier is None:
                    break
            if best is not None and best.duration <= w.limit * max_squeeze * 0.98:
                break
        if best is None:
            raise RuntimeError("TTS produced no audio")
        self.calibrator.update(best.text, tgt, best.duration)

        wav = best.wav
        seg.tts_speed = 1.0
        if self.tts.supports_speed:
            speed = speed_for(best.duration, w, tcfg)
            if speed > 1.01:
                fast = self.tts.synthesize(best.text, tgt, speaker, style=style, speed=speed, temperature=temperature,
                                           seed=best.seed)
                fast, _, _ = au.trim_silence(fast, sr)
                if sr * 0.1 < len(fast) < len(wav):
                    wav, seg.tts_speed = fast, round(speed, 3)

        fit = fit_audio(wav, sr, w, tcfg)
        audio = fit.audio
        if cfg.tts.match_loudness and seg.prosody.get("rms_db", -80.0) > -70.0:
            gain_db = float(np.clip(seg.prosody["rms_db"] - au.gain_to_db(au.active_rms(audio, sr)), -18, 18))
            audio = audio * au.db_to_gain(gain_db)
        audio = au.fade(audio, sr, 6, 25)
        au.save(out_path, audio, sr)
        seg.tts_text = best.text
        seg.tts_take = int(best.seed)
        seg.stretch = round(fit.rate, 3)
        seg.placed_start = round(w.start, 3)
        seg.placed_end = round(w.start + len(audio) / sr, 3)
        seg.tts_path = str(out_path)
        notes = [fit.notes] if fit.notes else []
        if best.text != seg.translation:
            notes.append("shorter candidate")
        if seg.tts_speed and seg.tts_speed > 1.0:
            notes.append(f"tts speed x{seg.tts_speed}")
        seg.fit_notes = ", ".join(notes)


def _read_mono(f: sf.SoundFile, start: float, end: float) -> np.ndarray:
    sr = f.samplerate
    f.seek(max(0, int(start * sr)))
    return au.to_mono(f.read(max(1, int((end - max(0.0, start)) * sr)), dtype="float32", always_2d=True))
