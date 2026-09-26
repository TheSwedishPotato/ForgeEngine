"""'While watching' mode #2: delayed full-video dub (rolling buffer).

We capture the screen region of your player + its audio, hold everything back
by `delay_seconds` (default 12 s), and use that head start to dub each line
*in place*: the dub starts exactly where the actor starts, is time-fitted to
the original line, the original dialogue under it is replaced by the
separated background, and (optionally) the mouth is re-synced with Wav2Lip.
You watch the delayed result in a window (or OBS Virtual Camera).

Everything runs on the audio clock (sample index), so picture and sound stay locked.

Note: DRM-protected players (e.g. Netflix in a browser or the Windows app)
normally present black frames to screen capture. This mode is for sources that
can be captured: your own videos, DRM-free streams, local players.
"""

from __future__ import annotations

import queue
import threading
import time
from collections import deque
from typing import Callable

import numpy as np

from ..config import DubConfig, resolve_path
from ..media import audio as au
from ..timing.fit import Window, fit_audio
from ..utils.log import get_logger
from .devices import find_device, stream_extra_settings
from .engine import LiveEngine
from .rings import TimelineRing
from .vad import StreamingSegmenter, Utterance

log = get_logger("live.video")


class SubtitleRenderer:
    def __init__(self):
        self.font = None
        try:
            from PIL import ImageFont

            for name in ("arial.ttf", "DejaVuSans.ttf", "Arial.ttf", "LiberationSans-Regular.ttf"):
                try:
                    self.font = ImageFont.truetype(name, 28)
                    break
                except OSError:
                    continue
        except ImportError:
            pass

    def draw(self, frame: np.ndarray, text: str) -> np.ndarray:
        if not text or self.font is None:
            return frame
        from PIL import Image, ImageDraw

        img = Image.fromarray(frame[..., ::-1])
        d = ImageDraw.Draw(img)
        w, h = img.size
        box = d.textbbox((0, 0), text, font=self.font)
        tw, th = box[2] - box[0], box[3] - box[1]
        x, y = (w - tw) // 2, h - th - 40
        d.rectangle((x - 10, y - 6, x + tw + 10, y + th + 10), fill=(0, 0, 0))
        d.text((x, y), text, font=self.font, fill=(255, 255, 255))
        return np.asarray(img)[..., ::-1].copy()


