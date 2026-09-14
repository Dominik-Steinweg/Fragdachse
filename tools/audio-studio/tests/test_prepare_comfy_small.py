import hashlib
import importlib.util
from pathlib import Path

import pytest


spec = importlib.util.spec_from_file_location("prepare_comfy_small", Path(__file__).resolve().parents[1] / "scripts/prepare_comfy_small.py")
preparation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(preparation)


def test_copy_keeps_source_and_is_idempotent_without_replacing_existing_weights(tmp_path):
    source = tmp_path / "source.safetensors"
    source.write_bytes(b"synthetic checkpoint bytes")
    expected = hashlib.sha256(source.read_bytes()).hexdigest()
    destination = tmp_path / "comfy" / "model.safetensors"
    assert preparation.copy_checkpoint(source, destination, expected) == "copied_and_verified"
    assert destination.read_bytes() == source.read_bytes()
    assert preparation.copy_checkpoint(source, destination, expected) == "already_verified"
    destination.write_bytes(b"someone else's weights")
    with pytest.raises(ValueError, match="nicht ersetzt"):
        preparation.copy_checkpoint(source, destination, expected)
    assert destination.read_bytes() == b"someone else's weights"
    assert source.read_bytes() == b"synthetic checkpoint bytes"


def test_unverified_source_is_rejected_before_copying(tmp_path):
    source = tmp_path / "source.safetensors"
    source.write_bytes(b"changed")
    destination = tmp_path / "model.safetensors"
    with pytest.raises(ValueError, match="model-lock"):
        preparation.copy_checkpoint(source, destination, "0" * 64)
    assert not destination.exists()
