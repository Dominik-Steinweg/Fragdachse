from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from audio_studio import AudioProcessingError, PROFILES, inspect_audio, process_audio, read_audio


def _write(path: Path, samples: np.ndarray, sample_rate: int = 48_000) -> Path:
    sf.write(path, np.asarray(samples, dtype=np.float64), sample_rate, format="WAV", subtype="FLOAT")
    return path


def test_profiles_are_serializable_and_read_inspection_is_compact(tmp_path: Path) -> None:
    source = _write(tmp_path / "source.wav", np.zeros((48_000, 2)))

    data, rate = read_audio(source)
    inspection = inspect_audio(source)

    assert data.shape == (48_000, 2)
    assert rate == 48_000
    assert inspection["finite"] is True
    assert inspection["channels"] == 2
    assert len(inspection["waveform_peaks"]) <= 128
    json.dumps(PROFILES, allow_nan=False)


def test_oneshot_keeps_early_attack_and_removes_silent_prelude(tmp_path: Path) -> None:
    sample_rate = 48_000
    samples = np.zeros((sample_rate, 1))
    onset = int(0.2 * sample_rate)
    attack = np.linspace(0.0, 0.6, int(0.004 * sample_rate), endpoint=True)
    samples[onset : onset + attack.size, 0] = attack
    tail = np.exp(-np.arange(int(0.15 * sample_rate)) / (sample_rate * 0.035)) * 0.35
    samples[onset + attack.size : onset + attack.size + tail.size, 0] = tail
    source = _write(tmp_path / "source.wav", samples, sample_rate)

    result = process_audio(source, tmp_path / "candidate", "oneshot", "weapon_shot", {})
    cuts = result["recipe"]["cuts"]
    processed, rate = read_audio(Path(result["outputs"]["processed_wav"]))

    assert rate == sample_rate
    assert 0.19 <= cuts["start_seconds"] <= 0.2
    assert cuts["end_seconds"] > 0.25
    # A real micro-fade is permitted at the file edge, but the attack peak must
    # survive instead of being trimmed to the first high sample.
    assert float(np.max(np.abs(processed))) > 0.3


def test_oneshot_handles_low_noise_prelude_without_waiting_for_peak(tmp_path: Path) -> None:
    sample_rate = 48_000
    rng = np.random.default_rng(7)
    samples = rng.normal(0.0, 0.002, (sample_rate, 1))
    onset = int(0.22 * sample_rate)
    attack = np.linspace(0.0, 0.45, int(0.003 * sample_rate), endpoint=True)
    samples[onset : onset + attack.size, 0] += attack
    source = _write(tmp_path / "noise.wav", samples, sample_rate)

    result = process_audio(source, tmp_path / "candidate", "oneshot", "weapon_shot", {})
    cuts = result["recipe"]["cuts"]

    assert cuts["detected_onset_seconds"] < 0.23
    assert cuts["start_seconds"] < 0.225


def test_oneshot_at_frame_zero_does_not_fade_away_the_attack(tmp_path: Path) -> None:
    sample_rate = 48_000
    samples = np.exp(-np.arange(sample_rate) / (sample_rate * 0.05))[:, None]
    source = _write(tmp_path / "early.wav", samples, sample_rate)

    result = process_audio(source, tmp_path / "candidate", "oneshot", "weapon_shot", {})
    processed, _ = read_audio(Path(result["outputs"]["processed_wav"]))

    assert result["recipe"]["fades"]["fade_in_ms"] == 0.0
    assert float(abs(processed[0, 0])) > 0.8
    assert any("aggressive cut" in warning for warning in result["analysis"]["warnings"])


