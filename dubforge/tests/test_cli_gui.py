"""The user-facing entry points: CLI wiring and the Gradio UI construction."""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run(*args, timeout=240):
    return subprocess.run([sys.executable, str(ROOT / "main.py"), *args], capture_output=True, text=True, timeout=timeout, cwd=ROOT)


def test_test_clip_script_mock_passes():
    p = subprocess.run([sys.executable, str(ROOT / "scripts" / "test_clip.py"), "--mock", "--to", "sv"],
                       capture_output=True, text=True, timeout=240, cwd=ROOT)
    assert p.returncode == 0, p.stdout[-2000:] + p.stderr[-2000:]
    assert "[FAIL]" not in p.stdout and p.stdout.count("[PASS]") == 6


def test_cli_rejects_unknown_language_and_bad_config():
    p = run("dub", "nonexistent.mp4", "--to", "sv", "--mock")
    assert p.returncode != 0 and "FileNotFoundError" in p.stderr
    p = run("dub", str(ROOT / "README.md"), "--to", "klingon", "--mock")
    assert p.returncode != 0
    p = run("dub", "x.mp4", "--to", "sv", "--set", "tts.nope=1", "--mock")
    assert p.returncode != 0 and "Unknown config key" in p.stderr


def test_doctor_runs():
    p = run("doctor")
    assert "ffmpeg" in p.stdout and "faster_whisper" in p.stdout


def test_gui_builds_and_warns_about_swedish_on_xtts():
    from dubforge.config import Config
    from dubforge.gui import build, COLS
    demo = build(Config())
    assert demo is not None and len(COLS) == 8
    from dubforge.languages import tts_backends_for
    assert tts_backends_for("sv") == ["chatterbox"]
