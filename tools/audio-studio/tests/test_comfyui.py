from __future__ import annotations

import io
import json
from pathlib import Path

import httpx
import numpy as np
import pytest
import soundfile as sf

from audio_studio.comfyui import (
    ComfyUiConfigError,
    ComfyUiGenerator,
    ComfyUiJobError,
    ComfyUiModelError,
    ComfyUiOutputError,
    ComfyUiTimeoutError,
    ComfyUiUnavailableError,
)


def _transport_audio(fmt: str = "FLAC") -> bytes:
    output = io.BytesIO()
    sf.write(output, np.array([[0.0], [0.25], [-0.5], [0.75]], dtype=np.float32), 22_050, format=fmt)
    return output.getvalue()


def _workflow(output_format: str = "flac") -> dict:
    return {
        "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "stable-audio.safetensors"}},
        "3": {
            "class_type": "StableAudioSampler",
            "inputs": {"seed": 1, "steps": 8, "cfg": 4.0, "duration": 2, "prompt": "default", "model": ["1", 0]},
        },
        "9": {
            "class_type": "SaveAudio",
            "inputs": {"audio": ["3", 0], "filename_prefix": "default", "format": "flac"},
        },
    }


def _object_info() -> dict:
    return {
        # Legacy ComfyUI object_info uses the filename list as the type slot.
        "CheckpointLoaderSimple": {"input": {"required": {"ckpt_name": [["stable-audio.safetensors"], {"tooltip": "checkpoint"}]}}},
        "StableAudioSampler": {
            "input": {
                "required": {
                    "seed": ["INT", {"default": 1}],
                    "steps": ["INT", {"default": 8}],
                    "cfg": ["FLOAT", {"default": 4.0}],
                    "duration": ["INT", {"default": 2}],
                    "prompt": ["STRING", {"default": ""}],
                    "model": ["AUDIO", {}],
                }
            }
        },
        "SaveAudio": {
            "input": {"required": {
                "audio": ["AUDIO", {}],
                "filename_prefix": ["STRING", {"default": ""}],
                "format": ["COMFY_DYNAMICCOMBO_V3", {"options": [{"key": "flac"}, {"key": "mp3"}]}],
            }}
        },
    }


def _registry(output_format: str = "flac") -> dict:
    return {
        "medium": {
            "backend": "comfyui",
            "workflow": "stable-audio.api.json",
            "bindings": {
                "prompt": [["3", "prompt"]],
                "duration": [["3", "duration"]],
                "seed": [["3", "seed"]],
                "steps": [["3", "steps"]],
                "cfg_scale": [["3", "cfg"]],
                "filename_prefix": [["9", "filename_prefix"]],
            },
            "output_node": "9",
            "output_format": output_format,
            "model_id": "Comfy-Org/stable-audio-3",
            "model_revision": "rev-1",
            "max_duration_seconds": 380,
        }
    }


def _make_generator(tmp_path: Path, handler, **kwargs) -> ComfyUiGenerator:
    (tmp_path / "stable-audio.api.json").write_text(json.dumps(_workflow()), encoding="utf-8")
    client = httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url="http://127.0.0.1:8188",
        follow_redirects=False,
        trust_env=False,
    )
    return ComfyUiGenerator(_registry(), tmp_path, http_client=client, poll_interval=0, **kwargs)


