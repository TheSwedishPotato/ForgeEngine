"""Streaming utterance segmentation for live mode (Silero VAD, energy fallback)."""

from __future__ import annotations

import time
from dataclasses import dataclass

import numpy as np

from ..media import audio as au
from ..utils.log import get_logger

log = get_logger("vad")

VAD_SR = 16000
FRAME = 512  # Silero's native window at 16 kHz (32 ms)


@dataclass
class Utterance:
    start_idx: int  # absolute sample index (capture sample rate) of the first sample
    audio: np.ndarray  # [n, ch] at capture rate
    sr: int
    t_final: float  # perf_counter when the utterance was closed

    @property
    def duration(self) -> float:
        return len(self.audio) / self.sr

    @property
    def end_idx(self) -> int:
        return self.start_idx + len(self.audio)


class _SileroVAD:
    def __init__(self):
        from silero_vad import load_silero_vad

        self.model = load_silero_vad()

    def prob(self, frame16k: np.ndarray) -> float:
        import torch

        with torch.inference_mode():
            return float(self.model(torch.from_numpy(frame16k.astype(np.float32)), VAD_SR).item())

    def reset(self) -> None:
        self.model.reset_states()


class _EnergyVAD:
    """Adaptive noise-floor energy detector (no dependencies)."""

    def __init__(self):
        self.floor = 1e-3

    def prob(self, frame16k: np.ndarray) -> float:
        e = float(np.sqrt(np.mean(frame16k**2)) + 1e-9)
        self.floor = 0.995 * self.floor + 0.005 * e if e < self.floor * 3 else self.floor * 1.0005
        return float(np.clip((20 * np.log10(e / self.floor) - 6) / 12, 0, 1))

    def reset(self) -> None:
        pass


class StreamingSegmenter:
    def __init__(self, sr: int, threshold: float = 0.5, min_silence_ms: int = 350, min_utterance_s: float = 0.5,
                 max_utterance_s: float = 8.0, preroll_ms: int = 250, use_silero: bool = True):
        self.sr = sr
        self.threshold = threshold
        self.min_silence_frames = max(1, int(min_silence_ms / 32))
        self.min_len = int(min_utterance_s * sr)
        self.max_len = int(max_utterance_s * sr)
        self.preroll = int(preroll_ms / 1000 * sr)
        try:
            self.vad = _SileroVAD() if use_silero else _EnergyVAD()
        except Exception as e:
            log.warning("Silero VAD unavailable (%s); using energy VAD", e)
            self.vad = _EnergyVAD()
        self._buf16 = np.zeros(0, np.float32)
        self._hist: list[np.ndarray] = []  # recent capture-rate audio (pre-roll + current utterance)
        self._hist_start = 0  # absolute index of _hist[0][0]
        self._in_speech = False
        self._speech_start = 0
        self._silence = 0
        self._consumed16 = 0

    def _hist_array(self) -> np.ndarray:
        return np.concatenate(self._hist, axis=0) if self._hist else np.zeros((0, 2), np.float32)

    def _trim_hist(self, keep_from: int) -> None:
        arr = self._hist_array()
        cut = max(0, keep_from - self._hist_start)
        self._hist = [arr[cut:]] if cut < len(arr) else []
        self._hist_start += min(cut, len(arr))

    def feed(self, block: np.ndarray, start_idx: int) -> list[Utterance]:
        """block: [n, ch] float32 at self.sr beginning at absolute sample start_idx."""
        if not self._hist:
            self._hist_start = start_idx
        self._hist.append(block)
        mono = au.to_mono(block)
        self._buf16 = np.concatenate([self._buf16, au.resample(mono, self.sr, VAD_SR)])
        out: list[Utterance] = []
        ratio = self.sr / VAD_SR
        while len(self._buf16) >= FRAME:
            frame, self._buf16 = self._buf16[:FRAME], self._buf16[FRAME:]
            frame_end_idx = start_idx - int(len(self._buf16) * ratio) + len(block)
            p = self.vad.prob(frame)
            if not self._in_speech:
                if p >= self.threshold:
                    self._in_speech = True
                    self._silence = 0
                    self._speech_start = max(self._hist_start, frame_end_idx - int(FRAME * ratio) - self.preroll)
                else:
                    self._trim_hist(frame_end_idx - self.preroll)
                continue
            self._silence = self._silence + 1 if p < self.threshold - 0.15 else 0
            length = frame_end_idx - self._speech_start
            if self._silence >= self.min_silence_frames or length >= self.max_len:
                end = frame_end_idx - (int(self._silence * FRAME * ratio * 0.6) if self._silence else 0)
                utt = self._cut(self._speech_start, end)
                if utt is not None and len(utt.audio) >= self.min_len:
                    out.append(utt)
                self._in_speech = self._silence < self.min_silence_frames  # forced cut: keep listening
                self._speech_start = end
                self._silence = 0
                self._trim_hist(end - (0 if self._in_speech else self.preroll))
        return out

    def _cut(self, a: int, b: int) -> Utterance | None:
        arr = self._hist_array()
        s, e = max(0, a - self._hist_start), max(0, b - self._hist_start)
        if e <= s:
            return None
        return Utterance(a, arr[s:e].copy(), self.sr, time.perf_counter())
