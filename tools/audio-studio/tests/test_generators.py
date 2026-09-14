"""Provider boundaries are independent of model runtimes and GPU availability."""
import copy

import pytest

from audio_studio.generators import GenerationRouter
from audio_studio.storage import atomic_json


class Provider:
    def __init__(self, *, error=None, report=None):
        self.calls = []
        self.error = error
        self.report = report or {}

    def load_model(self, name):
        self.calls.append(("load", name))
        if self.error:
            raise RuntimeError(self.error)

    def generate(self, *args, **kwargs):
        self.calls.append(("generate", args, kwargs))
        return {"backend_metadata": "preserved"}

    def unload(self):
        self.calls.append(("unload",))

    def doctor(self):
        return self.report


@pytest.fixture
def routed(tmp_path):
    atomic_json(tmp_path / "catalog/model-lock.json", {"license": {"acknowledged": True}})
    python, comfy = Provider(), Provider()
    registry = {"schema_version": 1, "models": {"small-sfx": {"backend": "python"}, "medium": {"backend": "comfyui"}}}
    router = GenerationRouter(tmp_path, registry=registry, factories={"python": lambda: python, "comfyui": lambda: comfy})
    return router, python, comfy


def test_python_arguments_and_metadata_pass_through_unchanged(routed, tmp_path):
    router, python, comfy = routed
    prompt = "  Literal {impact} prompt\nNo rewrite.  "
    params = {"steps": 8, "cfg_scale": 1.0}
    callback = lambda event: None
    args = ("small-sfx", prompt, 2, 1701, tmp_path / "raw.wav")
    result = router.generate(*args, parameters=params, progress_callback=callback)
    assert python.calls[-1] == ("generate", args, {"parameters": params, "progress_callback": callback})
    assert python.calls[-1][2]["parameters"] is params
    assert result == {"backend_metadata": "preserved"}
    assert comfy.calls == []


def test_medium_never_constructs_python_runtime(routed, tmp_path):
    router, python, comfy = routed
    router.factories["python"] = lambda: pytest.fail("Medium must not initialize the Python model runtime")
    router.generate("medium", "impact", 2, 10, tmp_path / "raw.wav")
    assert router.loaded_model_name == "medium"
    assert comfy.calls[-1][0] == "generate"
    assert python.calls == []


def test_preflight_failure_keeps_small_loaded_and_never_falls_back(routed, tmp_path):
    router, python, comfy = routed
    router.load_model("small-sfx")
    comfy.error = "ComfyUI nicht erreichbar"
    with pytest.raises(RuntimeError, match="nicht erreichbar"):
        router.generate("medium", "prompt", 2, 10, tmp_path / "raw.wav")
    assert python.calls == [("load", "small-sfx")]
    assert router.loaded_model_name == "small-sfx"


def test_switch_releases_owned_python_model_after_remote_preflight(routed):
    router, python, comfy = routed
    router.load_model("small-sfx")
    router.load_model("medium")
    assert python.calls[-1] == ("unload",)
    assert comfy.calls == [("load", "medium")]
    router.unload()
    assert router.loaded_model_name is None


def test_remote_uses_existing_license_acknowledgement(routed, tmp_path):
    router, _, comfy = routed
    atomic_json(tmp_path / "catalog/model-lock.json", {"license": {"acknowledged": False}})
    with pytest.raises(ValueError, match="Lizenzfreigabe"):
        router.load_model("medium")
    assert comfy.calls == []


def test_future_workflow_model_needs_no_named_model_branch(routed, tmp_path):
    router, python, comfy = routed
    changed = copy.deepcopy(router.registry)
    changed["models"]["small-sfx"] = {"backend": "comfyui", "workflow": "future-small.api.json"}
    future = GenerationRouter(tmp_path, registry=changed, factories=router.factories)
    future.generate("small-sfx", "prompt", 2, 10, tmp_path / "raw.wav")
    assert comfy.calls[-1][1][0] == "small-sfx"
    assert not python.calls


def test_doctor_reports_active_routes_without_native_medium_requirements(routed):
    router, python, comfy = routed
    python.report = {"feasible": {"small-sfx": True, "medium": False}, "actions": ["Install Flash Attention for medium"], "models": {"small-sfx": {"available": True}, "medium": {"available": False}}}
    comfy.report = {"models": {"medium": {"ready": True, "base_url": "http://127.0.0.1:8188"}}}
    result = router.doctor()
    assert result["feasible"] == {"small-sfx": True, "medium": True}
    assert result["models"]["medium"]["backend"] == "comfyui"
    assert "Flash Attention" not in str(result)


def test_unknown_model_or_provider_fails_explicitly(routed, tmp_path):
    router, python, comfy = routed
    with pytest.raises(ValueError, match="Unbekanntes Modell"):
        router.load_model("typo")
    with pytest.raises(ValueError, match="Unbekannter Generator"):
        GenerationRouter(tmp_path, registry={"schema_version": 1, "models": {"medium": {"backend": "typo"}}})
    assert not python.calls and not comfy.calls


def test_both_small_routes_are_independently_available_and_forward_same_request(tmp_path):
    from pathlib import Path
    from audio_studio.storage import read_json
    tool = Path(__file__).resolve().parents[1]
    registry = read_json(tool / "catalog/generators.json")
    atomic_json(tmp_path / "catalog/model-lock.json", {"license": {"acknowledged": True}})
    python, comfy = Provider(), Provider()
    router = GenerationRouter(tmp_path, registry=registry, factories={"python": lambda: python, "comfyui": lambda: comfy})
    payload = ("unchanged action prompt", 3, 1234, tmp_path / "raw.wav")
    parameters = {"steps": 8, "cfg_scale": 1.0}
    router.generate("small-sfx", *payload, parameters=parameters)
    router.generate("small-sfx-comfyui", *payload, parameters=parameters)
    native_call = next(call for call in python.calls if call[0] == "generate")
    comfy_call = next(call for call in comfy.calls if call[0] == "generate")
    assert native_call[1][0] == "small-sfx"
    assert comfy_call[1][0] == "small-sfx-comfyui"
    assert native_call[1][1:] == comfy_call[1][1:] == payload
    assert native_call[2] == comfy_call[2]
    assert {item["name"]: item["backend"] for item in router.model_options} == {
        "small-sfx": "python", "small-sfx-comfyui": "comfyui", "medium": "comfyui",
    }
