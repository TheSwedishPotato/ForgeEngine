import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from dubforge.config import load_config  # noqa: E402

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


@pytest.fixture
def mock_cfg(tmp_path):
    def make(*overrides):
        return load_config(preset="mock", overrides=[
            f"general.work_dir={tmp_path / 'work'}",
            f"general.output_dir={tmp_path / 'out'}",
            f"general.models_dir={tmp_path / 'models'}",
            *overrides,
        ])
    return make
