"""Explicit, network-enabled Stable Audio 3 checkpoint preparation.

This script is intentionally separate from :mod:`audio_studio.models`.  The
runtime adapter forces offline mode; this setup command is the one place where a
user may download gated model artifacts after reviewing access and license terms.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any


DEFAULT_MODELS = ("medium", "small-sfx")
TEXT_ENCODER_REPO = "google/t5gemma-b-b-ul2"
MODEL_FILES = ["model_config.json", "model.safetensors", "LICENSE.md", "LICENSE_GEMMA.md", "NOTICE", "README.md"]


def lock_directory(destination: Path, lock_path: Path) -> str:
    """Use portable relative paths where possible, absolute paths across drives."""
    try:
        return os.path.relpath(destination, lock_path.parent).replace(os.sep, "/")
    except ValueError:
        return destination.as_posix()


def validate_model_root(studio_root: Path, model_root: Path) -> None:
    """Keep explicitly configured downloads out of game/build inputs."""
    repository = studio_root.resolve().parents[1]
    destination = model_root.resolve()
    reserved = [repository / name for name in ("public", "src", "dist", ".git", "node_modules")]
    reserved.append(studio_root / "catalog")
    if any(destination.is_relative_to(p.resolve()) or p.resolve().is_relative_to(destination) for p in reserved):
        raise ValueError("Model files must stay outside game assets, source, build, catalog and repository ancestors")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def resolve_source_commit(lock: dict[str, Any], refresh: bool) -> str:
    current = lock.get("upstream", {}).get("resolved_commit")
    if current and not refresh:
        return str(current)
    output = subprocess.run(
        ["git", "ls-remote", "https://github.com/Stability-AI/stable-audio-3.git", "refs/heads/main"],
        check=True,
        capture_output=True,
        text=True,
        timeout=30,
    ).stdout.split()
    if not output:
        raise RuntimeError("git ls-remote returned no stable-audio-3 main commit")
    return output[0]


def download_snapshot(
    *,
    snapshot_download,
    model_info,
    repo_id: str,
    destination: Path,
    requested_revision: str | None,
    allow_patterns: list[str] | None = None,
    http_chunks: bool = False,
    local_weights: bool = False,
) -> tuple[str, Path]:
    revision = requested_revision or "main"
    resolved_revision = model_info(repo_id=repo_id, revision=revision).sha
    destination.mkdir(parents=True, exist_ok=True)
    if http_chunks or local_weights:
        from huggingface_hub import hf_hub_download, get_hf_file_metadata, hf_hub_url
        from http_download import download_ranges
        info = model_info(repo_id=repo_id, revision=resolved_revision, files_metadata=True)
        for item in info.siblings:
            if allow_patterns is not None and item.rfilename not in allow_patterns:
                continue
            target = (destination / item.rfilename).resolve()
            if not target.is_relative_to(destination.resolve()):
                raise ValueError("Unsafe model repository filename")
            if local_weights and item.rfilename.endswith(".safetensors"):
                metadata = get_hf_file_metadata(hf_hub_url(repo_id, item.rfilename, revision=resolved_revision), token=True)
                if not target.is_file() or target.stat().st_size != metadata.size or sha256(target) != metadata.etag:
                    raise ValueError(f"Expected manually downloaded, SHA-256-matching weights at {target}; no weights were downloaded")
                continue
            if (item.size or 0) < 16 * 1024**2:
                hf_hub_download(repo_id, item.rfilename, revision=resolved_revision, local_dir=str(destination))
                continue
            metadata = get_hf_file_metadata(hf_hub_url(repo_id, item.rfilename, revision=resolved_revision), token=True)
            if target.is_file() and target.stat().st_size == metadata.size and sha256(target) == metadata.etag:
                continue
            download_ranges(metadata.location, target, metadata.size, metadata.etag)
        return resolved_revision, destination
    path = Path(
        snapshot_download(
            repo_id=repo_id,
            revision=resolved_revision,
            local_dir=str(destination),
            allow_patterns=allow_patterns,
        )
    )
    return resolved_revision, path


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Download and lock local Stable Audio 3 artifacts")
    script_root = Path(__file__).resolve().parents[1]
    parser.add_argument("--lock", type=Path, default=script_root / "catalog" / "model-lock.json")
    parser.add_argument("--model-root", type=Path, default=script_root / "models" / "weights")
    parser.add_argument("--refresh-source", action="store_true", help="Resolve the current upstream main commit")
    parser.add_argument("--acknowledge-license", action="store_true")
    parser.add_argument("--model", choices=["all", *DEFAULT_MODELS], default="all")
    parser.add_argument("--http-chunks", action="store_true", help="Use SHA-256-checked resumable HTTP ranges for large files")
    parser.add_argument("--local-weights", action="store_true", help="Verify manually placed safetensors; only supporting files may download")
    args = parser.parse_args(argv)

    lock_path = args.lock.resolve()
    model_root = args.model_root.resolve()
    selected_models = DEFAULT_MODELS if args.model == "all" else (args.model,)
    validate_model_root(script_root, model_root)
    lock = json.loads(lock_path.read_text(encoding="utf-8"))
    source_commit = resolve_source_commit(lock, args.refresh_source)

    # Setup is the deliberate network boundary.  Do not inherit the adapter's
    # offline settings when a caller runs this script in the same process.
    os.environ["HF_HUB_OFFLINE"] = "0"
    os.environ["TRANSFORMERS_OFFLINE"] = "0"
    try:
        from huggingface_hub import model_info, snapshot_download
    except ImportError as exc:
        raise SystemExit(
            "huggingface-hub is missing. Install model dependencies first with uv pip."
        ) from exc

    models = lock.setdefault("models", {})
    # Check access to actual gated files, not just public model-card metadata,
    # before starting any large downloads. Never print credentials on failure.
    from huggingface_hub import get_hf_file_metadata, hf_hub_url
    selected = [(models[name]["repo_id"], models[name].get("revision"), MODEL_FILES) for name in selected_models]
    text_lock = lock.get("text_encoder", {})
    selected.append((text_lock.get("repo_id", TEXT_ENCODER_REPO), text_lock.get("revision"), None))
    required_bytes = 0
    for repo_id, revision, patterns in selected:
        info = model_info(repo_id=repo_id, revision=revision or "main", files_metadata=True)
        filename = "model_config.json" if patterns else "config.json"
        get_hf_file_metadata(hf_hub_url(repo_id, filename, revision=info.sha), token=True)
        required_bytes += sum((item.size or 0) for item in info.siblings
                              if (patterns is None or item.rfilename in patterns)
                              and not (args.local_weights and item.rfilename.endswith(".safetensors")))
    existing_parent = model_root
    while not existing_parent.exists():
        existing_parent = existing_parent.parent
    # Conservative: include space for a fresh copy on resumed setups as well.
    reserve = 2 * 1024**3
    free_bytes = shutil.disk_usage(existing_parent).free
    if free_bytes < required_bytes + reserve:
        raise RuntimeError(f"Model destination needs {required_bytes + reserve:,} free bytes including reserve; available: {free_bytes:,}. Select a larger --model-root.")
    print(json.dumps({"selected_models": list(selected_models), "model_root": str(model_root), "download_bytes_upper_bound": required_bytes}), flush=True)
    for model_name in selected_models:
        model = models[model_name]
        revision, snapshot = download_snapshot(
            snapshot_download=snapshot_download,
            model_info=model_info,
            repo_id=model["repo_id"],
            destination=model_root / model_name,
            requested_revision=model.get("revision"),
            allow_patterns=MODEL_FILES,
            http_chunks=args.http_chunks,
            local_weights=args.local_weights,
        )
        config = snapshot / model["files"]["config"]
        checkpoint = snapshot / model["files"]["checkpoint"]
        if not config.is_file() or not checkpoint.is_file():
            raise RuntimeError(
                f"{model_name}: expected model_config.json and model.safetensors under {snapshot}"
            )
        model["revision"] = revision
        model["local_dir"] = lock_directory(model_root / model_name, lock_path)
        model["files"]["config_sha256"] = sha256(config)
        model["files"]["checkpoint_sha256"] = sha256(checkpoint)

    text = lock.setdefault("text_encoder", {
        "repo_id": TEXT_ENCODER_REPO,
        "revision": None,
        "local_dir": None,
    })
    text_revision, text_snapshot = download_snapshot(
        snapshot_download=snapshot_download,
        model_info=model_info,
        repo_id=text["repo_id"],
        destination=model_root / "text-encoder",
        requested_revision=text.get("revision"),
        http_chunks=args.http_chunks,
        local_weights=args.local_weights,
    )
    text["revision"] = text_revision
    text["local_dir"] = lock_directory(model_root / "text-encoder", lock_path)
    text["snapshot_files"] = sum(1 for path in text_snapshot.rglob("*") if path.is_file())

    upstream = lock.setdefault("upstream", {})
    upstream["resolved_commit"] = source_commit
    if args.acknowledge_license:
        from datetime import datetime, timezone

        license_data = lock.setdefault("license", {})
        license_data["acknowledged"] = True
        license_data["acknowledged_at"] = datetime.now(timezone.utc).isoformat()
        license_data["acknowledged_by"] = os.environ.get("USERNAME") or os.environ.get("USER") or "local-user"
    lock_path.write_text(json.dumps(lock, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"lock": str(lock_path), "source_commit": source_commit, "models": list(selected_models)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
