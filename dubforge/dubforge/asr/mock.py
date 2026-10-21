"""CPU-only stand-in for ASR: finds speech-like bursts by energy and labels them. Lets the whole
pipeline (separation -> fit -> mix -> mux) be exercised without a GPU."""
from __future__ import annotations

from pathlib import Path

from ..audio_utils import energy_speech_spans, read_audio
from ..base import ASR, Progress, _noop
from ..config import Config
from ..types import Segment, Word


class EnergyMockASR(ASR):
    name = "energy_mock"

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def transcribe_array(self, audio_16k, language):
        return self._from_audio(audio_16k, 16000, language)

    def transcribe(self, wav_path: Path, language: str | None, progress: Progress = _noop
                   ) -> tuple[list[Segment], str]:
        x, sr = read_audio(wav_path, mono=True)
        return self._from_audio(x, sr, language)

    def _from_audio(self, x, sr, language):
        spans = energy_speech_spans(x, sr)
        segs = []
        for i, (a, b) in enumerate(spans):
            text = f"This is test line number {i + 1}."
            words, t = [], a
            toks = text.split()
            step = (b - a) / len(toks)
            for w in toks:
                words.append(Word(t, t + step, " " + w))
                t += step
            segs.append(Segment(id=i, start=a, end=b, text=text, words=words))
        return segs, language or "en"
