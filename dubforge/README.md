# DubForge: private, local AI dubbing

DubForge dubs a movie or show from any language to another (English → German, German → English, Japanese → English, and so on). It keeps:

- **the actors' own voices.** Zero-shot voice cloning per character, from clips it picks automatically.
- **emotion and delivery.** Each line is re-voiced using the original line's own audio as the style reference. Angry stays angry, a whisper stays a whisper, a shout stays loud.
- **timing.** Translations are chosen and fitted to the time the actor actually speaks.
- **the soundtrack.** Music, effects, laughs, screams and breaths are kept. Only the dialogue is replaced.
- **the lips (optional).** Wav2Lip (fast) or MuseTalk (higher quality) re-renders the mouth, only on the frames where a dubbed line is spoken.

Everything runs **on your own GPU**. After a one-time model download you can set `offline: true` and nothing ever touches the network again. There is no telemetry, no cloud API and no account.

> **Personal use only.** Use DubForge with videos you have the right to process: your own recordings, DRM-free purchases, public-domain films. Voice cloning of real actors is for your private viewing. Don't publish or distribute the results. XTTS-v2, Wav2Lip and MuseTalk are licensed for non-commercial use only.

### About Netflix and other DRM streams

- **Netflix app downloads are encrypted.** They only play inside the Netflix app. DubForge can't open them and doesn't try to decrypt anything.
- **Screen recording DRM content usually captures black frames.** OBS and similar tools hit the browser's or app's protected-media path.
- **The *live audio overlay* mode works with any player, Netflix included.** It only listens to your PC's sound output through a virtual audio cable, the same way Windows Live Captions does.
- **Batch mode and the delayed-video mode are for sources you can capture or already have as files.**

---

## 1. The plan (how it works)

```
                         ┌─────────────── BATCH MODE (best quality) ───────────────┐
 movie.mkv ─► extract ─► separate ─► transcribe ─► emotion ─► translate ─► voices ─► TTS ─► mix ─► lip sync ─► mux ─► movie.de.mkv
              audio      Demucs /    WhisperX      SpeechBrain NLLB /       per-char  XTTS-v2   stems  Wav2Lip /   dub + original
                         RoFormer    + pyannote    + prosody   Seamless /   reference / GPT-   + dub  MuseTalk    track + subtitles
                         vocals |    or ECAPA      (whisper    local LLM    clips     SoVITS
                         background  speakers      detection)  (N candidates)          + timing fit
```

| # | Stage | What happens | Why it matters for quality |
|---|---|---|---|
| 1 | **extract** | ffmpeg decodes the audio (5.1 is downmixed, dialogue centre included) | – |
| 2 | **separate** | Demucs `htdemucs_ft` (or BS-RoFormer) splits **dialogue** from **background**. `background = mix − vocals`, so the two always add back up to the exact original | keeps music and effects intact, and gives clean audio for ASR and voice cloning |
| 3 | **transcribe** | WhisperX `large-v3`: batched Whisper, wav2vec2 word timestamps, pyannote diarization. Without a HF token, ECAPA speaker clustering is used instead. Lines are split at speaker changes and pauses, and fragments are merged | exact word timing is the basis of sync |
| 4 | **emotion** | SpeechBrain wav2vec2 classifier (neutral/happy/angry/sad), plus DSP prosody (loudness, pitch range, voicing → **whisper detection**) | drives take temperature, reference choice and loudness |
| 5 | **translate** | NLLB-200 / SeamlessM4T v2 (text, or straight from speech) / **local LLM** (context-aware, syllable-budgeted). Several candidates are kept per line and the best-fitting one is chosen | dubbing ≠ subtitling: the line has to *fit the mouth* |
| 6 | **voices** | Picks each character's cleanest 3–12 s clips: no overlap, high dialogue-to-background ratio, confident ASR, a spread of emotions | cloning quality depends on the reference |
| 7 | **TTS** | XTTS-v2. **Timbre** comes from the character's clips, **style** from the original line itself (blended). Up to N takes are scored for plausible length (catches babbling and cut-offs), with optional Whisper re-check. Too long → shorter candidate → model speed-up → pitch-preserving stretch → overflow into silence. Loudness matched per line | emotion transfer + sync |
| 8 | **mix** | background + original vocals with dubbed lines muted (laughs and breaths survive) + dub, rendered in blocks (any film length) | sounds like a studio dub, not a voice-over |
| 9 | **lip sync** | Only dubbed spans are cut out (frame-exact). Wav2Lip (face tracking, feathered lower-face blend) or MuseTalk 1.5 runs on them, then they are spliced back. Clips with no face keep the original | mouths match, and the rest of the film is untouched |
| 10 | **mux** | New default audio track (e.g. "German (DubForge)") + original track + soft subtitles. The video is stream-copied unless it was lip-synced | switch tracks in VLC/MPV |

