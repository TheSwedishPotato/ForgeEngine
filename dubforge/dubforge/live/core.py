"""Live dubbing engine - hardware-free core (testable offline).

Time model: everything is indexed in *input samples* (absolute count since start). The output
plays input position `T_now - delay` at any moment, i.e. the whole show runs `delay` seconds
behind real time. A dubbed line for speech at input position `a` is scheduled at `a`, so it
sounds exactly `delay` seconds after the original was spoken - IF it is ready by then.
The video must be delayed by the same amount to stay in sync (see video_delay.py).

Honest limits: a sentence can only be dubbed after it has been spoken, then it needs ASR +
translation + TTS time. So `delay` must exceed (longest sentence + processing). 10-15 s is
realistic on an 8-12 GB GPU; lines that miss the deadline are played late and counted.
"""
from __future__ import annotations

import queue
import tempfile
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np

from ..audio_utils import (active_rms_db, db_to_gain, energy_speech_spans, fade, resample, time_stretch,
                           trim_silence, write_audio)
from ..base import ASR, Style, Translator, TTS
from ..config import Config
from ..mix import plan_fit
from ..tts.common import looks_broken
from ..types import Segment

VadFn = Callable[[np.ndarray, int], list[tuple[float, float]]]


class RingBuffer:
    """Mono ring buffer addressed by absolute sample index."""

    def __init__(self, capacity: int):
        self.cap = capacity
        self.buf = np.zeros(capacity, dtype=np.float32)
        self.total = 0
        self._lock = threading.Lock()

    def write(self, x: np.ndarray) -> None:
        with self._lock:
            added = len(x)
            x = x[-self.cap:]                       # a block bigger than the buffer keeps only its tail
            n = len(x)
            i = (self.total + added - n) % self.cap  # ring slot of x[0]
            first = min(n, self.cap - i)
            self.buf[i:i + first] = x[:first]
            if n > first:
                self.buf[:n - first] = x[first:]
            self.total += added

    def read(self, start: int, n: int) -> np.ndarray:
        """Samples [start, start+n); zeros for anything not (or no longer) in the buffer."""
        with self._lock:
            out = np.zeros(n, dtype=np.float32)
            lo = max(start, self.total - self.cap, 0)
            hi = min(start + n, self.total)
            if hi <= lo:
                return out
            idx = np.arange(lo, hi) % self.cap
            out[lo - start:hi - start] = self.buf[idx]
            return out


def silero_vad(window_s_min_silence: float = 0.5) -> VadFn:
    """VAD from faster-whisper's bundled Silero model; falls back to the energy VAD."""
    try:
        from faster_whisper.vad import VadOptions, get_speech_timestamps
        opts = VadOptions(min_silence_duration_ms=int(window_s_min_silence * 1000), speech_pad_ms=120,
                          min_speech_duration_ms=250)

        def vad(audio16k: np.ndarray, sr: int) -> list[tuple[float, float]]:
            return [(c["start"] / sr, c["end"] / sr) for c in get_speech_timestamps(audio16k, opts)]
        return vad
    except Exception:
        return lambda a, sr: energy_speech_spans(a, sr, min_silence_s=window_s_min_silence)


class UtteranceSegmenter:
    """Finds finished utterances in the ring buffer (speech followed by `min_silence_s` of quiet)."""

    def __init__(self, sr: int, vad: VadFn, min_silence_s: float = 0.6, max_utt_s: float = 10.0,
                 min_utt_s: float = 0.4, window_s: float = 24.0, vad_sr: int = 16000):
        self.sr, self.vad, self.vad_sr = sr, vad, vad_sr
        self.min_sil, self.max_utt, self.min_utt, self.window = min_silence_s, max_utt_s, min_utt_s, window_s
        self.emitted_until = 0                                    # absolute sample index

    def poll(self, ring: RingBuffer) -> list[tuple[int, int]]:
        now = ring.total
        start = max(self.emitted_until, now - int(self.window * self.sr), 0)
        if now - start < int(0.3 * self.sr):
            return []
        audio = ring.read(start, now - start)
        a16 = resample(audio, self.sr, self.vad_sr)
        out: list[tuple[int, int]] = []
        for s, e in self.vad(a16, self.vad_sr):
            a, b = start + int(s * self.sr), start + int(e * self.sr)
            closed = b <= now - int(self.min_sil * self.sr)
            # force-cut a very long utterance that is still open
            while b - a > int(self.max_utt * self.sr) and (closed or b - a > int(self.max_utt * self.sr) + int(1.5 * self.sr)):
                cut = self._best_cut(ring, a + int((self.max_utt - 2.0) * self.sr), a + int(self.max_utt * self.sr))
                out.append((a, cut))
                a = cut
            if closed and (b - a) >= int(self.min_utt * self.sr):
                out.append((a, b))
                self.emitted_until = max(self.emitted_until, b)
            elif out:
                self.emitted_until = max(self.emitted_until, out[-1][1])
        return out

    def _best_cut(self, ring: RingBuffer, lo: int, hi: int) -> int:
        x = ring.read(lo, hi - lo)
        n = max(1, int(0.1 * self.sr))
        m = len(x) // n
        if m == 0:
            return hi
        e = np.mean(x[: m * n].reshape(m, n) ** 2, axis=1)
        return lo + int(np.argmin(e)) * n + n // 2


