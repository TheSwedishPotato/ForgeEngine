"""One-time model downloads (the ONLY step that needs internet). Everything lands in ./models."""
from __future__ import annotations

import urllib.request
from pathlib import Path
from typing import Callable

from .config import Config
from .env import setup_env

YUNET_URL = ("https://raw.githubusercontent.com/opencv/opencv_zoo/main/models/face_detection_yunet/"
             "face_detection_yunet_2023mar.onnx")

WAV2LIP_HELP = """Wav2Lip (lip-sync) is downloaded too: personal/research/non-commercial use only. Skip it with
  python main.py models download --only whisper nllb chatterbox demucs speechbrain yunet"""


def _whisper(cfg: Config) -> None:
    from faster_whisper.utils import download_model
    download_model(cfg.asr.model, cache_dir=str(Path(cfg.models_dir) / "whisper"))


def _nllb(cfg: Config) -> None:
    from huggingface_hub import snapshot_download
    snapshot_download(cfg.translate.model)


def _chatterbox(cfg: Config) -> None:
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS
    try:
        ChatterboxMultilingualTTS.from_pretrained(device="cpu", t3_model=cfg.tts.chatterbox_t3)
    except TypeError:
        ChatterboxMultilingualTTS.from_pretrained(device="cpu")


def _demucs(cfg: Config) -> None:
    from demucs.pretrained import get_model
    get_model(cfg.separate.model)


def _speechbrain(cfg: Config) -> None:
    """Speaker-embedding model (diarization) + the emotion classifier."""
    from .compat import patch_speechbrain_hub
    patch_speechbrain_hub()
    from speechbrain.inference.speaker import EncoderClassifier
    from transformers import AutoFeatureExtractor, AutoModelForAudioClassification
    EncoderClassifier.from_hparams(source="speechbrain/spkrec-ecapa-voxceleb",
                                   savedir=str(Path(cfg.models_dir) / "speechbrain" / "spkrec-ecapa-voxceleb"),
                                   run_opts={"device": "cpu"})
    AutoFeatureExtractor.from_pretrained(cfg.emotion.model)
    AutoModelForAudioClassification.from_pretrained(cfg.emotion.model)


def _yunet(cfg: Config) -> None:
    import shutil
    dst = Path(cfg.lipsync.face_model)
    dst.parent.mkdir(parents=True, exist_ok=True)
    if dst.exists():
        return
    try:                                            # Hugging Face first (GitHub raw is blocked on some networks)
        from huggingface_hub import hf_hub_download
        shutil.copy(hf_hub_download("opencv/face_detection_yunet", "face_detection_yunet_2023mar.onnx"), dst)
    except Exception:
        urllib.request.urlretrieve(YUNET_URL, dst)


def _wav2lip(cfg: Config) -> None:
    """Wav2Lip network definition + GAN checkpoint from a Hugging Face copy of the official repo.
    Non-commercial licence (see docs/BUSINESS_AND_LICENSING.md). The checkpoint is only ever loaded with
    torch's weights-only unpickler."""
    import shutil
    from huggingface_hub import hf_hub_download, snapshot_download
    repo, ckpt = Path(cfg.lipsync.wav2lip_repo), Path(cfg.lipsync.wav2lip_checkpoint)
    snapshot_download("camenduru/Wav2Lip", local_dir=str(repo), allow_patterns=["models/*.py"])
    if not ckpt.exists():
        ckpt.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy(hf_hub_download("camenduru/Wav2Lip", "checkpoints/wav2lip_gan.pth"), ckpt)


def _xtts(cfg: Config) -> None:
    from TTS.api import TTS
    TTS(cfg.tts.xtts_model)


JOBS: dict[str, Callable[[Config], None]] = {
    "whisper": _whisper, "nllb": _nllb, "chatterbox": _chatterbox, "demucs": _demucs,
    "speechbrain": _speechbrain, "yunet": _yunet, "wav2lip": _wav2lip, "xtts": _xtts,
}
DEFAULT = ["whisper", "nllb", "chatterbox", "demucs", "speechbrain", "yunet", "wav2lip"]


def download(cfg: Config, which: list[str] | None = None) -> dict[str, str]:
    setup_env(cfg, online=True)
    results = {}
    for name in which or DEFAULT:
        print(f"-> {name} ...", flush=True)
        try:
            JOBS[name](cfg)
            results[name] = "ok"
        except Exception as e:                      # keep going; report at the end
            results[name] = f"FAILED: {type(e).__name__}: {e}"
    print("\n" + WAV2LIP_HELP)
    return results
