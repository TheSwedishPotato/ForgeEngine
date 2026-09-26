from __future__ import annotations

import logging
import sys
import time
from contextlib import contextmanager
from typing import Callable, Iterator

LOGGER_NAME = "dubforge"


def setup_logging(level: str = "INFO", logfile: str | None = None) -> logging.Logger:
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(level.upper())
    logger.handlers.clear()
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s %(message)s", "%H:%M:%S")
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(fmt)
    logger.addHandler(h)
    if logfile:
        fh = logging.FileHandler(logfile, encoding="utf-8")
        fh.setFormatter(fmt)
        logger.addHandler(fh)
    logger.propagate = False
    return logger


def get_logger(name: str | None = None) -> logging.Logger:
    return logging.getLogger(LOGGER_NAME if not name else f"{LOGGER_NAME}.{name}")


# Progress callback: (fraction 0..1, message). The GUI plugs gr.Progress in here.
ProgressFn = Callable[[float, str], None]


def null_progress(_frac: float, _msg: str) -> None:
    pass


@contextmanager
def timed(label: str, timings: dict[str, float] | None = None) -> Iterator[None]:
    log = get_logger()
    t0 = time.perf_counter()
    log.info("▶ %s", label)
    try:
        yield
    finally:
        dt = time.perf_counter() - t0
        if timings is not None:
            timings[label] = timings.get(label, 0.0) + dt
        log.info("✔ %s (%.1fs)", label, dt)
