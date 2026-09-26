"""Thread-safe audio buffers shared between PortAudio callbacks and worker threads."""

from __future__ import annotations

import threading
from collections import deque

import numpy as np


class FifoRing:
    """FIFO of float32 frames [n, ch]; reads pad with silence on underflow."""

    def __init__(self, channels: int, max_samples: int):
        self.ch = channels
        self.max = max_samples
        self.q: deque[np.ndarray] = deque()
        self.size = 0
        self.lock = threading.Lock()

    def write(self, x: np.ndarray) -> None:
        if x.ndim == 1:
            x = np.repeat(x[:, None], self.ch, axis=1)
        with self.lock:
            self.q.append(x.astype(np.float32, copy=False))
            self.size += len(x)
            while self.size > self.max and self.q:  # drop oldest audio if the consumer stalls
                self.size -= len(self.q.popleft())

    def read(self, n: int) -> np.ndarray:
        out = np.zeros((n, self.ch), np.float32)
        filled = 0
        with self.lock:
            while filled < n and self.q:
                head = self.q[0]
                take = min(n - filled, len(head))
                out[filled: filled + take] = head[:take]
                if take == len(head):
                    self.q.popleft()
                else:
                    self.q[0] = head[take:]
                filled += take
                self.size -= take
        return out

    def available(self) -> int:
        with self.lock:
            return self.size

    def clear(self) -> None:
        with self.lock:
            self.q.clear()
            self.size = 0


class TimelineRing:
    """Fixed-size circular buffer addressed by absolute sample index (for the delayed video mode)."""

    def __init__(self, channels: int, capacity: int):
        self.ch = channels
        self.cap = capacity
        self.buf = np.zeros((capacity, channels), np.float32)
        self.lock = threading.Lock()

    def _slices(self, start: int, n: int):
        s = start % self.cap
        first = min(n, self.cap - s)
        return (s, s + first), (0, n - first)

    def write(self, start: int, x: np.ndarray, add: bool = False) -> None:
        if x.ndim == 1:
            x = np.repeat(x[:, None], self.ch, axis=1)
        x = x[-self.cap:]
        with self.lock:
            (a, b), (c, d) = self._slices(start, len(x))
            n1 = b - a
            if add:
                self.buf[a:b] += x[:n1]
                self.buf[c:d] += x[n1:]
            else:
                self.buf[a:b] = x[:n1]
                self.buf[c:d] = x[n1:]

    def read(self, start: int, n: int) -> np.ndarray:
        with self.lock:
            (a, b), (c, d) = self._slices(start, n)
            return np.concatenate([self.buf[a:b], self.buf[c:d]], axis=0).copy()

    def clear_range(self, start: int, n: int) -> None:
        self.write(start, np.zeros((n, self.ch), np.float32))
