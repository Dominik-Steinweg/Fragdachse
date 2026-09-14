"""Small, synchronous HTTP adapter for a local ComfyUI audio workflow.

The adapter deliberately speaks only the stable HTTP queue/history/view routes.
It does not start or stop ComfyUI, use a websocket, call global interrupt/free
routes, or make a second attempt after an uncertain POST.
"""

from __future__ import annotations

import copy
import hashlib
import json
import math
import os
import secrets
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit

import httpx
import numpy as np
import soundfile as sf


MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024
MAX_DECODED_AUDIO_BYTES = 256 * 1024 * 1024
REQUIRED_BINDINGS = frozenset({"prompt", "duration", "seed", "filename_prefix"})


class ComfyUiError(RuntimeError):
    """Base class for an actionable local ComfyUI failure."""


class ComfyUiConfigError(ComfyUiError):
    """The registry, workflow, or ComfyUI node schema is invalid."""


class ComfyUiUnavailableError(ComfyUiError):
    """ComfyUI could not be reached or returned an invalid HTTP response."""


class ComfyUiModelError(ComfyUiError):
    """The requested workflow or model is not available in ComfyUI."""


class ComfyUiJobError(ComfyUiError):
    """The remote ComfyUI execution failed or was interrupted."""


class ComfyUiTimeoutError(ComfyUiError):
    """The bounded wait expired; the remote job may still be running."""


class ComfyUiOutputError(ComfyUiError):
    """ComfyUI returned no valid, bounded WAV output."""


# Short aliases make integration code read naturally while retaining the
# backend-specific names above for callers that want to catch one class.
ComfyUIError = ComfyUiError
ComfyUIConfigError = ComfyUiConfigError
ComfyUIUnavailableError = ComfyUiUnavailableError
ComfyUIModelError = ComfyUiModelError
ComfyUIJobError = ComfyUiJobError
ComfyUITimeoutError = ComfyUiTimeoutError
ComfyUIOutputError = ComfyUiOutputError


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_hash(value: Any) -> str:
    return _sha256_bytes(
        json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode(
            "utf-8"
        )
    )


def _is_integer(value: Any) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


