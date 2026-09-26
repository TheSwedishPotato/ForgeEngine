"""Turn raw Whisper output into good dubbing units.

* drop hallucinations / non-speech
* split segments where diarization says the speaker changes mid-segment
* split overly long segments at natural pauses/punctuation
* merge tiny fragments of the same speaker
"""

from __future__ import annotations

import re

from ..config import ASRConfig
from ..types import Segment, Transcript, Word
from .base import join_words

# Classic Whisper hallucinations on music/silence (lower-cased substrings).
HALLUCINATIONS = (
    "thank you for watching",
    "thanks for watching",
    "please subscribe",
    "subtitles by the amara.org",
    "amara.org community",
    "untertitel im auftrag des zdf",
    "untertitelung des zdf",
    "untertitel der amara.org",
    "sous-titrage st' 501",
    "sous-titres réalisés para la communauté d'amara.org",
    "субтитры сделал",
    "ご視聴ありがとうございました",
    "字幕由",
)

SENTENCE_END = re.compile(r"[.!?…。！？]['\"”’)]*$")
CLAUSE_END = re.compile(r"[,;:—–、，；：]['\"”’)]*$")


def is_hallucination(text: str) -> bool:
    t = text.strip().lower()
    if not t or re.fullmatch(r"[\W_♪♫\s]*", t):
        return True
    if any(h in t for h in HALLUCINATIONS):
        return True
    tokens = t.split()
    if len(tokens) >= 8 and len(set(tokens)) <= 2:  # "no no no no no no no no ..."
        return True
    return False


def clean(transcript: Transcript, cfg: ASRConfig) -> Transcript:
    kept: list[Segment] = []
    for s in transcript.segments:
        s.text = " ".join(s.text.split())
        if is_hallucination(s.text):
            continue
        if s.no_speech_prob is not None and s.no_speech_prob > cfg.drop_no_speech_prob and (s.avg_logprob or 0) < -0.5:
            continue
        if s.avg_logprob is not None and s.avg_logprob < cfg.drop_avg_logprob:
            continue
        if s.end - s.start < 0.08:
            continue
        kept.append(s)
    transcript.segments = kept
    return transcript


def _from_words(template: Segment, words: list[Word], language: str | None, speaker: str | None = None) -> Segment:
    return Segment(
        id=template.id,
        start=words[0].start,
        end=words[-1].end,
        text=join_words([w.text for w in words], language),
        speaker=speaker or template.speaker,
        words=words,
        avg_logprob=template.avg_logprob,
        no_speech_prob=template.no_speech_prob,
    )


def split_on_speaker_change(seg: Segment, language: str | None, min_words: int = 2) -> list[Segment]:
    if len({w.speaker for w in seg.words if w.speaker}) < 2:
        return [seg]
    runs: list[tuple[str, list[Word]]] = []
    cur = seg.speaker
    for w in seg.words:
        cur = w.speaker or cur  # unlabeled words inherit the previous speaker
        if runs and runs[-1][0] == cur:
            runs[-1][1].append(w)
        else:
            runs.append((cur, [w]))
    # absorb tiny runs (diarization jitter) into the previous run
    merged: list[tuple[str, list[Word]]] = []
    for spk, ws in runs:
        if merged and len(ws) < min_words:
            merged[-1][1].extend(ws)
        elif merged and merged[-1][0] == spk:
            merged[-1][1].extend(ws)
        else:
            merged.append((spk, list(ws)))
    if len(merged) > 1 and len(merged[0][1]) < min_words:
        merged[1] = (merged[1][0], merged[0][1] + merged[1][1])
        merged.pop(0)
    return [_from_words(seg, ws, language, spk) for spk, ws in merged]


def split_long(seg: Segment, max_seconds: float, language: str | None) -> list[Segment]:
    if seg.duration <= max_seconds or len(seg.words) < 4:
        return [seg]
    words = seg.words
    best_i, best_score = None, -1e9
    mid = (seg.start + seg.end) / 2
    for i in range(1, len(words)):
        left, right = words[i - 1], words[i]
        gap = max(0.0, right.start - left.end)
        score = gap * 4.0
        if SENTENCE_END.search(left.text.strip()):
            score += 2.0
        elif CLAUSE_END.search(left.text.strip()):
            score += 1.0
        score -= abs(left.end - mid) / max(seg.duration, 1e-3) * 1.5  # prefer the middle
        if score > best_score:
            best_i, best_score = i, score
    assert best_i is not None
    a = _from_words(seg, words[:best_i], language)
    b = _from_words(seg, words[best_i:], language)
    return split_long(a, max_seconds, language) + split_long(b, max_seconds, language)


def merge_short(segments: list[Segment], cfg: ASRConfig, language: str | None) -> list[Segment]:
    out: list[Segment] = []
    for s in segments:
        if out:
            p = out[-1]
            gap = s.start - p.end
            combined = s.end - p.start
            same = p.speaker == s.speaker
            short = p.duration < cfg.min_segment_seconds * 3 or s.duration < cfg.min_segment_seconds * 3
            open_sentence = not SENTENCE_END.search(p.text.strip())
            if same and 0 <= gap <= cfg.merge_gap_seconds and combined <= cfg.max_segment_seconds and (short or open_sentence):
                words = p.words + s.words
                p.end = s.end
                p.words = words
                p.text = join_words([w.text for w in words], language) if words else f"{p.text} {s.text}"
                continue
        out.append(s)
    return out


def postprocess(transcript: Transcript, cfg: ASRConfig) -> Transcript:
    lang = transcript.language
    transcript = clean(transcript, cfg)
    segs: list[Segment] = []
    for s in transcript.segments:
        segs.extend(split_on_speaker_change(s, lang))
    segs = [p for s in segs for p in split_long(s, cfg.max_segment_seconds, lang)]
    segs.sort(key=lambda s: s.start)
    segs = merge_short(segs, cfg, lang)
    segs = [s for s in segs if s.duration >= cfg.min_segment_seconds * 0.5 and s.text.strip()]
    transcript.segments = segs
    transcript.renumber()
    transcript.refresh_speakers()
    return transcript
