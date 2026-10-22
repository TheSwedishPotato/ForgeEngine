"""Face detection for lip-sync: OpenCV YuNet (ONNX, tiny, CPU-fast) with a Haar fallback."""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

Box = tuple[int, int, int, int]   # x1, y1, x2, y2


class FaceDetector:
    def __init__(self, yunet_path: str | Path | None = None, score: float = 0.6, max_side: int = 640):
        self.max_side = max_side
        self.yunet = None
        self.score = score
        if yunet_path and Path(yunet_path).exists():
            self.yunet = cv2.FaceDetectorYN.create(str(yunet_path), "", (320, 320), score, 0.3, 5000)
        self.haar = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

    @property
    def kind(self) -> str:
        return "yunet" if self.yunet is not None else "haar"

    def detect(self, frame: np.ndarray) -> Box | None:
        """Largest face in the frame (the closest actor is the best guess for who is talking)."""
        h, w = frame.shape[:2]
        scale = min(1.0, self.max_side / max(h, w))
        small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale < 1.0 else frame
        boxes: list[tuple[float, float, float, float]] = []
        if self.yunet is not None:
            self.yunet.setInputSize((small.shape[1], small.shape[0]))
            _, faces = self.yunet.detect(small)
            if faces is not None:
                boxes = [(f[0], f[1], f[0] + f[2], f[1] + f[3]) for f in faces]
        else:
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            for (x, y, bw, bh) in self.haar.detectMultiScale(gray, 1.1, 5, minSize=(30, 30)):
                boxes.append((x, y, x + bw, y + bh))
        if not boxes:
            return None
        x1, y1, x2, y2 = max(boxes, key=lambda b: (b[2] - b[0]) * (b[3] - b[1]))
        return (max(0, int(x1 / scale)), max(0, int(y1 / scale)), min(w, int(x2 / scale)), min(h, int(y2 / scale)))

    def confirm(self, frame: np.ndarray, box: Box) -> bool:
        """Independent second opinion: does a classic frontal-face detector find a face at `box` too?
        YuNet can be confidently wrong (e.g. a face mostly hidden behind a foreground object; its landmarks still
        look perfect), and a mouth re-rendered onto the wrong thing ruins a shot."""
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        side = max(24, int(0.4 * (box[2] - box[0])))
        found = self.haar.detectMultiScale(gray, 1.1, 4, minSize=(side, side))
        return any(iou(box, (x, y, x + bw, y + bh)) > 0.3 for x, y, bw, bh in found)


def iou(a: Box, b: Box) -> float:
    ix = max(0, min(a[2], b[2]) - max(a[0], b[0]))
    iy = max(0, min(a[3], b[3]) - max(a[1], b[1]))
    inter = ix * iy
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / union if union > 0 else 0.0


def smooth_boxes(boxes: list[Box], window: int = 5) -> list[Box]:
    """Moving average of box coordinates - removes jitter that would make the mouth patch wobble."""
    arr = np.array(boxes, dtype=np.float32)
    out = np.empty_like(arr)
    for i in range(len(arr)):
        lo = max(0, i - window // 2)
        out[i] = arr[lo:lo + window].mean(axis=0)
    return [tuple(int(round(v)) for v in b) for b in out]


def fill_missing(boxes: list[Box | None]) -> list[Box] | None:
    """Carry boxes forward/backward over short detection gaps. None if nothing was ever found."""
    found = [b for b in boxes if b is not None]
    if not found:
        return None
    out: list[Box] = []
    last = found[0]
    for b in boxes:
        last = b if b is not None else last
        out.append(last)
    return out
