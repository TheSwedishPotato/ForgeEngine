"""Language table: one place that maps a language to every model's code, plus a
speaking-rate model used to estimate how long a translated line will take to say."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Lang:
    code: str  # Whisper / ISO 639-1 code
    name: str
    nllb: str
    seamless: str | None
    iso3: str  # ISO 639-2 (container metadata)
    xtts: str | None
    sovits: str | None
    rate: float  # typical syllables (or morae) per second in natural speech
    script: str = "latin"


LANGS: dict[str, Lang] = {
    l.code: l
    for l in [
        Lang("en", "English", "eng_Latn", "eng", "eng", "en", "en", 6.2),
        Lang("de", "German", "deu_Latn", "deu", "deu", "de", None, 6.0),
        Lang("fr", "French", "fra_Latn", "fra", "fra", "fr", None, 7.2),
        Lang("es", "Spanish", "spa_Latn", "spa", "spa", "es", None, 7.8),
        Lang("it", "Italian", "ita_Latn", "ita", "ita", "it", None, 7.0),
        Lang("pt", "Portuguese", "por_Latn", "por", "por", "pt", None, 7.0),
        Lang("nl", "Dutch", "nld_Latn", "nld", "nld", "nl", None, 6.2),
        Lang("pl", "Polish", "pol_Latn", "pol", "pol", "pl", None, 6.5),
        Lang("cs", "Czech", "ces_Latn", "ces", "ces", "cs", None, 6.3),
        Lang("sv", "Swedish", "swe_Latn", "swe", "swe", None, None, 6.2),
        Lang("da", "Danish", "dan_Latn", "dan", "dan", None, None, 6.2),
        Lang("no", "Norwegian", "nob_Latn", "nob", "nor", None, None, 6.2),
        Lang("fi", "Finnish", "fin_Latn", "fin", "fin", None, None, 7.0),
        Lang("hu", "Hungarian", "hun_Latn", "hun", "hun", "hu", None, 6.6),
        Lang("ro", "Romanian", "ron_Latn", "ron", "ron", None, None, 6.8),
        Lang("el", "Greek", "ell_Grek", "ell", "ell", None, None, 6.8, "greek"),
        Lang("tr", "Turkish", "tur_Latn", "tur", "tur", "tr", None, 6.9),
        Lang("ru", "Russian", "rus_Cyrl", "rus", "rus", "ru", None, 6.0, "cyrillic"),
        Lang("uk", "Ukrainian", "ukr_Cyrl", "ukr", "ukr", None, None, 6.0, "cyrillic"),
        Lang("ar", "Arabic", "arb_Arab", "arb", "ara", "ar", None, 5.8, "abjad"),
        Lang("he", "Hebrew", "heb_Hebr", "heb", "heb", None, None, 6.0, "abjad"),
        Lang("hi", "Hindi", "hin_Deva", "hin", "hin", "hi", None, 6.0, "indic"),
        Lang("ja", "Japanese", "jpn_Jpan", "jpn", "jpn", "ja", "ja", 7.8, "japanese"),
        Lang("ko", "Korean", "kor_Hang", "kor", "kor", "ko", "ko", 6.5, "hangul"),
        Lang("zh", "Chinese (Mandarin)", "zho_Hans", "cmn", "zho", "zh-cn", "zh", 5.2, "han"),
        Lang("yue", "Cantonese", "yue_Hant", "yue", "yue", None, "yue", 5.5, "han"),
        Lang("vi", "Vietnamese", "vie_Latn", "vie", "vie", None, None, 5.5),
        Lang("th", "Thai", "tha_Thai", "tha", "tha", None, None, 6.0, "thai"),
        Lang("id", "Indonesian", "ind_Latn", "ind", "ind", None, None, 6.8),
    ]
}

_ALIASES = {l.name.lower(): l.code for l in LANGS.values()}
_ALIASES.update({l.iso3: l.code for l in LANGS.values()})
_ALIASES.update({l.nllb.lower(): l.code for l in LANGS.values()})
_ALIASES.update({"zh-cn": "zh", "cmn": "zh", "chinese": "zh", "mandarin": "zh", "nb": "no", "ger": "de",
                 "fre": "fr", "cze": "cs", "dut": "nl", "gre": "el", "chi": "zh", "iw": "he"})


class UnsupportedLanguage(ValueError):
    pass


def normalize(code_or_name: str) -> str:
    key = code_or_name.strip().lower().replace("_", "-")
    if key in LANGS:
        return key
    if key in _ALIASES:
        return _ALIASES[key]
    short = key.split("-")[0]
    if short in LANGS:
        return short
    raise UnsupportedLanguage(f"Unknown language '{code_or_name}'. Known: {', '.join(sorted(LANGS))}")


def get(code: str) -> Lang:
    return LANGS[normalize(code)]


def choices() -> list[tuple[str, str]]:
    return [(f"{l.name} ({l.code})", l.code) for l in LANGS.values()]


# --------------------------------------------------------------------------- speaking-rate model

_VOWELS = {
    "latin": "aeiouyàáâãäåæèéêëìíîïòóôõöøùúûüýÿąęėįųūůőűœăâîșțı",
    "cyrillic": "аеёиоуыэюяіїє",
    "greek": "αεηιουωάέήίόύώϊϋΐΰ",
}
_RE_HAN = re.compile(r"[一-鿿㐀-䶿]")
_RE_KANA = re.compile(r"[぀-ヿ]")
_RE_HANGUL = re.compile(r"[가-힯]")
_RE_DIGIT = re.compile(r"\d")
_RE_LETTER = re.compile(r"\w", re.UNICODE)


def count_syllables(text: str, lang: str) -> float:
    l = get(lang)
    t = text.lower()
    digits = len(_RE_DIGIT.findall(t)) * 1.6
    if l.script == "han":
        return len(_RE_HAN.findall(t)) + digits
    if l.script == "japanese":
        return len(_RE_KANA.findall(t)) + 1.7 * len(_RE_HAN.findall(t)) + digits
    if l.script == "hangul":
        return len(_RE_HANGUL.findall(t)) + digits
    if l.script in ("abjad", "indic", "thai"):
        return len(_RE_LETTER.findall(t)) / 2.3 + digits
    vowels = _VOWELS.get(l.script, _VOWELS["latin"])
    n = 0
    prev = False
    for ch in t:
        is_v = ch in vowels
        if is_v and not prev:
            n += 1
        prev = is_v
    return n + digits


def estimate_seconds(text: str, lang: str, rate_scale: float = 1.0) -> float:
    """Rough spoken duration incl. short pauses at punctuation."""
    syl = count_syllables(text, lang)
    # short pauses at commas, longer ones between sentences inside the line
    pauses = len(re.findall(r"[,;:—–，、]", text)) * 0.12 + len(re.findall(r"[.!?…。！？]+\s+\S", text)) * 0.25
    return syl / (get(lang).rate * rate_scale) + pauses


class RateCalibrator:
    """Learns how fast the actual TTS voice speaks, so estimates improve during a run."""

    def __init__(self, momentum: float = 0.85):
        self.scale = 1.0
        self.momentum = momentum
        self.n = 0

    def update(self, text: str, lang: str, actual_seconds: float) -> None:
        est = estimate_seconds(text, lang)
        if est < 0.4 or actual_seconds < 0.3:
            return
        ratio = max(0.5, min(2.0, est / actual_seconds))
        m = self.momentum if self.n >= 3 else 0.5
        self.scale = m * self.scale + (1 - m) * ratio
        self.n += 1

    def estimate(self, text: str, lang: str) -> float:
        return estimate_seconds(text, lang, self.scale)
