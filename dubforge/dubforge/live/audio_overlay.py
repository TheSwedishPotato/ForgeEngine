"""'While watching' mode #1: live audio overlay (interpreter style).

Routing (Windows):
    Netflix / any player  --->  "CABLE Input" (VB-Audio Virtual Cable)
    DubForge listens on "CABLE Output", and plays to your real speakers:
        original sound (ducked / dialogue-cancelled / muted)  +  cloned-voice dub
You no longer hear the player directly, because its output goes into the cable.

The dub trails the actor by roughly (VAD pause + ASR + MT + first TTS chunk),
typically ~1-2.5 s on a modern GPU. For picture-accurate sync use the delayed
video mode (live_video.py) instead.
"""

from __future__ import annotations

import queue
import threading
import time
from typing import Callable

import numpy as np

from ..config import DubConfig
from ..media import audio as au
from ..utils.log import get_logger
from .devices import find_device, stream_extra_settings
from .engine import LiveEngine, LiveLine
from .rings import FifoRing
from .vad import StreamingSegmenter, Utterance

log = get_logger("live.audio")

EventFn = Callable[[dict], None]


class _Ducker:
    """Smooth gain for the original sound while the dub is speaking."""

    def __init__(self, sr: int, duck_db: float, attack_ms: float = 60, release_ms: float = 450):
        self.gain = 1.0
        self.target_ducked = au.db_to_gain(duck_db)
        self.a = 1 - np.exp(-1 / (sr * attack_ms / 1000))
        self.r = 1 - np.exp(-1 / (sr * release_ms / 1000))

    def envelope(self, n: int, active: bool) -> np.ndarray:
        target = self.target_ducked if active else 1.0
        coef = self.a if active else self.r
        # closed-form one-pole ramp over the block
        k = np.arange(1, n + 1)
        env = target + (self.gain - target) * (1 - coef) ** k
        self.gain = float(env[-1])
        return env.astype(np.float32)


