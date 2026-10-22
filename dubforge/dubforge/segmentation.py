"""Turn raw ASR output into dubbing-sized units: whole sentences, not mid-sentence fragments.

Whisper cuts wherever it likes. Translating fragments produces broken grammar and wrong
pronouns, so (1) merge continuation fragments, (2) split anything too long for one TTS
call / one lip-sync window at punctuation or at the biggest pause.
"""
from __future__ import annotations

import re

from .config import SegmentationCfg
from .types import Segment, Word

_TERMINAL = re.compile(r"[.!?…。！？]+[\"'”’)\]]*\s*$")
_MUSIC = re.compile(r"^[\s♪♫🎵🎶#*\-–—_\[\]\(\)]*$")


def is_sentence_end(text: str) -> bool:
    return bool(_TERMINAL.search(text.strip()))


def is_nonspeech(text: str) -> bool:
    t = text.strip()
    return not t or bool(_MUSIC.match(t)) or (t.startswith(("[", "(")) and t.endswith(("]", ")")))


def _join(a: Segment, b: Segment) -> Segment:
    return Segment(id=a.id, start=a.start, end=b.end, text=(a.text.rstrip() + " " + b.text.lstrip()).strip(),
                   speaker=a.speaker, words=a.words + b.words)


def merge_fragments(segs: list[Segment], cfg: SegmentationCfg) -> list[Segment]:
    out: list[Segment] = []
    for s in segs:
        if out:
            prev = out[-1]
            gap = s.start - prev.end
            if (gap <= cfg.merge_gap_s and not is_sentence_end(prev.text)
                    and (s.end - prev.start) <= cfg.max_segment_s and not is_nonspeech(prev.text)):
                out[-1] = _join(prev, s)
                continue
        out.append(s)
    return out


def split_sentences(seg: Segment, min_piece_s: float) -> list[Segment]:
    """Cut a segment after each sentence-ending word (using word timings) when both sides are long enough.

    Whisper often returns a whole exchange as ONE segment ("Why don't you admit it? I'm not scared."), which
    may contain two speakers. Speaker detection works per unit, so units must not span a turn change."""
    words = seg.words
    if len(words) < 2:
        return [seg]
    pieces: list[list[Word]] = []
    cur: list[Word] = []
    for i, w in enumerate(words):
        cur.append(w)
        rest = words[i + 1:]
        if (is_sentence_end(w.text) and rest and cur[-1].end - cur[0].start >= min_piece_s
                and rest[-1].end - rest[0].start >= min_piece_s):
            pieces.append(cur)
            cur = []
    if cur:
        pieces.append(cur)
    if len(pieces) == 1:                      # nothing to cut: keep Whisper's own segment boundaries
        return [seg]
    return [Segment(id=seg.id, start=p[0].start, end=p[-1].end, text=_words_text(p), speaker=seg.speaker, words=p)
            for p in pieces]


def split_long(seg: Segment, max_s: float) -> list[Segment]:
    """Recursively split at the best word boundary near the middle (punctuation / long pause win)."""
    if seg.duration <= max_s or len(seg.words) < 2:
        return [seg]
    words = seg.words
    mid = (seg.start + seg.end) / 2
    best, best_score = 1, float("-inf")
    for i in range(1, len(words)):
        gap = words[i].start - words[i - 1].end
        punct = 1.0 if re.search(r"[.!?…,;:]$", words[i - 1].text.strip()) else 0.0
        centre = -abs(words[i].start - mid) / seg.duration
        score = punct * 1.5 + gap * 4.0 + centre * 2.0
        if score > best_score:
            best, best_score = i, score
    left, right = words[:best], words[best:]
    a = Segment(id=seg.id, start=seg.start, end=left[-1].end, text=_words_text(left), speaker=seg.speaker, words=left)
    b = Segment(id=seg.id, start=right[0].start, end=seg.end, text=_words_text(right), speaker=seg.speaker, words=right)
    return split_long(a, max_s) + split_long(b, max_s)


def _words_text(words: list[Word]) -> str:
    return "".join(w.text if w.text.startswith(" ") or not i else " " + w.text for i, w in enumerate(words)).strip()


def resegment(segs: list[Segment], cfg: SegmentationCfg) -> list[Segment]:
    segs = [s for s in sorted(segs, key=lambda s: s.start) if s.text.strip()]
    merged = merge_fragments(segs, cfg)
    out: list[Segment] = []
    for s in merged:
        for piece in (split_sentences(s, cfg.min_sentence_s) if cfg.split_sentences else [s]):
            out.extend(split_long(piece, cfg.max_segment_s))
    for i, s in enumerate(out):
        s.id = i
        s.skip = is_nonspeech(s.text)
    return out
