#!/usr/bin/env python
"""DubForge batch runner for Wav2Lip.

Runs *inside* the Wav2Lip checkout/environment (it imports Wav2Lip's own
`models`, `audio` and `face_detection` modules) and is launched by
dubforge.lipsync.wav2lip as a subprocess. Compared to Wav2Lip's demo script:
  * the model is loaded once for hundreds of clips
  * frames without a detectable face keep the original picture instead of aborting
  * the face is tracked across frames (stays on the same person in two-shots)
  * detection runs on a downscaled copy; the result is pasted at full resolution
  * only the lower face is blended back, with a feathered mask, so eyes stay sharp

Protocol: prints "PROGRESS <done> <total>" lines on stdout.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys

import numpy as np

MEL_STEP = 16
IMG = 96


def patch_librosa() -> None:
    """Wav2Lip's audio.py calls librosa.filters.mel positionally (removed in librosa 0.10)."""
    import librosa.filters

    orig = librosa.filters.mel
    if getattr(orig, "_dubforge_patched", False):
        return

    def mel(*args, **kwargs):
        for name, value in zip(("sr", "n_fft"), args):
            kwargs[name] = value
        return orig(**kwargs)

    mel._dubforge_patched = True  # type: ignore[attr-defined]
    librosa.filters.mel = mel


def load_model(path: str, device: str):
    import torch
    from models import Wav2Lip  # Wav2Lip repo

    try:
        ckpt = torch.load(path, map_location="cpu", weights_only=False)
    except TypeError:  # torch < 1.13
        ckpt = torch.load(path, map_location="cpu")
    state = {k.replace("module.", ""): v for k, v in ckpt["state_dict"].items()}
    model = Wav2Lip()
    model.load_state_dict(state)
    return model.to(device).eval()


def read_frames(path: str) -> tuple[list[np.ndarray], float]:
    import cv2

    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    frames = []
    while True:
        ok, f = cap.read()
        if not ok:
            break
        frames.append(f)
    cap.release()
    return frames, fps


def mel_chunks(wav: np.ndarray, fps: float) -> list[np.ndarray]:
    """16 kHz waveform -> one 16-step mel window per video frame (Wav2Lip's framing)."""
    import audio  # Wav2Lip repo

    mel = audio.melspectrogram(wav)
    if np.isnan(mel).any():
        wav = wav + np.random.default_rng(0).normal(0, 1e-4, len(wav))
        mel = audio.melspectrogram(wav)
    chunks, i = [], 0
    step = 80.0 / fps
    while True:
        s = int(i * step)
        if s + MEL_STEP > mel.shape[1]:
            chunks.append(mel[:, mel.shape[1] - MEL_STEP:])
            break
        chunks.append(mel[:, s: s + MEL_STEP])
        i += 1
    return chunks


def iou(a, b) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, x2 - x1) * max(0, y2 - y1)
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


