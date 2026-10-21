from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import numpy as np
import pytest
import soundfile as sf

from dubforge.audio_utils import (active_rms_db, energy_speech_spans, time_stretch, trim_silence)
from dubforge.config import Config, FitCfg, SegmentationCfg, TTSCfg, parse_override
from dubforge.diarize.ecapa import assign_short_by_neighbour, cluster_embeddings
from dubforge.languages import resolve, tts_backends_for, tts_supports
from dubforge.mix import plan_fit, residual_gain_curve
from dubforge.refs import Clip, build_bank, pick_clips
from dubforge.segmentation import is_nonspeech, resegment, split_long
from dubforge.tts.common import looks_broken, normalize_text, split_text, style_for
from dubforge.types import Segment, Word


# ------------------------------------------------------------------ languages / config
def test_language_resolution_and_tts_capabilities():
    assert resolve("Swedish").code == "sv" == resolve("swe").code == resolve("SV").code
    assert resolve("Swedish").nllb == "swe_Latn"
    assert tts_supports("chatterbox", "sv") and not tts_supports("xtts", "sv")   # the reason Chatterbox is default
    assert tts_backends_for("sv") == ["chatterbox"]
    assert "xtts" in tts_backends_for("cs") and "chatterbox" not in tts_backends_for("cs")
    with pytest.raises(ValueError):
        resolve("klingon")


def test_config_is_strict_and_overridable(tmp_path):
    with pytest.raises(KeyError):
        Config.load(overrides={"tts": {"cfg_wieght": 0.3}})
    c = Config()
    c.set("tts.cfg_weight", 0.3)
    assert c.tts.cfg_weight == 0.3
    assert parse_override("fit.max_speedup=1.15") == ("fit.max_speedup", 1.15)
    y = tmp_path / "c.yaml"
    y.write_text("tts:\n  backend: xtts\nasr:\n  model: medium\n")
    c = Config.load(y)
    assert (c.tts.backend, c.asr.model, c.asr.beam_size) == ("xtts", "medium", 5)
    c.apply_profile(5.0)
    assert c.translate.model.endswith("600M")


# ------------------------------------------------------------------ fit planner
def seg(i, a, b, text="x"):
    return Segment(id=i, start=a, end=b, text=text)


def test_plan_fit_cases():
    cfg = FitCfg()
    segs = [seg(0, 0, 2), seg(1, 3, 5), seg(2, 6, 8), seg(3, 8.3, 10), seg(4, 12, 13)]
    d = {0: 1.5,        # fits
         1: 2.2,        # 10% too long -> small speed-up to end with the actor
         2: 3.0,        # 50% too long and the next line starts at 8.3 -> must compress beyond 1.2x
         3: 2.7,        # long, but 2.3 s of room (silence until the next line) -> speed up to max, spill
         4: 9.0}        # hopeless -> overrun flag
    p = plan_fit(segs, d, cfg, total_duration=20.0)
    assert p[0].ratio == 1.0 and not p[0].flags
    assert 1.05 < p[1].ratio <= cfg.max_speedup and not p[1].flags
    assert p[1].end <= 5.0 + 1e-6
    assert p[2].ratio > cfg.max_speedup and "compressed" in p[2].flags and p[2].end <= 8.3 - cfg.min_gap_s + 1e-6
    assert p[3].ratio == cfg.max_speedup and "spill" in p[3].flags and p[3].end <= 10 + cfg.max_spill_s + 1e-6
    assert "overrun" in p[4].flags and p[4].ratio == cfg.hard_speedup
    assert all(plan.ratio >= 1.0 for plan in p.values())          # never slows speech down


# ------------------------------------------------------------------ audio utils
def test_time_stretch_changes_length_not_pitch():
    sr = 24000
    t = np.arange(sr * 2) / sr
    x = (0.5 * np.sin(2 * np.pi * 200 * t)).astype(np.float32)
    y = time_stretch(x, sr, 1.25)
    assert abs(len(y) / len(x) - 0.8) < 0.03
    z = y[2000:-2000]
    f = np.fft.rfftfreq(len(z), 1 / sr)[np.argmax(np.abs(np.fft.rfft(z)))]
    assert abs(f - 200) < 10                                          # pitch preserved
    assert time_stretch(x, sr, 1.0) is x


