from forge_dub.pipeline.models import Segment
from forge_dub.pipeline.wavutil import concat_timeline, duration_of, write_silence


def test_write_silence_duration(tmp_path):
    path = tmp_path / "s.wav"
    write_silence(path, 1.5)
    assert abs(duration_of(path) - 1.5) < 0.02


def test_concat_timeline_places_clips(tmp_path):
    segments = []
    for i in range(3):
        clip = tmp_path / f"clip{i}.wav"
        write_silence(clip, 1.0)
        segments.append(Segment(id=i, start=float(i), end=float(i) + 1.0,
                                audio_path=str(clip)))
    out = tmp_path / "timeline.wav"
    concat_timeline(segments, total_duration=3.0, out_path=out)
    assert abs(duration_of(out) - 3.0) < 0.05
