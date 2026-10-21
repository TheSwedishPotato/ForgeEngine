"""Compatibility shims for version clashes between the pinned model libraries.

Scoped on purpose: they patch only the one library that needs it, not Hugging Face globally.
"""
from __future__ import annotations

import functools
import inspect


def patch_speechbrain_hub() -> None:
    """SpeechBrain 1.0.x was written for huggingface_hub 0.x. Our stack needs hub >= 1.0 (transformers 5,
    pinned by Chatterbox) and SpeechBrain 1.1 is unusable because it needs torch >= 2.7 while Chatterbox
    pins torch 2.6. Two things break:
      * `hf_hub_download(use_auth_token=...)` - removed argument  -> map it to `token`
      * a missing optional file (`custom.py`) now raises RemoteEntryNotFoundError instead of
        requests' HTTPError, which SpeechBrain catches to mean 'file absent, skip it'.
    """
    try:
        import huggingface_hub
        import speechbrain.utils.fetching as fetching
    except ImportError:
        return
    orig = huggingface_hub.hf_hub_download
    if getattr(fetching, "_dubforge_hub_patched", False) or "use_auth_token" in inspect.signature(orig).parameters:
        return                                              # already patched, or an old hub that needs nothing
    from huggingface_hub.errors import EntryNotFoundError
    import requests

    @functools.wraps(orig)
    def wrapper(*args, use_auth_token=None, local_dir_use_symlinks=None, force_filename=None, **kwargs):
        if use_auth_token and "token" not in kwargs:
            kwargs["token"] = use_auth_token
        try:
            return orig(*args, **kwargs)
        except EntryNotFoundError as e:
            raise requests.exceptions.HTTPError(f"404 Client Error: {e}") from e

    class _HubProxy:
        hf_hub_download = staticmethod(wrapper)

        def __getattr__(self, name):                        # everything else is the real module
            return getattr(huggingface_hub, name)

    fetching.huggingface_hub = _HubProxy()
    fetching._dubforge_hub_patched = True
