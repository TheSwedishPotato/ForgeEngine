"""ffmpeg / ffprobe helpers, plus streaming frame reader/writer for the lip-sync pass."""
from __future__ import annotations

import json
import shutil
import subprocess
from dataclasses import dataclass
from fractions import Fraction
from functools import lru_cache
from pathlib import Path

import numpy as np


class MediaError(RuntimeError):
    pass


def require_ffmpeg() -> None:
    for tool in ("ffmpeg", "ffprobe"):
        if shutil.which(tool) is None:
            raise MediaError(f"`{tool}` not found on PATH. Install FFmpeg (see README) and retry.")


def run(cmd: list[str], input_bytes: bytes | None = None) -> subprocess.CompletedProcess:
    p = subprocess.run(cmd, input=input_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if p.returncode != 0:
        tail = p.stderr.decode("utf-8", "replace").strip().splitlines()[-12:]
        raise MediaError(f"{cmd[0]} failed (exit {p.returncode}):\n" + "\n".join(tail))
    return p


@lru_cache(maxsize=None)
def has_ffmpeg_filter(name: str) -> bool:
    out = subprocess.run(["ffmpeg", "-hide_banner", "-filters"], stdout=subprocess.PIPE,
                         stderr=subprocess.DEVNULL).stdout.decode("utf-8", "replace")
    return any(line.split()[1:2] == [name] for line in out.splitlines())


@dataclass
class MediaInfo:
    path: Path
    duration: float
    has_video: bool
    width: int
    height: int
    fps: Fraction
    audio_streams: int
    audio_lang: str | None

    @property
    def fps_str(self) -> str:
        return f"{self.fps.numerator}/{self.fps.denominator}"


def probe(path: str | Path) -> MediaInfo:
    require_ffmpeg()
    p = run(["ffprobe", "-v", "error", "-print_format", "json", "-show_format", "-show_streams", str(path)])
    j = json.loads(p.stdout)
    streams = j.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video"
              and s.get("disposition", {}).get("attached_pic", 0) == 0), None)
    a = [s for s in streams if s.get("codec_type") == "audio"]
    if not a:
        raise MediaError(f"{path} has no audio stream to dub.")
    fps = Fraction(0)
    if v:
        rate = v.get("avg_frame_rate") or v.get("r_frame_rate") or "0/1"
        fps = Fraction(rate) if rate not in ("0/0", "") else Fraction(0)
        if fps == 0:
            fps = Fraction(v.get("r_frame_rate", "25/1"))
    dur = float(j.get("format", {}).get("duration") or (v or a[0]).get("duration") or 0)
    return MediaInfo(Path(path), dur, v is not None, int(v["width"]) if v else 0,
                     int(v["height"]) if v else 0, fps, len(a), a[0].get("tags", {}).get("language"))


def extract_audio(src: str | Path, dst: str | Path, sr: int = 44100, channels: int = 2,
                  stream: int = 0) -> Path:
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-map", f"0:a:{stream}", "-vn",
         "-ac", str(channels), "-ar", str(sr), "-c:a", "pcm_s16le", str(dst)])
    return Path(dst)


def to_mono_16k(src: str | Path, dst: str | Path) -> Path:
    run(["ffmpeg", "-y", "-v", "error", "-i", str(src), "-ac", "1", "-ar", "16000",
         "-c:a", "pcm_s16le", str(dst)])
    return Path(dst)


def cut_clip(src: str | Path, dst: str | Path, start: float, duration: float) -> Path:
    """Accurate re-encoded cut (used by the 30-second test script)."""
    run(["ffmpeg", "-y", "-v", "error", "-ss", f"{start}", "-i", str(src), "-t", f"{duration}",
         "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-c:a", "aac", "-b:a", "192k", str(dst)])
    return Path(dst)


