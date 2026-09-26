from __future__ import annotations

import os
from pathlib import Path

from ..types import Transcript


def _ts(t: float) -> str:
    t = max(0.0, t)
    h, rem = divmod(int(round(t * 1000)), 3_600_000)
    m, rem = divmod(rem, 60_000)
    s, ms = divmod(rem, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def write_srt(transcript: Transcript, path: str | os.PathLike, translated: bool = True,
              max_chars: int = 42) -> Path:
    path = Path(path)
    lines = []
    n = 0
    for s in transcript.segments:
        text = (s.translation if translated else s.text) or ""
        if translated and s.keep_original:
            text = s.text
        text = text.strip()
        if not text:
            continue
        start = s.placed_start if (translated and s.placed_start is not None) else s.speech_start
        end = s.placed_end if (translated and s.placed_end is not None) else s.speech_end
        n += 1
        lines += [str(n), f"{_ts(start)} --> {_ts(max(end, start + 0.5))}", _wrap(text, max_chars), ""]
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _wrap(text: str, width: int) -> str:
    if len(text) <= width:
        return text
    words = text.split()
    if len(words) < 2:
        return text
    # two balanced lines
    best, best_diff = 1, 1e9
    for i in range(1, len(words)):
        a, b = " ".join(words[:i]), " ".join(words[i:])
        diff = abs(len(a) - len(b))
        if diff < best_diff:
            best, best_diff = i, diff
    return " ".join(words[:best]) + "\n" + " ".join(words[best:])
