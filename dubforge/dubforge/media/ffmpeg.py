"""Thin, dependency-free FFmpeg wrapper (probe, extract, cut, raw frame pipes, mux)."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Iterator, Sequence

import numpy as np

from ..utils.log import get_logger

log = get_logger("ffmpeg")

_FFMPEG = "ffmpeg"
_FFPROBE = "ffprobe"


class FFmpegError(RuntimeError):
    pass


def configure(ffmpeg: str = "ffmpeg", ffprobe: str = "ffprobe") -> None:
    global _FFMPEG, _FFPROBE
    _FFMPEG, _FFPROBE = ffmpeg, ffprobe
    ffmpeg_bin.cache_clear()
    ffprobe_bin.cache_clear()


@lru_cache(maxsize=1)
def ffmpeg_bin() -> str:
    found = shutil.which(_FFMPEG)
    if found:
        return found
    try:  # pip install imageio-ffmpeg ships a static binary
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    raise FFmpegError("ffmpeg not found. Install it (conda install -c conda-forge ffmpeg) or set general.ffmpeg.")


@lru_cache(maxsize=1)
def ffprobe_bin() -> str | None:
    return shutil.which(_FFPROBE)


def run(args: Sequence[str], desc: str = "ffmpeg", quiet: bool = True) -> subprocess.CompletedProcess:
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-y"]
    if quiet:
        cmd += ["-loglevel", "error"]
    cmd += [str(a) for a in args]
    log.debug("%s: %s", desc, " ".join(cmd))
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        tail = proc.stderr.decode(errors="replace")[-2000:]
        raise FFmpegError(f"{desc} failed ({proc.returncode}):\n{tail}")
    return proc


# --------------------------------------------------------------------------- probing


@dataclass
class MediaInfo:
    path: str
    duration: float
    has_video: bool
    has_audio: bool
    width: int = 0
    height: int = 0
    fps: float = 0.0
    video_codec: str | None = None
    pix_fmt: str | None = None
    audio_sr: int = 0
    audio_channels: int = 0
    audio_streams: int = 0
    video_start: float = 0.0  # stream start times; they differ in some files (audio delay)
    audio_start: float = 0.0

    @property
    def frame_count(self) -> int:
        return int(round(self.duration * self.fps)) if self.fps else 0


def _parse_rate(rate: str | None) -> float:
    if not rate or rate in ("0/0", "N/A"):
        return 0.0
    if "/" in rate:
        n, d = rate.split("/")
        return float(n) / float(d) if float(d) else 0.0
    return float(rate)


def probe(path: str | os.PathLike) -> MediaInfo:
    path = str(path)
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    probe_bin = ffprobe_bin()
    if probe_bin:
        proc = subprocess.run(
            [probe_bin, "-v", "error", "-print_format", "json", "-show_format", "-show_streams", path],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        if proc.returncode == 0:
            return _probe_from_json(path, json.loads(proc.stdout.decode(errors="replace")))
    return _probe_from_ffmpeg(path)


def _probe_from_json(path: str, data: dict) -> MediaInfo:
    streams = data.get("streams", [])
    v = next((s for s in streams if s.get("codec_type") == "video" and s.get("disposition", {}).get("attached_pic", 0) == 0), None)
    audio = [s for s in streams if s.get("codec_type") == "audio"]
    a = audio[0] if audio else None
    duration = float(data.get("format", {}).get("duration") or 0.0)
    if not duration:
        duration = max(float(s.get("duration") or 0) for s in streams) if streams else 0.0
    info = MediaInfo(path=path, duration=duration, has_video=v is not None, has_audio=a is not None, audio_streams=len(audio))
    if v is not None:
        info.width, info.height = int(v.get("width", 0)), int(v.get("height", 0))
        info.fps = _parse_rate(v.get("avg_frame_rate")) or _parse_rate(v.get("r_frame_rate"))
        info.video_codec = v.get("codec_name")
        info.pix_fmt = v.get("pix_fmt")
        info.video_start = _float(v.get("start_time"))
    if a is not None:
        info.audio_sr = int(a.get("sample_rate", 0) or 0)
        info.audio_channels = int(a.get("channels", 0) or 0)
        info.audio_start = _float(a.get("start_time"))
    return info


def _float(x) -> float:
    try:
        return float(x)
    except (TypeError, ValueError):
        return 0.0


def _probe_from_ffmpeg(path: str) -> MediaInfo:
    proc = subprocess.run([ffmpeg_bin(), "-hide_banner", "-i", path], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    text = proc.stderr.decode(errors="replace")
    dur = 0.0
    m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", text)
    if m:
        dur = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    info = MediaInfo(path=path, duration=dur, has_video="Video:" in text, has_audio="Audio:" in text)
    vm = re.search(r"Video:\s*(\w+).*?,\s*(\d{2,5})x(\d{2,5}).*?([\d.]+)\s*fps", text)
    if vm:
        info.video_codec, info.width, info.height, info.fps = vm.group(1), int(vm.group(2)), int(vm.group(3)), float(vm.group(4))
    am = re.search(r"Audio:.*?(\d+)\s*Hz,\s*([\w.()]+)", text)
    if am:
        info.audio_sr = int(am.group(1))
        layout = am.group(2)
        info.audio_channels = {"mono": 1, "stereo": 2, "5.1": 6, "5.1(side)": 6, "7.1": 8}.get(layout, 2)
    info.audio_streams = text.count("Audio:")
    return info


# --------------------------------------------------------------------------- audio


def extract_audio(src: str | os.PathLike, dst: str | os.PathLike, sr: int = 44100, channels: int = 2,
                  stream_index: int = 0, start: float | None = None, end: float | None = None,
                  offset: float = 0.0) -> Path:
    """Decode the chosen audio stream to PCM WAV (5.1 is downmixed incl. the dialogue center).

    offset = audio_start - video_start: shifts the audio so that t=0 in the WAV is the first video frame.
    """
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    args: list[str] = []
    if start is not None:
        args += ["-ss", f"{start:.3f}"]
    args += ["-i", str(src)]
    if end is not None:
        args += ["-t", f"{end - (start or 0):.3f}"]
    if offset > 0.001:
        args += ["-af", f"adelay={int(round(offset * 1000))}:all=1"]
    elif offset < -0.001:
        args += ["-af", f"atrim=start={-offset:.4f},asetpts=PTS-STARTPTS"]
    args += ["-map", f"0:a:{stream_index}", "-vn", "-ac", str(channels), "-ar", str(sr), "-c:a", "pcm_s16le", str(dst)]
    run(args, "extract audio")
    return dst


def decode_audio(src: str | os.PathLike, sr: int, channels: int = 1) -> np.ndarray:
    """Decode any audio/video file straight into a float32 array [samples, channels]."""
    cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-loglevel", "error", "-i", str(src), "-vn",
           "-ac", str(channels), "-ar", str(sr), "-f", "f32le", "-"]
    proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if proc.returncode != 0:
        raise FFmpegError(proc.stderr.decode(errors="replace")[-1500:])
    data = np.frombuffer(proc.stdout, dtype=np.float32)
    return data.reshape(-1, channels).copy()


# --------------------------------------------------------------------------- video


@lru_cache(maxsize=8)
def encoder_works(name: str) -> bool:
    """True if the encoder is compiled in AND works on this machine (NVENC needs a GPU)."""
    try:
        proc = subprocess.run(
            [ffmpeg_bin(), "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.2",
             "-c:v", name, "-f", "null", "-"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30,
        )
        return proc.returncode == 0
    except Exception:
        return False


@lru_cache(maxsize=4)
def filter_available(name: str) -> bool:
    try:
        proc = subprocess.run([ffmpeg_bin(), "-hide_banner", "-filters"], stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        return re.search(rf"\s{re.escape(name)}\s", proc.stdout.decode(errors="replace")) is not None
    except Exception:
        return False


def video_encode_args(codec: str = "auto", crf: int = 17) -> list[str]:
    if codec == "auto":
        codec = "h264_nvenc" if encoder_works("h264_nvenc") else "libx264"
    if codec in ("h264_nvenc", "hevc_nvenc"):
        return ["-c:v", codec, "-preset", "p6", "-tune", "hq", "-rc", "vbr", "-cq", str(crf + 2), "-b:v", "0",
                "-pix_fmt", "yuv420p"]
    if codec == "libx265":
        return ["-c:v", codec, "-preset", "medium", "-crf", str(crf + 4), "-pix_fmt", "yuv420p"]
    return ["-c:v", codec, "-preset", "slow", "-crf", str(crf), "-pix_fmt", "yuv420p"]


def cut_video(src: str | os.PathLike, dst: str | os.PathLike, start: float, end: float,
              audio: bool = True, fps: float | None = None, crf: int = 16) -> Path:
    """Frame-accurate cut (re-encodes). Used for test clips and lip-sync jobs."""
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    args = ["-ss", f"{max(0.0, start):.3f}", "-i", str(src), "-t", f"{end - start:.3f}"]
    if fps:
        args += ["-r", f"{fps}"]
    args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf), "-pix_fmt", "yuv420p"]
    args += ["-c:a", "aac", "-b:a", "192k"] if audio else ["-an"]
    args += [str(dst)]
    run(args, "cut video")
    return dst


class FrameReader:
    """Stream decoded BGR frames from a video through a pipe (constant frame rate)."""

    def __init__(self, path: str | os.PathLike, width: int, height: int, fps: float | None = None,
                 start: float = 0.0, duration: float | None = None):
        self.width, self.height = width, height
        self.frame_bytes = width * height * 3
        cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-loglevel", "error"]
        if start > 0:
            cmd += ["-ss", f"{start:.3f}"]
        cmd += ["-i", str(path)]
        if duration is not None:
            cmd += ["-t", f"{duration:.3f}"]
        vf = [f"scale={width}:{height}"]
        if fps:
            vf.insert(0, f"fps={fps}")
        cmd += ["-an", "-vf", ",".join(vf), "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
        self.proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, bufsize=self.frame_bytes * 4)

    def read(self) -> np.ndarray | None:
        assert self.proc.stdout is not None
        buf = self.proc.stdout.read(self.frame_bytes)
        if not buf or len(buf) < self.frame_bytes:
            return None
        return np.frombuffer(buf, np.uint8).reshape(self.height, self.width, 3)

    def __iter__(self) -> Iterator[np.ndarray]:
        while True:
            f = self.read()
            if f is None:
                return
            yield f

    def close(self) -> None:
        if self.proc.poll() is None:
            self.proc.kill()
        self.proc.wait()

    def __enter__(self) -> "FrameReader":
        return self

    def __exit__(self, *exc) -> None:
        self.close()


class FrameWriter:
    """Encode BGR frames piped from Python (video only; audio is muxed afterwards)."""

    def __init__(self, path: str | os.PathLike, width: int, height: int, fps: float,
                 codec: str = "auto", crf: int = 17):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        cmd = [ffmpeg_bin(), "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
               "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{width}x{height}", "-r", f"{fps}", "-i", "-",
               *video_encode_args(codec, crf), "-an", str(self.path)]
        self.proc = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

    def write(self, frame: np.ndarray) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.write(np.ascontiguousarray(frame, dtype=np.uint8).tobytes())

    def close(self) -> None:
        assert self.proc.stdin is not None
        self.proc.stdin.close()
        err = self.proc.stderr.read().decode(errors="replace") if self.proc.stderr else ""
        if self.proc.wait() != 0:
            raise FFmpegError(f"video encode failed:\n{err[-1500:]}")

    def __enter__(self) -> "FrameWriter":
        return self

    def __exit__(self, exc_type, *exc) -> None:
        if exc_type is None:
            self.close()
        else:
            self.proc.kill()


# --------------------------------------------------------------------------- muxing


@dataclass
class AudioTrack:
    path: str
    language: str | None = None  # ISO 639-2 for players, e.g. "deu"
    title: str | None = None
    default: bool = False


@dataclass
class SubtitleTrack:
    path: str
    language: str | None = None
    title: str | None = None


def mux(video_src: str | os.PathLike, audio_tracks: list[AudioTrack], dst: str | os.PathLike,
        subtitles: list[SubtitleTrack] | None = None, copy_video: bool = True,
        audio_codec: str = "aac", audio_bitrate: str = "256k", burn_srt: str | None = None,
        video_codec: str = "auto", crf: int = 17, audio_sr: int | None = None,
        audio_offset: float = 0.0) -> Path:
    """Combine a video stream with new audio tracks (+ optional soft subtitles).

    audio_offset: start time of the video stream; our WAVs start at the first frame, so shift them to match.
    """
    dst = Path(dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    subtitles = subtitles or []
    args: list[str] = ["-i", str(video_src)]
    for t in audio_tracks:
        if abs(audio_offset) > 0.001:
            args += ["-itsoffset", f"{audio_offset:.4f}"]
        args += ["-i", t.path]
    for s in subtitles:
        args += ["-i", s.path]
    args += ["-map", "0:v:0"]
    for i in range(len(audio_tracks)):
        args += ["-map", f"{i + 1}:a:0"]
    for j in range(len(subtitles)):
        args += ["-map", f"{len(audio_tracks) + 1 + j}:s:0"]
    if burn_srt:
        # the subtitles filter needs an escaped path; use forward slashes and escape the drive colon
        p = str(Path(burn_srt).resolve()).replace("\\", "/").replace(":", "\\:").replace("'", r"\'")
        args += ["-vf", f"subtitles='{p}'", *video_encode_args(video_codec, crf)]
    elif copy_video:
        args += ["-c:v", "copy"]
    else:
        args += video_encode_args(video_codec, crf)
    args += ["-c:a", audio_codec, "-b:a", audio_bitrate]
    if audio_sr:
        args += ["-ar", str(audio_sr)]
    if subtitles:
        args += ["-c:s", "mov_text" if dst.suffix.lower() in (".mp4", ".mov", ".m4v") else "srt"]
    for i, t in enumerate(audio_tracks):
        if t.language:
            args += [f"-metadata:s:a:{i}", f"language={t.language}"]
        if t.title:
            args += [f"-metadata:s:a:{i}", f"title={t.title}"]
        args += [f"-disposition:a:{i}", "default" if (t.default or (i == 0 and not any(x.default for x in audio_tracks))) else "0"]
    for j, s in enumerate(subtitles):
        if s.language:
            args += [f"-metadata:s:s:{j}", f"language={s.language}"]
        if s.title:
            args += [f"-metadata:s:s:{j}", f"title={s.title}"]
    if dst.suffix.lower() in (".mp4", ".mov", ".m4v"):
        args += ["-movflags", "+faststart"]
    args += [str(dst)]
    run(args, "mux")
    return dst