def test_trim_and_levels():
    sr = 16000
    x = np.concatenate([np.zeros(sr), 0.3 * np.sin(2 * np.pi * 300 * np.arange(sr) / sr), np.zeros(sr)]).astype(np.float32)
    assert 0.9 < len(trim_silence(x, sr)) / sr < 1.2
    loud = 0.3 * np.sin(2 * np.pi * 300 * np.arange(sr) / sr)
    padded = np.concatenate([loud, np.zeros(sr * 2)])
    assert abs(active_rms_db(padded, sr) - active_rms_db(loud, sr)) < 1.0   # pauses don't lower 'active' level


def test_energy_vad():
    sr = 16000
    x = np.zeros(sr * 6, np.float32)
    for a, b in [(1.0, 2.0), (3.0, 4.5)]:
        x[int(a * sr):int(b * sr)] = 0.2 * np.sin(2 * np.pi * 200 * np.arange(int((b - a) * sr)) / sr)
    spans = energy_speech_spans(x + 1e-4 * np.random.default_rng(0).standard_normal(len(x)).astype(np.float32), sr)
    assert len(spans) == 2 and abs(spans[0][0] - 1.0) < 0.1 and abs(spans[1][1] - 4.5) < 0.1


# ------------------------------------------------------------------ segmentation
def words(text, t0, dt=0.4):
    out, t = [], t0
    for w in text.split():
        out.append(Word(t, t + dt * 0.9, " " + w))
        t += dt
    return out


def test_resegment_merges_fragments_and_splits_long():
    a = Segment(0, 0.0, 1.5, "I told you that we should", words=words("I told you that we should", 0.0, 0.3))
    b = Segment(1, 1.6, 3.0, "never go back there.", words=words("never go back there.", 1.6, 0.35))
    c = Segment(2, 3.1, 4.0, "Fine.", words=words("Fine.", 3.1))
    out = resegment([a, b, c], SegmentationCfg())
    assert [s.text for s in out] == ["I told you that we should never go back there.", "Fine."]   # sentence kept whole
    long_words = words("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen "
                       "sixteen seventeen eighteen nineteen twenty. next sentence starts here and continues", 0.0, 0.5)
    big = Segment(0, 0.0, long_words[-1].end, " ".join(w.text.strip() for w in long_words), words=long_words)
    parts = split_long(big, 8.0)
    assert len(parts) >= 2 and all(p.duration <= 8.0 for p in parts)
    texts = [p.text for p in parts]
    i = next(k for k, t in enumerate(texts) if t.rstrip().endswith("twenty."))
    assert texts[i + 1].startswith("next")                                # a cut lands exactly on the sentence boundary
    assert is_nonspeech("♪ ♪") and is_nonspeech("[music]") and not is_nonspeech("hello")


# ------------------------------------------------------------------ references
def test_reference_selection_and_bank(tmp_path):
    clips = [Clip(0, 0, 6, "neutral", 6.0), Clip(1, 10, 15, "angry", 5.0), Clip(2, 20, 28, "angry", 7.5),
             Clip(3, 30, 33, "sad", 3.0)]
    chosen = pick_clips(sorted(clips, key=lambda c: -c.score), "angry", max_s=10.0)
    assert [c.emotion for c in chosen[:2]] == ["angry", "angry"]          # emotion-matched first
    assert sum(c.duration for c in chosen[:-1]) < 10.0                    # stops once max_s reached
    sr = 16000
    voc = (0.2 * np.random.default_rng(1).standard_normal(sr * 40)).astype(np.float32)
    voc[sr * 20:sr * 21] = 1.0                                            # clipped region -> seg 2 rejected
    acc = np.zeros_like(voc)
    sf.write(tmp_path / "v.wav", voc, sr)
    sf.write(tmp_path / "a.wav", acc, sr)
    segs = [Segment(0, 0, 3, "a", speaker="S0"), Segment(1, 2.5, 5, "b", speaker="S1"),   # 0 and 1 overlap
            Segment(2, 20, 22, "c", speaker="S0"), Segment(3, 30, 33, "d", speaker="S0")]
    bank = build_bank(segs, tmp_path / "v.wav", tmp_path / "a.wav")
    ids = {c.seg_id for cl in bank.values() for c in cl}
    assert ids == {3}


