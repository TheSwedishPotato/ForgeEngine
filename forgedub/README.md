# ForgeDub — AI Video Dubbing (English → Swedish)

ForgeDub is a self-hosted desktop app that dubs your videos from **English into
Swedish** with your **own AI engine** — no third-party paid APIs. Drop in a video
file (or paste a web link), and ForgeDub:

1. **Extracts** the audio
2. **Transcribes** the English speech (with timing)
3. **Translates** it to Swedish
4. **Regenerates** the speech in Swedish — **cloning the original speaker's voice**
5. **Stitches** the new audio back onto the video, keeping the original timing

You can review and edit every translated line, then re-render — just like the
big commercial dubbing tools, but it's yours.

> ℹ️ ForgeDub is a standalone app and is independent from the Forge Engine game
> in the rest of this repository.

---

## Two modes

ForgeDub detects what's installed and picks a mode automatically:

| Mode | What you get | Needs |
| --- | --- | --- |
| **Demo** | The whole app + a canned demo dub so you can click through everything | Only the light base requirements |
| **Real** | Genuine Swedish dubs of *your* audio with voice cloning | The AI model pack + ffmpeg (a capable machine, ideally an NVIDIA GPU) |

The badge in the top-right of the app tells you which mode you're in.

---

## Quick start (Demo mode)

```bash
cd forgedub
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
python app.py                    # opens the desktop window
```

No desktop window (e.g. on a headless server)? Run it in the browser:

```bash
python app.py --no-window        # then open the printed http://127.0.0.1:8765
```

---

## Turning on the Real engine

Real dubbing needs **ffmpeg** plus the AI model pack.

**1. Install ffmpeg**

```bash
# Linux
sudo apt install ffmpeg
# macOS
brew install ffmpeg
# Windows
winget install Gyan.FFmpeg
```

**2. Install the model pack** (large download; a GPU is strongly recommended)

```bash
pip install -r requirements-ml.txt
python -m forge_dub.tools.install_argos      # English → Swedish translation pack
```

The first real dub also downloads the XTTS-v2 voice model automatically.

**3. Run it**

```bash
python app.py
```

The badge should now read **REAL engine**. That's it — your uploads are dubbed
for real.

> **Voice model licensing:** the default voice engine is Coqui **XTTS-v2**, which
> is released under the Coqui Public Model License (non-commercial). For
> commercial use, swap in a different TTS (e.g. set `FORGEDUB_TTS=piper` with a
> Swedish Piper voice) — the pipeline is engine-agnostic.

---

## Using ForgeDub

1. **Upload file** — drag a video in, or click to browse. **From link** — paste a
   YouTube/web URL (the "search the web / paste a link" import; needs yt-dlp).
2. Choose options: **Clone original voice**, **Keep background music**.
3. Press **Start dubbing** and watch the live progress.
4. When it's done, **play** the result, **edit** any Swedish line in the
   transcript table, and hit **Apply edits & re-render**.
5. **Download** the finished file.

---

## How it works

```
intake ──> extract ──> (separate) ──> transcribe ──> translate
       └─> synthesize (voice clone) ──> align (keep timing) ──> mux ──> output
```

Each stage lives in `forge_dub/pipeline/` and has a real implementation and a
mock one, so the app always runs end-to-end.

| Stage | Real engine | 
| --- | --- |
| Transcribe | [faster-whisper](https://github.com/SYSTRAN/faster-whisper) |
| Translate | [Argos Translate](https://github.com/argosopentech/argos-translate) (offline) |
| Voice / cloning | [Coqui XTTS-v2](https://github.com/coqui-ai/TTS) (or Piper) |
| Audio / video | ffmpeg |
| URL import | [yt-dlp](https://github.com/yt-dlp/yt-dlp) |

---

## Configuration

All optional, via environment variables:

| Variable | Default | Meaning |
| --- | --- | --- |
| `FORGEDUB_ENGINE` | `auto` | `auto` / `real` / `mock` |
| `FORGEDUB_DEVICE` | `auto` | `auto` / `cpu` / `cuda` |
| `FORGEDUB_WHISPER_MODEL` | `base` | `tiny` … `large-v3` |
| `FORGEDUB_TTS` | `auto` | `auto` / `xtts` / `piper` / `mock` |
| `FORGEDUB_TGT` | `sv` | target language code |
| `FORGEDUB_PIPER_MODEL` | – | path to a Piper voice (if using Piper) |
| `FORGEDUB_PORT` | `8765` | server port |
| `FORGEDUB_DATA_DIR` | `forgedub/data` | where uploads & outputs live |

---

## Development

```bash
pip install -r requirements.txt pytest httpx
pytest                # runs the full pipeline + API tests in mock mode
```

Project layout:

```
forgedub/
  app.py                 desktop launcher (server + native window)
  forge_dub/
    server.py            FastAPI routes
    jobs.py              background job manager + progress
    config.py            settings
    capabilities.py      detects installed engines (real vs demo)
    pipeline/            intake, extract, asr, translate, tts, align, mux
    tools/install_argos  one-shot translation-pack installer
  web/                   the desktop UI (HTML/CSS/JS)
  tests/                 mock-mode tests (no models needed)
```
