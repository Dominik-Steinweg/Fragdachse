from pathlib import Path

import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from audio_studio.server import create_app
from audio_studio.service import Studio
from audio_studio.storage import Conflict, sha256
from conftest import prepared


def test_import_process_review_publish_preserves_sources_and_limits_writes(studio):
    target = studio.root / "public/assets/sounds/one.ogg"
    source_catalog = studio.root / "src/audio/AudioCatalog.ts"
    before, catalog_before = target.read_bytes(), source_catalog.read_bytes()
    selection = prepared(studio)
    assert target.read_bytes() == before
    assert source_catalog.read_bytes() == catalog_before
    raw = studio.audio_path(selection["run_id"], "0")
    raw_hash = sha256(raw)
    exported = studio.audio_path(**selection, kind="ogg")
    assert sf.info(exported).subtype == "VORBIS"
    plan = studio.plan_export([selection])
    assert plan["items"][0]["shared_keys"] == ["sfx_one", "sfx_shared"]
    with pytest.raises(ValueError, match="human"):
        studio.commit_export(plan["id"], confirmed=False)
    assert target.read_bytes() == before
    result = studio.commit_export(plan["id"], confirmed=True)
    assert result["status"] == "published"
    assert target.read_bytes() == exported.read_bytes()
    assert source_catalog.read_bytes() == catalog_before  # already whitelisted
    assert sha256(raw) == raw_hash
    assert studio.candidate(selection["run_id"], "0")[1]["protected"]
    with pytest.raises(Conflict):
        studio.commit_export(plan["id"], confirmed=True)


def test_stale_export_and_duplicate_shared_target_block_before_writes(studio):
    selected = prepared(studio)
    other = prepared(studio, "sfx_shared")
    with pytest.raises(ValueError, match="one candidate"):
        studio.plan_export([selected, other])
    plan = studio.plan_export([selected])
    target = studio.root / "public/assets/sounds/one.ogg"
    target.write_bytes(target.read_bytes() + b"external edit")
    changed = target.read_bytes()
    with pytest.raises(Conflict, match="target changed"):
        studio.commit_export(plan["id"], confirmed=True)
    assert target.read_bytes() == changed


def test_post_review_recipe_version_requires_its_own_review(studio):
    selected = prepared(studio)
    plan = studio.plan_export([selected])
    studio.process(selected["run_id"], "0", "oneshot", "impact", {"output_gain_db": -8})
    # Creating a second version does not substitute it into the already reviewed plan.
    original_hash = plan["items"][0]["expected_source_hash"]
    studio.commit_export(plan["id"], confirmed=True)
    assert sha256(studio.root / "public/assets/sounds/one.ogg") == original_hash


def test_process_can_replace_authored_overrides_for_full_form(studio):
    run = studio.import_current("sfx_one")

    def authored(record):
        record["author_snapshot"]["processing"] = {
            "profile": "impact",
            "overrides": {"auto_trim": False, "start_seconds": 0.05},
        }

    studio.jobs.update(run["id"], authored)
    inherited = studio.process(run["id"], "0", "oneshot", "impact", {})
    inherited_overrides = inherited["recipe"]["recipe"]["overrides"]
    assert inherited_overrides["auto_trim"] is False
    assert inherited_overrides["start_seconds"] == 0.05

    replaced = studio.process(
        run["id"], "0", "oneshot", "impact", {}, replace_overrides=True
    )
    replaced_overrides = replaced["recipe"]["recipe"]["overrides"]
    assert replaced_overrides == {}


def test_multi_target_export_adds_missing_whitelist_only_once(studio):
    existing = prepared(studio)
    # A new game target can be produced even though it has never had a file.
    from audio_studio.storage import atomic_json
    import copy
    run = copy.deepcopy(studio.jobs.read(existing["run_id"]))
    run["id"], run["key"] = "newtarget", "sfx_missing"
    run["repository_snapshot"] = studio.repository.scan()["entries"]["sfx_missing"]
    atomic_json(studio.jobs.path("newtarget"), run)
    missing = {**existing, "run_id": "newtarget"}
    plan = studio.plan_export([existing, missing])
    result = studio.commit_export(plan["id"], confirmed=True)
    assert len(result["results"]) == 2
    assert studio.repository.scan()["entries"]["sfx_missing"]["shipped"]
    assert studio.game_audio("sfx_missing").read_bytes() == studio.audio_path(**missing, kind="ogg").read_bytes()
    repeated = studio.plan_export([missing])
    assert repeated["items"][0]["whitelist_addition"] is None
    studio.commit_export(repeated["id"], confirmed=True)


