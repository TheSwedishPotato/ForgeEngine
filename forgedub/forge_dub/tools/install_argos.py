"""Download and install an Argos Translate language package (default en -> sv).

Run after installing requirements-ml.txt:

    python -m forge_dub.tools.install_argos          # en -> sv
    python -m forge_dub.tools.install_argos en de    # any pair
"""
from __future__ import annotations

import sys


def main(from_code: str = "en", to_code: str = "sv") -> None:
    import argostranslate.package as package

    print(f"Updating Argos package index…")
    package.update_package_index()
    available = package.get_available_packages()
    match = next(
        (p for p in available if p.from_code == from_code and p.to_code == to_code),
        None,
    )
    if match is None:
        raise SystemExit(f"No Argos Translate package for {from_code} -> {to_code}")

    print(f"Downloading {from_code} -> {to_code}…")
    path = match.download()
    package.install_from_path(path)
    print(f"Installed Argos Translate {from_code} -> {to_code}.")


if __name__ == "__main__":
    main(*(sys.argv[1:3]))