def test_residual_gate_removes_original_speech_only_under_dub():
    segs = [seg(0, 2.0, 4.0), seg(1, 6.0, 7.0), seg(2, 8.0, 9.0)]
    segs[0].tts_path = segs[1].tts_path = "dub.wav"
    segs[1].skip = True                                                  # a sung line: keep the original
    # segs[2] has no dub (e.g. too short to clone): the original must stay audible, not become silence
    g = residual_gain_curve(segs, 10.0, pad_s=0.25)
    at = lambda t: g[int(t * 100)]
    assert at(3.0) < 0.01 and at(1.0) > 0.99 and at(5.0) > 0.99 and at(6.5) > 0.99 and at(8.5) > 0.99


# ------------------------------------------------------------------ text prep
def test_text_prep():
    assert normalize_text("Hello [laughs] there ♪ (sighs) friend…") == "Hello there friend..."
    t = "Sentence one is here. " * 20
    chunks = split_text(t.strip(), 100)
    assert all(len(c) <= 100 for c in chunks) and " ".join(chunks).count("Sentence one") == 20
    assert split_text("short", 100) == ["short"]
    assert split_text("a" * 10 + " " + "b" * 300, 100)[-1].strip("b") == ""      # hard-wraps unbroken text
    sr = 24000
    ok = (0.1 * np.sin(np.arange(int(3 * sr)) * 0.05)).astype(np.float32)
    assert not looks_broken(ok, sr, "x" * 40, "en")
    assert looks_broken(np.zeros(sr, np.float32), sr, "hello", "en")
    assert looks_broken(np.tile(ok, 4), sr, "hello there", "en")                 # babbling far past expected length


def test_style_from_emotion_and_loudness():
    cfg = TTSCfg()
    calm = Segment(0, 0, 2, "x", emotion="neutral", energy_db=-30)
    angry = Segment(1, 0, 2, "x", emotion="angry", energy_db=-18)
    sad = Segment(2, 0, 2, "x", emotion="sad", energy_db=-36)
    s_calm, s_angry, s_sad = (style_for(s, -30, cfg) for s in (calm, angry, sad))
    assert s_sad.exaggeration < s_calm.exaggeration < s_angry.exaggeration
    assert s_angry.arousal > 0 > s_sad.arousal


# ------------------------------------------------------------------ diarization maths
def test_clustering_recovers_speakers():
    rng = np.random.default_rng(0)
    centers = rng.standard_normal((3, 64))
    emb = np.concatenate([c + 0.15 * rng.standard_normal((n, 64)) for c, n in zip(centers, (20, 10, 5))])
    labels = cluster_embeddings(emb, None, 0.55)
    assert len(set(labels)) == 3
    assert set(labels[:20]) == {0}                                        # biggest cluster is SPK0
    assert len(set(cluster_embeddings(emb, 2, 0.55))) == 2
    assert list(cluster_embeddings(emb[:1], None, 0.55)) == [0]
    segs = [seg(0, 0, 3), seg(1, 3, 3.3), seg(2, 10, 13)]
    assert assign_short_by_neighbour(segs, {0: 4, 2: 7})[1] == 4          # short line joins its temporal neighbour


# ------------------------------------------------------------------ ollama adapter (fake server)
class _Fake(BaseHTTPRequestHandler):
    prompts: list[str] = []

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        if self.path.endswith("/chat"):
            _Fake.prompts.append(body["messages"][0]["content"])
            text = body["messages"][0]["content"].split("Line to translate")[1].split(": ", 1)[1].split("\n")[0]
            out = json.dumps({"message": {"content": json.dumps({"translation": f"SV<{text}>"})}})
        else:
            out = "{}"
        self.send_response(200)
        self.end_headers()
        self.wfile.write(out.encode())

    def log_message(self, *a):
        pass


def test_ollama_translator_uses_context_and_budget():
    from dubforge.translate.ollama import OllamaTranslator
    srv = HTTPServer(("127.0.0.1", 0), _Fake)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    cfg = Config()
    cfg.translate.ollama_url = f"http://127.0.0.1:{srv.server_port}"
    segs = [Segment(0, 0, 2, "Hello there.", emotion="happy"), Segment(1, 2.5, 5, "How are you?")]
    OllamaTranslator(cfg).translate(segs, "en", "sv")
    srv.shutdown()
    assert [s.translation for s in segs] == ["SV<Hello there.>", "SV<How are you?>"]
    assert "Hello there. -> SV<Hello there.>" in _Fake.prompts[1]          # previous line given as context
    assert "at most" in _Fake.prompts[0] and "happy" in _Fake.prompts[0]
    assert OllamaTranslator.parse("not json at all") == "not json at all"


