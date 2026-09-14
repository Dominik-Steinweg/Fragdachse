"""The only Python port to game configuration and game writes."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path


class Repository:
    def __init__(self, root: Path, tool: Path):
        self.root = root.resolve()
        self.adapter = tool / "adapter" / "index.mjs"

    def call(self, command: str, **payload):
        result = subprocess.run(
            ["node", str(self.adapter)],
            input=json.dumps({"command": command, "root": str(self.root), **payload}),
            text=True, encoding="utf-8", capture_output=True, timeout=120,
            cwd=self.adapter.parent,
        )
        if result.returncode:
            raise ValueError(result.stderr.strip() or result.stdout.strip() or "Repository adapter failed")
        value = json.loads(result.stdout)
        if isinstance(value, dict) and value.get("error"):
            raise ValueError(str(value["error"]))
        return value

    def scan(self):
        return self.call("scan")

