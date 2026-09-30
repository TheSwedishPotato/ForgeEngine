"""Soundtrack for the SAS fan film, synthesised from scratch (no samples).

Warm pad chords, a plucked motif on each cut, jet rumble that swells in the flying
shots, and a soft two-note chime on the end card. Writes promo/out/music.wav.
"""
import os
import wave
import numpy as np

SR = 44100
DUR = 38.0
N = int(SR * DUR)
t = np.arange(N) / SR
rng = np.random.default_rng(1946)


def note(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


def env(start, length, attack, release):
    e = np.zeros(N)
    i0, i1 = int(start * SR), min(N, int((start + length) * SR))
    x = t[i0:i1] - start
    e[i0:i1] = np.minimum(1, x / attack) * np.minimum(1, (length - x) / release)
    return np.clip(e, 0, 1)


def lowpass(x, cutoff):
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = (1 - a) * x[i] + a * acc
        y[i] = acc
    return y


mix = np.zeros((N, 2))

# pad: Dmaj9 - Bm7 - Gmaj7 - A6sus, one chord per ~4.75 s, detuned saws softened
chords = [[50, 57, 62, 66, 69, 76], [47, 54, 59, 62, 66, 69], [43, 50, 55, 59, 62, 66], [45, 52, 57, 61, 64, 71]]
pad = np.zeros(N)
for k in range(8):
    start = k * 4.75 - 0.4
    ch = chords[k % 4]
    e = env(max(0, start), 5.6, 1.6, 2.0)
    for m in ch:
        f = note(m)
        for det in (-0.12, 0.0, 0.11):
            ph = rng.random() * 2 * np.pi
            fr = f * 2 ** (det / 12)
            # band-limited-ish saw: a few harmonics
            s = sum(np.sin(2 * np.pi * fr * h * t + ph * h) / h for h in range(1, 6))
            pad += s * e * 0.012
pad = lowpass(pad, 1800)
mix[:, 0] += pad
mix[:, 1] += np.roll(pad, 220)  # a little width

# plucked motif on every cut
cuts = [5, 9.5, 13.5, 17.5, 21.5, 25.5, 29.5, 33.5]
motif = [74, 76, 78, 81, 78, 76, 74, 69]
for c, m in zip(cuts, motif):
    for j, mm in enumerate((m, m + 12)):
        i0 = int(c * SR)
        L = int(2.2 * SR)
        x = np.arange(min(L, N - i0)) / SR
        f = note(mm)
        s = (np.sin(2 * np.pi * f * x) + 0.4 * np.sin(4 * np.pi * f * x)) * np.exp(-x * (3.2 + j * 2))
        mix[i0:i0 + len(x), 0] += s * (0.09 if j == 0 else 0.035)
        mix[i0:i0 + len(x), 1] += s * (0.07 if j == 0 else 0.05)

# jet rumble: brown noise, swelling from the climb to the approach
noise = np.cumsum(rng.standard_normal(N))
noise -= lowpass(noise, 8)  # remove drift
noise = lowpass(noise, 400)
noise /= np.max(np.abs(noise)) + 1e-9
swell = np.interp(t, [0, 9, 13, 16, 26, 30, 33, 38], [0, 0, 0.15, 0.55, 0.45, 0.2, 0, 0])
mix[:, 0] += noise * swell * 0.22
mix[:, 1] += np.roll(noise, 900) * swell * 0.22

# end card: soft two-note chime (a descending fourth)
for off, m in ((34.1, 81), (34.55, 76)):
    i0 = int(off * SR)
    x = np.arange(N - i0) / SR
    f = note(m)
    s = (np.sin(2 * np.pi * f * x) + 0.25 * np.sin(2 * np.pi * 2.76 * f * x) * np.exp(-x * 6)) * np.exp(-x * 1.4)
    mix[i0:, 0] += s * 0.12
    mix[i0:, 1] += s * 0.12

# master: gentle fade in/out and normalise
fade = np.clip(t / 1.2, 0, 1) * np.clip((DUR - t) / 1.5, 0, 1)
mix *= fade[:, None]
mix /= np.max(np.abs(mix)) * 1.12

os.makedirs(os.path.join(os.path.dirname(__file__), 'out'), exist_ok=True)
path = os.path.join(os.path.dirname(__file__), 'out', 'music.wav')
with wave.open(path, 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes((mix * 32767).astype('<i2').tobytes())
print('wrote', path)
