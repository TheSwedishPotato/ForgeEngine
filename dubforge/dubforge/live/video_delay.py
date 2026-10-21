"""Delayed video viewer: shows what was on screen `delay` seconds ago, so picture and dubbed
audio line up. Capture a region/monitor, buffer JPEG frames, replay late into a window or an
OBS-compatible virtual camera.

IMPORTANT: streaming services (Netflix etc.) mark their video as protected content. On most
setups a screen capture of them is BLACK. DubForge does not try to defeat that. This viewer works for
unprotected sources: local files in a player, YouTube/other non-DRM video, game or webcam feeds,
or an OBS scene. For Netflix, use the audio overlay only (accepting that picture and dub are not
aligned) or process a file you are entitled to process in batch mode.
"""
from __future__ import annotations

import collections
import time
from typing import Callable

import numpy as np


class DelayLine:
    """Time-ordered frame buffer. `pop_due(now)` returns the newest frame that is >= delay old."""

    def __init__(self, delay_s: float, clock: Callable[[], float] = time.monotonic):
        self.delay, self.clock = delay_s, clock
        self.q: collections.deque[tuple[float, bytes]] = collections.deque()

    def push(self, frame_blob: bytes, t: float | None = None) -> None:
        self.q.append((self.clock() if t is None else t, frame_blob))

    def pop_due(self, now: float | None = None) -> bytes | None:
        now = self.clock() if now is None else now
        out = None
        while self.q and self.q[0][0] <= now - self.delay:
            out = self.q.popleft()[1]
        return out

    def __len__(self) -> int:
        return len(self.q)


def run_viewer(delay_s: float, mode: str = "window", monitor: int = 1, fps: int = 30,
               region: dict | None = None, quality: int = 85) -> None:
    import cv2
    import mss

    line = DelayLine(delay_s)
    cam = None
    last = None
    period = 1.0 / fps
    with mss.mss() as sct:
        area = region or sct.monitors[monitor]
        if mode == "virtualcam":
            import pyvirtualcam
            cam = pyvirtualcam.Camera(width=area["width"], height=area["height"], fps=fps)
        elif mode == "window":
            cv2.namedWindow("DubForge (delayed)", cv2.WINDOW_NORMAL)
        print(f"Delayed video: {delay_s:.0f}s behind live. Press q in the window / Ctrl-C to stop.")
        nxt = time.monotonic()
        try:
            while True:
                shot = np.asarray(sct.grab(area))[:, :, :3]                      # BGRA -> BGR
                ok, blob = cv2.imencode(".jpg", shot, [cv2.IMWRITE_JPEG_QUALITY, quality])
                if ok:
                    line.push(blob.tobytes())
                due = line.pop_due()
                if due is not None:
                    last = cv2.imdecode(np.frombuffer(due, np.uint8), cv2.IMREAD_COLOR)
                if last is not None:
                    if cam is not None:
                        cam.send(cv2.cvtColor(last, cv2.COLOR_BGR2RGB))
                    else:
                        cv2.imshow("DubForge (delayed)", last)
                        if cv2.waitKey(1) & 0xFF == ord("q"):
                            break
                nxt += period
                time.sleep(max(0.0, nxt - time.monotonic()))
        except KeyboardInterrupt:
            pass
        finally:
            if cam is not None:
                cam.close()
            cv2.destroyAllWindows()
