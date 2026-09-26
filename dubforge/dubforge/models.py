"""One-time model downloads. After this, set `general.offline: true` and nothing
is ever fetched again. Everything lands in ./models (HF_HOME / TORCH_HOME point there)."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from .config import DubConfig, apply_runtime_env, resolve_path
from .utils.log import get_logger

log = get_logger("models")

COQUI_NOTICE = """XTTS-v2 is released under the Coqui Public Model License (CPML):
non-commercial use only. See https://coqui.ai/cpml. DubForge is for private use, which fits."""

S3FD_URL = "https://www.adrianbulat.com/downloads/python-fan/s3fd-619a316812.pth"


def _step(name: str, fn) -> bool:
    log.info("── %s", name)
    try:
        fn()
        log.info("   ok")
        return True
    except Exception as e:
        log.error("   FAILED: %s", e)
        return False


def download_all(cfg: DubConfig, only: list[str] | None = None, languages: list[str] | None = None,
                 accept_coqui_license: bool = False, lipsync: bool = False, seamless: bool = False,
                 live: bool = True) -> dict[str, bool]:
    cfg.general.offline = False
    apply_runtime_env(cfg)
    models = resolve_path(cfg.general.models_dir)
    assert models is not None
    want = set(only or ["whisper", "align", "diarization", "nllb", "xtts", "speechbrain", "demucs"])
    if seamless:
        want.add("seamless")
    if lipsync:
        want.add("lipsync")
    results: dict[str, bool] = {}

    if "whisper" in want:
        def whisper():
            from faster_whisper import download_model

            for name in {cfg.asr.model, cfg.live.asr_model} if live else {cfg.asr.model}:
                download_model(name, cache_dir=str(models / "faster-whisper"))
        results["whisper"] = _step(f"Whisper ({cfg.asr.model}, live: {cfg.live.asr_model})", whisper)

    if "align" in want:
        def align():
            import whisperx

            for lang in languages or ["en", "de"]:
                try:
                    whisperx.load_align_model(language_code=lang, device="cpu")
                except ValueError as e:
                    log.warning("   no alignment model for %s (%s)", lang, e)
        results["align"] = _step("WhisperX word-alignment models", align)

    if "diarization" in want:
        def diar():
            if not cfg.general.hf_token:
                raise RuntimeError("no HF token: skipping pyannote (ECAPA clustering will be used instead). "
                                   "Accept the model terms on huggingface.co and pass --hf-token to enable it.")
            import inspect

            from whisperx.diarize import DiarizationPipeline

            params = inspect.signature(DiarizationPipeline.__init__).parameters
            key = "token" if "token" in params else "use_auth_token"
            DiarizationPipeline(**{key: cfg.general.hf_token, "device": "cpu"})
        results["diarization"] = _step("pyannote speaker diarization (optional)", diar)

    if "nllb" in want:
        def nllb():
            from huggingface_hub import snapshot_download

            snapshot_download(cfg.translation.nllb_model, allow_patterns=["*.json", "*.model", "*.safetensors", "*.txt"])
        results["nllb"] = _step(f"NLLB ({cfg.translation.nllb_model})", nllb)

    if "seamless" in want:
        def seam():
            from huggingface_hub import snapshot_download

            snapshot_download(cfg.translation.seamless_model)
        results["seamless"] = _step(f"SeamlessM4T ({cfg.translation.seamless_model}, ~10 GB)", seam)

    if "xtts" in want:
        def xtts():
            print(COQUI_NOTICE)
            if not accept_coqui_license:
                ans = input("Do you accept the CPML for private, non-commercial use? [y/N] ").strip().lower()
                if ans not in ("y", "yes"):
                    raise RuntimeError("license not accepted")
            from huggingface_hub import snapshot_download

            dst = resolve_path(cfg.tts.xtts_model_dir)
            snapshot_download("coqui/XTTS-v2", local_dir=str(dst),
                              allow_patterns=["config.json", "model.pth", "vocab.json", "speakers_xtts.pth",
                                              "dvae.pth", "mel_stats.pth", "LICENSE.txt"])
        results["xtts"] = _step("Coqui XTTS-v2", xtts)

    if "speechbrain" in want:
        def sb():
            from .asr.speakers import SpeakerEmbedder
            from .emotion.speechbrain_backend import SpeechBrainEmotion

            SpeakerEmbedder("cpu", models).load()
            SpeechBrainEmotion(cfg.emotion, "cpu", models).load()
        results["speechbrain"] = _step("SpeechBrain emotion + ECAPA speaker models", sb)

    if "demucs" in want:
        def dm():
            from demucs.pretrained import get_model

            get_model(cfg.separation.demucs_model)
            get_model("htdemucs")  # lighter model used by live mode
        results["demucs"] = _step("Demucs separation models", dm)

    if "audio_separator" in want or cfg.separation.backend == "audio_separator":
        def asep():
            from audio_separator.separator import Separator

            s = Separator(model_file_dir=str(models / "audio-separator"))
            s.load_model(model_filename=cfg.separation.audio_separator_model)
        results["audio_separator"] = _step("audio-separator RoFormer model", asep)

    if "lipsync" in want:
        results["lipsync"] = _step("Wav2Lip repo + face detector", lambda: setup_wav2lip(cfg))

    return results


def setup_wav2lip(cfg: DubConfig) -> None:
    repo = resolve_path(cfg.lipsync.wav2lip_repo)
    assert repo is not None
    if not (repo / "inference.py").exists():
        if not shutil.which("git"):
            raise RuntimeError("git not found; clone https://github.com/Rudrabha/Wav2Lip manually into " + str(repo))
        subprocess.run(["git", "clone", "--depth", "1", "https://github.com/Rudrabha/Wav2Lip", str(repo)], check=True)
    s3fd = repo / "face_detection" / "detection" / "sfd" / "s3fd.pth"
    if not s3fd.exists():
        import urllib.request

        log.info("   downloading S3FD face detector")
        urllib.request.urlretrieve(S3FD_URL, s3fd)
    ckpt = resolve_path(cfg.lipsync.wav2lip_checkpoint)
    if ckpt is None or not ckpt.exists():
        raise RuntimeError(
            f"Now download 'wav2lip_gan.pth' from the links in {repo / 'README.md'} "
            f"(section 'Getting the weights') and save it as {ckpt}")


def check_offline_ready(cfg: DubConfig) -> list[str]:
    """Things that are still missing for a fully offline run."""
    missing = []
    xtts = resolve_path(cfg.tts.xtts_model_dir)
    if cfg.tts.backend == "xtts" and not (xtts and (xtts / "model.pth").exists()):
        missing.append("XTTS-v2 weights")
    models = resolve_path(cfg.general.models_dir)
    fw = models / "faster-whisper" if models else None
    if not (fw and fw.exists() and any(fw.iterdir())):
        missing.append("Whisper model")
    return missing


def models_size_gb(cfg: DubConfig) -> float:
    root = resolve_path(cfg.general.models_dir)
    if not root or not root.exists():
        return 0.0
    return round(sum(p.stat().st_size for p in Path(root).rglob("*") if p.is_file()) / 1024**3, 2)
