"""Real audio devices (PortAudio via sounddevice) and a file-based simulator for offline testing.

Windows routing for "mute Netflix, hear the dub":
  1. Install VB-CABLE (free, vb-audio.com). It adds playback device "CABLE Input" and
     recording device "CABLE Output".
  2. Windows Settings -> System -> Sound -> Volume mixer: set your browser / Netflix app
     OUTPUT to "CABLE Input". Netflix is now silent in your speakers.
  3. Run: python main.py live --in "CABLE Output" --out "<your headphones/speakers>"
  4. Set both CABLE devices and your speakers to the SAME sample rate (48000 Hz) in
     Sound -> device properties -> Advanced, or the stream open will fail.
"""
from __future__ import annotations

import time
from pathlib import Path

import numpy as np

from ..audio_utils import read_audio, write_audio
from .core import LiveDubber


def _sd():
    try:
        import sounddevice as sd
    except OSError as e:                         # PortAudio library missing
        raise RuntimeError(f"PortAudio not available: {e}") from e
    return sd


def list_devices() -> str:
    sd = _sd()
    rows = []
    for i, d in enumerate(sd.query_devices()):
        api = sd.query_hostapis(d["hostapi"])["name"]
        rows.append(f"{i:>3}  in={d['max_input_channels']} out={d['max_output_channels']}  "
                    f"{d['default_samplerate']:.0f}Hz  [{api}]  {d['name']}")
    return "\n".join(rows)


def find_device(sd, query: str | None, kind: str) -> int | None:
    """Pick a device by index or name substring (case-insensitive). None = system default."""
    if query is None:
        return None
    if str(query).isdigit():
        return int(query)
    key = "max_input_channels" if kind == "input" else "max_output_channels"
    matches = [i for i, d in enumerate(sd.query_devices()) if query.lower() in d["name"].lower() and d[key] > 0]
    if not matches:
        raise RuntimeError(f"No {kind} device matching {query!r}. Run `python main.py live --list-devices`.")
    return matches[0]


def run_devices(engine: LiveDubber, in_dev: str | None, out_dev: str | None, block: int = 2048) -> None:
    """Capture -> engine -> playback until Ctrl-C."""
    sd = _sd()
    i_idx, o_idx = find_device(sd, in_dev, "input"), find_device(sd, out_dev, "output")
    in_ch = min(2, int(sd.query_devices(i_idx, "input")["max_input_channels"]) if i_idx is not None
                else int(sd.query_devices(kind="input")["max_input_channels"]))

    def in_cb(indata, frames, t, status):
        engine.feed(indata.mean(axis=1) if indata.shape[1] > 1 else indata[:, 0])

    def out_cb(outdata, frames, t, status):
        outdata[:] = engine.pull(frames)

    engine.start()
    with sd.InputStream(device=i_idx, channels=in_ch, samplerate=engine.sr, blocksize=block, callback=in_cb), \
            sd.OutputStream(device=o_idx, channels=2, samplerate=engine.sr, blocksize=block, callback=out_cb):
        print(f"Live dubbing running (delay {engine.delay_s:.0f}s). Ctrl-C to stop.")
        try:
            while True:
                time.sleep(1.0)
        except KeyboardInterrupt:
            pass
    engine.stop()


def run_files(engine: LiveDubber, in_wav: Path, out_wav: Path, block_s: float = 0.1) -> None:
    """Deterministic offline run: feed a wav through the live engine as if it were streaming and
    record what the listener would hear. Used for tests and for tuning --delay without a GPU
    busy with Netflix."""
    x, _ = read_audio(in_wav, sr=engine.sr, mono=True)
    n = int(block_s * engine.sr)
    tail = np.zeros(int((engine.delay_s + 6.0) * engine.sr), dtype=np.float32)   # let the delayed end play out
    x = np.concatenate([x, tail])
    engine.sync = True
    out = []
    for i in range(0, len(x), n):
        engine.feed(x[i:i + n])
        engine.step()
        out.append(engine.pull(len(x[i:i + n])))
    write_audio(out_wav, np.concatenate(out), engine.sr)
