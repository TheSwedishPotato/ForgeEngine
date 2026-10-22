# DubForge — local AI dubbing (prototype)

Dub a movie or episode into another language **on your own GPU, offline**: the original actors' voices are
cloned, emotion and loudness follow the original performance, music/effects are kept, and (optionally) the
mouths are re-rendered to match the new language.

```
video ─► extract ─► separate voices from music/FX (Demucs)
                 ─► transcribe (faster-whisper large-v3, word timings)
                 ─► sentences ─► who speaks (ECAPA clustering) ─► emotion (wav2vec2)
                 ─► translate (NLLB-200, or a local LLM via Ollama)   ◄── you can review/edit here
                 ─► voice each line in the actor's own voice (Chatterbox / XTTS, zero-shot)
                 ─► fit to the actor's timing, match loudness ─► mix over the original music/FX
                 ─► lip-sync (Wav2Lip / MuseTalk, optional) ─► dubbed .mp4 (+ original as 2nd audio track)
```

> **Private use.** Process only footage you have the right to process, and only voices you have the right to clone.
> For selling anything, read [`docs/BUSINESS_AND_LICENSING.md`](docs/BUSINESS_AND_LICENSING.md) first — several default
> models are **non-commercial**.

## What is verified and what is not

I built and tested this in a sandbox **without a GPU** (4 CPU cores), so here is exactly what that does and doesn't prove.

**Automated tests** (`pytest`, 40+ tests on Python 3.11 with the pinned real stack): orchestration, checkpoint/resume,
timing fit, mixing, muxing, review → re-voice changed lines only, lip-sync frame pass, live-mode scheduling (simulated),
voice-identity logic, rotated/variable-frame-rate phone video, CLI and GUI construction.

**Real models on CPU, real footage** (Tears of Steel, CC-BY, 75 s clip with several speakers; a 37 s phone screen recording;
LibriSpeech speech; a real portrait photo):

| Check | Result |
|---|---|
| Full pipeline, all real models, English → Swedish | Works end to end; dubbed + original audio tracks, `.srt`, QA report |
| Music/FX preserved | Final mix between lines is identical to the Demucs accompaniment stem |
| Chatterbox cross-lingual clone (English reference → Swedish) | Whisper re-transcription 1 wrong word in 11; speaker similarity to reference **0.62** vs **0.015** for other speakers |
| Wav2Lip on real film faces (CPU) | Works: ~10 s per 4 s of 720p video. Mouth is soft (96 px model), chin area slightly lighter |
| Speaker clustering | LibriSpeech, 12 speakers: ARI 0.90–0.96. **Film dialogue is harder** (see limitations); set `diarize.num_speakers` |
| Whisper on quiet, mumbled film dialogue | `small` misses/garbles lines; `large-v3-turbo` (CPU default) recovers noticeably more; still imperfect |

**Bugs that real footage found (and are fixed):** phone recordings carry a *rotation flag* and *variable frame rate* — the first
version read frames at the wrong size and produced a scrambled picture (regression test added); a lip-sync pass re-encoded the
whole video even when nothing changed; Whisper returns an exchange of two people as one segment, which was voiced as one person
(now split per sentence before speaker detection); lip-sync trusted a confident face detector that was wrong (a man's face half-hidden
behind a brain in a jar) — now an independent second detector must agree; plus SpeechBrain/`huggingface_hub`/transformers 5
clashes, Chatterbox needing `setuptools<81`, lines too short to clone being muted.

**NOT verified — expect to tune:** anything on an NVIDIA GPU (CUDA, speed, VRAM), MuseTalk, Windows specifics (the `.bat` files were
never run on Windows), live mode with real audio devices / VB-CABLE / virtual camera, `h264_nvenc`, and the **perceived quality** of a
full film. Speaker detection and lip-sync in particular need a human to check the first results.

## No NVIDIA GPU (e.g. AMD Ryzen with Radeon graphics)

