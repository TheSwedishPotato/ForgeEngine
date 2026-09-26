#!/usr/bin/env python
"""Download every model DubForge needs, once. Same as `python main.py download-models`.

    python scripts/download_models.py                       # core models (+ asks about the XTTS license)
    python scripts/download_models.py --languages en,de,fr  # word-alignment models for these languages
    python scripts/download_models.py --hf-token hf_xxx     # + pyannote diarization (accept its terms on HF first)
    python scripts/download_models.py --lipsync             # + Wav2Lip repo and face detector
    python scripts/download_models.py --seamless            # + SeamlessM4T v2 (~10 GB)
    python scripts/download_models.py --preset gpu_24gb     # the bigger models that preset uses
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dubforge.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main(["download-models", *sys.argv[1:]]))
