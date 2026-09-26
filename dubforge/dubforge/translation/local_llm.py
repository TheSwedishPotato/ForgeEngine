"""Context-aware translation with a LOCAL LLM through any OpenAI-compatible server
running on your own machine (llama.cpp `llama-server`, LM Studio, Ollama, vLLM...).

This gives the most natural dubbing scripts: the model sees the surrounding
dialogue, knows who is speaking, and gets a syllable budget per line. Nothing
leaves localhost; the URL must point to 127.0.0.1/localhost.
"""

from __future__ import annotations

import json
import re
from urllib.parse import urlparse

from ..types import Segment
from . import languages as L
from .base import Translator, log

SYSTEM_PROMPT = """You are a professional film dubbing adapter. You translate dialogue from {src} to {tgt} \
so it can be spoken by voice actors in sync with the picture.
Rules:
- Natural, idiomatic spoken {tgt}; keep each character's register, slang, emotion and humour.
- Keep names, places and invented words as they are unless a glossary entry says otherwise.
- Each line has a syllable budget; aim to stay within it (±15%). Prefer shorter phrasing to literal accuracy.
- For every line give {n} alternative versions, best first, the later ones progressively shorter.
- Output ONLY JSON: {{"lines": [{{"id": <id>, "versions": ["...", "..."]}}, ...]}}"""


class LocalLLMTranslator(Translator):
    name = "local_llm"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        host = urlparse(self.cfg.llm_url).hostname or ""
        if host not in ("127.0.0.1", "localhost", "::1", "0.0.0.0"):
            raise ValueError(f"translation.llm_url must point to this machine (got '{host}'). "
                             "DubForge never sends dialogue to remote servers.")

    def _chat(self, messages: list[dict]) -> str:
        import requests

        r = requests.post(
            self.cfg.llm_url.rstrip("/") + "/chat/completions",
            json={"model": self.cfg.llm_model, "messages": messages, "temperature": self.cfg.llm_temperature,
                  "response_format": {"type": "json_object"}},
            timeout=600,
        )
        r.raise_for_status()
        return r.json()["choices"][0]["message"]["content"]

    @staticmethod
    def _parse(content: str) -> dict[int, list[str]]:
        m = re.search(r"\{.*\}", content, re.S)
        if not m:
            return {}
        try:
            data = json.loads(m.group(0))
        except json.JSONDecodeError:
            return {}
        out: dict[int, list[str]] = {}
        for item in data.get("lines", []):
            try:
                vs = item.get("versions") or [item.get("text", "")]
                out[int(item["id"])] = [str(v) for v in vs if str(v).strip()]
            except (KeyError, TypeError, ValueError):
                continue
        return out

    def translate_texts(self, texts, src, tgt, n, segments=None, audio16k=None, progress=lambda f, m: None):
        src_l, tgt_l = L.get(src), L.get(tgt)
        segs: list[Segment] = segments or [Segment(id=i, start=0, end=L.estimate_seconds(t, src) or 1.0, text=t)
                                           for i, t in enumerate(texts)]
        system = SYSTEM_PROMPT.format(src=src_l.name, tgt=tgt_l.name, n=n)
        if self.cfg.glossary:
            system += "\nGlossary (source -> required target): " + "; ".join(f"{k} -> {v}" for k, v in self.cfg.glossary.items())
        results: dict[int, list[str]] = {}
        done_context: list[str] = []
        step = max(1, self.cfg.llm_batch_lines)
        for b in range(0, len(segs), step):
            batch = segs[b: b + step]
            lines = []
            for local_id, s in enumerate(batch):
                budget = max(1, round((s.speech_duration or s.duration) * tgt_l.rate))
                lines.append({"id": local_id, "speaker": s.speaker, "seconds": round(s.duration, 2),
                              "syllable_budget": budget, "text": s.text})
            user = ""
            if done_context:
                user += "Previous dialogue (for context only):\n" + "\n".join(done_context[-self.cfg.llm_context_lines:]) + "\n\n"
            nxt = segs[b + step: b + step + 2]
            if nxt:
                user += "Following dialogue (context only): " + " / ".join(s.text for s in nxt) + "\n\n"
            user += "Translate these lines:\n" + json.dumps(lines, ensure_ascii=False)
            parsed: dict[int, list[str]] = {}
            for _attempt in range(2):
                try:
                    parsed = self._parse(self._chat([{"role": "system", "content": system},
                                                     {"role": "user", "content": user}]))
                except Exception as e:
                    log.warning("Local LLM request failed (%s)", e)
                if len(parsed) == len(batch):
                    break
            for local_id, s in enumerate(batch):
                vs = parsed.get(local_id) or []
                if not vs:  # model skipped the line: ask for it alone
                    try:
                        single = self._parse(self._chat([
                            {"role": "system", "content": system},
                            {"role": "user", "content": "Translate these lines:\n" + json.dumps([lines[local_id]], ensure_ascii=False)},
                        ]))
                        vs = single.get(local_id) or next(iter(single.values()), [])
                    except Exception:
                        vs = []
                results[b + local_id] = (vs or [s.text])[:n]
                done_context.append(f"{s.speaker}: {s.text} => {results[b + local_id][0]}")
            progress(min(1.0, (b + step) / len(segs)), f"translated {min(b + step, len(segs))}/{len(segs)} lines")
        return [results[i] for i in range(len(segs))]