@dataclass
class Clip:
    start: int                 # input-sample position where it should begin
    audio: np.ndarray          # mono at the engine sample rate


class OutputMixer:
    def __init__(self, sr: int, delay_s: float, ring: RingBuffer, bed_gain: float = 0.0,
                 resync_s: float = 0.5, offset_ms: float = 0.0):
        self.sr, self.ring, self.bed_gain, self.resync = sr, ring, bed_gain, int(resync_s * sr)
        self.delay_n = int((delay_s + offset_ms / 1000.0) * sr)
        self.head: int | None = None
        self.clips: list[Clip] = []
        self._lock = threading.Lock()

    def head_estimate(self, input_total: int) -> int:
        return input_total - self.delay_n

    def schedule(self, start: int, audio: np.ndarray, input_total: int) -> bool:
        """Queue a clip. Returns True if it is on time, False if it had to start late."""
        head = self.head if self.head is not None else self.head_estimate(input_total)
        late = start < head
        with self._lock:
            self.clips.append(Clip(max(start, head), audio))
        return not late

    def pull(self, n: int, input_total: int) -> np.ndarray:
        """Next `n` stereo output frames."""
        if self.head is None or abs(self.head_estimate(input_total) - self.head) > self.resync:
            self.head = self.head_estimate(input_total)           # first call / clock drift correction
        h = self.head
        mono = np.zeros(n, dtype=np.float32)
        if self.bed_gain > 0:
            mono += self.ring.read(h, n) * self.bed_gain
        with self._lock:
            keep = []
            for c in self.clips:
                if c.start >= h + n:                       # not due yet
                    keep.append(c)
                    continue
                lo = max(h, c.start)
                off = lo - c.start                         # how much of the clip already played
                seg = c.audio[off:off + (h + n - lo)]
                if len(seg):
                    mono[lo - h:lo - h + len(seg)] += seg
                if off + len(seg) < len(c.audio):          # more to play next block
                    keep.append(c)
            self.clips = keep
        self.head = h + n
        y = np.clip(mono, -1.0, 1.0)
        return np.stack([y, y], axis=1)


@dataclass
class LiveStats:
    utterances: int = 0
    dubbed: int = 0
    late: int = 0
    empty: int = 0
    errors: int = 0
    proc_seconds: list[float] = field(default_factory=list)

    def summary(self) -> str:
        avg = sum(self.proc_seconds) / len(self.proc_seconds) if self.proc_seconds else 0.0
        mx = max(self.proc_seconds, default=0.0)
        return (f"utterances={self.utterances} dubbed={self.dubbed} late={self.late} empty={self.empty} "
                f"errors={self.errors} avg_proc={avg:.1f}s max_proc={mx:.1f}s")


