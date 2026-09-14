"""Tool 1 and Studio share this authoring schema and non-destructive sync."""
from __future__ import annotations

import copy
import math
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .storage import Conflict, Store, atomic_json, read_json, safe_id, sha256
from .generators import registered_model_names


MODEL_NAMES = registered_model_names()


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Prompt(Strict):
    text: str = Field(default="", max_length=8000)
    source: str = "manual"
    preserve_on_sync: Literal[True] = True


class Generation(Strict):
    model: str = Field(default="medium", json_schema_extra={"enum": list(MODEL_NAMES)})
    duration_seconds: int = Field(default=2, ge=1, le=47)
    candidate_count: int = Field(default=4, ge=1, le=32)
    steps: int = Field(default=8, ge=1, le=100)
    cfg_scale: float = Field(default=1, ge=0, le=20)

    @field_validator("model")
    @classmethod
    def registered_model(cls, value):
        if value not in MODEL_NAMES:
            raise ValueError(f"Unknown generation model: {value}")
        return value

    @field_validator("duration_seconds", mode="before")
    @classmethod
    def whole_seconds(cls, value):
        """Accept JSON integers and integral numeric values, never fractions."""
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise ValueError("duration_seconds must be a positive whole number of seconds")
        try:
            number = float(value)
        except (TypeError, ValueError, OverflowError) as exc:
            raise ValueError("duration_seconds must be a positive whole number of seconds") from exc
        if not math.isfinite(number) or number <= 0 or not number.is_integer():
            raise ValueError("duration_seconds must be a positive whole number of seconds")
        return int(number)


class Processing(Strict):
    profile: Literal["weapon_shot", "impact", "explosion", "continuous_texture", "gentle"] = "gentle"
    overrides: dict[str, Any] = Field(default_factory=dict)

    @field_validator("overrides")
    @classmethod
    def valid_overrides(cls, value):
        from .processor import validate_overrides
        return validate_overrides(value)


class CopyNotice(Strict):
    id: str
    source_path: str
    source_keys: list[str] = Field(default_factory=list)
    target_path: str
    file_hash: str
    reason: str
    hidden: bool = False


class Entry(Strict):
    name: str = ""
    category: str = "event"
    intent: str = ""
    playback: Literal["oneshot", "loop", "unknown"] = "unknown"
    prompt: Prompt = Field(default_factory=Prompt)
    generation_defaults: Generation = Field(default_factory=Generation)
    processing: Processing = Field(default_factory=Processing)
    notes: str = ""
    needs_revision: bool = False
    copy_notice: CopyNotice | None = None
    suggested_changes: list[dict[str, Any]] = Field(default_factory=list)
    repository: dict[str, Any] = Field(default_factory=dict)
    orphaned: bool = False


class Catalog(Strict):
    schema_version: Literal[1] = 1
    entries: dict[str, Entry] = Field(default_factory=dict)

    @field_validator("entries")
    @classmethod
    def valid_keys(cls, entries):
        for key in entries:
            safe_id(key)
        return entries


AUTHOR_FIELDS = {"name", "category", "intent", "playback", "prompt", "generation_defaults", "processing", "notes", "needs_revision"}


class CatalogService:
    def __init__(self, store: Store, repository):
        self.store, self.repository = store, repository

    def read(self):
        raw = read_json(self.store.catalog_path, {"schema_version": 1, "entries": {}})
        catalog = Catalog.model_validate(raw).model_dump()
        return {"catalog": catalog, "revision": sha256(self.store.catalog_path)}

    def _commit(self, data, expected):
        validated = Catalog.model_validate(data).model_dump()
        atomic_json(self.store.catalog_path, validated, expected=expected, check=True)
        return self.read()

    def sync(self):
        with self.store.writing():
            state = self.read()
            data = state["catalog"]
            scan = self.repository.scan()
            for key, facts in scan["entries"].items():
                new = key not in data["entries"]
                if new:
                    data["entries"][key] = Entry(name=key).model_dump()
                entry = data["entries"][key]
                previous = entry["repository"]
                # Only factual snapshots are replaced. Authors decide playback and recipes.
                material = ("target_path", "usages", "playback", "shared_keys")
                if previous and any(previous.get(k) != facts.get(k) for k in material):
                    suggestion = {"kind": "repository_changed", "facts": {k: facts.get(k) for k in material}}
                    if suggestion not in entry["suggested_changes"]:
                        entry["suggested_changes"].append(suggestion)
                entry["repository"] = facts
                entry["orphaned"] = False
            for key, entry in data["entries"].items():
                if key not in scan["entries"]:
                    entry["orphaned"] = True
            for migration in sorted((self.store.tool / "catalog" / "migrations").glob("*.json")):
                record = read_json(migration)
                # Provenance is operation identity, never inferred from equal current hashes.
                for notice in record.get("copies", []):
                    key = notice["target_key"]
                    if key not in data["entries"]:
                        continue
                    entry = data["entries"][key]
                    if entry["copy_notice"] is None:
                        entry["copy_notice"] = CopyNotice(
                            id=notice["id"], source_path=notice["source_path"],
                            source_keys=notice.get("source_keys", []), target_path=notice["target_path"],
                            file_hash=notice["file_hash"], reason=notice["reason"],
                        ).model_dump()
            return self._commit(data, state["revision"])

    def edit(self, key: str, patch: dict, expected: str, *, propose: bool = False):
        if set(patch) - AUTHOR_FIELDS:
            raise ValueError("Only authoring fields can be edited; targets come from the game")
        with self.store.writing():
            state = self.read()
            if state["revision"] != expected:
                raise Conflict("Catalog changed. Refresh before saving your edit.")
            entry = state["catalog"]["entries"][key]
            candidate = {**copy.deepcopy(entry), **patch}
            Entry.model_validate(candidate)
            if propose:
                proposal = {"kind": "author_proposal", "patch": patch}
                if proposal not in entry["suggested_changes"]:
                    entry["suggested_changes"].append(proposal)
            else:
                entry.update(patch)
            return self._commit(state["catalog"], expected)

    def hide_notice(self, key: str, expected: str):
        with self.store.writing():
            state = self.read()
            if state["revision"] != expected:
                raise Conflict("Catalog changed. Refresh first.")
            notice = state["catalog"]["entries"][key]["copy_notice"]
            if notice:
                notice["hidden"] = True
            return self._commit(state["catalog"], expected)
