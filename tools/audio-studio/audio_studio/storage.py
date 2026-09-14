"""Shared atomic JSON storage and repository-wide writer coordination."""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from filelock import FileLock


class Conflict(ValueError):
    """A reviewed snapshot is no longer current."""


def sha256(path: Path) -> str | None:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def read_json(path: Path, default: Any = None) -> Any:
    # Windows can briefly deny opening a file during atomic replacement or
    # external scanning. Retry reads only; never turn denied access into an
    # empty catalog/history, which could subsequently overwrite real data.
    for attempt in range(5):
        try:
            payload = path.read_text(encoding="utf-8-sig")
        except FileNotFoundError:
            return default
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.025 * 2**attempt)
        else:
            return json.loads(payload)


def atomic_json(path: Path, value: Any, *, expected: str | None = None, check: bool = False):
    payload = (json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n").encode("utf-8")
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        # Readers/scanners can briefly hold the destination open on Windows.
        # Keep the fully flushed temporary file and the old destination intact;
        # never fall back to truncating or deleting the destination.
        for attempt in range(9):
            try:
                # Recheck after every wait so retries cannot bypass a newer edit.
                if check and sha256(path) != expected:
                    raise Conflict(f"Concurrent edit: {path.name}. Refresh before saving.")
                os.replace(temporary, path)
                break
            except PermissionError:
                if attempt == 8:
                    raise
                time.sleep(min(0.025 * 2**attempt, 0.25))
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def safe_id(value: str) -> str:
    if not re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", value):
        raise ValueError("Invalid identifier")
    return value


def within(root: Path, relative: str | Path) -> Path:
    root = root.resolve()
    candidate = (root / relative).resolve()
    if not candidate.is_relative_to(root) or candidate == root:
        raise ValueError("Path must remain inside its declared workspace")
    return candidate


class Store:
    def __init__(self, tool: Path, workspace: Path):
        self.tool = tool.resolve()
        self.workspace = workspace.resolve()
        self.catalog_path = self.tool / "catalog" / "sounds.json"
        self.lock = FileLock(str(self.tool / ".studio.lock"), timeout=10)

    @contextmanager
    def writing(self):
        with self.lock:
            yield

    def path(self, relative: str | Path) -> Path:
        return within(self.workspace, relative)

    def save(self, relative: str, data: Any):
        with self.writing():
            atomic_json(self.path(relative), data)
