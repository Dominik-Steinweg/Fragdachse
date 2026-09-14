from __future__ import annotations

import importlib
import json
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

from audio_studio.models import (
    GenerationError,
    StableAudioBackend,
    UnsupportedModelError,
)


class _FakeInnerModel:
    sample_rate = 22_050


class _FakeLoadedModel:
    def __init__(self, calls: list[dict]):
        self.model = _FakeInnerModel()
        self.device = "cpu"
        self.calls = calls

    def generate(self, **kwargs):
        self.calls.append(kwargs)
        # The real Stable Audio contract is [B, C, T].
        return np.zeros((1, 2, 2_205), dtype=np.float32)


def test_generation_uses_official_contract_and_records_raw_metadata(tmp_path: Path):
    loaded_calls: list[dict] = []
    load_calls: list[str] = []

    def loader(name: str, **_kwargs):
        load_calls.append(name)
        return _FakeLoadedModel(loaded_calls)

    output = tmp_path / "raw.wav"
    backend = StableAudioBackend(model_loader=loader, license_acknowledged=True)
    metadata = backend.generate(
        "small-sfx",
        "a short dry mechanical click",
        1,
        17,
        output,
        {"steps": 4, "cfg_scale": 1.25},
    )

    assert load_calls == ["small-sfx"]
    assert loaded_calls == [
        {
            "prompt": "a short dry mechanical click",
            "duration": 1,
            "seed": 17,
            "steps": 4,
            "cfg_scale": 1.25,
            "batch_size": 1,
            "chunked_decode": True,
        }
    ]
    assert output.is_file()
    waveform, sample_rate = sf.read(output, always_2d=True)
    assert sample_rate == 22_050
    assert waveform.shape == (2_205, 2)
    assert metadata["model_id"] == "stabilityai/stable-audio-3-small-sfx"
    assert metadata["model_revision"] is None
    assert metadata["sample_rate"] == 22_050
    assert metadata["arguments"]["seed"] == 17
    assert metadata["raw_output"]["sha256"]
    assert metadata["raw_output"]["path"] == str(output)


@pytest.mark.parametrize("model_name,requested", [
    ("small-sfx", 1), ("small-sfx", 2.0), ("small-sfx", 120),
    ("medium", 2), ("medium", 380.0),
])
def test_whole_second_conditioning_preserves_request_and_complete_raw(tmp_path, model_name, requested):
    calls = []

    class DurationModel(_FakeLoadedModel):
        def generate(self, **kwargs):
            calls.append(kwargs)
            # A nonzero tail proves the adapter does not crop to the shorter request.
            return np.full((1, 1, int(kwargs["duration"] * self.model.sample_rate)), 0.125, dtype=np.float32)

    backend = StableAudioBackend(model_loader=lambda name: DurationModel(calls), license_acknowledged=True)
    output = tmp_path / "raw.wav"
    metadata = backend.generate(model_name, "bite", requested, 1838078139, output)
    assert calls[0]["duration"] == int(requested)
    assert metadata["arguments"]["duration_seconds"] == requested
    assert metadata["actual_arguments"]["duration"] == int(requested)
    assert metadata["duration_policy"] == "whole_seconds_only"
    waveform, sample_rate = sf.read(output)
    assert len(waveform) == int(requested) * sample_rate
    assert np.all(waveform == 0.125)
    assert metadata["raw_output"]["duration_seconds"] == int(requested)


@pytest.mark.parametrize("duration", [0.1, 1.5, 2.1, 120.1, "2", True])
def test_fractional_or_coerced_duration_is_rejected_before_loading(tmp_path, duration):
    def loader(name):
        pytest.fail("Invalid duration must fail before loading a model")

    backend = StableAudioBackend(model_loader=loader, license_acknowledged=True)
    with pytest.raises(GenerationError, match="whole number"):
        backend.generate("small-sfx", "bite", duration, 1, tmp_path / "raw.wav")


def test_sampler_callback_reports_json_safe_progress_without_metadata(tmp_path):
    events = []

    class ProgressModel(_FakeLoadedModel):
        def generate(self, **kwargs):
            callback = kwargs["callback"]
            callback({"i": 0, "t": object()})
            callback({"i": 3, "t": object()})
            return np.zeros((1, 1, 2_205), dtype=np.float32)

    backend = StableAudioBackend(
        model_loader=lambda _name: ProgressModel([]), license_acknowledged=True
    )
    metadata = backend.generate(
        "small-sfx", "click", 1, 1, tmp_path / "raw.wav",
        {"steps": 4}, progress_callback=events.append,
    )
    assert events == [
        {"stage": "sampling", "completed_steps": 1, "total_steps": 4, "fraction": 0.25},
        {"stage": "sampling", "completed_steps": 4, "total_steps": 4, "fraction": 1.0},
    ]
    assert "callback" not in metadata["arguments"]["parameters"]
    assert "callback" not in metadata["actual_arguments"]


def test_model_is_persistent_and_switching_keeps_one_loaded(tmp_path: Path):
    loaded: dict[str, _FakeLoadedModel] = {}
    load_calls: list[str] = []

    def loader(name: str, **_kwargs):
        load_calls.append(name)
        loaded[name] = _FakeLoadedModel([])
        return loaded[name]

    backend = StableAudioBackend(model_loader=loader, license_acknowledged=True)
    backend.load("small-sfx")
    first = backend.load("small-sfx")
    assert first is backend.load("small-sfx")
    backend.load("medium")
    assert load_calls == ["small-sfx", "medium"]
    assert backend.loaded_model_name == "medium"
    backend.unload()
    assert backend.loaded_model_name is None
    assert not backend.is_loaded


