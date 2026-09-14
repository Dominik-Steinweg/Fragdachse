import threading

import numpy as np
import pytest
import soundfile as sf

from audio_studio.catalog import Entry
from audio_studio.jobs import Jobs
from audio_studio.storage import Store, atomic_json
from audio_studio import storage


def test_fourth_candidate_completes_after_transient_status_write_denial(tmp_path, monkeypatch):
    tool = tmp_path / 'tool'
    tool.mkdir()
    backend = ControlledBackend()
    backend.release.set()
    jobs = Jobs(Store(tool, tool / 'work'), backend)
    original = storage.os.replace
    denied = []

    def replace(source, destination):
        if destination.name == 'generation.json':
            record = storage.read_json(storage.Path(source))
            if record.get('completed') == 4 and len(denied) < 3:
                denied.append(source)
                raise PermissionError(13, 'sharing violation', str(destination))
        return original(source, destination)

    monkeypatch.setattr(storage.os, 'replace', replace)
    monkeypatch.setattr(storage.time, 'sleep', lambda _: None)
    entry = Entry(playback='oneshot', prompt={'text': 'one impact'}).model_dump()
    entry['generation_defaults']['candidate_count'] = 4
    record = jobs.submit('sfx_one', entry, {'target_path': 'one.ogg'}, seed=23)
    try:
        jobs.queue.join()
        complete = jobs.read(record['id'])
        assert complete['status'] == 'complete'
        assert complete['completed'] == 4
        assert len(denied) == 3
        assert len(backend.calls) == 4
        assert all(jobs.store.path(c['path']).is_file() for c in complete['candidates'])
    finally:
        jobs.close()


class ControlledBackend:
    def __init__(self):
        self.entered = threading.Event()
        self.release = threading.Event()
        self.calls = []

    def generate(self, model, prompt, duration, seed, path, parameters=None):
        self.calls.append((model, seed, parameters))
        self.entered.set()
        assert self.release.wait(timeout=5)
        sf.write(path, np.zeros((441, 2)), 44100)
        return {"model": model, "seed": seed}

    def unload(self):
        pass


def test_cancel_waits_for_candidate_and_preserves_partial_output(tmp_path):
    tool = tmp_path / "tool"
    tool.mkdir()
    backend = ControlledBackend()
    jobs = Jobs(Store(tool, tool / "work"), backend)
    entry = Entry(playback="oneshot", prompt={"text": "one impact"}).model_dump()
    record = jobs.submit("sfx_one", entry, {"target_path": "one.ogg"}, seed=23)
    assert backend.entered.wait(timeout=5)
    jobs.cancel(record["id"])
    assert jobs.read(record["id"])["status"] == "cancelling"
    backend.release.set()
    jobs.queue.join()
    complete = jobs.read(record["id"])
    assert complete["status"] == "cancelled"
    assert complete["completed"] == 1
    assert len(backend.calls) == 1
    assert jobs.store.path(complete["candidates"][0]["path"]).is_file()
    jobs.close()


def test_run_status_transitions_loading_to_generating_with_sampler_progress(tmp_path):
    tool = tmp_path / "tool"
    tool.mkdir()

    class TransitionBackend:
        loading = threading.Event()
        release_loading = threading.Event()
        entered = threading.Event()
        release = threading.Event()

        def load_model(self, _model):
            self.loading.set()
            assert self.release_loading.wait(timeout=5)

        def generate(self, model, prompt, duration, seed, path, parameters=None, progress_callback=None):
            self.entered.set()
            assert self.release.wait(timeout=5)
            sf.write(path, np.zeros((441, 2)), 44100)
            return {"model": model, "seed": seed}

        def unload(self):
            pass

    backend = TransitionBackend()
    jobs = Jobs(Store(tool, tool / "work"), backend)
    entry = Entry(playback="oneshot", prompt={"text": "one impact"}).model_dump()
    record = jobs.submit("sfx_one", entry, {"target_path": "one.ogg"}, seed=23)
    assert record["status"] == "queued"
    assert record["progress"]["stage"] == "queued"
    assert backend.loading.wait(timeout=5)
    loading = jobs.read(record["id"])
    assert loading["status"] == "loading"
    assert loading["candidates"][0]["status"] == "loading"

    backend.release_loading.set()
    assert backend.entered.wait(timeout=5)
    sampling = jobs.read(record["id"])
    assert sampling["status"] == "generating"
    assert sampling["candidates"][0]["status"] == "sampling"
    assert sampling["progress"]["stage"] == "sampling"

    jobs.cancel(record["id"])
    assert jobs.read(record["id"])["status"] == "cancelling"
    backend.release.set()
    jobs.queue.join()
    assert jobs.read(record["id"])["status"] == "cancelled"
    jobs.close()


def test_restart_marks_interrupted_runs_without_relaunching(tmp_path):
    tool = tmp_path / "tool"
    tool.mkdir()
    store = Store(tool, tool / "work")
    atomic_json(store.path("runs/abc/generation.json"), {"id":"abc","created_at":"2026-01-01","status":"generating","candidates":[],"completed":0})
    jobs = Jobs(store, ControlledBackend())
    assert jobs.read("abc")["status"] == "generating"  # read-only CLI creation is harmless
    jobs.recover_interrupted()
    assert jobs.read("abc")["status"] == "interrupted"
    assert jobs.thread is None


