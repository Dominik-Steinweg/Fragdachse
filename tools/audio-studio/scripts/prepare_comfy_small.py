"""Make the verified existing Small-SFX checkpoint available to native ComfyUI.

Copies bytes only: no download, conversion, environment install or server restart.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile


TOOL = Path(__file__).resolve().parents[1]
FILENAME = "stable_audio_3_small_sfx.safetensors"


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def copy_checkpoint(source: Path, destination: Path, expected: str):
    if not source.is_file():
        raise ValueError(f"Vorhandener Small-SFX-Checkpoint fehlt: {source}")
    if digest(source) != expected:
        raise ValueError("Small-SFX-Checkpoint stimmt nicht mit catalog/model-lock.json überein.")
    if destination.exists():
        if digest(destination) != expected:
            raise ValueError(f"Eine andere Datei liegt bereits am ComfyUI-Ziel; sie wird nicht ersetzt: {destination}")
        return "already_verified"
    destination.parent.mkdir(parents=True, exist_ok=True)
    if shutil.disk_usage(destination.parent).free < source.stat().st_size + 256 * 1024**2:
        raise ValueError("Zu wenig freier Speicher für die ComfyUI-Checkpoint-Kopie.")
    fd, name = tempfile.mkstemp(prefix=".small-sfx-", suffix=".partial", dir=destination.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        shutil.copyfile(source, temporary)
        if digest(temporary) != expected:
            raise ValueError("Prüfsumme der ComfyUI-Kopie stimmt nicht überein.")
        # Atomic, no overwrite even if another installer created the target.
        os.link(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)
    return "copied_and_verified"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--comfy-models", type=Path, required=True, help="Existing ComfyUI models directory")
    args = parser.parse_args()
    model_root = args.comfy_models.resolve()
    if not model_root.is_dir():
        raise ValueError("Den vorhandenen ComfyUI-Modellordner angeben.")
    if model_root.is_relative_to(TOOL.parents[1]):
        raise ValueError("ComfyUI-Gewichte müssen außerhalb des Spiel-Repositories liegen.")
    lock = json.loads((TOOL / "catalog/model-lock.json").read_text(encoding="utf-8-sig"))
    entry = lock["models"]["small-sfx"]
    source = Path(entry["local_dir"]) / entry["files"]["checkpoint"]
    expected = entry["files"]["checkpoint_sha256"]
    destination = model_root / "checkpoints" / FILENAME
    status = copy_checkpoint(source, destination, expected)
    print(json.dumps({"status": status, "source": str(source), "destination": str(destination), "sha256": expected}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
