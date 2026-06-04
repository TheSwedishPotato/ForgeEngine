from forge_dub.capabilities import Capabilities, detect


def test_detect_returns_capabilities():
    caps = detect()
    assert isinstance(caps, Capabilities)
    assert isinstance(caps.real_ready, bool)
    assert isinstance(caps.tts, bool)
    # to_dict carries the derived flags
    data = caps.to_dict()
    assert "real_ready" in data and "tts" in data