class FaceTracker:
    def __init__(self, device: str, batch_size: int, max_side: int = 720):
        import face_detection  # Wav2Lip repo

        self.det = face_detection.FaceAlignment(face_detection.LandmarksType._2D, flip_input=False, device=device)
        self.batch_size = batch_size
        self.max_side = max_side

    def detect(self, frames: list[np.ndarray]) -> list[list[np.ndarray]]:
        import cv2

        h, w = frames[0].shape[:2]
        scale = min(1.0, self.max_side / max(h, w))
        small = [cv2.resize(f, (int(w * scale), int(h * scale))) if scale < 1 else f for f in frames]
        out: list[list[np.ndarray]] = []
        bs = self.batch_size
        i = 0
        while i < len(small):
            batch = np.array(small[i: i + bs])[..., ::-1].copy()  # BGR -> RGB
            try:
                dets = self.det.face_detector.detect_from_batch(batch)
            except RuntimeError:
                if bs == 1:
                    raise
                bs = max(1, bs // 2)
                continue
            for d in dets:
                out.append([np.array(b[:4]) / scale for b in d if b[-1] > 0.5])
            i += len(batch)
        return out

    def track(self, frames: list[np.ndarray]) -> list[tuple[int, int, int, int] | None]:
        dets = self.detect(frames)
        boxes: list = []
        prev = None
        for cands in dets:
            if not cands:
                boxes.append(None)
                continue
            if prev is not None:
                scores = [iou(c, prev) for c in cands]
                best = int(np.argmax(scores))
                if scores[best] < 0.1:  # lost the face (cut): restart on the largest one
                    best = int(np.argmax([(c[2] - c[0]) * (c[3] - c[1]) for c in cands]))
            else:
                best = int(np.argmax([(c[2] - c[0]) * (c[3] - c[1]) for c in cands]))
            prev = cands[best]
            boxes.append(tuple(float(v) for v in prev))
        return boxes


def smooth(boxes: list, window: int) -> list:
    out = list(boxes)
    idx = [i for i, b in enumerate(boxes) if b is not None]
    for n, i in enumerate(idx):
        lo, hi = max(0, n - window // 2), min(len(idx), n + window // 2 + 1)
        nb = [boxes[idx[k]] for k in range(lo, hi) if abs(idx[k] - i) <= window]
        out[i] = tuple(np.mean(nb, axis=0))
    return out


def feather_mask(h: int, w: int, feather: float) -> np.ndarray:
    import cv2

    m = np.zeros((h, w), np.float32)
    m[int(h * 0.5):, int(w * 0.08): w - int(w * 0.08)] = 1.0
    k = max(3, int(max(h, w) * feather) | 1)
    m = cv2.GaussianBlur(m, (k, k), 0)
    return m[..., None]


class Writer:
    def __init__(self, path: str, w: int, h: int, fps: float):
        self.p = subprocess.Popen(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24",
             "-s", f"{w}x{h}", "-r", f"{fps}", "-i", "-", "-c:v", "libx264", "-preset", "veryfast", "-crf", "12",
             "-pix_fmt", "yuv420p", path],
            stdin=subprocess.PIPE)

    def write(self, f: np.ndarray) -> None:
        self.p.stdin.write(np.ascontiguousarray(f).tobytes())

    def close(self) -> int:
        self.p.stdin.close()
        return self.p.wait()


class Wav2LipEngine:
    """Loads Wav2Lip once; `lipsync(frames, wav16k, fps)` is used by batch jobs and by live video mode."""

    def __init__(self, repo: str, checkpoint: str, device: str = "cuda", pads=(0, 12, 0, 0), batch_size: int = 64,
                 face_batch_size: int = 8, smooth_frames: int = 5, feather: float = 0.15):
        repo = os.path.abspath(repo)
        if repo not in sys.path:
            sys.path.insert(0, repo)
        patch_librosa()
        import torch

        self.device = device if (device == "cpu" or torch.cuda.is_available()) else "cpu"
        cwd = os.getcwd()
        os.chdir(repo)  # face_detection resolves its weights relative to the repo
        try:
            self.model = load_model(checkpoint, self.device)
            self.tracker = FaceTracker(self.device, face_batch_size)
        finally:
            os.chdir(cwd)
        self.pads = pads
        self.batch_size = batch_size
        self.smooth_frames = smooth_frames
        self.feather = feather

    def lipsync(self, frames: list[np.ndarray], wav16k: np.ndarray, fps: float) -> list[np.ndarray] | None:
        import cv2
        import torch

        if not frames:
            return None
        mels = mel_chunks(wav16k.astype(np.float64), fps)
        n = min(len(frames), len(mels))
        frames = frames[:n]
        boxes = smooth(self.tracker.track(frames), self.smooth_frames)
        if all(b is None for b in boxes):
            return None
        h, w = frames[0].shape[:2]
        top, bottom, left, right = self.pads
        out_frames = [f.copy() for f in frames]
        todo = []
        for i, b in enumerate(boxes):
            if b is None:
                continue
            x1, y1, x2, y2 = b
            y1, y2 = max(0, int(y1 - top)), min(h, int(y2 + bottom))
            x1, x2 = max(0, int(x1 - left)), min(w, int(x2 + right))
            if x2 - x1 >= 16 and y2 - y1 >= 16:
                todo.append((i, (x1, y1, x2, y2)))
        for s in range(0, len(todo), self.batch_size):
            chunk = todo[s: s + self.batch_size]
            faces = np.stack([cv2.resize(frames[i][y1:y2, x1:x2], (IMG, IMG)) for i, (x1, y1, x2, y2) in chunk])
            masked = faces.copy()
            masked[:, IMG // 2:] = 0
            img = np.concatenate((masked, faces), axis=3) / 255.0
            mel = np.stack([mels[i] for i, _ in chunk])[..., None]
            img_t = torch.FloatTensor(np.transpose(img, (0, 3, 1, 2))).to(self.device)
            mel_t = torch.FloatTensor(np.transpose(mel, (0, 3, 1, 2))).to(self.device)
            with torch.no_grad():
                pred = self.model(mel_t, img_t).cpu().numpy().transpose(0, 2, 3, 1) * 255.0
            for p, (i, (x1, y1, x2, y2)) in zip(pred, chunk):
                patch = cv2.resize(p.astype(np.uint8), (x2 - x1, y2 - y1), interpolation=cv2.INTER_LANCZOS4)
                orig = out_frames[i][y1:y2, x1:x2].astype(np.float32)
                m = feather_mask(y2 - y1, x2 - x1, self.feather)
                out_frames[i][y1:y2, x1:x2] = np.clip(patch.astype(np.float32) * m + orig * (1 - m), 0, 255).astype(np.uint8)
        return out_frames


def process_job(job: dict, engine: Wav2LipEngine) -> bool:
    import audio  # Wav2Lip repo

    frames, fps = read_frames(job["video"])
    out = engine.lipsync(frames, audio.load_wav(job["audio"], 16000), fps)
    if out is None:
        print(f"no face in job {job['id']}", flush=True)
        return False
    h, w = out[0].shape[:2]
    wr = Writer(job["out"], w, h, fps)
    for f in out:
        wr.write(f)
    return wr.close() == 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--repo", required=True)
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--jobs", required=True)
    ap.add_argument("--pads", type=int, nargs=4, default=[0, 12, 0, 0])
    ap.add_argument("--batch-size", type=int, default=64)
    ap.add_argument("--face-batch-size", type=int, default=8)
    ap.add_argument("--smooth", type=int, default=5)
    ap.add_argument("--feather", type=float, default=0.15)
    ap.add_argument("--device", default="cuda")
    args = ap.parse_args()

    engine = Wav2LipEngine(args.repo, args.checkpoint, args.device, tuple(args.pads), args.batch_size,
                           args.face_batch_size, args.smooth, args.feather)
    jobs = json.load(open(args.jobs, encoding="utf-8"))
    ok = 0
    for k, job in enumerate(jobs):
        try:
            if process_job(job, engine):
                ok += 1
        except Exception as e:  # one bad clip must not stop the film
            print(f"job {job['id']} failed: {e}", flush=True)
        print(f"PROGRESS {k + 1} {len(jobs)}", flush=True)
    print(f"DONE {ok} {len(jobs)}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