def test_failed_generator_tracks_partial_raw_for_explicit_cleanup(tmp_path):
    tool = tmp_path / "tool"
    tool.mkdir()
    class FailsAfterWrite(ControlledBackend):
        def generate(self, model, prompt, duration, seed, path, parameters=None):
            path.write_bytes(b"incomplete generated audio")
            raise RuntimeError("device failed during output")
    jobs = Jobs(Store(tool, tool / "work"), FailsAfterWrite())
    entry = Entry(playback="oneshot", prompt={"text": "impact"}).model_dump()
    record = jobs.submit("sfx_one", entry, {"target_path": "one.ogg"})
    jobs.queue.join()
    failed = jobs.read(record["id"])
    assert failed["status"] == "failed"
    assert failed["candidates"][0]["failed"]
    assert failed["candidates"][0]["discarded"]
    assert failed["candidates"][0]["hash"]
    assert jobs.store.path(failed["candidates"][0]["path"]).exists()
    jobs.close()


def test_sampling_progress_is_durable_per_candidate_and_run(tmp_path):
    tool = tmp_path / "tool"
    tool.mkdir()

    class ProgressBackend(ControlledBackend):
        def generate(self, model, prompt, duration, seed, path, parameters=None, progress_callback=None):
            assert progress_callback is not None
            progress_callback({"stage": "sampling", "completed_steps": 1, "total_steps": 4, "fraction": 0.25})
            progress_callback({"stage": "sampling", "completed_steps": 4, "total_steps": 4, "fraction": 1.0})
            sf.write(path, np.zeros((441, 2)), 44100)
            return {"model": model, "seed": seed}

    jobs = Jobs(Store(tool, tool / "work"), ProgressBackend())
    entry = Entry(
        playback="oneshot",
        prompt={"text": "one impact"},
        generation_defaults={"duration_seconds": 2, "candidate_count": 1, "steps": 4},
    ).model_dump()
    record = jobs.submit("sfx_one", entry, {"target_path": "one.ogg"}, seed=23)
    jobs.queue.join()
    complete = jobs.read(record["id"])
    assert complete["total"] == 1
    assert complete["progress"]["stage"] == "complete"
    assert complete["progress"]["candidate_id"] == "0"
    assert complete["progress"]["fraction"] == 1.0
    candidate = complete["candidates"][0]
    assert candidate["progress"]["stage"] == "complete"
    assert candidate["progress"]["completed_steps"] == 4
    jobs.close()


def test_legacy_fractional_job_snapshot_remains_readable(tmp_path):
    tool = tmp_path / "tool"
    tool.mkdir()
    store = Store(tool, tool / "work")
    atomic_json(
        store.path("runs/legacy/generation.json"),
        {
            "id": "legacy",
            "created_at": "2026-01-01",
            "status": "complete",
            "completed": 1,
            "seeds": [1],
            "author_snapshot": {"generation_defaults": {"duration_seconds": 1.5}},
            "candidates": [],
        },
    )
    jobs = Jobs(store, ControlledBackend())
    assert jobs.read("legacy")["author_snapshot"]["generation_defaults"]["duration_seconds"] == 1.5


def test_new_job_rejects_fractional_duration_before_queueing(tmp_path):
    tool = tmp_path / "tool"
    tool.mkdir()
    jobs = Jobs(Store(tool, tool / "work"), ControlledBackend())
    entry = Entry(
        playback="oneshot",
        prompt={"text": "one impact"},
        generation_defaults={"duration_seconds": 2, "candidate_count": 1},
    ).model_dump()
    # Simulate an older or externally supplied snapshot reaching the job boundary.
    entry["generation_defaults"]["duration_seconds"] = 1.5
    with pytest.raises(ValueError, match="whole number"):
        jobs.submit("sfx_one", entry, {"target_path": "one.ogg"})


def test_remote_stage_and_failure_are_retained_without_a_playable_candidate(tmp_path):
    tool = tmp_path / "tool"
    tool.mkdir()
    observed = []

    class Remote:
        def generate(self, model, prompt, duration, seed, path, parameters=None, progress_callback=None):
            for stage in ("queued", "sampling"):
                progress_callback({"stage": stage, "total_steps": 0, "indeterminate": True, "detail": "ComfyUI: " + stage})
                observed.append(jobs.list()[0]["progress"])
            raise RuntimeError("ComfyUI: Generation fehlgeschlagen, CUDA out of memory")

        def unload(self):
            pass

    jobs = Jobs(Store(tool, tool / "work"), Remote())
    entry = Entry(playback="oneshot", prompt={"text": "impact"}, generation_defaults={"candidate_count": 1}).model_dump()
    record = jobs.submit("sfx_one", entry, {"target_path": "one.ogg"})
    jobs.queue.join()
    failed = jobs.read(record["id"])
    assert [progress["stage"] for progress in observed] == ["queued", "sampling"]
    assert all(progress["indeterminate"] and progress["total_steps"] == 0 for progress in observed)
    assert observed[1]["detail"] == "ComfyUI: sampling"
    assert failed["status"] == "failed" and "out of memory" in failed["error"]
    assert failed["candidates"][0]["hash"] is None
    assert failed["completed"] == 0
    jobs.close()
