import pytest

from dubforge.asr import segmenting
from dubforge.config import ASRConfig
from dubforge.translation import languages as L
from dubforge.translation.base import choose_candidate, dedupe
from dubforge.types import Segment, Transcript, Word


def test_language_normalization():
    assert L.normalize("German") == "de"
    assert L.normalize("deu") == "de"
    assert L.normalize("zh-cn") == "zh"
    assert L.normalize("en-US") == "en"
    assert L.get("de").nllb == "deu_Latn"
    with pytest.raises(L.UnsupportedLanguage):
        L.normalize("klingon")


def test_syllable_estimates_are_sane():
    short = L.estimate_seconds("Ja.", "de")
    long = L.estimate_seconds("Das ist eine sehr viel längere Antwort, die man sprechen muss.", "de")
    assert 0 < short < long
    assert 1.5 < long < 5.0
    assert L.count_syllables("こんにちは", "ja") >= 4
    assert L.count_syllables("你好世界", "zh") == 4


def test_rate_calibrator_learns():
    cal = L.RateCalibrator()
    text = "Das ist ein ganz normaler Satz."
    for _ in range(6):
        cal.update(text, "de", L.estimate_seconds(text, "de") * 1.5)  # the voice speaks slowly
    assert cal.estimate(text, "de") > L.estimate_seconds(text, "de") * 1.3


def test_length_aware_choice_prefers_fitting_candidate():
    cands = ["Das ist eine außerordentlich lange und umständliche Übersetzung dieses Satzes.", "Das ist kurz."]
    assert choose_candidate(cands, slot=1.0, lang="de", rank_penalty=0.35) == 1
    assert choose_candidate(cands, slot=8.0, lang="de", rank_penalty=0.35) == 0
    assert dedupe(["Hallo!", "hallo", " Hallo  Welt "]) == ["Hallo!", "Hallo Welt"]


def test_hallucination_filter():
    assert segmenting.is_hallucination("Untertitel im Auftrag des ZDF, 2021")
    assert segmenting.is_hallucination("♪ ♪")
    assert not segmenting.is_hallucination("Where were you last night?")


def _seg(i, a, b, text, spk="SPEAKER_00", words=None):
    return Segment(id=i, start=a, end=b, text=text, speaker=spk, words=words or [])


def test_split_long_at_pause():
    words = [Word(0.0 + i * 0.5, 0.4 + i * 0.5, f"w{i}") for i in range(10)]
    words[4] = Word(2.0, 2.4, "end.")
    for w in words[5:]:
        w.start += 1.0
        w.end += 1.0
    seg = _seg(0, 0, words[-1].end, "x", words=words)
    parts = segmenting.split_long(seg, 4.0, "en")
    assert len(parts) >= 2
    assert parts[0].words[-1].text == "end."


def test_split_on_speaker_change():
    words = [Word(i * 0.3, i * 0.3 + 0.25, f"w{i}", speaker="A" if i < 4 else "B") for i in range(8)]
    parts = segmenting.split_on_speaker_change(_seg(0, 0, 2.4, "x", words=words), "en")
    assert [p.speaker for p in parts] == ["A", "B"]
    assert len(parts[0].words) == 4


def test_merge_short_same_speaker():
    cfg = ASRConfig()
    segs = [_seg(0, 0.0, 0.5, "Well"), _seg(1, 0.6, 2.0, "I don't know."), _seg(2, 2.1, 3.0, "Who?", "SPEAKER_01")]
    out = segmenting.merge_short(segs, cfg, "en")
    assert len(out) == 2
    assert out[0].text.startswith("Well")


def test_transcript_roundtrip(tmp_path):
    t = Transcript([_seg(0, 1.0, 2.0, "Hi", words=[Word(1.1, 1.5, "Hi")])], language="en", duration=3.0)
    t.segments[0].translation = "Hallo"
    t.save(tmp_path / "t.json")
    t2 = Transcript.load(tmp_path / "t.json")
    assert t2.segments[0].translation == "Hallo"
    assert t2.segments[0].speech_start == pytest.approx(1.1)
