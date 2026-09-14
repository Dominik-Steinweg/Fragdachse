"""The shipped Medium workflow reaches the existing RAW/processing pipeline."""
import io
import json
from pathlib import Path

import httpx
import numpy as np
import soundfile as sf
import pytest

from audio_studio.comfyui import ComfyUiGenerator
from audio_studio.generators import GenerationRouter
from audio_studio.storage import atomic_json, read_json, sha256


TOOL = Path(__file__).resolve().parents[1]


@pytest.mark.parametrize("model", ["medium", "small-sfx-comfyui"])
def test_shipped_workflow_api_job_raw_and_processing(studio, model):
    # Captured read-only from the installed native ComfyUI 0.35.1 API. In
    # particular, legacy COMBO lists and the V3 FLAC saver coexist here.
    schemas = read_json(TOOL / "tests/fixtures/comfyui-0.35.1-object-info.json")
    registry = read_json(TOOL / "catalog/generators.json")
    workflow_path = TOOL / "workflows" / registry["models"][model]["workflow"]
    template = read_json(workflow_path)
    prompt = "  A single explosive metal impact.\nNo rewrite: {dry|wet}.  "
    received = []
    source = np.sin(np.arange(44100)[:, None] * np.array([[.08, .081]])) * .4
    encoded = io.BytesIO()
    sf.write(encoded, source, 44100, format="FLAC", subtype="PCM_24")
    flac = encoded.getvalue()
    expected, rate = sf.read(io.BytesIO(flac), dtype="float32", always_2d=True)

    def respond(request):
        path = request.url.path
        if path == "/object_info":
            return httpx.Response(200, json=schemas)
        if path == "/system_stats":
            return httpx.Response(200, json={"system": {"comfyui_version": "0.35.1"}})
        if path == "/prompt":
            payload = json.loads(request.content)
            graph = payload["prompt"]
            assert graph["1"]["inputs"]["ckpt_name"] == registry["models"][model]["model_filename"]
            assert graph["3"]["inputs"]["text"] == prompt
            assert graph["4"]["inputs"]["text"] == ""
            assert graph["5"]["inputs"]["seconds_total"] == graph["6"]["inputs"]["seconds"] == 2
            assert graph["7"]["inputs"]["seed"] == 1701
            assert graph["7"]["inputs"]["steps"] == 10
            assert graph["7"]["inputs"]["cfg"] == 1.5
            assert graph["7"]["inputs"]["sampler_name"] == "lcm"
            assert graph["9"]["inputs"]["format"] == "flac"
            received.append(payload)
            return httpx.Response(200, json={"prompt_id": "our-job", "number": 0})
        if path == "/history/our-job":
            return httpx.Response(200, json={"our-job": {"status": {"completed": True, "status_str": "success"}, "outputs": {"9": {"audio": [{"filename": "result.flac", "subfolder": "audio-studio", "type": "output"}]}}}})
        if path == "/view":
            assert dict(request.url.params) == {"filename": "result.flac", "subfolder": "audio-studio", "type": "output"}
            return httpx.Response(200, content=flac)
        raise AssertionError(f"Unexpected request: {request.method} {path}")

    atomic_json(studio.tool / "catalog/model-lock.json", {"license": {"acknowledged": True}})
    client = httpx.Client(transport=httpx.MockTransport(respond))
    comfy = ComfyUiGenerator({model: registry["models"][model]}, TOOL / "workflows", http_client=client)
    router = GenerationRouter(studio.tool, registry=registry, factories={"python": lambda: None, "comfyui": lambda: comfy})
    studio.jobs.backend = router
    state = studio.catalog.read()
    state = studio.catalog.edit("sfx_one", {"prompt": {"text": prompt}, "playback": "oneshot"}, state["revision"])
    revision = studio.catalog.read()["revision"]
    run = studio.generate("sfx_one", revision, generation={"model": model, "duration_seconds": 2, "candidate_count": 1, "steps": 10, "cfg_scale": 1.5}, seed=1701)
    studio.jobs.queue.join()
    finished = studio.jobs.read(run["id"])
    assert finished["status"] == "complete", finished.get("error")
    candidate = finished["candidates"][0]
    raw = studio.store.path(candidate["path"])
    actual, actual_rate = sf.read(raw, dtype="float32", always_2d=True)
    np.testing.assert_array_equal(actual, expected)
    assert actual_rate == rate
    assert candidate["hash"] == sha256(raw)
    assert candidate["generation"]["backend"] == "comfyui"
    assert candidate["generation"]["model_name"] == model
    assert finished["author_snapshot"]["generation_defaults"]["model"] == model
    assert candidate["generation"]["prompt_id"] == "our-job"
    assert candidate["generation"]["actual_graph"] == received[0]["prompt"]
    assert candidate["generation"]["transport_output"]["format"] == "flac"
    assert template == read_json(workflow_path)
    before = sha256(raw)
    version = studio.process(run["id"], "0", "oneshot", "impact", {})
    assert version["id"]
    assert sha256(raw) == before
    assert studio.jobs.read(run["id"])["candidates"][0]["versions"]
    client.close()
