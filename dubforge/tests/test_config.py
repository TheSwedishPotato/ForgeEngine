import pytest
import yaml

from dubforge.config import ConfigError, list_presets, load_config, parse_override


def test_defaults_load():
    cfg = load_config()
    assert cfg.target_lang == "de"
    assert cfg.tts.backend == "xtts"
    assert cfg.asr.model == "large-v3"


def test_presets_exist_and_load():
    names = list_presets()
    for required in ("gpu_8gb", "gpu_12gb", "gpu_24gb", "hollywood", "mock", "cpu"):
        assert required in names
    for n in names:
        load_config(preset=n)


def test_preset_stacking_and_overrides():
    cfg = load_config(preset="gpu_8gb,hollywood", overrides=["tts.temperature=0.55", "target_lang=fr"])
    assert cfg.asr.compute_type == "int8_float16"  # from gpu_8gb
    assert cfg.translation.backend == "local_llm"  # from hollywood
    assert cfg.tts.temperature == 0.55
    assert cfg.target_lang == "fr"


def test_override_parsing_types():
    assert parse_override("a.b=1") == {"a": {"b": 1}}
    assert parse_override("a.b=true") == {"a": {"b": True}}
    assert parse_override("a=[1, 2]") == {"a": [1, 2]}
    assert parse_override("a.b=null") == {"a": {"b": None}}


def test_unknown_key_suggests():
    with pytest.raises(ConfigError, match="temperature"):
        load_config(overrides=["tts.temprature=0.5"])


def test_type_check():
    with pytest.raises(ConfigError):
        load_config(overrides=["tts.max_takes=lots"])


def test_save_redacts_token(tmp_path):
    cfg = load_config(overrides=["general.hf_token=hf_secret"])
    cfg.save(tmp_path / "c.yaml")
    data = yaml.safe_load((tmp_path / "c.yaml").read_text())
    assert data["general"]["hf_token"] is None
    assert load_config(config_path=tmp_path / "c.yaml").tts.backend == "xtts"


def test_section_hash_changes():
    a = load_config()
    b = load_config(overrides=["tts.temperature=0.1"])
    assert a.section_hash("asr") == b.section_hash("asr")
    assert a.section_hash("tts") != b.section_hash("tts")