def mux(video: str | Path, audio: str | Path, dst: str | Path, *, original: str | Path | None,
        keep_original: bool, tgt_iso3: str, src_iso3: str | None, copy_video: bool = True,
        video_cfg=None, bitrate: str = "256k", extra_audio_gain: float | None = None) -> Path:
    """Combine picture + dubbed mix (+ the original audio as a second, switchable track)."""
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(video), "-i", str(audio)]
    if keep_original and original:
        cmd += ["-i", str(original)]
    cmd += ["-map", "0:v:0", "-map", "1:a:0"]
    if keep_original and original:
        cmd += ["-map", "2:a:0"]
    if copy_video:
        cmd += ["-c:v", "copy"]
    else:
        vc = video_cfg
        cmd += ["-c:v", vc.encoder, "-pix_fmt", "yuv420p"]
        cmd += ["-cq", str(vc.crf)] if "nvenc" in vc.encoder else ["-crf", str(vc.crf), "-preset", vc.preset]
    cmd += ["-c:a", "aac", "-b:a", bitrate, "-ac", "2"]
    cmd += ["-metadata:s:a:0", f"language={tgt_iso3}", "-metadata:s:a:0", "title=Dubbed",
            "-disposition:a:0", "default"]
    if keep_original and original:
        cmd += ["-metadata:s:a:1", f"language={src_iso3 or 'und'}", "-metadata:s:a:1", "title=Original",
                "-disposition:a:1", "0"]
    cmd += ["-shortest", "-movflags", "+faststart", str(dst)]
    run(cmd)
    return Path(dst)


class FrameReader:
    """Iterate BGR uint8 frames from any video via an ffmpeg rawvideo pipe."""

    def __init__(self, path: str | Path, info: MediaInfo | None = None):
        self.info = info or probe(path)
        self.path = str(path)
        self._proc: subprocess.Popen | None = None

    def __enter__(self):
        self._proc = subprocess.Popen(
            ["ffmpeg", "-v", "error", "-i", self.path, "-an", "-f", "rawvideo", "-pix_fmt", "bgr24", "-"],
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=10 ** 8)
        return self

    def __exit__(self, *exc):
        if self._proc:
            self._proc.stdout.close()
            self._proc.kill()
            self._proc.wait()

    def __iter__(self):
        w, h = self.info.width, self.info.height
        n = w * h * 3
        while True:
            buf = self._proc.stdout.read(n)
            if len(buf) < n:
                return
            yield np.frombuffer(buf, np.uint8).reshape(h, w, 3).copy()


class FrameWriter:
    """Encode BGR frames to a silent video via an ffmpeg pipe."""

    def __init__(self, path: str | Path, info: MediaInfo, video_cfg):
        self.path, self.info, self.cfg = str(path), info, video_cfg
        self._proc: subprocess.Popen | None = None

    def __enter__(self):
        w, h, vc = self.info.width, self.info.height, self.cfg
        enc = ["-c:v", vc.encoder]
        enc += ["-cq", str(vc.crf), "-preset", "p5"] if "nvenc" in vc.encoder \
            else ["-crf", str(vc.crf), "-preset", vc.preset]
        self._proc = subprocess.Popen(
            ["ffmpeg", "-y", "-v", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{w}x{h}",
             "-r", self.info.fps_str, "-i", "-", "-an",
             "-vf", "pad=ceil(iw/2)*2:ceil(ih/2)*2", *enc, "-pix_fmt", "yuv420p", self.path],
            stdin=subprocess.PIPE, stderr=subprocess.PIPE)
        return self

    def write(self, frame: np.ndarray) -> None:
        self._proc.stdin.write(np.ascontiguousarray(frame, dtype=np.uint8).tobytes())

    def __exit__(self, exc_type, *exc):
        try:
            self._proc.stdin.close()
        except Exception:
            pass
        err = self._proc.stderr.read().decode("utf-8", "replace")
        code = self._proc.wait()
        if exc_type is None and code != 0:
            raise MediaError("ffmpeg encoder failed:\n" + "\n".join(err.strip().splitlines()[-10:]))
