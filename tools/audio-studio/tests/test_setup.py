import importlib.util
import hashlib
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest


@pytest.fixture
def setup_module():
    script = Path(__file__).resolve().parents[1] / "scripts/setup_models.py"
    spec = importlib.util.spec_from_file_location("model_setup", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_model_setup_rejects_game_directories_before_any_download(tmp_path, setup_module):
    module = setup_module
    root = tmp_path / "game"
    studio = root / "tools/audio-studio"
    for destination in (root, root / "public/models", root / "dist", studio / "catalog", root / "src/models"):
        with pytest.raises(ValueError):
            module.validate_model_root(studio, destination)
        assert not destination.exists()
    module.validate_model_root(studio, studio / "models")
    module.validate_model_root(studio, tmp_path / "external-models")


def test_lock_directory_supports_another_windows_drive(monkeypatch, setup_module):
    destination = Path("models").resolve()
    def different_drive(*args):
        raise ValueError("path is on mount E:, start on mount C:")
    monkeypatch.setattr(setup_module.os.path, "relpath", different_drive)
    assert setup_module.lock_directory(destination, Path("catalog/model-lock.json")) == destination.as_posix()


@pytest.mark.parametrize("blocked", [False, True])
def test_selected_setup_checks_access_before_download_and_shares_encoder(tmp_path, monkeypatch, setup_module, blocked):
    template = Path(__file__).resolve().parents[1] / "catalog/model-lock.json"
    original = json.loads(template.read_text(encoding="utf-8"))
    lock_path = tmp_path / "model-lock.json"
    lock_path.write_text(json.dumps(original), encoding="utf-8")
    downloads = []
    def info(**kwargs):
        return SimpleNamespace(sha="locked-revision", siblings=[SimpleNamespace(rfilename="model.safetensors", size=100)])
    def access(url, **kwargs):
        if blocked and url == setup_module.TEXT_ENCODER_REPO:
            raise PermissionError("encoder access not granted")
    def snapshot(**kwargs):
        downloads.append(kwargs)
        destination = Path(kwargs["local_dir"])
        destination.mkdir(parents=True, exist_ok=True)
        for name in ("model_config.json", "model.safetensors"):
            (destination / name).write_bytes(b"fixture")
        return str(destination)
    monkeypatch.setitem(sys.modules, "huggingface_hub", SimpleNamespace(
        model_info=info, snapshot_download=snapshot,
        hf_hub_url=lambda repo_id, *args, **kwargs: repo_id,
        get_hf_file_metadata=access,
    ))
    monkeypatch.setattr(setup_module.shutil, "disk_usage", lambda path: SimpleNamespace(free=10**12))
    args = ["--model", "small-sfx", "--lock", str(lock_path), "--model-root", str(tmp_path / "weights")]
    if blocked:
        with pytest.raises(PermissionError):
            setup_module.main(args)
        assert downloads == []
        assert json.loads(lock_path.read_text()) == original
    else:
        assert setup_module.main(args) == 0
        assert [entry["repo_id"] for entry in downloads] == [original["models"]["small-sfx"]["repo_id"], setup_module.TEXT_ENCODER_REPO]
        assert "model.safetensors" in downloads[0]["allow_patterns"]
        assert not any("t5gemma/" in pattern or "*" in pattern for pattern in downloads[0]["allow_patterns"])
        updated = json.loads(lock_path.read_text())
        assert updated["models"]["medium"] == original["models"]["medium"]
        assert updated["models"]["small-sfx"]["revision"] == "locked-revision"


@pytest.mark.parametrize("valid", [True, False])
def test_manual_weights_are_verified_without_downloading_replacements(tmp_path, monkeypatch, setup_module, valid):
    content = b"approved model weights"
    target = tmp_path / "model.safetensors"
    target.write_bytes(content if valid else b"wrong")
    info = lambda **kwargs: SimpleNamespace(sha="immutable", siblings=[SimpleNamespace(rfilename=target.name, size=len(content))])
    def forbidden(*args, **kwargs):
        pytest.fail("Manual weight verification must not download replacements")
    monkeypatch.syspath_prepend(str(Path(__file__).resolve().parents[1] / "scripts"))
    monkeypatch.setitem(sys.modules, "huggingface_hub", SimpleNamespace(
        hf_hub_download=forbidden,
        hf_hub_url=lambda *args, **kwargs: "https://provider/weights",
        get_hf_file_metadata=lambda *args, **kwargs: SimpleNamespace(size=len(content), etag=hashlib.sha256(content).hexdigest()),
    ))
    kwargs = dict(snapshot_download=forbidden, model_info=info, repo_id="model", destination=tmp_path, requested_revision="immutable", local_weights=True)
    if valid:
        assert setup_module.download_snapshot(**kwargs) == ("immutable", tmp_path)
    else:
        with pytest.raises(ValueError, match="manually downloaded"):
            setup_module.download_snapshot(**kwargs)
        assert target.read_bytes() == b"wrong"
