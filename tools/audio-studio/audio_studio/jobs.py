"""One persistent inference worker, sequential candidates, durable partial runs."""
from __future__ import annotations

import copy
import inspect
import math
import queue
import secrets
import threading
import time
import uuid
from datetime import datetime, timezone

from .storage import atomic_json, read_json, safe_id, sha256


def now():
    return datetime.now(timezone.utc).isoformat()


class Jobs:
    def __init__(self, store, backend):
        self.store, self.backend = store, backend
        self.queue = queue.Queue()
        self.cancelled: set[str] = set()
        self.active: str | None = None
        self.mutex = threading.RLock()
        self.stopping = False
        self.thread = None

    def recover_interrupted(self):
        """Only the new exclusive server owner may declare old jobs interrupted."""
        # Crashed inference is never silently restarted or claimed complete.
        for record in self.list():
            if record["status"] in {"queued", "loading", "generating", "cancelling"}:
                self.update(record["id"], lambda r: r.update(status="interrupted", error="Studio stopped during this run; completed candidates are retained."))

    def start(self):
        if self.thread is None:
            self.thread = threading.Thread(target=self._worker, name="audio-inference", daemon=True)
            self.thread.start()

    def path(self, run_id):
        return self.store.path(f"runs/{safe_id(run_id)}/generation.json")

    def read(self, run_id):
        record = read_json(self.path(run_id))
        if record is None:
            raise ValueError("Unknown run")
        return record

    def list(self):
        folder = self.store.path("runs")
        if not folder.exists():
            return []
        return sorted(
            [read_json(self.store.path(p.relative_to(self.store.workspace))) for p in folder.glob("*/generation.json")],
            key=lambda r: r["created_at"], reverse=True,
        )

    def update(self, run_id, callback):
        with self.store.writing():
            record = self.read(run_id)
            callback(record)
            atomic_json(self.path(run_id), record)
            return record

    def submit(self, key, author, facts, *, seed=None):
        safe_id(key)
        if not author["prompt"]["text"].strip():
            raise ValueError("A prompt is required; the Studio does not invent prompts")
        if author["playback"] == "unknown":
            raise ValueError("Choose and verify oneshot or loop before production")
        duration = author["generation_defaults"].get("duration_seconds")
        if isinstance(duration, bool) or not isinstance(duration, (int, float)):
            raise ValueError("duration_seconds must be a positive whole number of seconds")
        try:
            duration_float = float(duration)
        except (TypeError, ValueError, OverflowError):
            duration_float = float("nan")
        if not math.isfinite(duration_float) or duration_float <= 0 or not duration_float.is_integer():
            raise ValueError("duration_seconds must be a positive whole number of seconds")
        if self.stopping:
            raise ValueError("Studio is stopping")
        run_id = uuid.uuid4().hex
        count = author["generation_defaults"]["candidate_count"]
        first_seed = secrets.randbelow(2**31 - count) if seed is None else seed
        if not isinstance(first_seed, int) or first_seed < 0 or first_seed + count >= 2**31:
            raise ValueError("Seed must be a nonnegative 31-bit integer")
        record = {
            "schema_version": 1, "id": run_id, "key": key, "created_at": now(),
            "status": "queued", "completed": 0, "total": count, "error": None,
            "author_snapshot": copy.deepcopy(author), "repository_snapshot": facts,
            "seeds": [first_seed + n for n in range(count)], "candidates": [],
            "progress": self._progress("queued", None, 0, author["generation_defaults"]["steps"]),
        }
        self.store.save(f"runs/{run_id}/generation.json", record)
        self.queue.put(run_id)
        self.start()
        return record

    def cancel(self, run_id):
        with self.mutex:
            self.cancelled.add(run_id)
            return self.update(run_id, lambda r: r.update(status="cancelling") if r["status"] in {"queued", "loading", "generating"} else None)

    def unload(self):
        with self.mutex:
            if self.active is not None or not self.queue.empty():
                raise ValueError("Cancel or finish queued work before releasing the model")
            self.backend.unload()

    def close(self):
        self.stopping = True
        for run in self.list():
            if run["status"] in {"queued", "loading", "generating"}:
                self.cancel(run["id"])
        self.queue.put(None)
        # A currently executing model call remains visibly cancelling until it returns.
        if self.thread:
            self.thread.join(timeout=2)
        if not self.thread or not self.thread.is_alive():
            self.backend.unload()
            close = getattr(self.backend, "close", None)
            if close:
                close()

    @staticmethod
    def _progress(
        stage: str,
        candidate_id: str | None,
        completed_steps: int = 0,
        total_steps: int = 0,
        *,
        fraction: float | None = None,
        indeterminate: bool = False,
        detail: str = "",
    ) -> dict[str, object]:
        total_steps = max(0, int(total_steps))
        completed_steps = max(0, min(total_steps, int(completed_steps)))
        if fraction is None:
            fraction = completed_steps / total_steps if total_steps else 0.0
        try:
            fraction = float(fraction)
        except (TypeError, ValueError, OverflowError):
            fraction = completed_steps / total_steps if total_steps else 0.0
        if not math.isfinite(fraction):
            fraction = completed_steps / total_steps if total_steps else 0.0
        fraction = max(0.0, min(1.0, fraction))
        return {
            "stage": stage,
            "candidate_id": candidate_id,
            "completed_steps": completed_steps,
            "total_steps": total_steps,
            "fraction": fraction,
            "indeterminate": bool(indeterminate),
            "detail": str(detail)[:1000],
            "updated_at": now(),
        }

    def _update_progress(
        self,
        run_id: str,
        candidate_id: str | None,
        stage: str,
        completed_steps: int = 0,
        total_steps: int = 0,
        *,
        fraction: float | None = None,
        indeterminate: bool = False,
        detail: str = "",
    ):
        progress = self._progress(
            stage,
            candidate_id,
            completed_steps,
            total_steps,
            fraction=fraction,
            indeterminate=indeterminate,
            detail=detail,
        )

        def update(record):
            record["progress"] = progress
            if stage == "loading" and record.get("status") != "cancelling":
                record["status"] = "loading"
            elif stage in {"queued", "sampling", "finalizing"} and record.get("status") != "cancelling":
                # The first candidate remains in loading while the model is
                # prepared. Once sampler progress begins, expose generating at
                # run level as well as on the candidate.
                record["status"] = "generating"
            elif stage == "cancelled":
                record["status"] = "cancelled"
            elif stage == "failed":
                record["status"] = "failed"
            if candidate_id is not None:
                candidate = next(
                    (item for item in record.get("candidates", []) if item.get("id") == candidate_id),
                    None,
                )
                if candidate is not None:
                    candidate["progress"] = progress.copy()
                    candidate["status"] = stage

        return self.update(run_id, update)

    def _backend_generate(self, model, prompt, duration, seed, path, parameters, progress_callback):
        """Call old injected backends and the new progress-aware adapter alike."""

        kwargs = {"parameters": parameters}
        try:
            signature = inspect.signature(self.backend.generate)
            accepts_progress_callback = "progress_callback" in signature.parameters
            accepts_callback = "callback" in signature.parameters
            accepts_var_kwargs = any(
                parameter.kind == inspect.Parameter.VAR_KEYWORD
                for parameter in signature.parameters.values()
            )
        except (TypeError, ValueError):
            accepts_progress_callback = True
            accepts_callback = False
            accepts_var_kwargs = False
        if accepts_progress_callback or accepts_var_kwargs:
            kwargs["progress_callback"] = progress_callback
        elif accepts_callback:
            kwargs["callback"] = progress_callback
        return self.backend.generate(model, prompt, duration, seed, path, **kwargs)

    def _worker(self):
        while True:
            run_id = self.queue.get()
            if run_id is None:
                return
            with self.mutex:
                self.active = run_id
            raw = None
            index = -1
            candidate_id = None
            try:
                record = self.read(run_id)
                author = record["author_snapshot"]
                settings = author["generation_defaults"]
                for index, seed in enumerate(record["seeds"]):
                    candidate_id = str(index)
                    if run_id in self.cancelled or self.stopping:
                        self._update_progress(
                            run_id,
                            None,
                            "cancelled",
                            0,
                            int(settings.get("steps", 0)),
                        )
                        break
                    raw = self.store.path(f"runs/{run_id}/raw/{index:03d}.wav")
                    raw.parent.mkdir(parents=True, exist_ok=True)
                    started = time.monotonic()

                    def started_candidate(record):
                        progress = self._progress(
                            "loading" if index == 0 else "generating",
                            candidate_id,
                            0,
                            int(settings.get("steps", 0)),
                        )
                        record.setdefault("candidates", []).append(
                            {
                                "id": candidate_id,
                                "path": raw.relative_to(self.store.workspace).as_posix(),
                                "hash": None,
                                "seed": seed,
                                "generation": None,
                                "elapsed_seconds": None,
                                "status": progress["stage"],
                                "progress": progress,
                                "favorite": False,
                                "discarded": False,
                                "cleaned": False,
                                "protected": False,
                                "versions": [],
                            }
                        )
                        record["status"] = "loading" if index == 0 else "generating"
                        record["progress"] = progress

                    self.update(run_id, started_candidate)
                    if index == 0 and hasattr(self.backend, "load_model"):
                        self.backend.load_model(settings["model"])
                    if run_id in self.cancelled or self.stopping:
                        self._update_progress(
                            run_id,
                            candidate_id,
                            "cancelled",
                            0,
                            int(settings.get("steps", 0)),
                        )
                        break

                    total_steps = int(settings.get("steps", 0))
                    self._update_progress(run_id, candidate_id, "sampling", 0, total_steps)

                    def progress(event):
                        if not isinstance(event, dict):
                            return
                        try:
                            completed_steps = int(event.get("completed_steps", event.get("step", 0)))
                        except (TypeError, ValueError):
                            completed_steps = 0
                        try:
                            event_total_steps = int(event.get("total_steps", total_steps))
                        except (TypeError, ValueError):
                            event_total_steps = total_steps
                        self._update_progress(
                            run_id,
                            candidate_id,
                            event.get("stage") if event.get("stage") in {"queued", "loading", "sampling", "finalizing"} else "sampling",
                            completed_steps,
                            event_total_steps,
                            fraction=event.get("fraction"),
                            indeterminate=event.get("indeterminate", False),
                            detail=event.get("detail", ""),
                        )

                    metadata = self._backend_generate(
                        settings["model"], author["prompt"]["text"], settings["duration_seconds"],
                        seed,
                        raw,
                        parameters={"steps": settings["steps"], "cfg_scale": settings["cfg_scale"]},
                        progress_callback=progress,
                    )

                    self._update_progress(run_id, candidate_id, "finalizing", total_steps, total_steps)

                    def completed(r):
                        candidate = next(c for c in r["candidates"] if c["id"] == candidate_id)
                        candidate.update(
                            hash=sha256(raw),
                            generation=metadata,
                            elapsed_seconds=time.monotonic() - started,
                            status="complete",
                            progress=self._progress("complete", candidate_id, total_steps, total_steps),
                        )
                        r["completed"] += 1
                        r["status"] = "cancelling" if run_id in self.cancelled else "generating"
                        r["progress"] = candidate["progress"].copy()
                    self.update(run_id, completed)
                self.update(run_id, lambda r: r.update(status="cancelled" if run_id in self.cancelled or self.stopping else "complete"))
            except Exception as exc:
                def failed(r):
                    error = f"{type(exc).__name__}: {exc}"
                    r.update(status="failed", error=error)
                    failed_candidate = next(
                        (c for c in r.get("candidates", []) if c.get("id") == candidate_id),
                        None,
                    )
                    if failed_candidate is None and raw is not None and raw.is_file():
                        failed_candidate = {
                            "id": str(index),
                            "path": raw.relative_to(self.store.workspace).as_posix(),
                            "hash": sha256(raw),
                            "seed": seed,
                            "failed": True,
                            "generation": {"status": "failed", "error": error},
                            "favorite": False,
                            "discarded": True,
                            "cleaned": False,
                            "protected": False,
                            "versions": [],
                        }
                        r.setdefault("candidates", []).append(failed_candidate)
                    if failed_candidate is not None:
                        if raw is not None and raw.is_file():
                            # Preserve the partial artifact's fingerprint so the
                            # normal review/cleanup integrity checks still apply.
                            failed_candidate["hash"] = sha256(raw)
                        failed_candidate.update(
                            failed=True,
                            discarded=True,
                            status="failed",
                            generation={"status": "failed", "error": error},
                            progress=self._progress(
                                "failed",
                                failed_candidate.get("id"),
                                0,
                                int(settings.get("steps", 0)) if "settings" in locals() else 0,
                            ),
                        )
                        r["progress"] = failed_candidate["progress"].copy()
                self.update(run_id, failed)
            finally:
                with self.mutex:
                    self.active = None
                self.queue.task_done()