class LiveVideoDubber:
    def __init__(self, cfg: DubConfig, on_event: Callable[[dict], None] | None = None):
        self.cfg = cfg
        self.lc = cfg.live
        self.vc = cfg.live.video
        self.on_event = on_event or (lambda e: None)
        self.sr = self.lc.samplerate
        self.delay = int(self.vc.delay_seconds * self.sr)
        cap = int((self.vc.delay_seconds + 30) * self.sr)
        self.orig = TimelineRing(2, cap)
        self.bg = TimelineRing(2, cap)
        self.mask = TimelineRing(1, cap)
        self.dubtl = TimelineRing(2, cap)
        self.engine = LiveEngine(cfg, separate_vocals=True)
        self.blocks: "queue.Queue[tuple[np.ndarray, int]]" = queue.Queue()
        self.utterances: "queue.Queue[Utterance]" = queue.Queue()
        self.frames: deque = deque()  # [sample_idx, frame]
        self.frames_lock = threading.Lock()
        self.subs: deque = deque(maxlen=64)  # (start_idx, end_idx, text)
        self.write_idx = 0
        self.play_idx: int | None = None
        self._running = threading.Event()
        self._threads: list[threading.Thread] = []
        self._streams: list = []
        self.lip = None
        self.subtitles = SubtitleRenderer() if self.lc.show_subtitles else None

    # ------------------------------------------------------------------ audio

    def _on_input(self, indata, frames, time_info, status) -> None:
        block = au.to_channels(np.asarray(indata, dtype=np.float32), 2).copy()
        self.orig.write(self.write_idx, block)
        self.blocks.put((block, self.write_idx))
        self.write_idx += frames

    def _on_output(self, outdata, frames, time_info, status) -> None:
        if self.play_idx is None:
            if self.write_idx >= self.delay:
                self.play_idx = self.write_idx - self.delay
            outdata[:] = 0
            return
        drift = (self.write_idx - self.play_idx) - self.delay
        if abs(drift) > self.sr * 0.1:  # device clocks drifted apart: resync
            self.play_idx += drift
        p = self.play_idx
        orig = self.orig.read(p, frames)
        m = self.mask.read(p, frames)
        mix = orig * (1 - m) + self.bg.read(p, frames) * m + self.dubtl.read(p, frames)
        for ring in (self.mask, self.dubtl, self.bg):  # consumed: clear so the ring can wrap safely
            ring.clear_range(p, frames)
        outdata[:] = au.soft_limit(mix, -0.5)
        self.play_idx = p + frames

    # ------------------------------------------------------------------ video

    def _grab_region(self, sct) -> dict:
        if self.vc.region:
            l, t, w, h = self.vc.region
            return {"left": l, "top": t, "width": w, "height": h}
        return sct.monitors[self.vc.monitor]

    def _capture_loop(self) -> None:
        import cv2
        import mss

        make = getattr(mss, "MSS", None) or mss.mss
        with make() as sct:
            region = self._grab_region(sct)
            period = 1.0 / self.vc.fps
            next_t = time.perf_counter()
            while self._running.is_set():
                shot = np.asarray(sct.grab(region))[..., :3]
                if self.vc.scale != 1.0:
                    shot = cv2.resize(shot, None, fx=self.vc.scale, fy=self.vc.scale, interpolation=cv2.INTER_AREA)
                with self.frames_lock:
                    self.frames.append([self.write_idx, np.ascontiguousarray(shot)])
                    limit = self.delay + self.sr * 5
                    while self.frames and self.write_idx - self.frames[0][0] > limit:
                        self.frames.popleft()
                next_t += period
                time.sleep(max(0.0, next_t - time.perf_counter()))

    def _present_loop(self) -> None:
        import cv2

        cam = None
        title = "DubForge (delayed dub) - F fullscreen, Q quit"
        period = 1.0 / self.vc.fps
        shown = None
        while self._running.is_set():
            t0 = time.perf_counter()
            p = self.play_idx
            if p is not None:
                with self.frames_lock:
                    while len(self.frames) > 1 and self.frames[1][0] <= p:
                        self.frames.popleft()
                    shown = self.frames[0][1] if self.frames and self.frames[0][0] <= p else shown
            if shown is not None:
                frame = shown
                if self.subtitles is not None and p is not None:
                    text = next((t for a, b, t in reversed(self.subs) if a <= p <= b), "")
                    frame = self.subtitles.draw(frame, text)
                if self.vc.output == "virtualcam":
                    if cam is None:
                        import pyvirtualcam

                        h, w = frame.shape[:2]
                        cam = pyvirtualcam.Camera(width=w, height=h, fps=self.vc.fps, fmt=pyvirtualcam.PixelFormat.BGR)
                        self.on_event({"type": "status", "message": f"virtual camera: {cam.device}"})
                    cam.send(frame)
                else:
                    cv2.imshow(title, frame)
                    key = cv2.waitKey(1) & 0xFF
                    if key in (ord("q"), 27):
                        self._running.clear()
                    elif key == ord("f"):
                        full = cv2.getWindowProperty(title, cv2.WND_PROP_FULLSCREEN)
                        cv2.setWindowProperty(title, cv2.WND_PROP_FULLSCREEN,
                                              cv2.WINDOW_NORMAL if full == cv2.WINDOW_FULLSCREEN else cv2.WINDOW_FULLSCREEN)
            elif self.vc.output != "virtualcam":
                cv2.waitKey(1)
            time.sleep(max(0.0, period - (time.perf_counter() - t0)))
        if cam is not None:
            cam.close()
        cv2.destroyAllWindows()

    # ------------------------------------------------------------------ workers

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
            try:
                line = eng.transcribe(utt)
                if line is None:
                    continue
                eng.translate(line)
                wav = np.concatenate(list(eng.speak(line, stream=False)) or [np.zeros(1, np.float32)])
                tsr = eng.tts.sample_rate
                wav, _, _ = au.trim_silence(wav, tsr)
                dur = utt.duration
                fit = fit_audio(wav, tsr, Window(0.0, dur, dur + 0.5), self.cfg.timing)
                dub = au.resample(fit.audio, tsr, self.sr)
                start = utt.start_idx
                if self.play_idx is not None and start < self.play_idx + int(0.05 * self.sr):
                    self.on_event({"type": "late", "text": line.text})
                    continue
                n = max(len(dub), len(utt.audio))
                pad = int(0.08 * self.sr)
                env = au.crossfade_envelope(n + 2 * pad, self.sr, [(pad / self.sr, (pad + len(utt.audio)) / self.sr)],
                                            40.0, inside=1.0, outside=0.0)
                if line.background is not None:
                    self.bg.write(start, au.match_length(line.background, len(utt.audio)))
                    self.mask.write(start - pad, env[:, None])
                self.dubtl.write(start, dub, add=True)
                self.subs.append((start, start + len(dub), line.text))
                if self.lip is not None:
                    self._lipsync(start, dub)
                lead = (start - (self.play_idx or 0)) / self.sr
                self.on_event({"type": "line", "speaker": line.speaker, "source": line.source_text, "text": line.text,
                               "headroom": round(lead, 1), "fit": fit.notes})
            except Exception as e:
                log.exception("live line failed")
                self.on_event({"type": "error", "message": str(e)})

    def _lipsync(self, start: int, dub: np.ndarray) -> None:
        end = start + len(dub)
        with self.frames_lock:
            items = [f for f in self.frames if start <= f[0] < end]
        if len(items) < 3 or (self.play_idx or 0) > items[0][0]:
            return
        fps = len(items) / ((items[-1][0] - items[0][0]) / self.sr + 1e-6)
        seg = dub[: int((items[-1][0] - start) / self.sr * self.sr) + int(self.sr / fps)]
        out = self.lip.lipsync([f[1] for f in items], au.resample(au.to_mono(seg), self.sr, 16000), fps)
        if out is None:
            return
        with self.frames_lock:
            for item, new in zip(items, out):
                if (self.play_idx or 0) <= item[0]:
                    item[1] = new

    # ------------------------------------------------------------------ control

    def start(self) -> None:
        import sounddevice as sd

        self.engine.load(lambda m: self.on_event({"type": "status", "message": m}))
        if self.vc.lipsync:
            try:
                from ..lipsync.wav2lip_runner import Wav2LipEngine

                lc = self.cfg.lipsync
                self.lip = Wav2LipEngine(str(resolve_path(lc.wav2lip_repo)), str(resolve_path(lc.wav2lip_checkpoint)),
                                         "cuda" if self.engine.device.startswith("cuda") else "cpu", tuple(lc.wav2lip_pads),
                                         lc.wav2lip_batch_size, lc.wav2lip_face_batch_size, lc.wav2lip_smooth_frames,
                                         lc.wav2lip_feather)
            except Exception as e:
                log.warning("live lip sync disabled (%s)", e)
        in_dev = find_device(self.lc.input_device, "input")
        out_dev = find_device(self.lc.output_device, "output")
        block = int(self.sr * self.lc.block_ms / 1000)
        in_ch = min(2, sd.query_devices(in_dev if in_dev is not None else sd.default.device[0])["max_input_channels"])
        self._running.set()
        for fn, name in ((self._segment_loop, "segmenter"), (self._work_loop, "dubber"),
                         (self._capture_loop, "capture"), (self._present_loop, "present")):
            t = threading.Thread(target=fn, daemon=True, name=name)
            t.start()
            self._threads.append(t)
        self._streams = [
            sd.InputStream(device=in_dev, samplerate=self.sr, channels=in_ch, blocksize=block, dtype="float32",
                           callback=self._on_input, extra_settings=stream_extra_settings(in_dev)),
            sd.OutputStream(device=out_dev, samplerate=self.sr, channels=2, blocksize=block, dtype="float32",
                            callback=self._on_output, extra_settings=stream_extra_settings(out_dev)),
        ]
        for s in self._streams:
            s.start()
        self.on_event({"type": "status", "message": f"buffering {self.vc.delay_seconds:.0f}s - start your video"})

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

    def run_forever(self) -> None:
        self.start()
        try:
            while self._running.is_set():
                time.sleep(0.3)
        except KeyboardInterrupt:
            pass
        finally:
            self.stop()
