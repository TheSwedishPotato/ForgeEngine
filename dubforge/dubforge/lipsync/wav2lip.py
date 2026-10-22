"""Wav2Lip (fast) driven in-process: model loaded ONCE, then called per dubbed window.

Needs a checkout of https://github.com/Rudrabha/Wav2Lip (for the network definition) and the
`wav2lip_gan.pth` checkpoint - see README. The audio front-end (mel spectrogram) is
re-implemented here because the repo's audio.py breaks on librosa >= 0.10.

Licence: Wav2Lip is for personal/research/non-commercial use only.
Limitations (real): output mouth is 96x96 px upscaled (soft on 1080p+ faces); it syncs the
LARGEST face in frame - no active-speaker detection yet.
"""
from __future__ import annotations

import sys
from pathlib import Path

import cv2
import numpy as np

from ..base import LipSync
from ..config import Config
from ..env import resolve_device
from .faces import Box, FaceDetector, fill_missing, smooth_boxes

IMG = 96
MEL_STEP = 16

# Wav2Lip hparams.py
_SR, _NFFT, _HOP, _WIN, _NMELS, _FMIN, _FMAX = 16000, 800, 200, 800, 80, 55, 7600
_PREEMPH, _REF_DB, _MIN_DB, _MAX_ABS = 0.97, 20.0, -100.0, 4.0


def melspectrogram(wav: np.ndarray) -> np.ndarray:
    """Identical to Wav2Lip's audio.melspectrogram (symmetric normalisation to [-4, 4])."""
    import librosa
    from scipy import signal
    wav = signal.lfilter([1, -_PREEMPH], [1], wav)
    D = librosa.stft(y=wav, n_fft=_NFFT, hop_length=_HOP, win_length=_WIN, pad_mode="reflect")
    basis = librosa.filters.mel(sr=_SR, n_fft=_NFFT, n_mels=_NMELS, fmin=_FMIN, fmax=_FMAX)
    S = np.dot(basis, np.abs(D))
    min_level = np.exp(_MIN_DB / 20 * np.log(10))
    S = 20 * np.log10(np.maximum(min_level, S)) - _REF_DB
    return np.clip((2 * _MAX_ABS) * ((S - _MIN_DB) / (-_MIN_DB)) - _MAX_ABS, -_MAX_ABS, _MAX_ABS)


def mel_chunks_for_frames(mel: np.ndarray, fps: float, n_frames: int) -> list[np.ndarray]:
    """One 16-step mel window per video frame (80 mel steps per second of audio)."""
    mult = 80.0 / fps
    out = []
    for i in range(n_frames):
        s = int(i * mult)
        out.append(mel[:, -MEL_STEP:] if s + MEL_STEP > mel.shape[1] else mel[:, s:s + MEL_STEP])
    return out


