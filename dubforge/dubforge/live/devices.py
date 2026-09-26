"""Audio device discovery (sounddevice / PortAudio)."""

from __future__ import annotations

import sys
from dataclasses import dataclass


@dataclass
class Device:
    index: int
    name: str
    hostapi: str
    max_input: int
    max_output: int
    default_sr: float


def list_devices() -> list[Device]:
    import sounddevice as sd

    apis = sd.query_hostapis()
    out = []
    for i, d in enumerate(sd.query_devices()):
        out.append(Device(i, d["name"], apis[d["hostapi"]]["name"], d["max_input_channels"], d["max_output_channels"],
                          d["default_samplerate"]))
    return out


def _api_rank(api: str) -> int:
    # WASAPI on Windows gives the lowest latency without exclusive drivers
    order = ["Windows WASAPI", "Core Audio", "PulseAudio", "JACK Audio Connection Kit", "ALSA", "Windows DirectSound", "MME"]
    return order.index(api) if api in order else len(order)


def find_device(name: str | None, kind: str) -> int | None:
    """Substring match (case-insensitive); None -> system default."""
    if not name:
        return None
    devs = [d for d in list_devices() if (d.max_input if kind == "input" else d.max_output) > 0]
    exact = [d for d in devs if name.lower() == d.name.lower()]
    matches = exact or [d for d in devs if name.lower() in d.name.lower()]
    if not matches:
        avail = "\n  ".join(f"[{d.index}] {d.name} ({d.hostapi})" for d in devs)
        raise ValueError(f"No {kind} device matching '{name}'. Available {kind} devices:\n  {avail}")
    return sorted(matches, key=lambda d: _api_rank(d.hostapi))[0].index


def stream_extra_settings(device: int | None):
    """On Windows WASAPI let Windows convert sample rates, so 44.1/48 kHz mismatches just work."""
    if sys.platform != "win32" or device is None:
        return None
    import sounddevice as sd

    info = sd.query_devices(device)
    if "WASAPI" in sd.query_hostapis(info["hostapi"])["name"]:
        try:
            return sd.WasapiSettings(auto_convert=True)
        except TypeError:
            return None
    return None


def describe() -> str:
    lines = []
    for d in list_devices():
        kinds = []
        if d.max_input:
            kinds.append(f"in:{d.max_input}")
        if d.max_output:
            kinds.append(f"out:{d.max_output}")
        lines.append(f"[{d.index:3d}] {d.name}  ({d.hostapi}, {' '.join(kinds)}, {int(d.default_sr)} Hz)")
    return "\n".join(lines)
