"""Language table: one place that maps a language to every model's code and capability.

TTS support sets matter: XTTS-v2 has NO Swedish; Chatterbox Multilingual does.
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class Language:
    code: str    # ISO 639-1 (also what Whisper / Chatterbox use)
    iso3: str   # ISO 639-2, for container metadata
    name: str
    nllb: str    # NLLB-200 FLORES code


_L = [
    Language("en", "eng", "English", "eng_Latn"),
    Language("sv", "swe", "Swedish", "swe_Latn"),
    Language("de", "deu", "German", "deu_Latn"),
    Language("fr", "fra", "French", "fra_Latn"),
    Language("es", "spa", "Spanish", "spa_Latn"),
    Language("it", "ita", "Italian", "ita_Latn"),
    Language("pt", "por", "Portuguese", "por_Latn"),
    Language("nl", "nld", "Dutch", "nld_Latn"),
    Language("pl", "pol", "Polish", "pol_Latn"),
    Language("ru", "rus", "Russian", "rus_Cyrl"),
    Language("uk", "ukr", "Ukrainian", "ukr_Cyrl"),
    Language("tr", "tur", "Turkish", "tur_Latn"),
    Language("ar", "ara", "Arabic", "arb_Arab"),
    Language("he", "heb", "Hebrew", "heb_Hebr"),
    Language("hi", "hin", "Hindi", "hin_Deva"),
    Language("zh", "zho", "Chinese", "zho_Hans"),
    Language("ja", "jpn", "Japanese", "jpn_Jpan"),
    Language("ko", "kor", "Korean", "kor_Hang"),
    Language("da", "dan", "Danish", "dan_Latn"),
    Language("no", "nor", "Norwegian", "nob_Latn"),
    Language("fi", "fin", "Finnish", "fin_Latn"),
    Language("el", "ell", "Greek", "ell_Grek"),
    Language("cs", "ces", "Czech", "ces_Latn"),
    Language("hu", "hun", "Hungarian", "hun_Latn"),
    Language("ro", "ron", "Romanian", "ron_Latn"),
    Language("id", "ind", "Indonesian", "ind_Latn"),
    Language("ms", "msa", "Malay", "zsm_Latn"),
    Language("vi", "vie", "Vietnamese", "vie_Latn"),
    Language("th", "tha", "Thai", "tha_Thai"),
    Language("sw", "swa", "Swahili", "swh_Latn"),
]

LANGUAGES: dict[str, Language] = {l.code: l for l in _L}

# Languages each TTS engine can speak (zero-shot cloning). Verified against the model cards.
CHATTERBOX_LANGS = {"ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja",
                    "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh"}
XTTS_LANGS = {"en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh",
              "ja", "hu", "ko", "hi"}

TTS_LANGS = {"chatterbox": CHATTERBOX_LANGS, "xtts": XTTS_LANGS}


def resolve(value: str) -> Language:
    """Accept 'sv', 'swe', 'Swedish', 'swedish' ..."""
    v = value.strip().lower()
    for l in _L:
        if v in (l.code, l.iso3, l.name.lower()):
            return l
    raise ValueError(f"Unknown language {value!r}. Known: " + ", ".join(f"{l.name} ({l.code})" for l in _L))


def tts_supports(backend: str, code: str) -> bool:
    langs = TTS_LANGS.get(backend)
    return True if langs is None else code in langs   # unknown/mock backends: don't block


def tts_backends_for(code: str) -> list[str]:
    return [b for b, langs in TTS_LANGS.items() if code in langs]


def choices() -> list[tuple[str, str]]:
    return [(f"{l.name} ({l.code})", l.code) for l in _L]