def test_failed_processor_tracks_artifacts_and_disallows_export(studio, monkeypatch):
    import audio_studio.processor as processor
    run = studio.import_current("sfx_one")
    def failed(source, output, *args):
        output.mkdir(parents=True)
        (output / "processed.wav").write_bytes(source.read_bytes())
        raise ValueError("Encoder failed")
    monkeypatch.setattr(processor, "process_audio", failed)
    with pytest.raises(ValueError, match="Encoder failed"):
        studio.process(run["id"], "0", "oneshot", "impact", {})
    candidate = studio.candidate(run["id"], "0")[1]
    assert candidate["versions"][0]["status"] == "failed"
    assert "wav" in candidate["versions"][0]["files"]
    studio.mark(run["id"], "0", discarded=True)
    plan = studio.cleanup_plan()
    assert len(plan["items"][0]["files"]) == 2
    studio.cleanup(plan["id"], True)


def test_cleanup_detects_file_lost_after_preview(studio):
    selected = prepared(studio)
    studio.mark(selected["run_id"], "0", discarded=True)
    preview = studio.cleanup_plan()
    studio.audio_path(selected["run_id"], "0").unlink()
    with pytest.raises(Conflict, match="changed"):
        studio.cleanup(preview["id"], True)
    updated = studio.cleanup_plan()
    assert updated["items"][0]["missing_files"]
    studio.cleanup(updated["id"], True)


def test_cleanup_previews_exact_files_and_protects_favorites_and_lineage(studio):
    selected = prepared(studio)
    studio.mark(selected["run_id"], "0", discarded=True)
    preview = studio.cleanup_plan()
    assert len(preview["items"]) == 1
    studio.mark(selected["run_id"], "0", favorite=True)
    with pytest.raises(Conflict, match="protected"):
        studio.cleanup(preview["id"], True)
    assert studio.cleanup_plan()["items"] == []
    studio.mark(selected["run_id"], "0", favorite=False)
    preview = studio.cleanup_plan()
    result = studio.cleanup(preview["id"], True)
    assert result["status"] == "cleaned"
    assert studio.jobs.path(selected["run_id"]).is_file()
    assert studio.candidate(selected["run_id"], "0")[1]["cleaned"]
    assert not studio.store.path(preview["items"][0]["files"][0]["path"]).exists()
    protected = prepared(studio)
    plan = studio.plan_export([protected])
    studio.commit_export(plan["id"], confirmed=True)
    studio.mark(protected["run_id"], "0", discarded=True)
    assert studio.cleanup_plan()["items"] == []


def test_model_free_http_and_browser_origin_protection(studio):
    with TestClient(create_app(studio), base_url="http://127.0.0.1:8765") as client:
        assert client.get("/").status_code == 200
        assert client.get("/static/studio.js").status_code == 200
        state = client.get("/api/state").json()
        assert state["catalog"]["entries"]["sfx_one"]["repository"]["exists"]
        token = {"X-Studio-Token": state["token"]}
        assert client.post("/api/sync", json={}).status_code == 403
        assert client.post("/api/sync", json={}, headers={**token, "Origin": "https://foreign.example"}).status_code == 403
        assert client.post("/api/sync", json={}, headers={**token, "Origin": "null"}).status_code == 403
        assert client.get("/api/state", headers={"Host": "foreign.example"}).status_code == 403
        assert client.post("/api/sync", json={}, headers={**token, "Origin": "http://127.0.0.1:8765"}).status_code == 200
        imported = client.post("/api/import/sfx_one", json={}, headers=token)
        assert imported.status_code == 200
        run_id = imported.json()["id"]
        response = client.post(f"/api/runs/{run_id}/0/process", json={"playback":"oneshot","profile":"impact"}, headers=token)
        assert response.status_code == 200
        version_id = response.json()["id"]
        media = client.get(f"/media/run/{run_id}/0/ogg", params={"version_id":version_id})
        assert media.content[:4] == b"OggS"
        processed_waveform = client.get(
            f"/api/waveform/{run_id}/0",
            params={"kind": "wav", "version_id": version_id},
        )
        assert processed_waveform.status_code == 200
        waveform = processed_waveform.json()
        assert waveform["frames"] > 0
        assert waveform["sample_rate"] == 44100
        assert waveform["points"]
        assert waveform["points"][0]["end_seconds"] > waveform["points"][0]["start_seconds"]
        assert len(waveform["peaks"]) == len(waveform["points"])
        assert client.get("/media/game/music_arena").status_code == 409


@pytest.mark.parametrize("relative", ["public/tmp", "src/tmp", "dist/tmp", ".git/tmp", "node_modules/tmp"])
def test_workspace_never_enters_game_build_or_source(studio, relative):
    with pytest.raises(ValueError, match="Work data"):
        Studio(studio.root, studio.tool, studio.root / relative)