Every stage is **cached and resumable** (`work/<film>/`). Every stage is also a **swappable backend** (`dubforge/registry.py`).

**The script is editable.** `work/<film>/script.json` holds every line with its original text, translation, alternative candidates, speaker, emotion and fit notes. Fix a line, reassign a speaker, or tick `keep_original` (songs, catch-phrases). Then re-run: **only the changed lines are re-voiced**. The GUI has a table editor for this.

### While-watching modes

| Mode | How | Latency / sync | Works with Netflix? |
|---|---|---|---|
| **Live audio overlay** (`live-audio`) | player → *VB-Cable* → DubForge → your headphones. The original is ducked, centre-cancelled or muted, and the cloned-voice dub is mixed in | dub trails the actor by ~1–2.5 s, like a live interpreter | ✅ (audio only) |
| **Delayed video** (`live-video`) | screen region + audio are buffered for 6–30 s. Each line is dubbed *in place* (same start, time-fitted, original dialogue replaced by separated background, optional live Wav2Lip). Output goes to a window or OBS Virtual Camera | picture-accurate sync, you watch 12 s "behind" | ❌ DRM players capture as black |

---

## 2. Installation (Windows 10/11 + NVIDIA; Linux is analogous)

### Step 1: basics
1. NVIDIA driver **≥ 570** (for CUDA 12.8 wheels). Check with `nvidia-smi`.
2. [Miniconda](https://docs.conda.io/en/latest/miniconda.html).
3. Git.
4. *(Windows only)* [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/). A few TTS dependencies compile small extensions.

### Step 2: conda env (Python 3.11 + ffmpeg + rubberband)
```bat
cd dubforge
conda env create -f environment.yml
conda activate dubforge
```

### Step 3: PyTorch with CUDA (before anything else)
WhisperX 3.8 pins **torch 2.8**, so install exactly that series:
```bat
pip install torch==2.8.0 torchaudio==2.8.0 torchvision==0.23.0 --index-url https://download.pytorch.org/whl/cu128
python -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```
It must print `True` and your GPU's name. RTX 50-series (Blackwell) cards need cu128 or newer, which is what this command installs.

### Step 4: Python packages
```bat
pip install -r requirements.txt
pip install -r requirements-optional.txt   :: optional: RoFormer separation, rubberband stretching
```

### Step 5: models (one time, ~12 GB)
```bat
python main.py download-models --languages en,de --accept-coqui-license
```
- **Whisper large-v3** (+ large-v3-turbo for live mode), **word-alignment** models for the listed languages, **NLLB-200 1.3B**, **XTTS-v2**, **SpeechBrain** emotion + speaker models, **Demucs**.
- **Speaker diarization (optional, recommended).** pyannote's models are gated:
  1. Create a free token at huggingface.co.
  2. Accept the terms of `pyannote/speaker-diarization-community-1`.
  3. Run `python main.py download-models --only diarization --hf-token hf_xxx`.

  The token is only used for this download and is never written to disk. Without it, DubForge falls back to ECAPA speaker clustering, which works fine for most films.
- `--preset gpu_24gb` fetches the bigger NLLB-3.3B. `--seamless` adds SeamlessM4T v2 (~10 GB).

Then go offline for good in `configs/default.yaml`:
```yaml
general:
  offline: true
```

### Step 6: check everything
```bat
python main.py doctor
```
This prints your GPU, suggests a preset, lists missing packages or models, and finds VB-Cable.

### Step 7 (optional): lip sync
**Wav2Lip** (fast, runs in the same env):
```bat
python main.py download-models --lipsync     :: clones Wav2Lip into third_party/ + gets the S3FD face detector
```
Then download `wav2lip_gan.pth` from the links in `third_party/Wav2Lip/README.md` and save it to `third_party/Wav2Lip/checkpoints/wav2lip_gan.pth`.

**MuseTalk 1.5** (better quality, **separate conda env** because it pins old torch/mmcv):
```bat
git clone https://github.com/TMElyralab/MuseTalk third_party/MuseTalk
:: follow MuseTalk's README: conda create -n musetalk python=3.10, its torch, mim install mmcv/mmdet/mmpose,
:: pip install -r requirements.txt, then download_weights.bat
```
In your config, point DubForge at that env (MuseTalk's scripts break on paths with spaces, so keep the folder path space-free):
```yaml
lipsync:
  backend: musetalk
  python: C:/Users/you/miniconda3/envs/musetalk/python.exe
```

### Step 8 (optional): GPT-SoVITS instead of XTTS
GPT-SoVITS speaks zh/en/ja/ko/yue. It is very natural for anime and Asian-language dubs. Run it in its own env and start its API:
```bat
python api_v2.py -a 127.0.0.1 -p 9880 -c GPT_SoVITS/configs/tts_infer.yaml
```
Then dub with `--tts gpt_sovits`.

### Step 9 (optional): local LLM translation (the best scripts)
Any OpenAI-compatible server **on localhost** works: llama.cpp `llama-server`, LM Studio or Ollama. Use a model that is strong in both languages (e.g. a Qwen/Mistral/Llama instruct model that fits next to nothing else, because the pipeline stages run one at a time).
```yaml
translation:
  backend: local_llm
  llm_url: http://127.0.0.1:8080/v1    # DubForge refuses non-local URLs
  llm_model: whatever-your-server-calls-it
```
The LLM sees the surrounding dialogue and each line's syllable budget, so you get natural, lip-length-aware dubbing scripts.

---

## 3. Usage

### 30-second test (do this first)
```bat
:: 1. plumbing check, no models needed (seconds):
python scripts/test_30s_clip.py --mock

:: 2. the real thing, starting at 5:00, English -> German, with an A/B listening file:
python scripts/test_30s_clip.py "D:\Videos\my_film.mkv" --start 300 --to de --ab

:: 3. with lip sync:
python scripts/test_30s_clip.py "D:\Videos\my_film.mkv" --start 300 --to de --lipsync wav2lip
```
It prints every line (original → dub, speaker, emotion, fitting notes), per-stage timings, peak VRAM and a speed estimate for a full film.

### Batch: a whole movie
```bat
python main.py batch "D:\Videos\my_film.mkv" --to de
python main.py batch film.mkv --to en --from de --preset gpu_12gb --lipsync musetalk
python main.py batch film.mkv --to de --preset gpu_24gb,hollywood        :: presets stack
python main.py batch film.mkv --to de --to-stage translate                :: stop to review the script first
python main.py batch film.mkv --to de --from-stage tts                    :: force re-voicing
python main.py batch film.mkv --to de --set tts.temperature=0.6 --set timing.max_stretch=1.1
```
Output lands in `output/<name>.<lang>.mkv|mp4`. It has the dub as the default audio track, the original as a second track, and translated subtitles.

### Edit the script
Open `work/<film>-<id>-<lang>/script.json` (or use the GUI's **Edit script** tab):
```json
{ "id": 42, "speaker": "SPEAKER_01", "emotion": "angry",
  "text": "Get out of my house!",
  "translation": "Raus aus meinem Haus!",
  "translation_candidates": ["Verschwinde aus meinem Haus!", "Raus aus meinem Haus!", "Raus hier!"],
  "keep_original": false, "fit_notes": "compress x1.08" }
```
Change `translation` and run the same command again. Hand-edited lines are detected and locked, and only they are re-voiced.

### GUI
```bat
python main.py gui
```
This opens http://127.0.0.1:7860 (local only). It has tabs for batch dubbing, the script editor, live mode and system info.

### While watching: live audio overlay (works with Netflix)
1. Install [VB-Audio Virtual Cable](https://vb-audio.com/Cable/) (free) and reboot.
2. Windows Settings → System → Sound → **Volume mixer** → set your browser's or Netflix app's **Output device** to **CABLE Input**.
3. Start DubForge:
   ```bat
   python main.py live-audio --to en --output-device "Headphones"
   ```
   It listens on "CABLE Output" by default. `python main.py devices` lists device names.
4. Press play.

How the original sound is handled (`--background`):
- **`duck`** (default): lowered while the dub speaks.
- **`center_cancel`**: removes centre-panned dialogue in real time and keeps stereo music and bass.
- **`mute`**: you only hear the dub.
- **`passthrough`**: the original plays unchanged.

Tips:
- Use headphones.
- Pausing the show also pauses the dub (no new speech means no new lines).
- For language learning, enable subtitles in the player.

### While watching: delayed, in-sync video
```bat
python main.py live-video --to de --delay 12 --region 0,0,1920,1080
python main.py live-video --to de --output virtualcam       :: OBS Virtual Camera
python main.py live-video --to de --lipsync                 :: experimental live Wav2Lip
```
Route the audio through VB-Cable as above. Press **F** for fullscreen and **Q** to quit. This mode works for anything you can screen-capture; DRM-protected players capture as black.

---

## 4. GPU presets

| Preset | VRAM | What changes |
|---|---|---|
| `gpu_8gb` | 8 GB | int8 Whisper, smaller batches, 2 takes/line |
| `gpu_12gb` | 12–16 GB | defaults |
| `gpu_24gb` | 24 GB+ | NLLB 3.3B, Demucs shifts=2, 4 takes, bigger lip-sync batches |
| `hollywood` | any (stack it) | RoFormer separation, local LLM script, 5 takes + Whisper verification, MuseTalk, less DSP squeezing |
| `cpu` | – | works, but very slow |
| `mock` | – | no models; plumbing tests |

Batch stages run **one model at a time** and unload in between, so peak VRAM is roughly the biggest single model: Whisper ~3–4.5 GB, NLLB-1.3B ~2.6 GB, XTTS ~2–3 GB, MuseTalk ~4–6 GB. Live mode keeps Whisper-turbo, NLLB and XTTS (and Demucs) loaded together, ~6–8 GB.

The durations below are **rough guesses, not measurements**. Run the 30-second test on your card to get real numbers.

| Film length | Card | Without lip sync | Lip sync |
|---|---|---|---|
| 2 hours | 8–12 GB card | 1.5–3 h | adds hours (Wav2Lip is faster than MuseTalk) |
| 2 hours | 4090-class card | under an hour | also adds hours |

---

## 5. Getting Hollywood-level results

1. **Clean separation is everything.** Try `separation.backend: audio_separator` (BS-RoFormer) or `separation.shifts: 2`.
2. **Use the local LLM translator.** Context and syllable budgets beat sentence-by-sentence MT by a mile.
3. **Review `script.json`** after `--to-stage translate`. Fix names with `translation.glossary` / `post_replace`, and set `asr.initial_prompt: "Names: ..."`.
4. **Check speakers.** If two characters got merged, set `asr.min_speakers` / `max_speakers`, provide a HF token for pyannote, or fix `speaker` in the script.
5. **Style vs stability.** `tts.style_mix` (0 = neutral character voice, 1 = mimic each line's delivery). 0.6–0.75 is the sweet spot. Use `prosody_reference: emotion_matched` if lines sound too "copied".
6. **More takes.** `tts.max_takes: 5` + `tts.verify_asr_model: small` rejects garbled takes automatically.
7. **Less DSP.** Lower `timing.max_stretch` (e.g. 1.1). DubForge will prefer re-phrasing and model-side speed-up instead.
8. **Lip sync.** MuseTalk for close-ups, Wav2Lip if speed matters. Only dubbed frames are touched.

---

## 6. Swap in your own models

Every stage is resolved through `dubforge/registry.py`. To add, e.g., a new TTS:

```python
# my_plugins.py (anywhere on PYTHONPATH)
import numpy as np
from dubforge.registry import register
from dubforge.tts.base import TTSBackend

class MyTTS(TTSBackend):
    name = "my_tts"
    sample_rate = 24000
    supports_speed = True
    languages = {"en", "de"}
    def set_voice(self, speaker, refs, ref_lang): ...        # refs: list[RefClip] (path, text, emotion...)
    def synthesize(self, text, lang, speaker, *, style=None, speed=1.0, temperature=None, seed=None) -> np.ndarray: ...

register("tts", "my_tts", MyTTS)
```
```yaml
general: {plugins: [my_plugins]}
tts: {backend: my_tts}
```
The same works for `separator`, `asr`, `translator`, `emotion` and `lipsync`. Good candidates to add later are F5-TTS, CosyVoice 2, IndexTTS2 (explicit duration control), emotion2vec, LatentSync and TalkNet active-speaker detection.

---

## 7. Code tour

```
dubforge/
├── main.py                        CLI entry (python main.py --help)
├── configs/default.yaml           documented defaults
├── configs/presets/*.yaml         gpu_8gb / gpu_12gb / gpu_24gb / hollywood / cpu / mock
├── scripts/test_30s_clip.py       30-second end-to-end test + report (+ --mock, --ab)
├── scripts/download_models.py     one-time model fetch
├── requirements*.txt, environment.yml, pyproject.toml
├── tests/                         pytest suite (runs without GPU/models via mock backends)
└── dubforge/
    ├── config.py                  typed config tree, presets, --set overrides, offline switches
    ├── types.py                   Segment / Word / Transcript (the editable script format)
    ├── registry.py                backend registry + plugin loading
    ├── cli.py, doctor.py, models.py
    ├── media/ffmpeg.py            probe, extract, frame pipes (frame-exact), mux with tracks/subs
    ├── media/audio.py             numpy DSP: resample, trim, loudness, envelopes, limiter
    ├── separation/                Demucs, audio-separator (RoFormer), chunked long-file processing
    ├── asr/                       WhisperX, faster-whisper, segmentation rules, ECAPA speakers
    ├── translation/               NLLB, SeamlessM4T, local LLM, language table + speaking-rate model
    ├── emotion/                   SpeechBrain classifier, prosody + whisper detection
    ├── tts/                       XTTS-v2 (timbre/style split), GPT-SoVITS API, voice bank
    ├── timing/                    fitting windows, isochrony logic, pitch-preserving stretch (+WSOLA)
    ├── mixing/mixer.py            block-wise final mix
    ├── lipsync/                   job planning, frame-exact splicing, Wav2Lip runner, MuseTalk driver
    ├── pipeline/batch.py          10-stage resumable orchestrator
    ├── pipeline/tts_stage.py      takes, candidates, speed/stretch/loudness per line
    ├── live/                      VB-Cable overlay, delayed video buffer, VAD, rings, live engine
    └── gui/app.py                 Gradio UI (127.0.0.1 only)
```

Run the tests with:
```bat
pip install -r requirements-dev.txt
python -m pytest -q
```

---

## 8. Troubleshooting

| Problem | Fix |
|---|---|
| `torch.cuda.is_available()` is False | You installed the CPU wheel. Reinstall with the `--index-url .../cu128` command from step 3 |
| `cudnn_ops64_9.dll` / cuDNN errors in faster-whisper | Use torch 2.8 (ships cuDNN 9) and don't mix in a separate old CUDA toolkit on PATH |
| CUDA out of memory | Use `--preset gpu_8gb`, lower `asr.batch_size`, `lipsync.wav2lip_batch_size` / `musetalk_batch_size` |
| A character got someone else's voice | Fix `speaker` in `script.json`, or set `asr.max_speakers` / use a HF token for pyannote |
| XTTS babbles at the end of short lines | Raise `tts.max_takes`, enable `tts.verify_asr_model: base` |
| Dub sounds rushed | Lower `timing.max_tts_speed` / `max_stretch`, use `translation.backend: local_llm` |
| Live: "No input device matching 'CABLE Output'" | Install VB-Cable, reboot, then `python main.py devices` |
| Live: echo / you hear the original twice | The player must output to *CABLE Input*, not to your speakers |
| MuseTalk produced nothing | Check its env runs standalone first; no spaces in its path |
| `librosa.filters.mel() takes 0 positional arguments` (Wav2Lip) | Already patched by DubForge's runner. Update DubForge |

---

## 9. Privacy

- No network calls at runtime once `offline: true` is set. Analytics are disabled for Hugging Face and Gradio.
- The GUI binds to 127.0.0.1 only. The local LLM and GPT-SoVITS URLs must be localhost (enforced).
- Your HF token is never saved into `work/*/config.used.yaml`.