class LiveDubber:
    def __init__(self, cfg: Config, asr: ASR, translator: Translator, tts: TTS, src: str, tgt: str, *,
                 sr: int = 48000, delay_s: float = 12.0, bed_gain: float = 0.0, vad: VadFn | None = None,
                 sync: bool = False, offset_ms: float = 0.0, work_dir: Path | None = None,
                 on_text: Callable[[str, str], None] | None = None):
        self.cfg, self.asr, self.tr, self.tts = cfg, asr, translator, tts
        self.src, self.tgt, self.sr, self.delay_s, self.sync = src, tgt, sr, delay_s, sync
        self.ring = RingBuffer(int((delay_s + 40.0) * sr))
        self.seg = UtteranceSegmenter(sr, vad or silero_vad())
        self.mixer = OutputMixer(sr, delay_s, self.ring, bed_gain, offset_ms=offset_ms)
        self.stats = LiveStats()
        self.on_text = on_text or (lambda s, t: None)
        self._tmp = Path(work_dir) if work_dir else Path(tempfile.mkdtemp(prefix="dubforge_live_"))
        self._tmp.mkdir(parents=True, exist_ok=True)
        self._q: queue.Queue = queue.Queue()
        self._prev: tuple[int, np.ndarray] | None = None          # (end_sample, audio) of previous utterance
        self._level_hist: list[float] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._n = 0

    # ---------------------------------------------------------------- audio thread side
    def feed(self, mono_block: np.ndarray) -> None:
        self.ring.write(mono_block.astype(np.float32, copy=False))

    def pull(self, n: int) -> np.ndarray:
        return self.mixer.pull(n, self.ring.total)

    # ---------------------------------------------------------------- worker side
    def step(self) -> None:
        for span in self.seg.poll(self.ring):
            self._q.put(span)
        if self.sync:
            while not self._q.empty():
                self._handle(self._q.get())

    def start(self) -> None:
        def loop():
            while not self._stop.is_set():
                self.step()
                try:
                    span = self._q.get(timeout=0.15)
                except queue.Empty:
                    continue
                self._handle(span)
        self._thread = threading.Thread(target=loop, daemon=True, name="dub-worker")
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=5)

    def _handle(self, span: tuple[int, int]) -> None:
        t0 = time.perf_counter()
        self.stats.utterances += 1
        try:
            self.process_utterance(*span, t0=t0)
        except Exception as e:                                     # never kill the show over one line
            self.stats.errors += 1
            self.on_text("error", f"{type(e).__name__}: {e}")
        self.stats.proc_seconds.append(time.perf_counter() - t0)

    def process_utterance(self, a: int, b: int, t0: float | None = None) -> None:
        t0 = t0 or time.perf_counter()
        pad = int(0.15 * self.sr)
        audio = self.ring.read(max(0, a - pad), b - a + pad)
        a16 = resample(audio, self.sr, 16000)
        segs, _ = self.asr.transcribe_array(a16, self.src)
        text = " ".join(s.text for s in segs).strip()
        if not text:
            self.stats.empty += 1
            return
        seg = Segment(id=self._n, start=a / self.sr, end=b / self.sr, text=text)
        self._n += 1
        self.tr.translate([seg], self.src, self.tgt)
        if not seg.translation.strip():
            self.stats.empty += 1
            return

        ref = self._reference(a, b, audio)
        level = active_rms_db(audio, self.sr)
        self._level_hist = (self._level_hist + [level])[-30:]
        arousal = float(np.clip((level - float(np.median(self._level_hist))) / 9.0, -1, 1))
        style = Style(exaggeration=float(np.clip(self.cfg.tts.base_exaggeration + 0.2 * arousal, 0.25, 1.4)),
                      arousal=arousal)
        wav = None
        for attempt in range(1 + min(1, self.cfg.tts.retries)):    # at most one retry live: time is tight
            style.seed = self._n * 100 + attempt
            wav = self.tts.synthesize(seg.translation, self.tgt, ref, style)
            if not looks_broken(wav, self.tts.sample_rate, seg.translation, self.tgt):
                break
        wav = trim_silence(wav, self.tts.sample_rate)
        d = len(wav) / self.tts.sample_rate
        plan = plan_fit([seg], {seg.id: d}, self.cfg.fit, total_duration=1e9)[seg.id]
        wav = resample(wav, self.tts.sample_rate, self.sr)
        wav = time_stretch(wav, self.sr, plan.ratio)
        if self.cfg.fit.match_loudness and len(wav):
            wav = wav * db_to_gain(float(np.clip(level - active_rms_db(wav, self.sr), -18, 12)))
        wav = fade(wav, self.sr)

        elapsed = time.perf_counter() - t0
        ready_total = self.ring.total + (int(elapsed * self.sr) if self.sync else 0)
        on_time = self.mixer.schedule(a, wav, ready_total)
        self.stats.dubbed += 1
        self.stats.late += (not on_time)
        self.on_text(seg.text, seg.translation + ("" if on_time else "   [LATE - raise --delay]"))

    def _reference(self, a: int, b: int, audio: np.ndarray) -> Path:
        """Own audio if long enough, else prepend the previous utterance (likely same speaker)."""
        ref = audio
        if len(audio) < 3.0 * self.sr and self._prev is not None and a - self._prev[0] < 4 * self.sr:
            ref = np.concatenate([self._prev[1], audio])
        ref = ref[-int(12 * self.sr):]
        self._prev = (b, audio)
        path = self._tmp / f"ref_{self._n:05d}.wav"
        write_audio(path, resample(ref, self.sr, 24000), 24000)
        for old in sorted(self._tmp.glob("ref_*.wav"))[:-6]:
            old.unlink(missing_ok=True)
        return path
