from __future__ import annotations

from ..base import Progress, Translator, _noop
from ..config import Config
from ..types import Segment


class PassthroughTranslator(Translator):
    """Copies the source text (tag-prefixed). For tests and for dry-running the audio pipeline."""
    name = "passthrough"

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def translate(self, segments: list[Segment], src: str, tgt: str, progress: Progress = _noop) -> None:
        for s in segments:
            if not s.skip and s.text.strip():
                s.translation = f"[{tgt}] {s.text}"
