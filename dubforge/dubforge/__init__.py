"""DubForge: private, fully local AI dubbing.

Pipeline (batch mode):
    extract audio -> separate dialogue/background -> transcribe + diarize
    -> translate -> emotion/prosody analysis -> voice-cloned TTS
    -> timing fit -> mix with background -> (optional) lip sync -> mux

Every stage is a swappable backend (see ``dubforge.registry``).
"""

__version__ = "0.1.0"