def test_explicit_fade_in_honors_full_request_when_attack_starts_at_frame_zero(tmp_path: Path) -> None:
    sample_rate = 48_000
    samples = np.exp(-np.arange(sample_rate) / (sample_rate * 0.05))[:, None]
    source = _write(tmp_path / "early-explicit.wav", samples, sample_rate)

    result = process_audio(
        source,
        tmp_path / "candidate-explicit",
        "oneshot",
        "weapon_shot",
        {"fade_in_ms": 200},
    )
    processed, _ = read_audio(Path(result["outputs"]["processed_wav"]))

    assert result["recipe"]["fades"]["fade_in_ms"] == pytest.approx(200.0, abs=0.1)
    assert abs(processed[0, 0]) < 1.0e-9
    # At 100 ms the requested 200 ms linear fade is halfway through, so the
    # exponential source is visibly attenuated rather than left untouched.
    assert abs(processed[int(0.1 * sample_rate), 0]) < 0.08
    assert not any("attack" in warning for warning in result["analysis"]["warnings"])


def test_loop_auto_trim_selects_a_stable_region_from_longer_source(tmp_path: Path) -> None:
    sample_rate = 48_000
    time = np.arange(sample_rate * 3) / sample_rate
    samples = np.zeros((sample_rate * 3, 1))
    active = (0.3 * np.sin(2 * np.pi * 260 * time[: sample_rate * 2]))[:, None]
    samples[sample_rate // 2 : sample_rate // 2 + active.shape[0]] = active
    source = _write(tmp_path / "long-texture.wav", samples, sample_rate)

    result = process_audio(source, tmp_path / "candidate", "loop", "continuous_texture", {})
    cuts = result["recipe"]["cuts"]

    assert cuts["selection"] == "stable_segment"
    assert cuts["start_seconds"] > 0.5
    assert 0.75 <= cuts["end_seconds"] - cuts["start_seconds"] <= 1.1


def test_loop_uses_no_oneshot_fades_and_writes_three_pass_preview(tmp_path: Path) -> None:
    sample_rate = 48_000
    time = np.arange(sample_rate * 2) / sample_rate
    samples = (0.35 * np.sin(2 * np.pi * 330 * time))[:, None]
    source = _write(tmp_path / "texture.wav", samples, sample_rate)

    result = process_audio(
        source,
        tmp_path / "candidate",
        "loop",
        "continuous_texture",
        {"start_seconds": 0.2, "end_seconds": 1.2, "crossfade_ms": 25, "crossfade_curve": "equal_power"},
    )
    recipe = result["recipe"]
    preview_data, preview_rate = read_audio(Path(result["outputs"]["loop_preview_wav"]))
    exported = result["analysis"]["export"]

    assert recipe["fades"]["fade_in_ms"] == 0.0
    assert recipe["fades"]["fade_out_ms"] == 0.0
    assert recipe["fades"]["crossfade_curve"] == "equal_power"
    assert preview_rate == sample_rate
    assert preview_data.shape[0] == 3 * int(sample_rate)
    assert exported["seam"]["rms_ratio"] < 2.0
    assert exported["seam"]["sample_jump"] < 0.15


def test_processing_is_non_destructive_and_refuses_collisions(tmp_path: Path) -> None:
    source = _write(tmp_path / "source.wav", np.ones((4_800, 1)) * 0.1)
    source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
    output = tmp_path / "candidate"

    result = process_audio(source, output, "oneshot", "impact", {})
    assert hashlib.sha256(source.read_bytes()).hexdigest() == source_hash
    assert result["recipe"]["source"]["sha256"] == source_hash
    assert result["recipe"]["output_hashes"] == result["outputs"]["sha256"]
    assert result["outputs"]["raw"] == str(source)
    assert "raw.wav" not in result["outputs"]["sha256"]
    assert not (output / "raw.wav").exists()

    with pytest.raises(AudioProcessingError, match="overwrite"):
        process_audio(source, output, "oneshot", "impact", {})


@pytest.mark.parametrize(
    "overrides",
    [
        {"unknown": 1},
        {"output_gain_db": float("nan")},
        {"crossfade_curve": "squared"},
        {"start_seconds": 0.5, "end_seconds": 0.2},
    ],
)
def test_invalid_overrides_are_rejected(tmp_path: Path, overrides: dict[str, object]) -> None:
    source = _write(tmp_path / "source.wav", np.zeros((4_800, 1)))

    with pytest.raises(AudioProcessingError):
        process_audio(source, tmp_path / "candidate", "oneshot", "weapon_shot", overrides)
