"""Use cases shared by CLI and HTTP; all game mutation crosses Repository."""
from __future__ import annotations

import copy
import uuid
from pathlib import Path

import soundfile as sf

from .catalog import CatalogService, Entry, validate_production
from .jobs import Jobs, now
from .repository import Repository
from .storage import Conflict, Store, atomic_json, read_json, sha256, within


class Studio:
    def __init__(self, root: Path, tool: Path, workspace: Path, *, backend=None, repository=None):
        self.root, self.tool = root.resolve(), tool.resolve()
        workspace = workspace.resolve()
        if workspace == self.root or self.root.is_relative_to(workspace):
            raise ValueError("Workspace must be a dedicated directory, never a repository ancestor")
        protected = [self.root / p for p in ("public", "src", ".git", "node_modules", "dist")]
        protected.append(self.tool / "catalog")
        if any(workspace.is_relative_to(p.resolve()) or p.resolve().is_relative_to(workspace) for p in protected):
            raise ValueError("Work data must be outside game assets, source, build and catalog directories")
        self.store = Store(self.tool, workspace)
        self.repository = repository or Repository(self.root, self.tool)
        self.catalog = CatalogService(self.store, self.repository)
        if backend is None:
            from .generators import GenerationRouter
            backend = GenerationRouter(self.tool)
        self.jobs = Jobs(self.store, backend)

    def current(self, key):
        scan = self.repository.scan()
        if key not in scan["entries"]:
            raise Conflict("This audio key is no longer supported in the game catalog")
        facts = scan["entries"][key]
        if facts.get("conflicts"):
            raise Conflict("Repository conflicts: " + str(facts["conflicts"]))
        return scan, facts

    def game_audio(self, key):
        _, facts = self.current(key)
        path = within(self.root / "public" / "assets" / "sounds", facts["filename"])
        if sha256(path) != facts["file_hash"] or not path.is_file():
            raise Conflict("Game audio changed or is missing. Refresh first.")
        return path

    def generate(self, key, expected, *, generation=None, seed=None):
        with self.store.writing():
            state = self.catalog.read()
            if state["revision"] != expected:
                raise Conflict("Catalog changed. Refresh before generating.")
            author = copy.deepcopy(state["catalog"]["entries"][key])
            if generation is not None:
                author["generation_defaults"] = generation
            author = Entry.model_validate(author).model_dump()
            _, facts = self.current(key)
            validate_production(author, facts)
            return self.jobs.submit(key, author, facts, seed=seed)

    def import_current(self, key):
        from .processor import read_audio, inspect_audio
        with self.store.writing():
            _, facts = self.current(key)
            source = self.game_audio(key)
            audio, sample_rate = read_audio(source)
            run_id = uuid.uuid4().hex
            raw = self.store.path(f"runs/{run_id}/raw/000.wav")
            raw.parent.mkdir(parents=True, exist_ok=True)
            record = {
                "schema_version": 1, "id": run_id, "key": key, "created_at": now(),
                "status": "imported", "completed": 1, "error": None, "seeds": [],
                "author_snapshot": self.catalog.read()["catalog"]["entries"][key],
                "repository_snapshot": facts,
                "candidates": [{
                    "id": "0", "path": raw.relative_to(self.store.workspace).as_posix(), "hash": None,
                    "generation": {"kind": "game_import", "source_path": facts["target_path"], "source_hash": facts["file_hash"]},
                    "favorite": False, "discarded": False, "cleaned": False, "protected": False, "versions": [],
                }],
            }
            try:
                sf.write(raw, audio, sample_rate, subtype="FLOAT")
                inspect_audio(raw)
                if sha256(source) != facts["file_hash"]:
                    raise Conflict("Game sound changed during import")
            except Exception as exc:
                record.update(status="failed", error=str(exc), completed=0)
                record["candidates"][0].update(failed=True, discarded=True)
                raise
            finally:
                record["candidates"][0]["hash"] = sha256(raw)
                self.store.save(f"runs/{run_id}/generation.json", record)
            return record

    def candidate(self, run_id, candidate_id):
        run = self.jobs.read(run_id)
        candidate = next((c for c in run["candidates"] if c["id"] == candidate_id), None)
        if candidate is None:
            raise ValueError("Unknown candidate")
        return run, candidate

    def audio_path(self, run_id, candidate_id, version_id=None, kind="raw"):
        _, candidate = self.candidate(run_id, candidate_id)
        if candidate["cleaned"]:
            raise ValueError("Audio was cleaned; metadata remains available")
        if candidate.get("failed"):
            raise ValueError("Failed audio is retained for history/cleanup, not production")
        if kind == "raw":
            path, fingerprint = candidate["path"], candidate["hash"]
        else:
            version = next((v for v in candidate["versions"] if v["id"] == version_id), None)
            if not version or kind not in version["files"]:
                raise ValueError("Unknown audio version")
            path, fingerprint = version["files"][kind]["path"], version["files"][kind]["hash"]
        result = self.store.path(path)
        if not result.is_file() or sha256(result) != fingerprint:
            raise Conflict("Working audio changed or is missing")
        return result

    def process(
        self,
        run_id,
        candidate_id,
        playback,
        profile,
        overrides,
        *,
        replace_overrides: bool = False,
    ):
        from .processor import process_audio
        with self.store.writing():
            raw = self.audio_path(run_id, candidate_id)
            run, _ = self.candidate(run_id, candidate_id)
            if run["repository_snapshot"].get("kind") == "music" and (playback != "loop" or profile != "music_loop"):
                raise ValueError("Music requires loop playback and the music_loop processing profile")
            if run["repository_snapshot"].get("kind") != "music" and profile == "music_loop":
                raise ValueError("music_loop is reserved for repository music entries")
            defaults = run["author_snapshot"]["processing"]
            if type(replace_overrides) is not bool:
                raise ValueError("replace_overrides must be a boolean")
            overrides = dict(overrides or {})
            if not replace_overrides and defaults["profile"] == profile:
                overrides = {**defaults["overrides"], **overrides}
            version_id = uuid.uuid4().hex
            output = self.store.path(f"runs/{run_id}/processed/{candidate_id}/{version_id}")
            error = None
            try:
                recipe = process_audio(raw, output, playback, profile, overrides)
            except Exception as exc:
                error = exc
                recipe = {"error": str(exc), "requested": {"playback": playback, "profile": profile, "overrides": overrides}}
            files = {}
            for kind, name in (("wav", "processed.wav"), ("ogg", "export.ogg"), ("loop", "loop-preview.wav")):
                path = output / name
                if path.is_file():
                    files[kind] = {"path": path.relative_to(self.store.workspace).as_posix(), "hash": sha256(path)}
            if error is None and ("wav" not in files or "ogg" not in files):
                error = ValueError("Processor did not produce both a WAV master and an OGG export")
            version = {"id": version_id, "status": "failed" if error else "complete", "created_at": now(), "playback": playback, "profile": profile, "recipe": recipe, "files": files}
            self.jobs.update(run_id, lambda r: next(c for c in r["candidates"] if c["id"] == candidate_id)["versions"].append(version))
            if error:
                raise error
            return version

    def mark(self, run_id, candidate_id, *, favorite=None, discarded=None):
        def update(record):
            candidate = next(c for c in record["candidates"] if c["id"] == candidate_id)
            if favorite is not None:
                candidate["favorite"] = bool(favorite)
            if discarded is not None:
                candidate["discarded"] = bool(discarded)
        self.candidate(run_id, candidate_id)
        return self.jobs.update(run_id, update)

    def plan_export(self, selections):
        from .processor import inspect_audio
        if not selections or len(selections) > 32:
            raise ValueError("Select between 1 and 32 concrete export versions")
        with self.store.writing():
            scan = self.repository.scan()
            items, targets = [], set()
            for selected in selections:
                run, candidate = self.candidate(selected["run_id"], selected["candidate_id"])
                key = run["key"]
                facts = scan["entries"].get(key)
                if not facts or facts.get("conflicts"):
                    raise Conflict("Audio key no longer resolves without conflicts")
                if not facts["target_path"].endswith(".ogg"):
                    raise ValueError("The central game target must use .ogg before an export can be reviewed")
                if facts["target_path"] != run["repository_snapshot"]["target_path"]:
                    raise Conflict("Target changed since the source was produced. Reimport or generate for the new target.")
                target_identity = facts["target_path"].casefold()
                if target_identity in targets:
                    raise ValueError("Only one candidate per target path can be published")
                targets.add(target_identity)
                source = self.audio_path(selected["run_id"], selected["candidate_id"], selected["version_id"], "ogg")
                info = sf.info(source)
                if info.format != "OGG" or info.subtype != "VORBIS":
                    raise ValueError("Only actual OGG/Vorbis exports may be published")
                version = next(v for v in candidate["versions"] if v["id"] == selected["version_id"])
                if facts.get("kind") == "music" and (version["playback"] != "loop" or version["profile"] != "music_loop"):
                    raise ValueError("Music must be processed with music_loop before publication")
                if version.get("status", "complete") != "complete":
                    raise ValueError("A failed processing version cannot be published")
                analysis = inspect_audio(source, version["playback"])
                items.append({**selected, "key": key, "target_path": facts["target_path"],
                    "shared_keys": facts["shared_keys"], "expected_file_hash": facts["file_hash"],
                    "source_path": str(source), "expected_source_hash": sha256(source),
                    "whitelist_addition": None if facts["shipped"] else facts["filename"], "analysis": analysis})
            plan = {"id": uuid.uuid4().hex, "created_at": now(), "catalog_hash": scan["catalog_hash"], "items": items, "status": "awaiting_human_review"}
            self.store.save(f"reviews/{plan['id']}.json", plan)
            return plan

    def commit_export(self, plan_id, *, confirmed: bool):
        if confirmed is not True:
            raise ValueError("Explicit human confirmation of the reviewed OGG and affected targets is required")
        with self.store.writing():
            from .storage import safe_id
            path = self.store.path(f"reviews/{safe_id(plan_id)}.json")
            plan = read_json(path)
            if not plan or plan["status"] != "awaiting_human_review":
                raise Conflict("Review is missing, consumed or failed; create a fresh preview")
            scan = self.repository.scan()
            if scan["catalog_hash"] != plan["catalog_hash"]:
                raise Conflict("Game catalog changed since review")
            # Validate every target before the first write. Each target has its own transaction.
            for item in plan["items"]:
                facts = scan["entries"].get(item["key"])
                if not facts or facts["target_path"] != item["target_path"] or facts["file_hash"] != item["expected_file_hash"]:
                    raise Conflict("Game target changed since review")
                source = self.audio_path(item["run_id"], item["candidate_id"], item["version_id"], "ogg")
                if sha256(source) != item["expected_source_hash"]:
                    raise Conflict("Export changed since review")
            plan.update(status="publishing", confirmed_at=now(), results=[])
            atomic_json(path, plan)
            expected_catalog = plan["catalog_hash"]
            try:
                for item in plan["items"]:
                    # Protect lineage before crossing the game write boundary, even on a crash.
                    def protect(record):
                        next(c for c in record["candidates"] if c["id"] == item["candidate_id"])["protected"] = True
                    self.jobs.update(item["run_id"], protect)
                    result = self.repository.call("publish", key=item["key"], source_path=item["source_path"],
                        expected_catalog_hash=expected_catalog, expected_file_hash=item["expected_file_hash"],
                        expected_source_hash=item["expected_source_hash"], workspace=str(self.store.workspace), approval_id=plan["id"])
                    plan["results"].append(result)
                    atomic_json(path, plan)
                    expected_catalog = result["catalog_hash"]
                plan["status"] = "published"
            except Exception as exc:
                plan.update(status="failed", error=str(exc))
                atomic_json(path, plan)
                raise
            atomic_json(path, plan)
            return plan

    def cleanup_plan(self):
        items = []
        for run in self.jobs.list():
            if run["status"] in {"queued", "loading", "generating", "cancelling"}:
                continue
            for candidate in run["candidates"]:
                if not candidate["discarded"] or candidate["favorite"] or candidate["protected"] or candidate["cleaned"]:
                    continue
                files = [{"path": candidate["path"], "hash": candidate["hash"]}]
                files.extend(f for version in candidate["versions"] for f in version["files"].values())
                items.append({"run_id": run["id"], "candidate_id": candidate["id"], "files": files,
                    "missing_files": [f["path"] for f in files if not self.store.path(f["path"]).exists()],
                    "bytes": sum(self.store.path(f["path"]).stat().st_size for f in files if self.store.path(f["path"]).is_file())})
        plan = {"id": uuid.uuid4().hex, "items": items, "created_at": now(), "status": "preview"}
        self.store.save(f"cleanup/{plan['id']}.json", plan)
        return plan

    def cleanup(self, plan_id, confirmed):
        from .storage import safe_id
        if confirmed is not True:
            raise ValueError("Confirm the displayed cleanup selection")
        with self.store.writing():
            path = self.store.path(f"cleanup/{safe_id(plan_id)}.json")
            plan = read_json(path)
            if not plan or plan["status"] != "preview":
                raise Conflict("Cleanup preview is no longer valid")
            for item in plan["items"]:
                _, candidate = self.candidate(item["run_id"], item["candidate_id"])
                current_files = [{"path": candidate["path"], "hash": candidate["hash"]}]
                current_files.extend(f for v in candidate["versions"] for f in v["files"].values())
                if candidate["favorite"] or candidate["protected"] or not candidate["discarded"] or current_files != item["files"]:
                    raise Conflict("Cleanup selection changed or became protected")
                for file in item["files"]:
                    expected = None if file["path"] in item.get("missing_files", []) else file["hash"]
                    if sha256(self.store.path(file["path"])) != expected:
                        raise Conflict("Working file changed since cleanup preview")
            for item in plan["items"]:
                for file in item["files"]:
                    self.store.path(file["path"]).unlink(missing_ok=True)
                self.jobs.update(item["run_id"], lambda r: next(c for c in r["candidates"] if c["id"] == item["candidate_id"]).update(cleaned=True, cleaned_at=now()))
            plan["status"] = "cleaned"
            atomic_json(path, plan)
            return plan
