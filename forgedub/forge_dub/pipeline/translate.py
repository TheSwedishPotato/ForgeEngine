"""Translation (English -> Swedish).

Real engine: Argos Translate — fully offline once the en->sv language package is
installed (``python -m forge_dub.tools.install_argos`` or the helper in the
README). Mock engine: looks up the canned demo Swedish text.
"""
from __future__ import annotations

from . import demo_content


def translate_segments(segments, settings, mode, report) -> None:
    if mode == "real":
        _translate_real(segments, settings, report)
    else:
        _translate_mock(segments, report)


def _translate_real(segments, settings, report) -> None:
    from argostranslate import translate as argos

    count = len(segments) or 1
    for index, seg in enumerate(segments):
        if seg.text_src.strip():
            seg.text_tgt = argos.translate(
                seg.text_src, settings.source_lang, settings.target_lang
            ).strip()
        else:
            seg.text_tgt = ""
        report((index + 1) / count, f"Translating… {index + 1}/{count}")


def _translate_mock(segments, report) -> None:
    count = len(segments) or 1
    for index, seg in enumerate(segments):
        seg.text_tgt = demo_content.SV_LOOKUP.get(seg.text_src, f"[SV] {seg.text_src}")
        report((index + 1) / count, f"Translating… {index + 1}/{count}")