def test_flac_generation_renders_declared_values_and_preserves_raw_contract(tmp_path: Path):
    calls: list[tuple[str, str, dict]] = []
    transport = _transport_audio()

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append((request.method, request.url.path, json.loads(request.content) if request.content else {}))
        if request.url.path == "/object_info":
            return httpx.Response(200, json=_object_info())
        if request.url.path == "/system_stats":
            return httpx.Response(200, json={"version": "0.35.1"})
        if request.url.path == "/prompt":
            payload = json.loads(request.content)
            assert payload["prompt"]["3"]["inputs"]["prompt"] == "  exact\ntext  "
            assert payload["prompt"]["3"]["inputs"]["duration"] == 4
            assert payload["prompt"]["3"]["inputs"]["steps"] == 12
            assert payload["prompt"]["3"]["inputs"]["cfg"] == 2.5
            assert payload["prompt"]["9"]["inputs"]["filename_prefix"].startswith("audio-studio/")
            return httpx.Response(200, json={"prompt_id": "prompt-1"})
        if request.url.path == "/history/prompt-1":
            return httpx.Response(
                200,
                json={
                    "prompt-1": {
                        "status": {"status_str": "success", "completed": True},
                        "outputs": {"9": {"audio": [{"filename": "result.flac", "subfolder": "", "type": "output"}]}},
                    }
                },
            )
        if request.url.path == "/view":
            assert dict(request.url.params) == {"filename": "result.flac", "subfolder": "", "type": "output"}
            return httpx.Response(200, content=transport)
        return httpx.Response(404)

    progress: list[dict] = []
    generator = _make_generator(tmp_path, handler)
    result = generator.generate(
        "medium", "  exact\ntext  ", 4.0, 17, tmp_path / "raw.wav",
        {"steps": 12, "cfg_scale": 2.5}, progress_callback=progress.append,
    )

    assert (tmp_path / "raw.wav").is_file()
    assert result["backend"] == "comfyui"
    assert result["model_id"] == "Comfy-Org/stable-audio-3"
    assert result["model_revision"] == "rev-1"
    assert result["arguments"]["prompt"] == "  exact\ntext  "
    assert result["actual_arguments"]["duration"] == 4
    assert result["raw_output"]["frames"] == 4
    assert result["raw_output"]["channels"] == 1
    assert result["transport_output"]["format"] == "flac"
    assert result["server_version"] == "0.35.1"
    assert result["prompt_id"] == "prompt-1"
    assert [event["stage"] for event in progress] == ["queued", "finalizing"]
    assert all(event["indeterminate"] for event in progress)
    assert not list(tmp_path.glob("*.comfyui-*part"))
    assert not any(path == "/interrupt" for _, path, _ in calls)


def test_missing_model_combo_fails_before_prompt(tmp_path: Path):
    (tmp_path / "stable-audio.api.json").write_text(json.dumps(_workflow()), encoding="utf-8")
    requested: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requested.append(request.url.path)
        if request.url.path == "/object_info":
            info = _object_info()
            info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"] = ["COMBO", ["other.safetensors"]]
            return httpx.Response(200, json=info)
        return httpx.Response(404)

    client = httpx.Client(transport=httpx.MockTransport(handler), base_url="http://127.0.0.1:8188")
    generator = ComfyUiGenerator(_registry(), tmp_path, http_client=client)
    with pytest.raises(ComfyUiModelError, match="fehlt|verfügbar"):
        generator.generate("medium", "click", 1, 1, tmp_path / "raw.wav")
    assert "/prompt" not in requested


@pytest.mark.parametrize("parameters, message", [
    ({"steps": 0}, "steps"),
    ({"cfg_scale": float("nan")}, "cfg_scale"),
    ({"sampler": "euler"}, "Nicht unterstützter"),
])
def test_parameters_are_validated_before_prompt(tmp_path: Path, parameters, message):
    paths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        paths.append(request.url.path)
        if request.url.path == "/object_info":
            return httpx.Response(200, json=_object_info())
        return httpx.Response(404)

    generator = _make_generator(tmp_path, handler)
    with pytest.raises(Exception, match=message):
        generator.generate("medium", "click", 1, 1, tmp_path / "raw.wav", parameters)
    assert "/prompt" not in paths


