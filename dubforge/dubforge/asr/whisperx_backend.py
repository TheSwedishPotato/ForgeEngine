"""WhisperX backend: batched Whisper + wav2vec2 word alignment + pyannote diarization."""

from __future__ import annotations

import inspect

from ..media import audio as au
from ..types import Segment, Transcript, Word
from ..utils.gpu import free_memory
from ..utils.log import get_logger
from .base import ASRBackend, join_words

log = get_logger("whisperx")


class WhisperXASR(ASRBackend):
    name = "whisperx"

    @property
    def provides_diarization(self) -> bool:  # type: ignore[override]
        return self.cfg.diarization in ("auto", "pyannote") and bool(self.hf_token or self._diarization_cached())

    def _diarization_cached(self) -> bool:
        if not self.models_dir:
            return False
        hub = self.models_dir / "huggingface" / "hub"
        return any(hub.glob("models--pyannote--speaker-diarization*")) if hub.exists() else False

    def transcribe(self, audio_path, language, progress=lambda f, m: None) -> Transcript:
        import whisperx

        device = "cuda" if self.device.startswith("cuda") else "cpu"
        audio, _ = au.load(audio_path, sr=16000, mono=True)
        duration = len(audio) / 16000

        # 1) transcription
        progress(0.02, "loading Whisper")
        load_kwargs = dict(compute_type=self.compute_type, language=language,
                           asr_options={"beam_size": self.cfg.beam_size, "initial_prompt": self.cfg.initial_prompt,
                                        "condition_on_previous_text": False})
        if self.models_dir:
            load_kwargs["download_root"] = str(self.models_dir / "faster-whisper")
        model = whisperx.load_model(self.cfg.model, device, **load_kwargs)
        progress(0.05, "transcribing")
        result = model.transcribe(audio, batch_size=self.cfg.batch_size, language=language)
        lang = result.get("language") or language or "en"
        del model
        free_memory()

        # 2) word alignment
        if self.cfg.align:
            progress(0.55, "aligning words")
            try:
                model_a, meta = whisperx.load_align_model(language_code=lang, device=device)
                result = whisperx.align(result["segments"], model_a, meta, audio, device, return_char_alignments=False)
                del model_a
            except Exception as e:  # no alignment model for this language -> segment timing only
                log.warning("Word alignment unavailable for '%s' (%s); continuing without it", lang, e)
            free_memory()

        # 3) diarization
        if self.provides_diarization:
            progress(0.75, "diarizing speakers")
            try:
                result = self._diarize(whisperx, audio, result, device)
            except Exception as e:
                log.warning("pyannote diarization failed (%s); falling back to ECAPA clustering", e)
                result["_diarized"] = False
            free_memory()

        segs: list[Segment] = []
        for s in result["segments"]:
            words = [
                Word(start=float(w["start"]), end=float(w["end"]), text=w.get("word", ""),
                     prob=float(w.get("score", 1.0)), speaker=w.get("speaker"))
                for w in s.get("words", []) if "start" in w and "end" in w
            ]
            text = s.get("text", "").strip() or join_words([w.text for w in words], lang)
            segs.append(Segment(id=len(segs), start=float(s["start"]), end=float(s["end"]), text=text,
                                speaker=s.get("speaker") or "SPEAKER_00", words=words,
                                avg_logprob=s.get("avg_logprob"), no_speech_prob=s.get("no_speech_prob")))
        progress(1.0, "transcription done")
        t = Transcript(segments=segs, language=lang, duration=duration)
        t.meta["diarized"] = bool(result.get("_diarized"))
        return t

    def _diarize(self, whisperx, audio, result, device):
        try:
            from whisperx.diarize import DiarizationPipeline
        except ImportError:
            DiarizationPipeline = whisperx.DiarizationPipeline  # older whisperx
        params = inspect.signature(DiarizationPipeline.__init__).parameters
        kwargs = {"device": device}
        if self.cfg.diarization_model:
            kwargs["model_name"] = self.cfg.diarization_model
        if "token" in params:
            kwargs["token"] = self.hf_token
        else:
            kwargs["use_auth_token"] = self.hf_token
        if "cache_dir" in params and self.models_dir:
            kwargs["cache_dir"] = str(self.models_dir / "huggingface" / "hub")
        pipe = DiarizationPipeline(**kwargs)
        diar = pipe(audio, min_speakers=self.cfg.min_speakers, max_speakers=self.cfg.max_speakers)
        if isinstance(diar, tuple):
            diar = diar[0]
        result = whisperx.assign_word_speakers(diar, result)
        result["_diarized"] = True
        del pipe
        return result
