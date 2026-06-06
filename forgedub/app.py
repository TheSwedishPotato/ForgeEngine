#!/usr/bin/env python3
"""ForgeDub desktop launcher.

Starts the local server and opens it in a native desktop window (pywebview).
If a desktop window isn't available (e.g. a headless server), it falls back to
browser mode and just prints the URL.

Usage:
    python app.py                 # desktop window
    python app.py --no-window     # server only, open in your browser
    python app.py --port 9000     # custom port
"""
from __future__ import annotations

import argparse
import threading
import time
import urllib.request

import uvicorn

from forge_dub import APP_NAME
from forge_dub.config import get_settings
from forge_dub.server import create_app


def _wait_until_up(url: str, timeout: float = 20.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            urllib.request.urlopen(url + "/api/health", timeout=1)
            return True
        except Exception:
            time.sleep(0.2)
    return False


def main() -> None:
    parser = argparse.ArgumentParser(description=f"{APP_NAME} — AI video dubbing")
    parser.add_argument("--no-window", action="store_true",
                        help="run the server only and open it in your browser")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()

    settings = get_settings()
    if args.host:
        settings.host = args.host
    if args.port:
        settings.port = args.port

    app = create_app(settings)
    url = f"http://{settings.host}:{settings.port}"
    server = uvicorn.Server(uvicorn.Config(
        app, host=settings.host, port=settings.port, log_level="info"))

    mode = settings.effective_mode().upper()
    banner = f"  {APP_NAME} — English → {settings.target_lang.upper()} dubbing  [{mode} engine]  "
    print("\n" + "=" * len(banner) + f"\n{banner}\n" + "=" * len(banner))

    if args.no_window:
        print(f"Open {url} in your browser.\n")
        server.run()
        return

    try:
        import webview  # pywebview
    except Exception:
        print(f"(Desktop window unavailable — running in browser mode.)\nOpen {url}\n")
        server.run()
        return

    threading.Thread(target=server.run, daemon=True).start()
    if not _wait_until_up(url):
        print("Server did not start in time; check the logs above.")
        return

    webview.create_window(
        f"{APP_NAME} — AI Video Dubbing", url,
        width=1240, height=860, min_size=(960, 680))
    webview.start()
    server.should_exit = True


if __name__ == "__main__":
    main()
