from __future__ import annotations

import hashlib
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from audio_studio import AudioProcessingError, PROFILES, process_audio, read_audio
import audio_studio.processor as processor
from audio_studio.processor import _crossfade_music_loop, _ffmpeg_level_metrics, validate_overrides


def _write(path: Path, samples: np.ndarray, sample_rate: int = 48_000) -> Path:
    sf.write(path, np.asarray(samples, dtype=np.float64), sample_rate, format="WAV", subtype="FLOAT")
    return path


def test_music_profile_preserves_complete_arrangement_without_sfx_trim(tmp_path: Path) -> None:
    sample_rate = 48_000
    total = sample_rate * 4
    time = np.arange(total) / sample_rate
    samples = np.zeros((total, 2), dtype=np.float64)
    # Deliberate quiet intro and release make an onset/tail heuristic visibly
    # wrong for a musical arrangement.
    active = (0.08 * np.sin(2.0 * np.pi * 220.0 * time))[:, None]
    samples[:, :] = active
    samples[: sample_rate // 2] *= 0.1
    samples[-sample_rate // 2 :] *= 0.1
    source = _write(tmp_path / "arrangement.wav", samples, sample_rate)

    result = process_audio(source, tmp_path / "candidate", "loop", "music_loop", {})
    cuts = result["recipe"]["cuts"]

    assert "music_loop" in PROFILES
    assert cuts["selection"] == "full_source"
    assert cuts["auto_trim"] is False
    assert cuts["start_seconds"] == pytest.approx(0.0)
    assert cuts["end_seconds"] == pytest.approx(4.0)
    assert not any("aggressive cut" in warning for warning in result["analysis"]["warnings"])
    assert any("beat and harmony" in warning for warning in result["analysis"]["warnings"])


def test_music_manual_endpoints_and_long_crossfade_are_recorded_and_bounded(tmp_path: Path) -> None:
    sample_rate = 48_000
    time = np.arange(sample_rate * 3) / sample_rate
    samples = np.stack(
        [0.1 * np.sin(2.0 * np.pi * 220.0 * time), 0.1 * np.sin(2.0 * np.pi * 330.0 * time)], axis=1
    )
    source = _write(tmp_path / "manual.wav", samples, sample_rate)

    result = process_audio(
        source,
        tmp_path / "candidate",
        "loop",
        "music_loop",
        {"start_seconds": 0.5, "end_seconds": 2.5, "crossfade_ms": 380_000},
    )
    recipe = result["recipe"]

    assert recipe["cuts"]["selection"] == "manual"
    assert recipe["cuts"]["start_seconds"] == pytest.approx(0.5)
    assert recipe["cuts"]["end_seconds"] == pytest.approx(2.5)
    # Crossfade is shortened to a safe overlap instead of consuming the whole
    # segment.  The exact sample rounding is intentionally implementation data.
    assert 0.0 < recipe["loop"]["crossfade_ms"] <= 1000.1
    assert recipe["fades"]["crossfade_curve"] == "equal_power"

    # The profile-specific 380-second control range must not widen SFX input
    # validation by accident.
    with pytest.raises(AudioProcessingError):
        validate_overrides({"end_seconds": 25.0})
    assert validate_overrides({"end_seconds": 379.0, "crossfade_ms": 380_000}, profile="music_loop")


def test_music_crossfade_preserves_interior_once_at_circular_seam() -> None:
    source = np.arange(20, dtype=np.float64)[:, None]
    result, used = _crossfade_music_loop(source, 6, "linear")

    assert used == 6
    assert result.shape == (14, 1)
    np.testing.assert_array_equal(result[6 - 3 : 6 - 3 + 8], source[6:14])
    # The file boundary is inside the overlap blend, so both adjacent samples
    # are neighboring blend samples rather than a fresh copy of source[0].
    values = np.linspace(0.0, 1.0, used, endpoint=True)
    expected = source[-used:, 0] * (1.0 - values) + source[:used, 0] * values
    assert result[0, 0] == pytest.approx(expected[3])
    assert result[-1, 0] == pytest.approx(expected[2])


def test_music_loudness_alignment_and_redecoded_ogg_true_peak_are_recorded(tmp_path: Path) -> None:
    sample_rate = 48_000
    time = np.arange(sample_rate * 2) / sample_rate
    # Quiet stereo material exercises the positive loudness alignment gain.
    samples = np.stack(
        [0.025 * np.sin(2.0 * np.pi * 997.0 * time), 0.022 * np.sin(2.0 * np.pi * 1231.0 * time)], axis=1
    )
    source = _write(tmp_path / "quiet-music.wav", samples, sample_rate)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()

    result = process_audio(source, tmp_path / "candidate", "loop", "music_loop", {})
    recipe = result["recipe"]
    exported, rate = read_audio(Path(result["outputs"]["export_ogg"]))
    loudness = recipe["loudness"]
    true_peak = recipe["true_peak"]

    assert rate == sample_rate
    assert "ebur128" in loudness["method"]
    assert loudness["processed_lufs"] == pytest.approx(-16.0, abs=0.1)
    assert loudness["export_lufs"] == pytest.approx(-16.0, abs=0.75)
    assert true_peak["codec_verified"] is True
    assert true_peak["export_db"] <= true_peak["limit_db"] + 0.05
    independently_measured = _ffmpeg_level_metrics(Path(result["outputs"]["export_ogg"]), loop=True)
    assert independently_measured is not None
    assert independently_measured["true_peak_db"] <= true_peak["limit_db"] + 0.05
    assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
    assert Path(result["outputs"]["processed_wav"]).is_file()
    assert Path(result["outputs"]["export_ogg"]).is_file()
    assert Path(result["outputs"]["loop_preview_wav"]).is_file()
    assert result["analysis"]["loop_preview"]["frames"] >= result["analysis"]["export"]["frames"] * 3 - 32


def test_ffmpeg_true_peak_catches_intersample_overshoot(tmp_path: Path) -> None:
    pytest.importorskip("imageio_ffmpeg")
    sample_rate = 48_000
    time = np.arange(sample_rate * 2) / sample_rate
    # A 16 kHz sine has a sample peak below 0 dBFS while band-limited
    # reconstruction exceeds it.  Linear interpolation would miss this.
    samples = (1.1 * np.sin(2.0 * np.pi * 16_000.0 * time))[:, None]
    source = _write(tmp_path / "intersample.wav", samples, sample_rate)
    measured = _ffmpeg_level_metrics(source)

    assert measured is not None
    sample_peak_db = 20.0 * np.log10(float(np.max(np.abs(samples))))
    assert sample_peak_db < 0.0
    assert measured["true_peak_db"] > 0.0


def test_music_fails_closed_when_verified_meter_is_unavailable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    sample_rate = 48_000
    source = _write(tmp_path / "meter-required.wav", np.zeros((sample_rate, 1)), sample_rate)
    monkeypatch.setattr(processor, "_ffmpeg_level_metrics", lambda path, loop=False: None)

    with pytest.raises(AudioProcessingError, match="imageio-ffmpeg ebur128 meter"):
        process_audio(source, tmp_path / "candidate", "loop", "music_loop", {})


def test_long_music_encodes_complete_vorbis_and_preserves_source(tmp_path: Path) -> None:
    # Short fixtures did not reveal the native Vorbis failure on long audio.
    rate = 44100
    t = np.arange(rate * 60) / rate
    samples = np.stack([.1 * np.sin(2 * np.pi * 220 * t), .1 * np.sin(2 * np.pi * 330 * t)], axis=1)
    source = _write(tmp_path / "long.wav", samples, rate)
    result = process_audio(source, tmp_path / "long-loop", "loop", "music_loop", {"end_seconds": 60, "crossfade_ms": 2000})
    info = sf.info(result["outputs"]["export_ogg"])
    assert info.subtype == "VORBIS"
    assert info.duration == pytest.approx(58, abs=.01)
    assert sf.info(source).duration == 60
    assert result["recipe"]["true_peak"]["codec_verified"]