class LiveAudioDubber:
    def __init__(self, cfg: DubConfig, on_event: EventFn | None = None):
        self.cfg = cfg
        self.lc = cfg.live
        self.on_event = on_event or (lambda e: None)
        self.sr = self.lc.samplerate
        self.engine = LiveEngine(cfg)
        self.passthrough = FifoRing(2, int(self.sr * 0.5))
        self.dub = FifoRing(2, int(self.sr * 30))
        self.utterances: "queue.Queue[Utterance]" = queue.Queue()
        self.blocks: "queue.Queue[tuple[np.ndarray, int]]" = queue.Queue()
        self.ducker = _Ducker(self.sr, self.lc.duck_db)
        from scipy.signal import butter, sosfilt_zi

        # steep low-pass for the centre channel: keeps kick drums / score bass, rejects the voice band
        self._lp_sos = butter(4, 120, btype="lowpass", fs=self.sr, output="sos")
        self._lp_state = sosfilt_zi(self._lp_sos) * 0.0
        self._idx = 0
        self._running = threading.Event()
        self._threads: list[threading.Thread] = []
        self._streams: list = []

    # ------------------------------------------------------------------ audio callbacks (keep them light!)

    def _on_input(self, indata, frames, time_info, status) -> None:
        block = au.to_channels(np.asarray(indata, dtype=np.float32), 2).copy()
        self.passthrough.write(block)
        self.blocks.put((block, self._idx))
        self._idx += frames

    def _process_original(self, x: np.ndarray, dub_active: bool) -> np.ndarray:
        mode = self.lc.background_mode
        g = au.db_to_gain(self.lc.original_gain_db)
        if mode == "mute":
            return np.zeros_like(x)
        if mode == "passthrough":
            return x * g
        if mode == "center_cancel":
            # dialogue is mixed to the centre: keep the sides (L-R) + the bass of the centre
            from scipy.signal import sosfilt

            mid = x.mean(axis=1)
            side = (x[:, 0] - x[:, 1]) * 0.5
            low, self._lp_state = sosfilt(self._lp_sos, mid, zi=self._lp_state)
            return np.stack([low + side, low - side], axis=1).astype(np.float32) * g
        env = self.ducker.envelope(len(x), dub_active)  # duck
        return x * env[:, None] * g

    def _on_output(self, outdata, frames, time_info, status) -> None:
        # keep passthrough latency low: if input runs ahead (clock drift), drop the excess
        excess = self.passthrough.available() - int(self.sr * 0.12)
        if excess > frames:
            self.passthrough.read(excess - frames)
        orig = self.passthrough.read(frames)
        dub_active = self.dub.available() > 0
        dub = self.dub.read(frames)
        mix = self._process_original(orig, dub_active) + dub
        outdata[:] = au.soft_limit(mix, -0.5)

    # ------------------------------------------------------------------ worker threads

    def _segment_loop(self) -> None:
        seg = StreamingSegmenter(self.sr, self.lc.vad_threshold, self.lc.min_silence_ms, self.lc.min_utterance_seconds,
                                 self.lc.max_utterance_seconds)
        while self._running.is_set():
            try:
                block, idx = self.blocks.get(timeout=0.2)
            except queue.Empty:
                continue
            for utt in seg.feed(block, idx):
                self.utterances.put(utt)

    def _work_loop(self) -> None:
        eng = self.engine
        while self._running.is_set():
            try:
                utt = self.utterances.get(timeout=0.2)
            except queue.Empty:
                continue
            lag = time.perf_counter() - utt.t_final
            if lag > self.lc.max_queue_seconds:
                self.on_event({"type": "dropped", "reason": f"{lag:.1f}s behind"})
                continue
            try:
                line: LiveLine | None = eng.transcribe(utt)
                if line is None:
                    continue
                eng.translate(line)
                t0 = time.perf_counter()
                t_first = None
                for chunk in eng.speak(line, stream=self.lc.tts_streaming):
                    if t_first is None:
                        t_first = time.perf_counter()
                    self.dub.write(au.resample(chunk, eng.tts.sample_rate, self.sr))
                t_first = t_first or time.perf_counter()
                line.timings["tts_first_chunk"] = t_first - t0
                self.on_event({"type": "line", "speaker": line.speaker, "source": line.source_text, "text": line.text,
                               "latency": round(t_first - utt.t_final, 2),  # end of speech -> dub starts
                               "timings": {k: round(v, 2) for k, v in line.timings.items()}})
            except Exception as e:
                log.exception("live line failed")
                self.on_event({"type": "error", "message": str(e)})

    # ------------------------------------------------------------------ control

    def start(self) -> None:
        import sounddevice as sd

        self.on_event({"type": "status", "message": "loading models"})
        self.engine.load(lambda m: self.on_event({"type": "status", "message": m}))
        in_dev = find_device(self.lc.input_device, "input")
        out_dev = find_device(self.lc.output_device, "output")
        block = int(self.sr * self.lc.block_ms / 1000)
        in_ch = min(2, sd.query_devices(in_dev if in_dev is not None else sd.default.device[0])["max_input_channels"])
        self._running.set()
        self._threads = [threading.Thread(target=self._segment_loop, daemon=True, name="segmenter"),
                         threading.Thread(target=self._work_loop, daemon=True, name="dubber")]
        for t in self._threads:
            t.start()
        self._streams = [
            sd.InputStream(device=in_dev, samplerate=self.sr, channels=in_ch, blocksize=block, dtype="float32",
                           callback=self._on_input, extra_settings=stream_extra_settings(in_dev), latency="low"),
            sd.OutputStream(device=out_dev, samplerate=self.sr, channels=2, blocksize=block, dtype="float32",
                            callback=self._on_output, extra_settings=stream_extra_settings(out_dev), latency="low"),
        ]
        for s in self._streams:
            s.start()
        self.on_event({"type": "status", "message": "listening - press play in your player"})

    def stop(self) -> None:
        self._running.clear()
        for s in self._streams:
            try:
                s.stop()
                s.close()
            except Exception:
                pass
        for t in self._threads:
            t.join(timeout=2)
        self.engine.close()
        self.on_event({"type": "status", "message": "stopped"})

    def run_forever(self) -> None:
        self.start()
        try:
            while True:
                time.sleep(0.5)
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()
