# Is this a business? Licences, rights and the honest picture

Short version: the **need is real**, the **technology is close but not "Hollywood" yet**, and the
two things that decide whether this becomes a company are **rights/consent** and **the licences of the
models you build on** — not the code. Today this prototype is legally a *personal-use* tool.

## 1. The licence problem (blocks selling anything built on the default stack)

| Component | Used for | Licence (as far as I could verify) | Commercial use? |
|---|---|---|---|
| Chatterbox Multilingual | voice cloning (default) | MIT *(checked, model page + repo)* | Yes |
| faster-whisper / Whisper | transcription | MIT *(from memory — verify)* | Yes |
| Demucs (htdemucs) | music/voice split | MIT *(from memory — verify)* | Yes |
| SpeechBrain ECAPA (VoxCeleb) | speaker clustering | Apache-2.0 code *(from memory)*; model trained on VoxCeleb — check its card | Check |
| `superb/wav2vec2-base-superb-er` | emotion | Apache-2.0 *(checked, model card)*; trained on IEMOCAP, whose own terms are research-oriented — check | Check |
| **NLLB-200** | translation (default) | **CC-BY-NC 4.0** *(checked)* | **No** |
| **XTTS-v2** | optional TTS | **Coqui Public Model License** — non-commercial *(checked via secondary source; read the CPML text)* | **No** |
| **Wav2Lip** | lip-sync | Personal/research/non-commercial only; trained on LRS2 *(checked, README)* | **No** (authors point to a paid commercial model) |
| MuseTalk | lip-sync | **Unclear — sources conflict** (OpenRAIL on the model card, MIT on a mirror) *(checked)* | Read the official LICENSE + each weight's card |

Everything is behind a swappable interface (`dubforge/registry.py`), so the commercial path is to replace the
three red rows, not to rewrite the product:

* **Translation:** run an LLM through the `ollama` backend with a permissively licensed model (check the model's
  own licence — "open weights" ≠ "commercial OK"), or another permissively licensed translation model.
* **TTS:** Chatterbox is already fine. Test quality per language.
* **Lip-sync:** license a commercial model, or evaluate openly licensed ones, after reading their weights' terms.

I am not a lawyer; have one read the actual licence texts before you take money for anything.

## 2. Rights and consent (the bigger blocker)

* You cannot sell a dub of a film you don't own. Studios/distributors hold the rights; you sell **to them**, with a contract.
* Cloning an actor's voice and re-rendering their face are **performer-rights** issues. Recent guild agreements
  (e.g. SAG-AFTRA's 2023 contract) require consent and compensation for digital replicas, and EU/Swedish law adds
  personality-rights and GDPR (voice is biometric data) questions. A studio will ask how you handle consent, opt-outs
  and payment of the original performers. "Cheaper than hiring actors" is exactly the pitch that triggers that conversation.
* Practical consequence: the first customers are the ones with simple rights — creators dubbing their *own* content,
  documentaries, e-learning, corporate video, indie films with consenting casts — not "all movie companies" on day one.

## 3. The market, honestly

* AI dubbing is an **active, funded category** (e.g. ElevenLabs, HeyGen, Deepdub, Papercup, Flawless AI's
  visual-dubbing work for film — *from memory, check current status*). You'd compete with them, not with an empty field.
* Studios' pain is real: human dubbing takes weeks to months per language and many long-tail titles are never dubbed.
* What studios pay for isn't the model, it's **quality guarantees, security (unreleased content can't leave their
  network), rights handling and a human QC pass**. Your fully-local design is a genuine advantage for the security point.
* Realistic product today: **AI-assisted dubbing with a human reviewer** (translation adaptation, performance QC).
  That is what the `--review` workflow is for. "No humans, perfect, any film" is not achievable with open models yet.
* Possible wedge: small languages where big vendors are weakest (Nordic languages) — but only if you can show
  quality there. Measure it (see the roadmap) before you claim it.

## 4. Suggested path

1. Keep using this as a personal prototype; judge the output on your own clips.
2. Build a small **evaluation set** per language (re-transcribe the dub and compute word error rate; speaker-similarity
   score vs the original; blind listening tests with native speakers). Numbers beat opinions in sales calls.
3. Talk to 5–10 localisation managers (streamers, distributors, e-learning companies) *before* building more.
   Ask what they pay per minute today, what quality bar they need, what they require on consent.
4. Swap the non-commercial components, then pilot on content with clean rights.
