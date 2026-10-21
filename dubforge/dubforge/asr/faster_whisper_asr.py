"""faster-whisper transcription with word timestamps (CTranslate2, fast and VRAM-light)."""
from __future__ import annotations

from pathlib import Path

from ..base import ASR, Progress, _noop
from ..config import Config
from ..env import resolve_device
from ..types import Segment, Word


class FasterWhisperASR(ASR):
    name = "faster_whisper"

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.model = None

    def load(self) -> None:
        from faster_whisper import WhisperModel
        dev = resolve_device(self.cfg)
        ct = self.cfg.asr.compute_type if dev == "cuda" else "int8"
        self.model = WhisperModel(self.cfg.asr.model, device=dev, compute_type=ct,
                                  download_root=str(Path(self.cfg.models_dir) / "whisper"))

    def transcribe_array(self, audio_16k, language):
        return self._run(audio_16k, language, _noop)

    def transcribe(self, wav_path: Path, language: str | None, progress: Progress = _noop
                   ) -> tuple[list[Segment], str]:
        return self._run(str(wav_path), language, progress)

    def _run(self, audio, language: str | None, progress: Progress) -> tuple[list[Segment], str]:
        a = self.cfg.asr
        it, info = self.model.transcribe(
            audio, language=language, beam_size=a.beam_size, word_timestamps=True,
            vad_filter=a.vad, vad_parameters={"min_silence_duration_ms": 300, "speech_pad_ms": 150},
            condition_on_previous_text=False,       # stops the repetition loops Whisper falls into on long audio
            no_speech_threshold=0.6, temperature=[0.0, 0.2, 0.4])
        out: list[Segment] = []
        for s in it:
            text = s.text.strip()
            # Whisper hallucinates on music/noise: drop segments it is unsure are speech
            if len(text) < a.min_text_chars or s.no_speech_prob > 0.85 or s.avg_logprob < -1.6 \
                    or s.compression_ratio > 2.6:
                continue
            words = [Word(w.start, w.end, w.word) for w in (s.words or [])]
            out.append(Segment(id=len(out), start=float(s.start), end=float(s.end), text=text, words=words))
            if info.duration:
                progress(min(1.0, s.end / info.duration), "transcribing")
        return out, info.language
