import copy

import pytest

from audio_studio.catalog import Catalog
from audio_studio.storage import Conflict, atomic_json, read_json, sha256


def test_sync_preserves_authorship_hidden_provenance_and_orphans(studio):
    notice = {"id": "copy-1", "target_key": "sfx_one", "source_path": "old.ogg", "source_keys": [],
              "target_path": "public/assets/sounds/one.ogg", "file_hash": "a" * 64, "reason": "Initial copy"}
    atomic_json(studio.tool / "catalog/migrations/copy.json", {"copies": [notice]})
    state = studio.catalog.sync()
    state = studio.catalog.edit("sfx_one", {"prompt": {"text": "My edited English prompt", "source": "manual"},
        "notes": "Keep this", "generation_defaults": {"model": "small-sfx", "duration_seconds": 3, "candidate_count": 2}}, state["revision"])
    state = studio.catalog.hide_notice("sfx_one", state["revision"])
    author = copy.deepcopy(state["catalog"]["entries"]["sfx_one"])
    source = studio.root / "src/audio/AudioCatalog.ts"
    source.write_text(source.read_text().replace("'./assets/sounds/missing.ogg'", "'./assets/sounds/planned.ogg'"))
    fresh = studio.catalog.sync()["catalog"]["entries"]
    assert fresh["sfx_one"]["prompt"] == author["prompt"]
    assert fresh["sfx_one"]["generation_defaults"] == author["generation_defaults"]
    assert fresh["sfx_one"]["copy_notice"]["hidden"] is True
    assert fresh["sfx_missing"]["suggested_changes"]
    source.write_text(source.read_text().replace("sfx_missing: './assets/sounds/planned.ogg'", "sfx_new: './assets/sounds/new.ogg'").replace("sfx_missing: 0.5", "sfx_new: 0.5"))
    fresh = studio.catalog.sync()["catalog"]["entries"]
    assert fresh["sfx_missing"]["orphaned"] is True
    assert fresh["sfx_new"]["prompt"]["text"] == ""
    assert fresh["music_arena"]["repository"]["kind"] == "music"
    assert fresh["music_arena"]["processing"]["profile"] == "music_loop"


def test_stale_edits_and_author_proposals_do_not_overwrite(studio):
    state = studio.catalog.read()
    studio.catalog.edit("sfx_one", {"intent": "Explicit author decision"}, state["revision"])
    with pytest.raises(Conflict):
        studio.catalog.edit("sfx_one", {"intent": "Old UI"}, state["revision"])
    state = studio.catalog.read()
    state = studio.catalog.edit("sfx_one", {"intent": "Astra proposal"}, state["revision"], propose=True)
    entry = state["catalog"]["entries"]["sfx_one"]
    assert entry["intent"] == "Explicit author decision"
    assert entry["suggested_changes"][-1]["patch"]["intent"] == "Astra proposal"
    with pytest.raises(ValueError, match="authoring"):
        studio.catalog.edit("sfx_one", {"target_path": "somewhere.ogg"}, state["revision"])


def test_schema_rejects_invalid_generation_and_unsafe_keys(studio):
    data = studio.catalog.read()["catalog"]
    data["entries"]["sfx_one"]["generation_defaults"]["duration_seconds"] = float("nan")
    with pytest.raises(ValueError):
        Catalog.model_validate(data)
    with pytest.raises(ValueError):
        Catalog.model_validate({"entries": {"../escape": {}}})
    with pytest.raises(ValueError):
        studio.catalog.edit("sfx_one", {"processing": {"profile": "impact", "overrides": {"mystery_filter": 1}}}, studio.catalog.read()["revision"])


@pytest.mark.parametrize("duration", [0.5, 1.5, True, "2"])
def test_generation_duration_requires_whole_json_number(studio, duration):
    data = studio.catalog.read()["catalog"]
    data["entries"]["sfx_one"]["generation_defaults"]["duration_seconds"] = duration
    with pytest.raises(ValueError, match="whole number"):
        Catalog.model_validate(data)


def test_generation_duration_accepts_integral_json_float(studio):
    data = studio.catalog.read()["catalog"]
    data["entries"]["sfx_one"]["generation_defaults"]["duration_seconds"] = 2.0
    validated = Catalog.model_validate(data).model_dump()
    assert validated["entries"]["sfx_one"]["generation_defaults"]["duration_seconds"] == 2


def test_atomic_save_detects_external_edit(studio):
    path = studio.store.catalog_path
    old_hash = sha256(path)
    path.write_text(path.read_text() + " ")
    foreign = path.read_bytes()
    with pytest.raises(Conflict):
        atomic_json(path, read_json(path), expected=old_hash, check=True)
    assert path.read_bytes() == foreign


def test_model_registry_drives_authoring_schema_and_preserves_python_selection(studio):
    from audio_studio.catalog import Generation
    from audio_studio.generators import registered_model_names
    assert Generation.model_json_schema()["properties"]["model"]["enum"] == list(registered_model_names())
    for model in registered_model_names():
        assert Generation(model=model).model == model
    with pytest.raises(ValueError, match="Unknown generation model"):
        Generation(model="misspelled-model")
    state = studio.catalog.read()
    studio.catalog.edit("sfx_one", {"generation_defaults": {"model": "small-sfx"}}, state["revision"])
    assert studio.catalog.sync()["catalog"]["entries"]["sfx_one"]["generation_defaults"]["model"] == "small-sfx"
