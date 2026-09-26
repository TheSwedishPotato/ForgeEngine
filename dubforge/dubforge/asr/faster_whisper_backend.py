"""faster-whisper (CTranslate2) backend: fast, word timestamps, no diarization
(speakers are assigned afterwards by ECAPA clustering)."""

from __future__ import annotations

from ..types import Segment, Transcript, Word
from ..utils.gpu import free_memory
from .base import ASRBackend, join_words


class FasterWhisperASR(ASRBackend):
    name = "faster_whisper"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.model = None

    def load(self) -> None:
        if self.model is not None:
            return
        from faster_whisper import WhisperModel

        device = "cuda" if self.device.startswith("cuda") else "cpu"
        index = int(self.device.split(":")[1]) if ":" in self.device else 0
        download_root = str(self.models_dir / "faster-whisper") if self.models_dir else None
        self.model = WhisperModel(self.cfg.model, device=device, device_index=index,
                                  compute_type=self.compute_type, download_root=download_root)

    def unload(self) -> None:
        self.model = None
        free_memory()

    def transcribe(self, audio_path, language, progress=lambda f, m: None) -> Transcript:
        self.load()
        assert self.model is not None
        segments_iter, info = self.model.transcribe(
            str(audio_path),
            language=language,
            beam_size=self.cfg.beam_size,
            word_timestamps=True,
            vad_filter=True,
            vad_parameters={"min_silence_duration_ms": 400, "speech_pad_ms": 150},
            condition_on_previous_text=False,  # fewer runaway hallucinations on long films
            initial_prompt=self.cfg.initial_prompt,
        )
        lang = info.language
        total = max(info.duration, 1e-3)
        segs: list[Segment] = []
        for s in segments_iter:
            words = [Word(start=w.start, end=w.end, text=w.word, prob=w.probability) for w in (s.words or [])]
            text = join_words([w.text for w in words], lang) if words else s.text.strip()
            segs.append(Segment(id=len(segs), start=s.start, end=s.end, text=text, words=words,
                                avg_logprob=s.avg_logprob, no_speech_prob=s.no_speech_prob))
            progress(min(1.0, s.end / total), f"transcribed {s.end / 60:.1f}/{total / 60:.1f} min")
        return Transcript(segments=segs, language=lang, duration=info.duration)

    def transcribe_array(self, audio16k, language: str | None) -> tuple[str, str]:
        """Live mode helper: returns (text, detected_language)."""
        self.load()
        assert self.model is not None
        segments_iter, info = self.model.transcribe(
            audio16k, language=language, beam_size=self.cfg.beam_size, vad_filter=False,
            condition_on_previous_text=False, without_timestamps=True,
        )
        text = " ".join(s.text.strip() for s in segments_iter).strip()
        return text, info.language