Everything runs on the CPU. The setup script detects this and installs the CPU build of PyTorch (AMD integrated graphics are not
supported by PyTorch on Windows). Speed is the cost: measured on a 4-core CPU, **12–35 minutes of waiting per minute of
dialogue-heavy video** (voice synthesis dominates; a CPU with more cores is faster). That is fine for clips and short scenes and
**not realistic for a full-length film** — for that you want an NVIDIA GPU. Use `--review` and short test cuts first.

## Quick start (Windows, two commands)

Install Git and [Miniconda](https://docs.conda.io/en/latest/miniconda.html), open **Anaconda Prompt**, then:

```
git clone -b claude/dubforge-prototype https://github.com/TheSwedishPotato/ForgeEngine
cd ForgeEngine\dubforge
setup_windows.bat                                   :: env + PyTorch + libraries + model download (untested on Windows)
dubforge.bat test "C:\Videos\movie.mkv"            :: 30-second Swedish test
dubforge.bat gui                                    :: web interface
```

The manual steps below do the same thing, one at a time.

## Quick start (manual)

```bash
# 1. environment (Windows: Anaconda Prompt; FFmpeg comes from conda-forge)
conda env create -f environment.yml && conda activate dubforge

# 2. PyTorch with CUDA FIRST, then everything else   (cu124 works for most NVIDIA cards; see "GPU notes")
pip install torch==2.6.0 torchaudio==2.6.0 --index-url https://download.pytorch.org/whl/cu124
pip install -r requirements-models.txt
pip install --no-deps demucs==4.0.1          # its metadata wrongly caps torchaudio; its real deps are in the file above
# (already verified: this exact sequence installs and imports on Python 3.11)

# 3. check, then download models ONCE (the only step that needs internet; ~12 GB)
python main.py doctor
python main.py models download

# 4. prove it works on 30 seconds before committing to a whole film
python scripts/test_clip.py "C:\Videos\movie.mkv" --start 00:10:00 --to sv

# 5. the real thing
python main.py dub "C:\Videos\movie.mkv" --to sv --review     # stops after translation so you can edit
python main.py dub "C:\Videos\movie.mkv" --to sv              # voices + renders (reuses all earlier work)
python main.py gui                                            # or do all of it in the browser UI
```

No GPU handy? `python scripts/test_clip.py --mock` runs the whole pipeline with fake models (checks FFmpeg + wiring only).

### GPU notes

* Needs NVIDIA + a recent driver. Models run one at a time and are unloaded between stages, so **8 GB VRAM should fit**
  (not measured — tell me if it doesn't); `main.py` auto-picks Whisper/NLLB sizes from your VRAM (`python main.py doctor` shows what it chose).
* **RTX 50-series (Blackwell):** `chatterbox-tts` pins torch 2.6 which has no kernels for those cards. You'll need a newer
  torch (cu128) and to relax that pin — tell me your exact GPU and I'll adjust the requirements.
* `ctranslate2`/faster-whisper need cuDNN 9; the pip CUDA wheels of torch bring it. On Windows `import torch` must happen first
  (DubForge does this for you).
* Faster video encode: `--set video.encoder=h264_nvenc`.
* Everything offline after step 3: `offline: true` (default) blocks all model-hub traffic.

## Using it

**Batch (best quality).** Works on any video file you have. Netflix's in-app downloads are encrypted and not readable by
other programs, and DubForge does not try to defeat DRM; use files you are entitled to process.

```
python main.py dub movie.mkv --to sv                       # source language auto-detected
python main.py dub movie.mkv --from en --to de --lipsync wav2lip
python main.py dub movie.mkv --to sv --translator ollama   # local-LLM dialogue adaptation (needs `ollama serve`)
python main.py dub movie.mkv --to sv --redo tts            # re-run from a stage on (extract separate asr diarize emotion translate tts mix lipsync mux)
python main.py dub movie.mkv --to sv --set diarize.num_speakers=3 --set fit.max_speedup=1.15
```

Outputs go to `output/`: `movie.sv.mp4` (dub as default track, **original audio as 2nd track** you can switch to),
`movie.sv.srt`. Everything intermediate is in `work/<film>_<hash>/` (stems, per-line wavs, `report.json`) — a crash or
Ctrl-C resumes where it stopped, and editing one translation re-voices only that line.

**Review workflow (recommended).** Machine translation is the weakest link. `--review` stops after translation; edit
`work/<film>/<lang>/segments.json` (`translation`; `"skip": true` leaves the original audio, e.g. for songs) or use the
GUI table, then run again.

**`report.json`** lists lines that had to be sped up a lot (`compressed`), ran past the actor's mouth (`overrun`), or
couldn't be cloned. Fix those by shortening the translation.

## Live mode (audio overlay)

```
python main.py live --list-devices
python main.py live --from en --to sv --in "CABLE Output" --out "Headphones" --delay 12
```

1. Install the free **VB-CABLE** driver. 2. Windows → Sound → Volume mixer: set Netflix/your browser's output to
**CABLE Input** (silent in your speakers). 3. Run the command. 4. Set the cable and your headphones to the same sample
rate (48 000 Hz) if the stream fails to open.

How it behaves — read this, it is physics, not a bug:

* A sentence can only be dubbed **after it has been spoken**, then it needs ASR + translation + TTS time. So everything
  runs `--delay` seconds late (default 12 s). Lines that miss their deadline play late and are flagged `[LATE - raise --delay]`.
* **Picture and dub only line up if the picture is delayed by the same amount.** `--video window|virtualcam` shows a delayed
  screen capture (`mss`) in a window or an OBS-compatible virtual camera. **Streaming services mark their video as
  protected and screen capture of it is blank; DubForge does not try to get around that.** Delayed video works for sources
  you can legally capture (local files in a player, non-protected video, an OBS scene). For Netflix itself you get the audio
  overlay only, trailing the picture by the delay.
* Live keeps ASR + translation + TTS loaded together, so it shrinks Whisper/NLLB on cards under 12 GB, and quality is
  below batch (no source separation, no review, speaker identity guessed from the previous line).
* `--mock --in clip.wav` simulates the whole thing offline and writes `output/live_simulation.wav`.

## Swapping models

Every model sits behind a small interface in `dubforge/base.py`. Add one by subclassing and registering a string:

```python
# my_tts.py
from dubforge.base import TTS, Style
class MyTTS(TTS):
    name = "my_tts"; sample_rate = 24000
    def __init__(self, cfg): self.cfg = cfg
    def load(self): ...                                   # load weights
    def supports(self, lang): return lang in {"sv", "en"}
    def synthesize(self, text, lang, reference_wav, style: Style): ...   # -> float32 mono numpy

# anywhere before running:
from dubforge import registry; registry.register("tts", "my_tts", "my_tts:MyTTS")
# then:  --tts my_tts    (or tts.backend: my_tts in YAML)
```

Interfaces: `Separator`, `ASR`, `Diarizer`, `EmotionClassifier`, `Translator`, `TTS`, `LipSync`. Built in:

| Stage | Options |
|---|---|
| separate | `demucs`, `none` |
| asr | `faster_whisper` |
| diarize | `ecapa`, `single` |
| emotion | `wav2vec2` (SUPERB IEMOCAP, Apache-2.0), `none` |
| translate | `nllb`, `ollama`, `passthrough` |
| tts | `chatterbox` (23 languages **incl. Swedish**), `xtts` (17 languages, **no Swedish**), `mock` |
| lipsync | `none`, `wav2lip` (in-process, fast), `musetalk` (subprocess, own env, experimental) |

Language/engine compatibility is checked up front: asking XTTS for Swedish fails immediately with the list of engines that can.

## How quality is protected

* **Sentence-level translation** – Whisper's fragments are merged into sentences before translating (pronouns and grammar survive).
* **Reference choice** – each line is voiced from *its own original audio* (≥3 s) so delivery transfers; short interjections
  fall back to that speaker's cleanest emotion-matched clips, then their longest line.
* **Emotion** – wav2vec2 label + how loud the line was vs. that speaker's norm set Chatterbox's expressiveness; the dub is
  then loudness-matched to the original line so whispers stay whispers.
* **Timing** – speech is only ever sped up (≤1.2× preferred, 1.4× hard limit), borrowing the silence after a line first;
  anything worse is flagged, never silently truncated.
* **Nothing is muted by accident** – grunts, screams, laughs (no transcript) and any line that could not be voiced keep the
  original audio; sung lines can be left original with `skip`.
* **Lip-sync windows** cover the original *and* the dubbed span, so a shorter dub shows a closed mouth, not the old words.
* **TTS sanity checks** – babbling, loops or silence are detected and regenerated.

## Known limitations (be realistic)

* **Speaker detection in film audio is imperfect.** It may split one person into two voices or merge two similar ones. Safeguards:
  per-sentence units, a continuity prior, short lines take their reference from the acoustically closest clips (not just the label),
  and after voicing every line is compared with every speaker's real voice (`voice_qa.json`, flagged in `report.json`).
  Still: read `work/<film>/common/speakers.txt`, and set `diarize.num_speakers` or fix the `speaker` field before voicing.
* **Quiet or mumbled dialogue** is mis-heard by any Whisper model; mistranslation follows. Always use `--review` on anything you care about.

* Lip-sync re-renders the **largest face**, not necessarily the speaker (see roadmap: active-speaker detection). Wav2Lip's
  mouth is 96 px (soft on 1080p); MuseTalk is sharper but heavier.
* Cloning across languages keeps some accent of the original speaker.
* Output audio is stereo (5.1 sources are down-mixed).
* NLLB translation is good, not literary (the 600M model turned "Middle Classes" into "mid-sized classes" in my test); use
  the 1.3B/3.3B model, `--review`, or the Ollama adapter for anything that matters.
* Emotion classifiers are noisy (a calm audiobook reading was labelled "happy"), so the label only nudges expressiveness (±0.2).
* Proper nouns and rare names are the most common TTS mispronunciations.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `cudnn_ops64_9.dll not found` | make sure torch is installed from the CUDA index before `faster-whisper`; reinstall torch cu124 |
| `CUDA out of memory` | `--set asr.compute_type=int8_float16`, `--set translate.model=facebook/nllb-200-distilled-600M`, close games/browsers |
| Wrong number of speakers | `--set diarize.num_speakers=N` (most reliable); or tune `diarize.threshold` (lower = more speakers) |
| `'NoneType' object is not callable` loading Chatterbox | `pip install "setuptools<81"` (its watermarker needs `pkg_resources`) |
| Dub sounds rushed | shorten translations in the review step; check `report.json` `compressed` lines |
| `LocalEntryNotFoundError` | a model isn't downloaded: `python main.py models download` (or `--set offline=false` once) |
| Wav2Lip errors | `python main.py doctor` shows which of repo / checkpoint / face model is missing |

## Lip-sync setup (optional)

`python main.py models download` already fetches Wav2Lip's network code and GAN checkpoint (from a Hugging Face copy of the
official repo; non-commercial licence) and the face detector. Then add `--lipsync wav2lip`:

```
python main.py dub clip.mp4 --to sv --lipsync wav2lip --review
```
It only re-renders a mouth when a face is large enough (`lipsync.min_face_px`) **and a second detector agrees it is a face**
(`lipsync.confirm_frac`); everything else keeps the original picture, which is the safe failure. To veto a shot yourself set
`"lipsync": false` on that line in `segments.json` (or untick it in the GUI table).
MuseTalk pins old torch/mmcv, so it needs its **own** conda env: clone it to `third_party/MuseTalk`, download its weights per its
README, set `lipsync.musetalk_python` to that env's python. It is untested.

## Layout

```
main.py                CLI: dub | gui | live | doctor | models
dubforge/pipeline.py   stage orchestration + checkpoints        dubforge/mix.py       fit + dub track + final mix
dubforge/refs.py       voice-reference selection                dubforge/segmentation.py  sentences
dubforge/{asr,diarize,emotion,translate,tts,lipsync}/   swappable backends
dubforge/live/         rolling-buffer engine, audio devices, delayed video
dubforge/gui.py        Gradio UI          configs/   YAML       scripts/test_clip.py   30-second test
tests/                 pytest (fake models)                      docs/                  licensing/business, roadmap
```