def test_generation_rejects_unsupported_parameter_and_shape(tmp_path: Path):
    backend = StableAudioBackend(model_loader=lambda name: _FakeLoadedModel([]), license_acknowledged=True)
    with pytest.raises(GenerationError, match="Unsupported generation parameter"):
        backend.generate(
            "small-sfx",
            "click",
            1,
            1,
            tmp_path / "raw.wav",
            {"revision": "main"},
        )

    with pytest.raises(UnsupportedModelError, match="only medium, small-sfx"):
        backend.generate("small-music", "music", 1, 1, tmp_path / "raw.wav")


def test_sample_rate_must_come_from_official_inner_model(tmp_path: Path):
    class NoRate:
        model = object()

        def generate(self, **_kwargs):
            return np.zeros((1, 1, 20), dtype=np.float32)

    backend = StableAudioBackend(model_loader=lambda _name: NoRate(), license_acknowledged=True)
    with pytest.raises(GenerationError, match="model.model.sample_rate"):
        backend.generate("small-sfx", "click", 1, 1, tmp_path / "raw.wav")


def test_generation_never_overwrites_an_existing_raw_file(tmp_path: Path):
    output = tmp_path / "raw.wav"
    output.write_bytes(b"existing raw")
    backend = StableAudioBackend(model_loader=lambda _name: _FakeLoadedModel([]), license_acknowledged=True)
    with pytest.raises(GenerationError, match="Refusing to overwrite"):
        backend.generate("small-sfx", "click", 1, 1, output)
    assert output.read_bytes() == b"existing raw"


def test_default_backend_requires_explicit_license_acknowledgement(tmp_path):
    from audio_studio.models import LicenseNotAcknowledgedError

    lock = tmp_path / "model-lock.json"
    lock.write_text(json.dumps({"license": {"acknowledged": False}}))
    backend = StableAudioBackend(lock_path=lock, model_loader=lambda _name: _FakeLoadedModel([]))
    with pytest.raises(LicenseNotAcknowledgedError, match="not been acknowledged"):
        backend.load("small-sfx")


def test_doctor_does_not_report_ready_from_weights_without_runtime(monkeypatch):
    from audio_studio import models
    backend = StableAudioBackend(license_acknowledged=True)
    monkeypatch.setattr(backend, "_artifact_status", lambda name: {"available": True})
    monkeypatch.setattr(backend, "_text_encoder_status", lambda: {"available": True})
    monkeypatch.setattr(models.importlib.util, "find_spec", lambda name: None)
    monkeypatch.setattr(models, "_package_version", lambda name: None)
    monkeypatch.setattr(models.shutil, "which", lambda name: None)
    result = backend.doctor()
    assert result["ok"] is False
    assert result["feasible"] == {"medium": False, "small-sfx": False}


def test_direct_locked_artifacts_are_hash_checked(tmp_path: Path):
    model_dir = tmp_path / "small-sfx"
    model_dir.mkdir()
    config = model_dir / "model_config.json"
    checkpoint = model_dir / "model.safetensors"
    config.write_text("{}", encoding="utf-8")
    checkpoint.write_bytes(b"checkpoint")
    import hashlib

    lock = {
        "schema_version": 1,
        "models": {
            "medium": {"files": {}, "local_dir": None},
            "small-sfx": {
                "local_dir": str(model_dir),
                "revision": "abc123",
                "files": {
                    "config": "model_config.json",
                    "checkpoint": "model.safetensors",
                    "config_sha256": hashlib.sha256(config.read_bytes()).hexdigest(),
                    "checkpoint_sha256": hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
                },
            },
        },
    }
    lock_path = tmp_path / "model-lock.json"
    lock_path.write_text(json.dumps(lock), encoding="utf-8")
    backend = StableAudioBackend(lock_path=lock_path, model_root=tmp_path)
    files, revision, _ = backend._resolve_artifacts("small-sfx")
    assert files["config"] == config
    assert revision == "abc123"


@pytest.mark.parametrize("encoder_reference", [
    {"model_name": "google/t5gemma-b-b-ul2"},
    {"repo_id": "stabilityai/stable-audio-3-small-sfx", "subfolder": "t5gemma-b-b-ul2"},
])
def test_local_text_encoder_is_injected_via_ephemeral_config(tmp_path: Path, encoder_reference):
    text_encoder = tmp_path / "text-encoder"
    text_encoder.mkdir()
    config = tmp_path / "model_config.json"
    config.write_text(
        json.dumps({"model": {"conditioning": {"configs": [{
            "type": "t5gemma", "config": encoder_reference
        }]}}}),
        encoding="utf-8",
    )
    lock = {
        "models": {"medium": {}, "small-sfx": {}},
        "text_encoder": {"repo_id": "google/t5gemma-b-b-ul2", "local_dir": str(text_encoder)},
    }
    lock_path = tmp_path / "model-lock.json"
    lock_path.write_text(json.dumps(lock), encoding="utf-8")
    backend = StableAudioBackend(lock_path=lock_path, license_acknowledged=True)
    prepared = backend._prepare_local_conditioner_config(config)
    payload = json.loads(prepared.read_text(encoding="utf-8"))
    assert payload["model"]["conditioning"]["configs"][0]["config"]["model_path"] == str(text_encoder)
    actual = payload["model"]["conditioning"]["configs"][0]["config"]
    assert "repo_id" not in actual and "subfolder" not in actual
    assert json.loads(config.read_text())["model"]["conditioning"]["configs"][0]["config"] == encoder_reference
    assert prepared != config
    backend.unload()
    assert not prepared.exists()
