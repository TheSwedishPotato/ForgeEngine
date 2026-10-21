"""Dialogue *adaptation* with a local LLM served by Ollama (still 100% on your machine).

Unlike sentence-by-sentence NMT, the model sees the surrounding lines, the speaker, the emotion
and a character budget derived from the actor's mouth time - which is what professional
dubbing adapters actually do. Quality depends on the model you pull (larger = better for
smaller languages such as Swedish).
"""
from __future__ import annotations

import json
import urllib.request

from ..base import Progress, Translator, _noop
from ..config import Config
from ..languages import resolve
from ..types import Segment

CHARS_PER_SEC = {"sv": 14, "de": 14, "en": 15, "fr": 15, "es": 16, "it": 16, "ja": 8, "zh": 5, "ko": 9}

PROMPT = """You are a professional film dubbing adapter. Translate the line below from {src} to {tgt}.
Rules: natural spoken {tgt}, same meaning and attitude, same register ({emotion}), keep names unchanged,
no explanations. The actor's mouth is open for {dur:.1f}s, so aim for at most {budget} characters
(shorter is better than longer).
Context so far:
{context}
Next line (for reference only): {nxt}
Line to translate ({speaker}): {text}
Answer as JSON: {{"translation": "..."}}"""


class OllamaTranslator(Translator):
    name = "ollama"

    def __init__(self, cfg: Config):
        self.cfg = cfg

    def _chat(self, prompt: str, keep_alive: str = "10m") -> str:
        c = self.cfg.translate
        body = json.dumps({"model": c.ollama_model, "stream": False, "format": "json", "keep_alive": keep_alive,
                           "options": {"temperature": 0.3},
                           "messages": [{"role": "user", "content": prompt}]}).encode()
        req = urllib.request.Request(c.ollama_url.rstrip("/") + "/api/chat", data=body,
                                     headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read())["message"]["content"]

    def unload(self) -> None:
        try:                                                  # free VRAM for the TTS stage
            c = self.cfg.translate
            req = urllib.request.Request(c.ollama_url.rstrip("/") + "/api/generate",
                                         data=json.dumps({"model": c.ollama_model, "keep_alive": 0}).encode(),
                                         headers={"Content-Type": "application/json"})
            urllib.request.urlopen(req, timeout=30).read()
        except Exception:
            pass
        super().unload()

    @staticmethod
    def parse(raw: str) -> str:
        try:
            return str(json.loads(raw)["translation"]).strip()
        except Exception:
            return raw.strip().strip('"')

    def translate(self, segments: list[Segment], src: str, tgt: str, progress: Progress = _noop) -> None:
        S, T = resolve(src), resolve(tgt)
        cps = CHARS_PER_SEC.get(T.code, 14)
        todo = [s for s in segments if not s.skip and s.text.strip()]
        history: list[str] = []
        for i, s in enumerate(todo):
            ctx = "\n".join(history[-self.cfg.translate.context_lines:]) or "(start of scene)"
            nxt = todo[i + 1].text if i + 1 < len(todo) else "(end)"
            prompt = PROMPT.format(src=S.name, tgt=T.name, emotion=s.emotion, dur=s.duration,
                                   budget=max(8, int(s.duration * cps * 1.1)), context=ctx, nxt=nxt,
                                   speaker=s.speaker, text=s.text)
            s.translation = self.parse(self._chat(prompt)) or s.text
            history.append(f"{s.speaker}: {s.text} -> {s.translation}")
            progress((i + 1) / len(todo), "adapting dialogue")
