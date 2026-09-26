#!/usr/bin/env python
"""DubForge entry point. Run `python main.py --help`."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dubforge.cli import main  # noqa: E402

if __name__ == "__main__":
    sys.exit(main())