# ------------------------------------------------------------------ wav2lip front-end
def test_wav2lip_mel_frontend():
    from dubforge.lipsync.wav2lip import MEL_STEP, feather_mask, mel_chunks_for_frames, melspectrogram
    sr = 16000
    x = (0.3 * np.sin(2 * np.pi * 440 * np.arange(sr * 2) / sr)).astype(np.float32)
    mel = melspectrogram(x)
    assert mel.shape[0] == 80 and abs(mel.shape[1] - 2 * 80) <= 2         # 80 mel steps per second
    assert mel.min() >= -4.0 and mel.max() <= 4.0
    chunks = mel_chunks_for_frames(mel, 25.0, 50)
    assert len(chunks) == 50 and all(c.shape == (80, MEL_STEP) for c in chunks)
    m = feather_mask(120, 100)
    assert m.shape == (120, 100, 1) and m[:30].max() < 1e-3 and m[-5:-1, 50].min() > 0.9   # mouth area solid, eyes untouched


def test_face_box_helpers():
    from dubforge.lipsync.faces import fill_missing, smooth_boxes
    boxes = [None, (10, 10, 50, 50), None, (12, 10, 52, 50)]
    filled = fill_missing(boxes)
    assert filled is not None and all(b is not None for b in filled) and filled[0] == (10, 10, 50, 50)
    assert fill_missing([None, None]) is None
    sm = smooth_boxes([(0, 0, 10, 10), (10, 0, 20, 10), (0, 0, 10, 10)])
    assert max(b[0] for b in sm) < 10                                      # jitter reduced


def test_reference_fallback_chain_for_short_interjections(tmp_path):
    from dubforge.refs import ReferenceProvider
    sr = 16000
    voc = (0.1 * np.random.default_rng(2).standard_normal(sr * 60)).astype(np.float32)
    sf.write(tmp_path / "v.wav", voc, sr)
    sf.write(tmp_path / "a.wav", np.zeros_like(voc), sr)
    segs = [Segment(0, 0, 5, "long line", speaker="A", emotion="neutral"),
            Segment(1, 10, 10.5, "No!", speaker="A", emotion="angry"),          # too short to clone from itself
            Segment(2, 20, 20.5, "Yes.", speaker="B"),                          # B only ever speaks briefly
            Segment(3, 30, 30.3, "Eh", speaker="C")]                            # hopeless
    rp = ReferenceProvider(segs, tmp_path / "v.wav", tmp_path / "a.wav", tmp_path / "refs")
    assert rp.for_segment(segs[0]) is not None                                  # own audio
    assert rp.for_segment(segs[1]) is not None                                  # borrows A's clean clips
    assert rp.for_segment(segs[2]) is None and rp.for_segment(segs[3]) is None  # nothing usable: caller keeps original


def test_speechbrain_hub_shim_maps_old_arguments(monkeypatch):
    """SpeechBrain 1.0.x vs huggingface_hub>=1.0: removed `use_auth_token`, changed 404 exception type."""
    pytest.importorskip("speechbrain")
    import huggingface_hub
    import requests
    import speechbrain.utils.fetching as fetching
    from huggingface_hub.errors import EntryNotFoundError

    seen = {}

    def fake_download(repo_id, filename, token=None, **kw):          # no `use_auth_token`, like hub 1.x
        seen.update(token=token, extra=kw)
        if filename == "custom.py":
            raise EntryNotFoundError("missing")
        return "/cached/file"

    monkeypatch.setattr(huggingface_hub, "hf_hub_download", fake_download)
    monkeypatch.setattr(fetching, "huggingface_hub", huggingface_hub)
    monkeypatch.setattr(fetching, "_dubforge_hub_patched", False, raising=False)
    from dubforge.compat import patch_speechbrain_hub
    patch_speechbrain_hub()
    hub = fetching.huggingface_hub
    assert hub.hf_hub_download("r", "emb.ckpt", use_auth_token="tok", local_dir_use_symlinks=False) == "/cached/file"
    assert seen["token"] == "tok" and "local_dir_use_symlinks" not in seen["extra"]
    with pytest.raises(requests.exceptions.HTTPError, match="404 Client Error"):   # what SpeechBrain catches as "file absent"
        hub.hf_hub_download("r", "custom.py", use_auth_token=False)
    assert hub.snapshot_download is huggingface_hub.snapshot_download                # everything else passes through