def test_timeout_deletes_only_own_queue_entry_and_mentions_remote_uncertainty(tmp_path: Path):
    paths: list[tuple[str, str, dict]] = []
    ticks = iter([0.0, 0.0, 0.0, 1.0])

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content) if request.content else {}
        paths.append((request.method, request.url.path, body))
        if request.url.path == "/object_info":
            return httpx.Response(200, json=_object_info())
        if request.url.path == "/system_stats":
            return httpx.Response(404)
        if request.url.path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "own-job"})
        if request.url.path == "/history/own-job":
            return httpx.Response(200, json={})
        if request.url.path == "/queue":
            if request.method == "GET":
                return httpx.Response(200, json={"queue_pending": [[1, "own-job"]], "queue_running": []})
            assert body == {"delete": ["own-job"]}
            return httpx.Response(200, json={})
        return httpx.Response(404)

    generator = _make_generator(tmp_path, handler, job_timeout_seconds=0.5, monotonic_fn=lambda: next(ticks))
    with pytest.raises(ComfyUiTimeoutError, match="weiterlaufen"):
        generator.generate("medium", "click", 1, 1, tmp_path / "raw.wav")
    assert ("POST", "/queue", {"delete": ["own-job"]}) in paths
    assert not any(path in ("/interrupt", "/free", "/history") and method == "POST" for method, path, _ in paths)


@pytest.mark.parametrize("url", [
    "https://example.com",
    "http://127.0.0.1:8188/evil",
    "http://user@127.0.0.1:8188",
    "http://127.0.0.2:8188",
])
def test_base_url_is_local_only(url: str, tmp_path: Path):
    with pytest.raises(ComfyUiConfigError):
        ComfyUiGenerator({}, tmp_path, base_url=url)


def test_existing_raw_is_never_overwritten_or_posted(tmp_path: Path):
    output = tmp_path / "raw.wav"
    output.write_bytes(b"keep")
    called = False

    def handler(request: httpx.Request) -> httpx.Response:
        nonlocal called
        called = True
        return httpx.Response(500)

    generator = _make_generator(tmp_path, handler)
    with pytest.raises(Exception, match="overwrite"):
        generator.generate("medium", "click", 1, 1, output)
    assert output.read_bytes() == b"keep"
    assert called is False


def test_malformed_audio_is_rejected_and_temp_is_cleaned(tmp_path: Path):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/object_info":
            return httpx.Response(200, json=_object_info())
        if request.url.path == "/system_stats":
            return httpx.Response(404)
        if request.url.path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "bad"})
        if request.url.path == "/history/bad":
            return httpx.Response(200, json={"bad": {"status": {"status_str": "success", "completed": True}, "outputs": {"9": {"audio": [{"filename": "x.flac", "type": "output"}]}}}})
        if request.url.path == "/view":
            return httpx.Response(200, content=b"not flac")
        return httpx.Response(404)

    generator = _make_generator(tmp_path, handler)
    with pytest.raises(ComfyUiOutputError):
        generator.generate("medium", "click", 1, 1, tmp_path / "raw.wav")
    assert not (tmp_path / "raw.wav").exists()
    assert not list(tmp_path.glob("*.comfyui-*part"))


def test_execution_error_reports_exception_message_before_generic_status(tmp_path: Path):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/object_info":
            return httpx.Response(200, json=_object_info())
        if request.url.path == "/system_stats":
            return httpx.Response(404)
        if request.url.path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "broken"})
        if request.url.path == "/history/broken":
            return httpx.Response(200, json={"broken": {"status": {
                "status_str": "error",
                "completed": True,
                "messages": [["execution_error", {"exception_type": "TypeError", "exception_message": "format is required"}]],
            }}})
        return httpx.Response(404)

    generator = _make_generator(tmp_path, handler)
    with pytest.raises(ComfyUiJobError, match="format is required"):
        generator.generate("medium", "click", 1, 1, tmp_path / "raw.wav")


def test_fresh_preflight_detects_stopped_server_after_previous_success(tmp_path):
    stopped = False

    def handler(request):
        if stopped:
            raise httpx.ConnectError("connection refused", request=request)
        return httpx.Response(200, json=_object_info() if request.url.path == "/object_info" else {})

    generator = _make_generator(tmp_path, handler)
    generator.load_model("medium")
    stopped = True
    with pytest.raises(ComfyUiUnavailableError, match="nicht erreichbar"):
        generator.load_model("medium")


