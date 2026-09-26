from dubforge.cli import build_parser, main


def test_parser_has_all_commands():
    p = build_parser()
    for argv in (["batch", "x.mkv", "--to", "de"], ["live-audio", "--to", "en"], ["live-video", "--delay", "10"],
                 ["gui"], ["doctor"], ["devices"], ["presets"], ["download-models", "--only", "nllb"]):
        assert p.parse_args(argv).cmd == argv[0]


def test_presets_command(capsys):
    assert main(["presets"]) == 0
    assert "gpu_8gb" in capsys.readouterr().out


def test_bad_override_is_reported(capsys):
    assert main(["batch", "nothing.mp4", "--set", "tts.nope=1"]) == 2
    assert "Unknown config key" in capsys.readouterr().err