def feather_mask(h: int, w: int) -> np.ndarray:
    """Soft mask over the lower face so the 96px patch blends instead of showing a box."""
    m = np.zeros((h, w), np.float32)
    m[int(h * 0.38):, int(w * 0.06): int(w * 0.94)] = 1.0
    k = max(3, (min(h, w) // 8) | 1)
    return cv2.GaussianBlur(m, (k, k), 0)[..., None]


class Wav2LipSync(LipSync):
    name = "wav2lip"

    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.model = None
        self.detector: FaceDetector | None = None

    def load(self) -> None:
        import torch
        lc = self.cfg.lipsync
        repo, ckpt = Path(lc.wav2lip_repo).resolve(), Path(lc.wav2lip_checkpoint)
        if not (repo / "models" / "wav2lip.py").exists():
            raise RuntimeError(f"Wav2Lip repo not found at {repo}. Run: git clone https://github.com/Rudrabha/Wav2Lip {lc.wav2lip_repo}")
        if not ckpt.exists():
            raise RuntimeError(f"Wav2Lip checkpoint missing: {ckpt}. Download wav2lip_gan.pth (link in the Wav2Lip README).")
        for m in [k for k in sys.modules if k == "models" or k.startswith("models.")]:
            del sys.modules[m]
        sys.path.insert(0, str(repo))
        try:
            from models import Wav2Lip
        finally:
            sys.path.remove(str(repo))
        self.device = resolve_device(self.cfg)
        # weights_only=True: the checkpoint is a pickle; never fall back to unrestricted loading, which would
        # execute whatever code a tampered .pth contains.
        ck = torch.load(str(ckpt), map_location="cpu", weights_only=True)
        net = Wav2Lip()
        net.load_state_dict({k.replace("module.", ""): v for k, v in ck["state_dict"].items()})
        self.model = net.to(self.device).eval()
        self.detector = FaceDetector(lc.face_model)

    # ------------------------------------------------------------------
    def track_faces(self, frames: list[np.ndarray]) -> list[Box] | None:
        raw = [self.detector.detect(f) for f in frames]
        if sum(b is not None for b in raw) < 0.5 * len(frames):
            return None
        cf = self.cfg.lipsync.confirm_frac
        if cf > 0 and self.detector.kind == "yunet":            # Haar-only mode has nothing independent to compare
            sample = [i for i in range(0, len(frames), 3) if raw[i] is not None]
            agree = sum(self.detector.confirm(frames[i], raw[i]) for i in sample)
            if not sample or agree / len(sample) < cf:
                return None
        boxes = fill_missing(raw)
        if boxes is None:
            return None
        boxes = smooth_boxes(boxes)
        biggest = max(min(b[2] - b[0], b[3] - b[1]) for b in boxes)
        if biggest < self.cfg.lipsync.min_face_px:
            return None
        h, w = frames[0].shape[:2]
        out = []
        for x1, y1, x2, y2 in boxes:
            pad = int(0.08 * (y2 - y1))                       # include the chin
            out.append((max(0, x1), max(0, y1), min(w, x2), min(h, y2 + pad)))
        return out

    def sync_clip(self, frames: list[np.ndarray], audio_16k: np.ndarray, fps: float):
        import torch
        n = len(frames)
        if n == 0:
            return None
        need = int(round(n / fps * _SR)) + _WIN
        audio = audio_16k[:need] if len(audio_16k) >= need else np.pad(audio_16k, (0, need - len(audio_16k)))
        boxes = self.track_faces(frames)
        if boxes is None:
            return None
        chunks = mel_chunks_for_frames(melspectrogram(audio.astype(np.float32)), fps, n)
        out = [f.copy() for f in frames]
        bs = self.cfg.lipsync.wav2lip_batch
        for b0 in range(0, n, bs):
            idx = range(b0, min(n, b0 + bs))
            faces = np.stack([cv2.resize(frames[i][boxes[i][1]:boxes[i][3], boxes[i][0]:boxes[i][2]], (IMG, IMG))
                              for i in idx])
            masked = faces.copy()
            masked[:, IMG // 2:] = 0
            img = np.concatenate((masked, faces), axis=3).astype(np.float32) / 255.0
            mel = np.stack([chunks[i] for i in idx])[..., None].astype(np.float32)
            with torch.no_grad():
                pred = self.model(torch.from_numpy(mel.transpose(0, 3, 1, 2)).to(self.device),
                                  torch.from_numpy(img.transpose(0, 3, 1, 2)).to(self.device))
            pred = (pred.cpu().numpy().transpose(0, 2, 3, 1) * 255.0).clip(0, 255)
            for k, i in enumerate(idx):
                x1, y1, x2, y2 = boxes[i]
                patch = cv2.resize(pred[k], (x2 - x1, y2 - y1)).astype(np.float32)
                m = feather_mask(y2 - y1, x2 - x1)
                region = out[i][y1:y2, x1:x2].astype(np.float32)
                out[i][y1:y2, x1:x2] = (patch * m + region * (1 - m)).astype(np.uint8)
        return out
