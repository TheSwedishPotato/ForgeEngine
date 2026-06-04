"""The ForgeDub dubbing pipeline.

The :mod:`orchestrator` ties the stages together:

    intake -> extract -> (separate) -> transcribe -> translate
           -> synthesize -> align -> mux

Each stage lives in its own module and supports both a ``real`` implementation
(backed by an AI model / ffmpeg) and a ``mock`` implementation (pure Python, no
heavy dependencies) so the whole flow can run anywhere.
"""