def test_uncertain_submit_is_never_retried(tmp_path):
    posts = []

    def handler(request):
        if request.method == "POST":
            posts.append(request.url.path)
            raise httpx.ReadTimeout("response lost", request=request)
        return httpx.Response(200, json=_object_info() if request.url.path == "/object_info" else {})

    generator = _make_generator(tmp_path, handler)
    with pytest.raises(ComfyUiUnavailableError, match="trotzdem laufen"):
        generator.generate("medium", "impact", 2.0, 10, tmp_path / "raw.wav")
    assert posts == ["/prompt"]


@pytest.mark.parametrize("problem", ["workflow", "node", "binding"])
def test_missing_workflow_node_or_required_binding_never_submits(tmp_path, problem):
    calls = []

    def handler(request):
        calls.append(request.method)
        info = _object_info()
        if problem == "node":
            del info["StableAudioSampler"]
        return httpx.Response(200, json=info)

    generator = _make_generator(tmp_path, handler)
    if problem == "workflow":
        (tmp_path / "stable-audio.api.json").unlink()
    if problem == "binding":
        del generator.registry["medium"]["bindings"]["prompt"]
    with pytest.raises((ComfyUiModelError, ComfyUiConfigError)):
        generator.load_model("medium")
    assert "POST" not in calls


def test_other_jobs_and_incomplete_outputs_cannot_complete_our_job(tmp_path):
    polls = 0

    def handler(request):
        nonlocal polls
        path = request.url.path
        if path == "/object_info":
            return httpx.Response(200, json=_object_info())
        if path == "/system_stats":
            return httpx.Response(200, json={})
        if path == "/prompt":
            return httpx.Response(200, json={"prompt_id": "ours"})
        if path == "/history/ours":
            polls += 1
            return httpx.Response(200, json={
                "someone-else": {"status": {"completed": True}, "outputs": {"9": {"audio": [{"filename": "foreign.flac"}]}}},
                "ours": {"status": {"completed": polls > 1, "status_str": "success" if polls > 1 else "running"}, "outputs": {"9": {"audio": [{"filename": "ours.flac", "type": "output"}]}}},
            })
        if path == "/queue":
            return httpx.Response(200, json={"queue_running": [[1, "ours"]], "queue_pending": []})
        if path == "/view":
            assert polls == 2 and request.url.params["filename"] == "ours.flac"
            return httpx.Response(200, content=_transport_audio())
        raise AssertionError(path)

    generator = _make_generator(tmp_path, handler)
    assert generator.generate("medium", "impact", 2.0, 1, tmp_path / "raw.wav")["prompt_id"] == "ours"


def test_streaming_download_checks_limit_before_consuming_body(tmp_path, monkeypatch):
    import audio_studio.comfyui as module
    monkeypatch.setattr(module, "MAX_DOWNLOAD_BYTES", 10)
    consumed = []

    class AudioStream(httpx.SyncByteStream):
        def __iter__(self):
            consumed.append(True)
            yield b"data"

    generator = _make_generator(tmp_path, lambda request: httpx.Response(200, headers={"content-length": "1000"}, stream=AudioStream()))
    with pytest.raises(ComfyUiOutputError, match="Downloadlimit"):
        generator._download_output({"filename": "ours.flac", "type": "output"}, tmp_path / "raw.wav", "flac")
    assert not consumed
    assert not (tmp_path / "raw.wav").exists()


def test_missing_remote_audio_is_an_actionable_http_error(tmp_path):
    generator = _make_generator(tmp_path, lambda request: httpx.Response(404))
    with pytest.raises(ComfyUiUnavailableError, match="404.*Audio-Datei"):
        generator._download_output({"filename": "ours.flac", "type": "output"}, tmp_path / "raw.wav", "flac")


@pytest.mark.parametrize("duration", [True, "2", 1.5, float("nan"), 0, 381])
def test_invalid_durations_never_submit(tmp_path, duration):
    generator = _make_generator(tmp_path, lambda request: httpx.Response(200, json=_object_info() if request.url.path == "/object_info" else {}))
    with pytest.raises(ComfyUiJobError, match="duration_seconds"):
        generator.generate("medium", "impact", duration, 1, tmp_path / "raw.wav")