def _safe_component(value: Any, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ComfyUiOutputError(f"ComfyUI-Ausgabe {label} fehlt oder ist ungültig.")
    if "\x00" in value or "\\" in value or ":" in value:
        raise ComfyUiOutputError(f"ComfyUI-Ausgabe {label} enthält einen ungültigen Pfad.")
    path = PurePosixPath(value)
    if path.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise ComfyUiOutputError(f"ComfyUI-Ausgabe {label} enthält einen absoluten oder Traversal-Pfad.")
    return value


class ComfyUiGenerator:
    """Generate one raw WAV at a time through a local ComfyUI server.

    ``registry`` is intentionally a plain mapping.  The parent router owns
    model-lock/license policy and can pass the authored model registry without
    making this backend know about catalog files.
    """

    def __init__(
        self,
        registry: Mapping[str, Mapping[str, Any]],
        workflow_root: Path | str,
        base_url: str = "http://127.0.0.1:8188",
        *,
        http_client: httpx.Client | None = None,
        timeout_seconds: float = 600.0,
        job_timeout_seconds: float | None = None,
        http_timeout_seconds: float = 15.0,
        poll_interval: float = 0.25,
        sleep_fn: Callable[[float], None] = time.sleep,
        monotonic_fn: Callable[[], float] = time.monotonic,
        now_fn: Callable[[], str] = _utc_now,
    ) -> None:
        self._base_url = self._validate_base_url(base_url)
        if not isinstance(registry, Mapping):
            raise ComfyUiConfigError("ComfyUI-Modellregistry muss ein Mapping sein.")
        self.registry = dict(registry)
        self.workflow_root = Path(workflow_root)
        if job_timeout_seconds is not None:
            timeout_seconds = job_timeout_seconds
        if timeout_seconds <= 0 or not math.isfinite(float(timeout_seconds)):
            raise ComfyUiConfigError("timeout_seconds muss eine positive endliche Zahl sein.")
        if poll_interval < 0 or not math.isfinite(float(poll_interval)):
            raise ComfyUiConfigError("poll_interval muss eine endliche Zahl >= 0 sein.")
        if http_timeout_seconds <= 0 or not math.isfinite(float(http_timeout_seconds)):
            raise ComfyUiConfigError("http_timeout_seconds muss eine positive endliche Zahl sein.")
        self.timeout_seconds = float(timeout_seconds)
        self.poll_interval = float(poll_interval)
        self.http_timeout_seconds = float(http_timeout_seconds)
        self._sleep = sleep_fn
        self._monotonic = monotonic_fn
        self._now = now_fn
        self._owns_client = http_client is None
        self._client = http_client or httpx.Client(
            base_url=self._base_url,
            timeout=http_timeout_seconds,
            follow_redirects=False,
            trust_env=False,
        )
        self.client_id = f"audio-studio-{uuid.uuid4().hex}"
        self._loaded_model_name: str | None = None
        self._loaded_model: dict[str, Any] | None = None
        self._object_info: Mapping[str, Any] | None = None
        self._server_version: str | None = None

    @staticmethod
    def _validate_base_url(base_url: str) -> str:
        if not isinstance(base_url, str):
            raise ComfyUiConfigError("ComfyUI base_url muss eine URL sein.")
        try:
            parsed = urlsplit(base_url)
            hostname = parsed.hostname
            port = parsed.port
        except ValueError as exc:
            raise ComfyUiConfigError("ComfyUI base_url enthält einen ungültigen Port.") from exc
        if parsed.scheme not in ("http", "https") or hostname is None:
            raise ComfyUiConfigError("ComfyUI base_url muss http(s) verwenden.")
        if parsed.username is not None or parsed.password is not None:
            raise ComfyUiConfigError("ComfyUI base_url darf keine Zugangsdaten enthalten.")
        if parsed.query or parsed.fragment or parsed.path not in ("", "/"):
            raise ComfyUiConfigError("ComfyUI base_url darf keinen Pfad, Query oder Fragment enthalten.")
        normalized_host = hostname.lower().rstrip(".")
        if normalized_host not in {"localhost", "127.0.0.1", "::1"}:
            raise ComfyUiConfigError("ComfyUI base_url darf nur auf localhost/127.0.0.1/::1 zeigen.")
        if port is not None and not 1 <= port <= 65535:
            raise ComfyUiConfigError("ComfyUI base_url enthält einen ungültigen Port.")
        return base_url.rstrip("/")

    @property
    def loaded_model_name(self) -> str | None:
        return self._loaded_model_name

    @property
    def is_loaded(self) -> bool:
        return self._loaded_model_name is not None

    def close(self) -> None:
        if self._owns_client:
            self._client.close()

    def __enter__(self) -> "ComfyUiGenerator":
        return self

    def __exit__(self, *_args: Any) -> None:
        self.close()

    def unload(self) -> None:
        """ComfyUI owns remote GPU state; never stop or unload its service."""

        return None

    def _request(self, method: str, path: str, *, optional: bool = False, **kwargs: Any) -> httpx.Response | None:
        target = self._target(path)
        kwargs.setdefault("timeout", self.http_timeout_seconds)
        try:
            response = self._client.request(method, target, follow_redirects=False, **kwargs)
        except httpx.RequestError as exc:
            if optional:
                return None
            if method.upper() == "POST" and path == "/prompt":
                raise ComfyUiUnavailableError(
                    f"ComfyUI /prompt wurde nicht bestätigt; der Remote-Auftrag kann trotzdem laufen, kein Retry: {exc}"
                ) from exc
            raise ComfyUiUnavailableError(f"ComfyUI ist nicht erreichbar: {exc}") from exc
        if not 200 <= response.status_code < 300:
            if optional:
                return None
            detail = response.text[:500].strip()
            raise ComfyUiUnavailableError(
                f"ComfyUI HTTP {response.status_code} für {method} {path}: {detail or 'keine Details'}"
            )
        return response

    def _target(self, path: str) -> str:
        try:
            base_url = str(self._client.base_url)
        except AttributeError:
            return self._base_url + path
        if base_url in ("", "http://"):
            return self._base_url + path
        return path

    @contextmanager
    def _stream_get(self, path: str, **kwargs: Any):
        """Open a bounded response stream without buffering the remote body."""

        kwargs.setdefault("timeout", self.http_timeout_seconds)
        target = self._target(path)
        try:
            stream = self._client.stream("GET", target, follow_redirects=False, **kwargs)
        except TypeError:
            stream = self._client.stream("GET", target, **kwargs)
        try:
            with stream as response:
                if not 200 <= response.status_code < 300:
                    raise ComfyUiUnavailableError(
                        f"ComfyUI HTTP {response.status_code} beim Abruf der Audio-Datei ({path})."
                    )
                yield response
        except httpx.TimeoutException as exc:
            raise ComfyUiUnavailableError(f"ComfyUI GET {path} überschritt das HTTP-Zeitlimit.") from exc
        except httpx.RequestError as exc:
            raise ComfyUiUnavailableError(f"ComfyUI ist nicht erreichbar: {exc}") from exc

    def _json(self, method: str, path: str, *, optional: bool = False, **kwargs: Any) -> Any:
        response = self._request(method, path, optional=optional, **kwargs)
        if response is None:
            return None
        try:
            return response.json()
        except ValueError as exc:
            raise ComfyUiUnavailableError(f"ComfyUI lieferte kein gültiges JSON für {path}.") from exc

    @staticmethod
    def _workflow_path(root: Path, filename: Any) -> Path:
        if not isinstance(filename, str) or not filename:
            raise ComfyUiConfigError("ComfyUI workflow fehlt im Modellregistry.")
        relative = Path(filename)
        if relative.is_absolute() or any(part in ("", ".", "..") for part in relative.parts):
            raise ComfyUiConfigError(f"ComfyUI workflow-Pfad ist unsicher: {filename!r}.")
        path = (root / relative).resolve()
        try:
            path.relative_to(root.resolve())
        except ValueError as exc:
            raise ComfyUiConfigError(f"ComfyUI workflow liegt außerhalb von workflow_root: {filename!r}.") from exc
        return path

    @staticmethod
    def _schema_inputs(info: Mapping[str, Any]) -> Mapping[str, Any]:
        inputs = info.get("input")
        if not isinstance(inputs, Mapping):
            raise ComfyUiConfigError("ComfyUI object_info enthält kein unterstütztes input-Schema.")
        result: dict[str, Any] = {}
        for section in ("required", "optional"):
            values = inputs.get(section, {})
            if values is None:
                continue
            if not isinstance(values, Mapping):
                raise ComfyUiConfigError(f"ComfyUI object_info input.{section} ist ungültig.")
            result.update(values)
        return result

    @staticmethod
    def _combo_values(definition: Any) -> list[str] | None:
        if not isinstance(definition, (list, tuple)) or not definition:
            return None
        kind = definition[0]
        # ComfyUI has emitted both ["COMBO", {...}] and the older
        # [["filename-a", "filename-b"], {...}] shape.  Newer dynamic
        # combos use a named COMFY_DYNAMICCOMBO_V3 type.
        if isinstance(kind, (list, tuple)):
            return [str(value) for value in kind]
        if str(kind).upper() not in {"COMBO", "COMFY_DYNAMICCOMBO_V3"}:
            return None
        if len(definition) < 2:
            return []
        options = definition[1]
        if isinstance(options, Mapping):
            for key in ("enum", "values", "options"):
                candidate = options.get(key)
                if isinstance(candidate, (list, tuple)):
                    if candidate and all(isinstance(item, Mapping) and "key" in item for item in candidate):
                        return [str(item["key"]) for item in candidate]
                    return [str(value) for value in candidate]
            return []
        if isinstance(options, (list, tuple)):
            return [str(value) for value in options]
        return []

    @classmethod
    def _validate_workflow(
        cls,
        model_name: str,
        config: Mapping[str, Any],
        workflow: Mapping[str, Any],
        object_info: Mapping[str, Any],
    ) -> tuple[dict[str, Any], list[str]]:
        if not isinstance(workflow, Mapping) or not workflow:
            raise ComfyUiConfigError(f"ComfyUI workflow für {model_name} muss ein nicht-leeres Graph-Mapping sein.")
        node_schemas: dict[str, Mapping[str, Any]] = {}
        model_filenames: list[str] = []
        for node_id, node in workflow.items():
            key = str(node_id)
            if not isinstance(node, Mapping):
                raise ComfyUiConfigError(f"ComfyUI workflow node {key!r} ist ungültig.")
            class_type = node.get("class_type")
            inputs = node.get("inputs")
            if not isinstance(class_type, str) or not class_type:
                raise ComfyUiConfigError(f"ComfyUI workflow node {key!r} braucht class_type.")
            if not isinstance(inputs, Mapping):
                raise ComfyUiConfigError(f"ComfyUI workflow node {key!r} braucht inputs.")
            info = object_info.get(class_type)
            if not isinstance(info, Mapping):
                raise ComfyUiConfigError(
                    f"ComfyUI unterstützt workflow node {class_type!r} nicht (object_info-Version inkompatibel)."
                )
            schema = cls._schema_inputs(info)
            node_schemas[key] = schema
            required_schema = info.get("input", {}).get("required", {})
            if isinstance(required_schema, Mapping):
                missing = [name for name in required_schema if name not in inputs]
                if missing:
                    raise ComfyUiConfigError(
                        f"ComfyUI workflow node {key!r} fehlen required inputs: {', '.join(map(str, missing))}."
                    )
            for input_name, value in inputs.items():
                if input_name not in schema:
                    raise ComfyUiConfigError(
                        f"ComfyUI object_info kennt {class_type}.{input_name} nicht; Workflow-Version inkompatibel."
                    )
                choices = cls._combo_values(schema[input_name])
                if choices is not None and isinstance(value, str):
                    if value not in choices:
                        raise ComfyUiModelError(
                            f"ComfyUI-Modell/Combo-Wert {value!r} für {class_type}.{input_name} fehlt in ComfyUI."
                        )
                    lowered = input_name.lower()
                    if any(token in lowered for token in ("model", "checkpoint", "ckpt", "clip_name")):
                        model_filenames.append(value)

            if "batch_size" in inputs:
                batch = inputs["batch_size"]
                if not _is_integer(batch) or batch != 1:
                    raise ComfyUiConfigError("ComfyUI workflow batch_size muss fest auf 1 stehen.")

        output_node = str(config.get("output_node", ""))
        if output_node not in node_schemas:
            raise ComfyUiConfigError(f"ComfyUI output_node {output_node!r} fehlt im Workflow.")
        bindings = config.get("bindings")
        if not isinstance(bindings, Mapping):
            raise ComfyUiConfigError("ComfyUI Modellregistry braucht bindings.")
        missing_bindings = sorted(REQUIRED_BINDINGS.difference(bindings))
        if missing_bindings:
            raise ComfyUiConfigError(
                f"ComfyUI Modellregistry fehlen Pflichtbindungen: {', '.join(missing_bindings)}."
            )
        for binding_name, locations in bindings.items():
            if not isinstance(locations, (list, tuple)) or not locations:
                raise ComfyUiConfigError(f"ComfyUI binding {binding_name!r} ist leer oder ungültig.")
            for location in locations:
                if not isinstance(location, (list, tuple)) or len(location) != 2:
                    raise ComfyUiConfigError(f"ComfyUI binding {binding_name!r} braucht [node, input].")
                node_id, input_name = str(location[0]), str(location[1])
                if node_id not in node_schemas:
                    raise ComfyUiConfigError(f"ComfyUI binding {binding_name!r} verweist auf fehlenden Node {node_id!r}.")
                if input_name not in node_schemas[node_id]:
                    raise ComfyUiConfigError(
                        f"ComfyUI binding {binding_name!r} verweist auf unbekannten Input {node_id}.{input_name}."
                    )
        registry_model_filename = config.get("model_filename")
        if registry_model_filename is not None:
            if not isinstance(registry_model_filename, str) or registry_model_filename not in model_filenames:
                raise ComfyUiModelError(
                    f"ComfyUI-Modell {registry_model_filename!r} ist in object_info nicht verfügbar."
                )
        return dict(node_schemas), sorted(set(model_filenames))

    def _read_model(self, model_name: str) -> tuple[dict[str, Any], Path, dict[str, Any], str]:
        config = self.registry.get(model_name)
        if not isinstance(config, Mapping):
            raise ComfyUiModelError(f"Unbekanntes ComfyUI-Modell {model_name!r}.")
        if config.get("backend") != "comfyui":
            raise ComfyUiModelError(f"Modell {model_name!r} gehört nicht zum ComfyUI-Backend.")
        workflow_path = self._workflow_path(self.workflow_root, config.get("workflow"))
        if not workflow_path.is_file():
            raise ComfyUiModelError(f"ComfyUI workflow fehlt: {workflow_path}")
        try:
            workflow_bytes = workflow_path.read_bytes()
            workflow = json.loads(workflow_bytes.decode("utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ComfyUiConfigError(f"ComfyUI workflow ist nicht lesbares JSON: {workflow_path}") from exc
        object_info = self._json("GET", "/object_info")
        if not isinstance(object_info, Mapping):
            raise ComfyUiUnavailableError("ComfyUI object_info ist kein gültiges Objekt.")
        self._validate_workflow(model_name, config, workflow, object_info)
        output_format = str(config.get("output_format", "wav")).lower()
        if output_format not in ("wav", "flac"):
            raise ComfyUiConfigError(f"Nicht unterstütztes ComfyUI output_format: {output_format!r}")
        config_copy = copy.deepcopy(dict(config))
        config_copy["_workflow"] = workflow
        config_copy["_workflow_bytes"] = workflow_bytes
        config_copy["_workflow_path"] = str(workflow_path)
        config_copy["_object_info"] = object_info
        config_copy["_template_sha256"] = _sha256_bytes(workflow_bytes)
        return config_copy, workflow_path, dict(workflow), config_copy["_template_sha256"]

    def _read_server_version(self) -> str | None:
        stats = self._json("GET", "/system_stats", optional=True)
        if not isinstance(stats, Mapping):
            return None
        for key in ("version", "comfyui_version", "server_version"):
            if stats.get(key) is not None:
                return str(stats[key])
        system = stats.get("system")
        if isinstance(system, Mapping):
            for key in ("version", "comfyui_version", "server_version"):
                if system.get(key) is not None:
                    return str(system[key])
        return None

    def load_model(self, model_name: str) -> Mapping[str, Any]:
        # ComfyUI can stop or change its model inventory independently of this
        # client. A stale preflight must never evict a working Python model.
        config, _path, _workflow, _digest = self._read_model(model_name)
        self._loaded_model_name = model_name
        self._loaded_model = config
        self._object_info = config["_object_info"]
        self._server_version = self._read_server_version()
        return config

    def _validate_generation_inputs(
        self, model_name: str, config: Mapping[str, Any], prompt: str, duration_seconds: Any, seed: Any, parameters: Mapping[str, Any] | None
    ) -> tuple[int, int, dict[str, Any]]:
        if not isinstance(prompt, str) or not prompt.strip():
            raise ComfyUiJobError("prompt muss ein nicht-leerer String sein; sein Inhalt wird unverändert übertragen.")
        if not _is_integer(duration_seconds) and not (
            isinstance(duration_seconds, float)
            and math.isfinite(duration_seconds)
            and duration_seconds.is_integer()
        ):
            raise ComfyUiJobError("duration_seconds muss eine positive ganze Zahl sein.")
        duration = int(duration_seconds)
        if duration <= 0:
            raise ComfyUiJobError("duration_seconds muss eine positive ganze Zahl sein.")
        maximum = config.get("max_duration_seconds")
        if not isinstance(maximum, (int, float)) or duration > float(maximum):
            raise ComfyUiJobError(
                f"duration_seconds={duration} überschreitet das ComfyUI-Modelllimit von {maximum!s} Sekunden."
            )
        if seed is None:
            actual_seed = secrets.randbelow(2_147_483_647)
        elif _is_integer(seed):
            actual_seed = seed
        else:
            raise ComfyUiJobError("seed muss eine ganze Zahl oder None sein.")
        if not 0 <= actual_seed <= 2**64 - 1:
            raise ComfyUiJobError("seed muss zwischen 0 und 2^64-1 liegen.")
        if parameters is None:
            supplied: dict[str, Any] = {}
        elif isinstance(parameters, Mapping):
            supplied = dict(parameters)
        else:
            raise ComfyUiJobError("parameters muss ein Mapping sein.")
        bindings = config.get("bindings")
        if not isinstance(bindings, Mapping):
            raise ComfyUiConfigError("ComfyUI Modellregistry braucht bindings.")
        for key in supplied:
            if key in {"prompt", "duration", "seed", "filename_prefix"}:
                raise ComfyUiJobError(f"{key} wird vom Adapter gebunden und darf nicht über parameters überschrieben werden.")
            if key not in bindings:
                raise ComfyUiJobError(f"Nicht unterstützter ComfyUI-Parameter: {key}")
        if "steps" in supplied:
            steps = supplied["steps"]
            if not _is_integer(steps) or steps <= 0:
                raise ComfyUiJobError("steps muss eine positive ganze Zahl sein.")
        if "cfg_scale" in supplied:
            cfg = supplied["cfg_scale"]
            if isinstance(cfg, bool) or not isinstance(cfg, (int, float)) or not math.isfinite(float(cfg)) or cfg < 0:
                raise ComfyUiJobError("cfg_scale muss eine endliche Zahl >= 0 sein.")
        object_info = config.get("_object_info")
        if isinstance(object_info, Mapping):
            for name in ("steps", "cfg_scale"):
                if name not in supplied:
                    continue
                for location in bindings.get(name, []):
                    node_id, input_name = str(location[0]), str(location[1])
                    node = config["_workflow"].get(node_id, {})
                    class_type = node.get("class_type") if isinstance(node, Mapping) else None
                    info = object_info.get(class_type) if class_type else None
                    schema = self._schema_inputs(info) if isinstance(info, Mapping) else {}
                    definition = schema.get(input_name)
                    options = definition[1] if isinstance(definition, (list, tuple)) and len(definition) > 1 else {}
                    if isinstance(options, Mapping):
                        minimum, maximum = options.get("min"), options.get("max")
                        numeric = float(supplied[name])
                        if minimum is not None and numeric < float(minimum):
                            raise ComfyUiJobError(f"{name} unterschreitet ComfyUI-Minimum {minimum}.")
                        if maximum is not None and numeric > float(maximum):
                            raise ComfyUiJobError(f"{name} überschreitet ComfyUI-Maximum {maximum}.")
        if "batch_size" in supplied and (not _is_integer(supplied["batch_size"]) or supplied["batch_size"] != 1):
            raise ComfyUiJobError("batch_size ist fest auf 1 begrenzt.")
        return duration, actual_seed, supplied

    @staticmethod
    def _set_bindings(graph: dict[str, Any], bindings: Mapping[str, Any], values: Mapping[str, Any]) -> None:
        for name, value in values.items():
            for location in bindings.get(name, []):
                node_id, input_name = str(location[0]), str(location[1])
                graph[node_id]["inputs"][input_name] = copy.deepcopy(value)

    @staticmethod
    def _history_entry(history: Any, prompt_id: str) -> Mapping[str, Any] | None:
        if not isinstance(history, Mapping):
            return None
        entry = history.get(prompt_id)
        return entry if isinstance(entry, Mapping) else None

    @staticmethod
    def _status_error(status: Any) -> str | None:
        if not isinstance(status, Mapping):
            return None
        status_str = str(status.get("status_str", "")).lower()
        messages = status.get("messages", [])

        # Official history messages are [event_name, event_data] pairs. Prefer
        # their node and exception over the generic status_str="error".
        for message in messages if isinstance(messages, (list, tuple)) else []:
            if not isinstance(message, (list, tuple)) or len(message) != 2:
                continue
            event, data = message
            if event not in {"execution_error", "execution_interrupted"} or not isinstance(data, Mapping):
                continue
            label = f"Node {data.get('node_id', '?')} ({data.get('node_type', 'unbekannt')})"
            reason = data.get("exception_message") or data.get("exception_type") or "Auftrag wurde unterbrochen"
            return f"{label}: {str(reason).strip()}"

        def describe(value: Any) -> str:
            if isinstance(value, Mapping):
                for key in ("exception_message", "message", "error", "exception_type"):
                    if value.get(key):
                        return str(value[key])
            return str(value)

        def walk(value: Any) -> str | None:
            if isinstance(value, Mapping):
                for key, child in value.items():
                    lowered = str(key).lower()
                    if lowered in {
                        "execution_error", "error", "interrupt", "interrupted", "exception",
                        "exception_message",
                    }:
                        return describe(child)
                    found = walk(child)
                    if found:
                        return found
            elif isinstance(value, (list, tuple)):
                for child in value:
                    found = walk(child)
                    if found:
                        return found
            elif isinstance(value, str):
                lowered = value.lower()
                if (
                    ("execution_error" in lowered or "execution error" in lowered or "interrupted" in lowered)
                    and lowered not in {"execution_error", "execution error"}
                ):
                    return value
            return None

        message_error = walk(messages)
        if message_error:
            return message_error
        if any(value in status_str for value in ("error", "interrupt", "cancel")):
            return status_str
        return None

    @staticmethod
    def _queue_has_prompt(queue: Any, prompt_id: str) -> tuple[bool, bool]:
        if not isinstance(queue, Mapping):
            return False, False
        pending = running = False
        for key, is_running in (("queue_pending", False), ("queue_running", True)):
            entries = queue.get(key, [])
            if not isinstance(entries, (list, tuple)):
                continue
            for item in entries:
                candidate = None
                if isinstance(item, Mapping):
                    candidate = item.get("prompt_id") or item.get("id")
                elif isinstance(item, (list, tuple)) and len(item) > 1:
                    candidate = item[1]
                if str(candidate) == prompt_id:
                    if is_running:
                        running = True
                    else:
                        pending = True
        return pending, running

    def _progress(self, callback: Callable[[Mapping[str, Any]], None] | None, stage: str) -> None:
        if callback is not None:
            details = {
                "queued": "ComfyUI wartet auf den Auftrag",
                "sampling": "ComfyUI erzeugt Audio; Fortschritt ist unbestimmt",
                "finalizing": "ComfyUI-Ausgabe wird geprüft",
            }
            callback(
                {
                    "stage": stage,
                    "detail": details[stage],
                    "completed_steps": 0,
                    "total_steps": 0,
                    "indeterminate": True,
                }
            )

    def _delete_queued_prompt(self, prompt_id: str) -> None:
        try:
            self._request("POST", "/queue", json={"delete": [prompt_id]}, optional=True)
        except ComfyUiError:
            pass

    def _wait_for_history(
        self, prompt_id: str, progress_callback: Callable[[Mapping[str, Any]], None] | None
    ) -> Mapping[str, Any]:
        deadline = self._monotonic() + self.timeout_seconds
        self._progress(progress_callback, "queued")
        while True:
            history = self._json("GET", f"/history/{prompt_id}")
            entry = self._history_entry(history, prompt_id)
            if entry is not None:
                status = entry.get("status")
                reason = self._status_error(status)
                if reason:
                    raise ComfyUiJobError(f"ComfyUI-Auftrag {prompt_id} fehlgeschlagen/unterbrochen: {reason}")
                if isinstance(status, Mapping) and (
                    status.get("completed") is True or str(status.get("status_str", "")).lower() == "success"
                ):
                    self._progress(progress_callback, "finalizing")
                    return entry

            queue = self._json("GET", "/queue")
            pending, running = self._queue_has_prompt(queue, prompt_id)
            self._progress(progress_callback, "sampling" if running else "queued")
            now = self._monotonic()
            if now >= deadline:
                self._delete_queued_prompt(prompt_id)
                raise ComfyUiTimeoutError(
                    f"ComfyUI-Auftrag {prompt_id} überschritt das Zeitlimit; der entfernte/aktive Auftrag kann remote weiterlaufen."
                )
            remaining = max(0.0, deadline - now)
            self._sleep(min(self.poll_interval, remaining))

    @staticmethod
    def _promote_without_overwrite(source: Path, destination: Path) -> None:
        if destination.exists():
            raise ComfyUiOutputError(f"Refusing to overwrite existing raw output: {destination}")
        try:
            os.link(source, destination)
        except FileExistsError as exc:
            raise ComfyUiOutputError(f"Refusing to overwrite existing raw output: {destination}") from exc
        except OSError as exc:
            raise ComfyUiOutputError(f"RAW konnte nicht atomar angelegt werden: {exc}") from exc
        source.unlink()

    def _download_output(
        self, output: Mapping[str, Any], destination: Path, output_format: str = "wav"
    ) -> dict[str, Any]:
        filename = _safe_component(output.get("filename"), "filename")
        if "/" in filename:
            raise ComfyUiOutputError("ComfyUI filename muss ein einzelner Dateiname sein; Unterordner gehören in subfolder.")
        output_format = str(output_format).lower()
        if output_format not in ("wav", "flac"):
            raise ComfyUiConfigError(f"Nicht unterstütztes ComfyUI output_format: {output_format!r}")
        extension = "." + output_format
        if not filename.lower().endswith(extension):
            raise ComfyUiOutputError(f"ComfyUI lieferte keine {output_format.upper()}-Ausgabe.")
        subfolder = output.get("subfolder", "")
        if subfolder in (None, ""):
            subfolder = ""
        else:
            subfolder = _safe_component(subfolder, "subfolder")
        output_type = output.get("type")
        if output_type not in ("output", "temp"):
            raise ComfyUiOutputError("ComfyUI-Ausgabe type muss output oder temp sein.")
        params = {"filename": filename, "subfolder": subfolder, "type": output_type}
        temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.comfyui-{output_format}-part")
        total = 0
        try:
            with self._stream_get("/view", params=params) as response:
                content_length = response.headers.get("content-length")
                if content_length is not None:
                    try:
                        if int(content_length) > MAX_DOWNLOAD_BYTES:
                            raise ComfyUiOutputError("ComfyUI-Audio überschreitet das Downloadlimit von 256 MiB.")
                    except ValueError as exc:
                        raise ComfyUiOutputError("ComfyUI lieferte eine ungültige Content-Length.") from exc
                with temporary.open("xb") as handle:
                    for chunk in response.iter_bytes(1024 * 1024):
                        total += len(chunk)
                        if total > MAX_DOWNLOAD_BYTES:
                            raise ComfyUiOutputError("ComfyUI-Audio überschreitet das Downloadlimit von 256 MiB.")
                        handle.write(chunk)
            transport_hash = _sha256_file(temporary)
            try:
                info = sf.info(str(temporary))
                if info.format != output_format.upper():
                    raise ComfyUiOutputError(f"ComfyUI lieferte einen anderen Audiocontainer als {output_format.upper()}.")
                if info.frames <= 0 or info.channels not in (1, 2) or info.samplerate <= 0:
                    raise ComfyUiOutputError(
                        f"ComfyUI-{output_format.upper()} muss nicht-leer und mono oder stereo sein."
                    )
                if info.frames * info.channels * 4 > MAX_DECODED_AUDIO_BYTES:
                    raise ComfyUiOutputError("ComfyUI-Audio überschreitet das dekodierte Größenlimit von 256 MiB.")
                # FLAC is ComfyUI's native lossless transport.  Reading as
                # float32 and writing a float WAV preserves the decoded samples
                # without resampling, normalization, or duration cropping.
                data, sample_rate = sf.read(str(temporary), always_2d=True, dtype="float32")
                if data.size == 0 or data.shape[1] not in (1, 2) or not np.isfinite(data).all():
                    raise ComfyUiOutputError(
                        f"ComfyUI-{output_format.upper()} enthält keine endlichen mono/stereo Samples."
                    )
            except ComfyUiOutputError:
                raise
            except Exception as exc:
                raise ComfyUiOutputError(f"ComfyUI lieferte keine lesbare {output_format.upper()}-Datei: {exc}") from exc
            wav_temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.comfyui-wav-part")
            try:
                if output_format == "wav":
                    # Preserve the downloaded WAV bytes exactly.
                    os.replace(temporary, wav_temporary)
                else:
                    try:
                        sf.write(str(wav_temporary), data, int(sample_rate), format="WAV", subtype="FLOAT")
                    except Exception as exc:
                        raise ComfyUiOutputError(f"Konnte RAW-WAV nicht schreiben: {exc}") from exc
                    temporary.unlink()
                # Re-open the promoted source so metadata describes the actual
                # RAW-WAV bytes, including its final frame/channel count.
                wav_info = sf.info(str(wav_temporary))
                if wav_info.frames <= 0 or wav_info.channels not in (1, 2) or wav_info.samplerate <= 0:
                    raise ComfyUiOutputError("RAW-WAV muss nicht-leer und mono oder stereo sein.")
                _data_check, wav_rate = sf.read(str(wav_temporary), always_2d=True, dtype="float32")
                if _data_check.size == 0 or not np.isfinite(_data_check).all():
                    raise ComfyUiOutputError("RAW-WAV enthält keine endlichen Samples.")
                self._promote_without_overwrite(wav_temporary, destination)
            finally:
                try:
                    wav_temporary.unlink()
                except FileNotFoundError:
                    pass
            raw_hash = _sha256_file(destination)
            return {
                "path": str(destination),
                "sha256": raw_hash,
                "frames": int(info.frames),
                "samples": int(info.frames),
                "channels": int(info.channels),
                "duration_seconds": float(info.frames / sample_rate),
                "sample_rate": int(sample_rate),
                "filename": filename,
                "subfolder": subfolder,
                "type": output_type,
                "bytes": total,
                "transport_format": output_format,
                "transport_filename": filename,
                "transport_sha256": transport_hash,
                "transport_bytes": total,
            }
        finally:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass

    def _find_output(
        self, entry: Mapping[str, Any], output_node: str, output_format: str = "wav"
    ) -> Mapping[str, Any]:
        outputs = entry.get("outputs")
        if not isinstance(outputs, Mapping):
            raise ComfyUiOutputError("ComfyUI-Auftrag wurde abgeschlossen, enthält aber keine outputs.")
        node_output = outputs.get(output_node)
        if node_output is None:
            node_output = outputs.get(str(output_node))
        if not isinstance(node_output, Mapping):
            raise ComfyUiOutputError(f"ComfyUI output_node {output_node!r} fehlt in der Historie.")
        audio = node_output.get("audio")
        if not isinstance(audio, (list, tuple)):
            raise ComfyUiOutputError("ComfyUI output_node enthält kein audio-Feld.")
        extension = "." + str(output_format).lower()
        outputs = [
            item for item in audio
            if isinstance(item, Mapping) and str(item.get("filename", "")).lower().endswith(extension)
        ]
        if len(outputs) != 1:
            raise ComfyUiOutputError(
                f"ComfyUI-Ausgabe muss genau eine {output_format.upper()}-Datei enthalten (gefunden: {len(outputs)})."
            )
        return outputs[0]

    def generate(
        self,
        model_name: str,
        prompt: str,
        duration_seconds: float,
        seed: int | None,
        output_path: str | os.PathLike[str],
        parameters: Mapping[str, Any] | None = None,
        *,
        progress_callback: Callable[[Mapping[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        destination = Path(output_path)
        if destination.exists():
            raise ComfyUiJobError(f"Refusing to overwrite existing raw output: {destination}")
        destination.parent.mkdir(parents=True, exist_ok=True)
        config = self.load_model(model_name)
        duration, actual_seed, supplied = self._validate_generation_inputs(
            model_name, config, prompt, duration_seconds, seed, parameters
        )
        workflow = copy.deepcopy(config["_workflow"])
        filename_prefix = f"audio-studio/{self.client_id}-{uuid.uuid4().hex}"
        bindings = config["bindings"]
        graph_values: dict[str, Any] = {
            "prompt": prompt,
            "duration": duration,
            "seed": actual_seed,
            "filename_prefix": filename_prefix,
        }
        graph_values.update(supplied)
        self._set_bindings(workflow, bindings, graph_values)
        # Validate the rendered graph again: binding edits must still satisfy
        # the exact object_info schema and combo values before /prompt.
        self._validate_workflow(model_name, config, workflow, config["_object_info"])
        rendered_hash = _canonical_hash(workflow)
        prompt_payload = {"prompt": workflow, "client_id": self.client_id}
        started_at = self._now()
        started_clock = self._monotonic()
        response = self._request("POST", "/prompt", json=prompt_payload)
        assert response is not None
        try:
            posted = response.json()
        except ValueError as exc:
            raise ComfyUiJobError("ComfyUI /prompt lieferte kein gültiges JSON; der Remote-Auftrag ist unklar.") from exc
        prompt_id = posted.get("prompt_id") if isinstance(posted, Mapping) else None
        if not isinstance(prompt_id, str) or not prompt_id:
            raise ComfyUiJobError("ComfyUI /prompt lieferte keine prompt_id; der Remote-Auftrag ist unklar.")
        try:
            entry = self._wait_for_history(prompt_id, progress_callback)
            output_format = str(config.get("output_format", "wav")).lower()
            output = self._find_output(entry, str(config["output_node"]), output_format)
            raw = self._download_output(output, destination, output_format)
        except ComfyUiError as exc:
            if prompt_id in str(exc):
                raise
            raise type(exc)(f"{exc} ComfyUI-Auftrag: {prompt_id}. Vor erneutem Start dessen Status prüfen.") from exc
        finished_at = self._now()
        elapsed = self._monotonic() - started_clock
        actual_parameters = dict(supplied)
        actual_arguments = {
            "prompt": prompt,
            "duration": duration,
            "seed": actual_seed,
            **actual_parameters,
            "batch_size": 1,
        }
        model_id = config.get("model_id")
        model_revision = config.get("model_revision")
        model_filenames = []
        for node in workflow.values():
            if isinstance(node, Mapping):
                inputs = node.get("inputs", {})
                if isinstance(inputs, Mapping):
                    for key, value in inputs.items():
                        if isinstance(value, str) and any(token in str(key).lower() for token in ("model", "checkpoint", "ckpt", "clip_name")):
                            model_filenames.append(value)
        metadata = {
            "schema_version": 1,
            "backend": "comfyui",
            "model_name": model_name,
            "model_id": model_id,
            "model_revision": model_revision,
            "model": {
                "name": model_name,
                "id": model_id,
                "revision": model_revision,
                "revision_provenance": "registry_declared",
                "revision_verified": False,
            },
            "arguments": {
                "prompt": prompt,
                "duration_seconds": float(duration_seconds),
                "seed": actual_seed,
                "parameters": actual_parameters,
            },
            "actual_arguments": actual_arguments,
            "duration_policy": "whole_seconds_only",
            "sample_rate": raw["sample_rate"],
            "raw_output": raw,
            "raw_hash": raw["sha256"],
            "transport_output": {
                "format": raw["transport_format"],
                "filename": raw["transport_filename"],
                "sha256": raw["transport_sha256"],
                "bytes": raw["transport_bytes"],
            },
            "started_at_utc": started_at,
            "finished_at_utc": finished_at,
            "elapsed_seconds": elapsed,
            "prompt_id": prompt_id,
            "client_id": self.client_id,
            "filename_prefix": filename_prefix,
            "model_filenames": sorted(set(model_filenames)),
            "server_version": self._server_version,
            "model_revision_provenance": "registry_declared",
            "model_revision_verified": False,
            "workflow_template": config["_workflow_path"],
            "workflow_template_sha256": config["_template_sha256"],
            "workflow_template_digest": config["_template_sha256"],
            "rendered_graph_sha256": rendered_hash,
            "rendered_graph_hash": rendered_hash,
            "actual_graph": workflow,
            "runtime": {"server_version": self._server_version, "client_id": self.client_id},
        }
        return metadata

    def doctor(self, model_name: str | None = None) -> dict[str, Any]:
        names = [model_name] if model_name is not None else list(self.registry)
        models: dict[str, Any] = {}
        for name in names:
            status: dict[str, Any] = {
                "available": False,
                "feasible": False,
                "ready": False,
                "workflow": None,
                "node_details": {},
                "model": None,
                "error": None,
            }
            try:
                config = self.load_model(name)
                status.update(
                    {
                        "available": True,
                        "feasible": True,
                        "ready": True,
                        "workflow": config.get("_workflow_path"),
                        "model": {
                            "id": config.get("model_id"),
                            "revision": config.get("model_revision"),
                            "filenames": config.get("model_filename"),
                        },
                        "node_details": {
                            "output_node": config.get("output_node"),
                            "bindings": copy.deepcopy(config.get("bindings", {})),
                        },
                    }
                )
            except ComfyUiError as exc:
                status["error"] = str(exc)
            models[name] = status
        if model_name is not None:
            result = dict(
                models.get(
                    model_name,
                    {"available": False, "feasible": False, "ready": False, "error": "unknown model"},
                )
            )
            result["model_name"] = model_name
            result["loaded_model_name"] = self.loaded_model_name
            return result
        return {"models": models, "loaded_model_name": self.loaded_model_name, "server_version": self._server_version}


__all__ = [
    "ComfyUiError",
    "ComfyUiConfigError",
    "ComfyUiUnavailableError",
    "ComfyUiModelError",
    "ComfyUiJobError",
    "ComfyUiTimeoutError",
    "ComfyUiOutputError",
    "ComfyUiGenerator",
]
