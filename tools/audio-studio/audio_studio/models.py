"""Bounded, local-only Stable Audio 3 model adapter.

The adapter deliberately keeps the official model package behind lazy imports.  The
audio studio can therefore browse its catalog on a machine without torch, while an
inference request still fails with a useful setup error instead of silently using a
different backend or downloading a checkpoint.
"""

from __future__ import annotations

import gc
import hashlib
import importlib
import importlib.metadata
import importlib.util
import inspect
import json
import math
import os
import platform
import shutil
import sys
import subprocess
import tempfile
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Mapping


# These are set before any ML package can be imported.  Setup/download scripts are
# separate and deliberately do not import this module, so they can opt into network
# access explicitly.
os.environ["HF_HUB_OFFLINE"] = "1"
os.environ["TRANSFORMERS_OFFLINE"] = "1"


DEFAULT_LOCK_PATH = Path(__file__).resolve().parents[1] / "catalog" / "model-lock.json"
SUPPORTED_MODELS = ("medium", "small-sfx")


class ModelBackendError(RuntimeError):
    """Base error for an actionable model adapter failure."""


class UnsupportedModelError(ModelBackendError):
    """The requested model is outside the bounded V1 adapter."""


class ModelUnavailableError(ModelBackendError):
    """A local checkpoint or required package is unavailable."""


class HardwareCapabilityError(ModelBackendError):
    """The selected model cannot run in the current runtime."""


class GenerationError(ModelBackendError):
    """The official model returned an unusable result or failed to generate."""


class LicenseNotAcknowledgedError(ModelBackendError):
    """The caller requested a license gate but has not acknowledged it locally."""


@dataclass(frozen=True)
class ModelSpec:
    name: str
    repo_id: str
    max_duration_seconds: float
    requires_cuda: bool
    requires_flash_attention: bool
    config_filename: str = "model_config.json"
    checkpoint_filename: str = "model.safetensors"


@dataclass(frozen=True)
class _PinnedModelConfig:
    """The small ``resolve`` contract consumed by upstream model.py.

    Stable Audio 3's public ``from_pretrained`` has no revision argument.  The
    official ``model_configs.ModelConfig`` calls ``hf_hub_download`` itself, so
    the adapter temporarily supplies this equivalent resolved-file object.  The
    upstream loader and state-dict code remain unchanged.
    """

    config_path: str
    checkpoint_path: str

    def resolve(self) -> tuple[str, str]:
        return self.config_path, self.checkpoint_path


MODEL_SPECS: dict[str, ModelSpec] = {
    "medium": ModelSpec(
        name="medium",
        repo_id="stabilityai/stable-audio-3-medium",
        max_duration_seconds=380.0,
        requires_cuda=True,
        requires_flash_attention=True,
    ),
    "small-sfx": ModelSpec(
        name="small-sfx",
        repo_id="stabilityai/stable-audio-3-small-sfx",
        max_duration_seconds=120.0,
        requires_cuda=False,
        requires_flash_attention=False,
    ),
}


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ModelUnavailableError(
            f"Model lock file is missing: {path}. Run tools/audio-studio/scripts/setup-models.ps1."
        ) from exc
    except json.JSONDecodeError as exc:
        raise ModelUnavailableError(f"Model lock file is not valid JSON: {path}") from exc
    if not isinstance(value, dict):
        raise ModelUnavailableError(f"Model lock file must contain an object: {path}")
    return value


def _package_version(package: str) -> str | None:
    try:
        return importlib.metadata.version(package)
    except importlib.metadata.PackageNotFoundError:
        return None


def _flash_attention_status() -> dict[str, Any]:
    """Check the actual import used by Stable Audio Medium, not only metadata."""

    try:
        available = importlib.util.find_spec("flash_attn") is not None
    except Exception as exc:
        return {"installed": False, "importable": False, "error": str(exc)}
    if not available:
        return {"installed": False, "importable": False}
    try:
        module = importlib.import_module("flash_attn")
        return {
            "installed": True,
            "importable": hasattr(module, "flash_attn_func"),
            "version": getattr(module, "__version__", None),
        }
    except Exception as exc:
        return {"installed": True, "importable": False, "error": str(exc)}


def _call_with_supported_loader_signature(
    loader: Callable[..., Any], model_name: str, device: str | None
) -> Any:
    """Call an injected loader without hiding errors raised by its body.

    The production loader receives the exact official arguments.  The signature
    inspection only makes small test doubles convenient (``lambda name: ...``).
    """

    model_half = True
    try:
        signature = inspect.signature(loader)
    except (TypeError, ValueError):
        # Some extension callables have no inspectable signature.  The fallback is
        # intentionally narrow and only applies to signature inspection failures.
        return loader(model_name)
    parameters = signature.parameters
    kwargs: dict[str, Any] = {}
    if "device" in parameters or any(
        p.kind == inspect.Parameter.VAR_KEYWORD for p in parameters.values()
    ):
        kwargs["device"] = device
    if "model_half" in parameters or any(
        p.kind == inspect.Parameter.VAR_KEYWORD for p in parameters.values()
    ):
        kwargs["model_half"] = model_half
    return loader(model_name, **kwargs)


class StableAudioBackend:
    """One-model-at-a-time, local-only adapter for official Stable Audio 3.

    ``model_loader`` is an injectable seam for contract tests.  In production it is
    omitted and the official ``StableAudioModel.from_pretrained`` is called with
    the upstream signature.  A real generation always requires a locked local
    config/checkpoint pair; no Hub download is attempted from this class.
    """

    _GENERATION_PARAMETER_KEYS = frozenset(
        {
            "steps",
            "cfg_scale",
            "batch_size",
            "chunked_decode",
            "sample_size",
            "truncate_output_to_duration",
            "duration_padding_sec",
            "apg_scale",
            "dist_shift",
            "sampler_type",
        }
    )

    def __init__(
        self,
        *,
        lock_path: str | os.PathLike[str] | None = None,
        model_root: str | os.PathLike[str] | None = None,
        device: str | None = None,
        model_loader: Callable[..., Any] | None = None,
        require_license_acknowledgement: bool = True,
        license_acknowledged: bool | None = None,
    ) -> None:
        self.lock_path = Path(lock_path) if lock_path is not None else DEFAULT_LOCK_PATH
        self.model_root = Path(model_root) if model_root is not None else None
        self.device = device
        self._model_loader = model_loader
        self.require_license_acknowledgement = require_license_acknowledgement
        self.license_acknowledged = license_acknowledged
        self._model: Any | None = None
        self._loaded_name: str | None = None
        self._resolved_files: dict[str, Path] = {}
        self._resolved_revision: str | None = None
        self._resolved_source_commit: str | None = None
        self._prepared_config_path: Path | None = None
        self._lock = threading.RLock()

    @property
    def loaded_model_name(self) -> str | None:
        return self._loaded_name

    @property
    def is_loaded(self) -> bool:
        return self._model is not None

    def _lock_data(self) -> dict[str, Any]:
        return _read_json(self.lock_path)

    def _spec_lock(self, model_name: str) -> dict[str, Any]:
        lock_data = self._lock_data()
        models = lock_data.get("models")
        if not isinstance(models, dict) or not isinstance(models.get(model_name), dict):
            raise ModelUnavailableError(
                f"No lock entry exists for {model_name!r} in {self.lock_path}. "
                "Run the model setup script and inspect the generated lock."
            )
        return models[model_name]

    def _license_is_acknowledged(self, lock_data: Mapping[str, Any]) -> bool:
        if self.license_acknowledged is not None:
            return self.license_acknowledged
        license_data = lock_data.get("license")
        return bool(
            isinstance(license_data, Mapping)
            and license_data.get("acknowledged") is True
        )

    def _find_direct_artifacts(
        self, model_name: str, spec: ModelSpec, model_lock: Mapping[str, Any]
    ) -> dict[str, Path] | None:
        candidates: list[Path] = []
        local_dir = model_lock.get("local_dir")
        if isinstance(local_dir, str) and local_dir:
            local_path = Path(local_dir)
            candidates.append(
                local_path if local_path.is_absolute() else self.lock_path.parent / local_path
            )
        if self.model_root is not None:
            candidates.extend(
                [self.model_root / model_name, self.model_root / spec.repo_id]
            )
        files = model_lock.get("files")
        config_name = spec.config_filename
        checkpoint_name = spec.checkpoint_filename
        if isinstance(files, Mapping):
            config_name = str(files.get("config", config_name))
            checkpoint_name = str(files.get("checkpoint", checkpoint_name))

        for candidate in candidates:
            config_path = candidate / config_name
            checkpoint_path = candidate / checkpoint_name
            if config_path.is_file() and checkpoint_path.is_file():
                return {"config": config_path, "checkpoint": checkpoint_path}
        return None

    def _find_cached_artifacts(
        self, model_name: str, spec: ModelSpec, model_lock: Mapping[str, Any]
    ) -> tuple[dict[str, Path] | None, str | None]:
        """Resolve files from an already existing HF cache without network access."""

        try:
            hub = importlib.import_module("huggingface_hub")
        except ImportError:
            raise ModelUnavailableError(
                "huggingface-hub is required to resolve Stable Audio 3 local artifacts. "
                "Install model dependencies with tools/audio-studio/scripts/setup-models.ps1."
            ) from None

        revision_value = model_lock.get("revision")
        revision = str(revision_value) if revision_value else None
        resolver = getattr(hub, "try_to_load_from_cache", None)
        if resolver is None:
            raise ModelUnavailableError(
                "Installed huggingface-hub has no try_to_load_from_cache; reinstall the "
                "pinned model dependencies."
            )

        kwargs = {"repo_id": spec.repo_id, "revision": revision} if revision else {"repo_id": spec.repo_id}
        config_name = spec.config_filename
        checkpoint_name = spec.checkpoint_filename
        files = model_lock.get("files")
        if isinstance(files, Mapping):
            config_name = str(files.get("config", config_name))
            checkpoint_name = str(files.get("checkpoint", checkpoint_name))
        try:
            config = resolver(filename=config_name, **kwargs)
            checkpoint = resolver(filename=checkpoint_name, **kwargs)
        except Exception as exc:  # hub versions differ in their offline exception types
            raise ModelUnavailableError(
                f"Could not inspect the local Hugging Face cache for {spec.repo_id!r}: {exc}. "
                "Run the explicit setup script first; generation never downloads models."
            ) from exc
        if not isinstance(config, str) or not isinstance(checkpoint, str):
            return None, revision
        config_path, checkpoint_path = Path(config), Path(checkpoint)
        if not config_path.is_file() or not checkpoint_path.is_file():
            return None, revision
        return {"config": config_path, "checkpoint": checkpoint_path}, revision

    def _resolve_artifacts(
        self, model_name: str, *, required: bool = True
    ) -> tuple[dict[str, Path], str | None, dict[str, Any]]:
        spec = MODEL_SPECS[model_name]
        lock_data = self._lock_data()
        model_lock = self._spec_lock(model_name)
        resolved = self._find_direct_artifacts(model_name, spec, model_lock)
        revision = model_lock.get("revision")
        resolved_revision = str(revision) if revision else None
        if resolved is None:
            resolved, cached_revision = self._find_cached_artifacts(
                model_name, spec, model_lock
            )
            resolved_revision = cached_revision
        if resolved is None:
            if required:
                raise ModelUnavailableError(
                    f"No local Stable Audio 3 files found for {model_name!r} "
                    f"({spec.repo_id}). Expected model_config.json and model.safetensors "
                    f"under {self.model_root or '<HF cache>'}. Run "
                    "tools/audio-studio/scripts/setup-models.ps1, then run doctor()."
                )
            return {}, resolved_revision, model_lock

        files = model_lock.get("files")
        expected: dict[str, str | None] = {}
        if isinstance(files, Mapping):
            expected = {
                "config": files.get("config_sha256"),
                "checkpoint": files.get("checkpoint_sha256"),
            }
        for kind, path in resolved.items():
            expected_hash = expected.get(kind)
            if expected_hash:
                actual = _sha256(path)
                if actual.lower() != str(expected_hash).lower():
                    raise ModelUnavailableError(
                        f"Hash mismatch for locked {model_name} {kind} file {path}. "
                        f"Expected {expected_hash}, got {actual}. Re-run setup or update the lock explicitly."
                    )
        return resolved, resolved_revision, model_lock

    def _check_hardware(self, model_name: str) -> None:
        if self._model_loader is not None:
            return
        spec = MODEL_SPECS[model_name]
        if spec.requires_cuda:
            try:
                torch = importlib.import_module("torch")
            except ImportError:
                raise HardwareCapabilityError(
                    "Stable Audio 3 Medium requires torch with CUDA support; torch is not installed. "
                    "Run the model setup instructions and use the matching CUDA wheel."
                ) from None
            if not bool(torch.cuda.is_available()):
                raise HardwareCapabilityError(
                    "Stable Audio 3 Medium requires a CUDA-capable GPU. torch.cuda.is_available() is false; "
                    "use small-sfx for CPU feasibility or install a matching CUDA runtime."
                )
            flash = _flash_attention_status()
            if spec.requires_flash_attention and not flash.get("importable"):
                raise HardwareCapabilityError(
                    "Stable Audio 3 Medium requires Flash Attention 2. Install a wheel matching "
                    "Python, torch 2.7.1 and CUDA, then rerun doctor()."
                )

    def _text_encoder_path(self, lock_data: Mapping[str, Any]) -> Path | None:
        text_encoder = lock_data.get("text_encoder")
        if not isinstance(text_encoder, Mapping):
            return None
        local_dir = text_encoder.get("local_dir")
        if not isinstance(local_dir, str) or not local_dir:
            return None
        path = Path(local_dir)
        path = path if path.is_absolute() else self.lock_path.parent / path
        return path if path.is_dir() else None

    def _prepare_local_conditioner_config(self, config_path: Path) -> Path:
        """Point upstream's T5Gemma conditioner at a locked local snapshot.

        The official config normally names ``google/t5gemma-b-b-ul2`` and the
        upstream conditioner calls ``transformers.from_pretrained`` with that
        name.  Setup stores the gated encoder snapshot beside the checkpoints;
        this ephemeral config copy keeps the tracked upstream JSON untouched while
        making offline execution deterministic.
        """

        if self._prepared_config_path is not None:
            self._prepared_config_path.unlink(missing_ok=True)
            self._prepared_config_path = None
        lock_data = self._lock_data()
        text_path = self._text_encoder_path(lock_data)
        if text_path is None:
            return config_path
        try:
            config = json.loads(config_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ModelUnavailableError(
                f"Could not read locked model config {config_path}: {exc}"
            ) from exc
        changed = False

        def visit(value: Any) -> None:
            nonlocal changed
            if isinstance(value, dict):
                if value.get("type") == "t5gemma" and isinstance(value.get("config"), dict):
                    conditioner_config = value["config"]
                    if conditioner_config.get("model_path") != str(text_path):
                        conditioner_config["model_path"] = str(text_path)
                        changed = True
                    # Current checkpoints reference an encoder subfolder in the
                    # audio Hub repository. Our shared snapshot is its own root;
                    # forwarding that subfolder would break offline resolution.
                    for remote_key in ("repo_id", "subfolder"):
                        if remote_key in conditioner_config:
                            del conditioner_config[remote_key]
                            changed = True
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)

        visit(config)
        if not changed:
            return config_path
        handle = tempfile.NamedTemporaryFile(
            mode="w", encoding="utf-8", suffix=".json", prefix="audio-studio-model-", delete=False
        )
        with handle:
            json.dump(config, handle)
        self._prepared_config_path = Path(handle.name)
        return self._prepared_config_path

    def _text_encoder_status(self) -> dict[str, Any]:
        try:
            lock_data = self._lock_data()
        except ModelBackendError as exc:
            return {"available": False, "error": str(exc)}
        text_encoder = lock_data.get("text_encoder")
        if not isinstance(text_encoder, Mapping):
            return {
                "available": False,
                "repo_id": "google/t5gemma-b-b-ul2",
                "error": "No text_encoder lock entry exists; run the explicit setup script.",
            }
        path = self._text_encoder_path(lock_data)
        return {
            "available": path is not None,
            "repo_id": text_encoder.get("repo_id", "google/t5gemma-b-b-ul2"),
            "revision": text_encoder.get("revision"),
            "local_dir": str(path) if path else text_encoder.get("local_dir"),
        }
    def _official_loader(
        self,
        model_name: str,
        device: str | None,
        resolved_files: Mapping[str, Path],
    ) -> Any:
        # Importing stable_audio_3 is intentionally confined to this call.
        try:
            module = importlib.import_module("stable_audio_3")
            model_class = getattr(module, "StableAudioModel")
        except (ImportError, AttributeError) as exc:
            raise ModelUnavailableError(
                "stable_audio_3 is not installed. Run the explicit model setup instructions; "
                "the audio studio does not install or download it during generation."
            ) from exc
        if resolved_files:
            # model.py imports ``all_models`` from model_configs at module import
            # time. Both references point to the same dict today; update each
            # defensively so the locked paths are honored across upstream versions.
            config_path = self._prepare_local_conditioner_config(resolved_files["config"])
            pinned = _PinnedModelConfig(
                config_path=str(config_path),
                checkpoint_path=str(resolved_files["checkpoint"]),
            )
            model_configs = importlib.import_module("stable_audio_3.model_configs")
            all_models = getattr(model_configs, "all_models", None)
            if isinstance(all_models, dict):
                all_models[model_name] = pinned
            model_module = sys.modules.get("stable_audio_3.model")
            model_all_models = getattr(model_module, "all_models", None)
            if isinstance(model_all_models, dict):
                model_all_models[model_name] = pinned
        # Keep the official signature: from_pretrained(model_name, device=None, model_half=True).
        return model_class.from_pretrained(model_name, device=device, model_half=True)

    def load(self, model_name: str) -> Any:
        """Load one persistent model, switching and unloading an existing model if needed."""

        if model_name not in SUPPORTED_MODELS:
            raise UnsupportedModelError(
                f"Unsupported model {model_name!r}. V1 permits only {', '.join(SUPPORTED_MODELS)}."
            )
        with self._lock:
            if self._model is not None and self._loaded_name == model_name:
                return self._model
            if self.require_license_acknowledgement:
                lock_data = self._lock_data()
                if not self._license_is_acknowledged(lock_data):
                    raise LicenseNotAcknowledgedError(
                        "The Stability AI checkpoint license has not been acknowledged locally. "
                        "Review the checkpoint license, then run scripts/setup_models.py --acknowledge-license."
                    )
            self._check_hardware(model_name)
            if self._model_loader is None:
                resolved, revision, _ = self._resolve_artifacts(model_name)
                lock_data = self._lock_data()
                source_data = lock_data.get("upstream")
                source_commit = source_data.get("resolved_commit") if isinstance(source_data, Mapping) else None
            else:
                resolved, revision, source_commit = {}, None, None
            if self._model is not None:
                self.unload()
            try:
                if self._model_loader is None:
                    loaded = self._official_loader(model_name, self.device, resolved)
                else:
                    loaded = _call_with_supported_loader_signature(
                        self._model_loader, model_name, self.device
                    )
            except ModelBackendError:
                raise
            except Exception as exc:
                raise ModelUnavailableError(
                    f"Failed to load local Stable Audio 3 model {model_name!r}: {exc}"
                ) from exc
            self._model = loaded
            self._loaded_name = model_name
            self._resolved_files = resolved
            self._resolved_revision = revision
            self._resolved_source_commit = str(source_commit) if source_commit else None
            return loaded

    def unload(self) -> None:
        """Release the persistent model and best-effort CUDA allocator state."""

        with self._lock:
            self._model = None
            self._loaded_name = None
            self._resolved_files = {}
            self._resolved_revision = None
            self._resolved_source_commit = None
            if self._prepared_config_path is not None:
                self._prepared_config_path.unlink(missing_ok=True)
                self._prepared_config_path = None
            gc.collect()
            # torch is not imported solely for unload.  If it is already loaded,
            # empty_cache is useful; otherwise this remains a genuinely lazy path.
            module = sys.modules.get("torch")
            if module is not None:
                if hasattr(module, "cuda") and module.cuda.is_available():
                    module.cuda.empty_cache()

    # Explicit aliases make the lifecycle boundary easy to call from a service
    # coordinator while preserving the compact load()/unload() API used by Jobs.
    def load_model(self, model_name: str) -> Any:
        return self.load(model_name)

    def unload_model(self) -> None:
        self.unload()

    def _sample_rate(self, loaded: Any) -> int:
        inner = getattr(loaded, "model", None)
        sample_rate = getattr(inner, "sample_rate", None)
        if sample_rate is None:
            raise GenerationError(
                "Official Stable Audio output did not expose model.model.sample_rate; "
                "refusing to guess the WAV sample rate."
            )
        try:
            value = int(sample_rate)
        except (TypeError, ValueError) as exc:
            raise GenerationError(f"Invalid model sample rate: {sample_rate!r}") from exc
        if value <= 0:
            raise GenerationError(f"Invalid model sample rate: {value}")
        return value

    @staticmethod
    def _to_numpy_waveform(output: Any) -> Any:
        try:
            value = output.detach()
        except AttributeError:
            value = output
        try:
            value = value.to("cpu")
        except (AttributeError, TypeError):
            try:
                value = value.cpu()
            except AttributeError:
                pass
        try:
            value = value.float()
        except AttributeError:
            pass
        try:
            array = value.numpy()
        except AttributeError:
            try:
                import numpy as np

                array = np.asarray(value)
            except ImportError as exc:
                raise GenerationError(
                    "Generated output is not a NumPy-compatible tensor and NumPy is unavailable."
                ) from exc
        return array

    def _validate_parameters(self, parameters: Mapping[str, Any] | None) -> dict[str, Any]:
        actual: dict[str, Any] = {
            "steps": 8,
            "cfg_scale": 1.0,
            "batch_size": 1,
            "chunked_decode": True,
        }
        if parameters is not None:
            if not isinstance(parameters, Mapping):
                raise GenerationError("parameters must be a mapping of official generate() keyword arguments.")
            unknown = sorted(set(parameters) - self._GENERATION_PARAMETER_KEYS)
            if unknown:
                raise GenerationError(
                    f"Unsupported generation parameter(s): {', '.join(unknown)}. "
                    f"Allowed: {', '.join(sorted(self._GENERATION_PARAMETER_KEYS))}."
                )
            actual.update(parameters)
        try:
            steps = int(actual["steps"])
        except (TypeError, ValueError) as exc:
            raise GenerationError("steps must be a positive integer") from exc
        if steps < 1:
            raise GenerationError("steps must be a positive integer")
        actual["steps"] = steps
        try:
            cfg = float(actual["cfg_scale"])
        except (TypeError, ValueError) as exc:
            raise GenerationError("cfg_scale must be a finite non-negative number") from exc
        if not math.isfinite(cfg) or cfg < 0:
            raise GenerationError("cfg_scale must be a finite non-negative number")
        actual["cfg_scale"] = cfg
        try:
            batch_size = int(actual["batch_size"])
        except (TypeError, ValueError) as exc:
            raise GenerationError("batch_size is fixed at 1 for the bounded adapter") from exc
        if batch_size != 1:
            raise GenerationError("batch_size is fixed at 1 for the bounded adapter")
        actual["batch_size"] = 1
        if not isinstance(actual["chunked_decode"], bool):
            raise GenerationError("chunked_decode must be a boolean")
        return actual

    @staticmethod
    def _validate_duration(duration_seconds: Any) -> int:
        """Validate the bounded adapter's whole-second duration contract.

        The Stable Audio conditioning path is deliberately called with whole
        seconds.  ``2.0`` is a valid JSON number and therefore remains accepted,
        while fractional numbers, booleans and string coercions are rejected.  A
        separate helper keeps the same check available to callers before a model
        is loaded and avoids silently changing a requested duration with
        ``ceil``.
        """

        if isinstance(duration_seconds, bool) or not isinstance(
            duration_seconds, (int, float)
        ):
            raise GenerationError("duration_seconds must be a positive whole number of seconds")
        try:
            duration = float(duration_seconds)
        except (TypeError, ValueError, OverflowError) as exc:
            raise GenerationError(
                "duration_seconds must be a positive whole number of seconds"
            ) from exc
        if not math.isfinite(duration) or duration <= 0 or not duration.is_integer():
            raise GenerationError("duration_seconds must be a positive whole number of seconds")
        return int(duration)

    def generate(
        self,
        model_name: str,
        prompt: str,
        duration_seconds: float,
        seed: int | None,
        output_path: str | os.PathLike[str],
        parameters: Mapping[str, Any] | None = None,
        progress_callback: Callable[[Mapping[str, Any]], None] | None = None,
        callback: Callable[[Mapping[str, Any]], None] | None = None,
    ) -> dict[str, Any]:
        """Generate one raw WAV and return reproducibility metadata.

        Stable Audio's official output is ``[B, C, T]``.  The adapter only accepts
        one candidate at a time and records the exact prompt, seed, kwargs, model
        revision, artifact hashes, runtime versions, sample rate and output hash.
        """

        if model_name not in SUPPORTED_MODELS:
            raise UnsupportedModelError(
                f"Unsupported model {model_name!r}. V1 permits only {', '.join(SUPPORTED_MODELS)}."
            )
        if not isinstance(prompt, str) or not prompt.strip():
            raise GenerationError("prompt must be a non-empty string")
        model_duration = self._validate_duration(duration_seconds)
        duration = float(duration_seconds)
        spec = MODEL_SPECS[model_name]
        if duration > spec.max_duration_seconds:
            raise GenerationError(
                f"duration_seconds={duration:g} exceeds {model_name}'s official limit "
                f"of {spec.max_duration_seconds:g} seconds."
            )
        if seed is None:
            # The upstream API uses -1 for random seeding, but that would leave no
            # reproducible value to write into the run metadata.  Select a seed here.
            import secrets

            actual_seed = secrets.randbelow(99_999)
        else:
            try:
                actual_seed = int(seed)
            except (TypeError, ValueError) as exc:
                raise GenerationError("seed must be an integer or None") from exc
        parameter_callback = None
        if isinstance(parameters, Mapping) and "callback" in parameters:
            parameter_callback = parameters["callback"]
            parameters = {key: value for key, value in parameters.items() if key != "callback"}
        if callback is not None and parameter_callback is not None:
            raise GenerationError("pass only one callback seam")
        if callback is None:
            callback = parameter_callback
        if callback is not None:
            if progress_callback is not None:
                raise GenerationError("pass only one of progress_callback or callback")
            progress_callback = callback
        if progress_callback is not None and not callable(progress_callback):
            raise GenerationError("progress_callback must be callable or None")
        actual_parameters = self._validate_parameters(parameters)
        destination = Path(output_path)
        if destination.exists():
            raise GenerationError(
                f"Refusing to overwrite existing raw output: {destination}. "
                "Choose a new candidate path or remove it explicitly after review."
            )
        started_at = time.perf_counter()
        started_utc = _utc_now()
        with self._lock:
            try:
                loaded = self.load(model_name)
                sample_rate = self._sample_rate(loaded)
                generate_kwargs = {
                    "prompt": prompt,
                    "duration": model_duration,
                    "seed": actual_seed,
                    **actual_parameters,
                }
                if progress_callback is not None:
                    total_steps = int(actual_parameters["steps"])

                    def report_sampling_progress(event: Mapping[str, Any]) -> None:
                        # The official sampler callback contains tensors.  Keep
                        # that implementation detail at the adapter boundary and
                        # expose only JSON-safe progress to Jobs/UI callers.
                        try:
                            step = int(event.get("i", 0)) + 1
                        except (AttributeError, TypeError, ValueError):
                            step = 0
                        step = max(0, min(total_steps, step))
                        progress_callback(
                            {
                                "stage": "sampling",
                                "completed_steps": step,
                                "total_steps": total_steps,
                                "fraction": float(step / total_steps)
                                if total_steps
                                else 0.0,
                            }
                        )

                    # Stable Audio 3 forwards sampler kwargs to sample_diffusion,
                    # whose callback receives the event above.  Keep callback out
                    # of actual_parameters so metadata remains JSON serializable.
                    generate_kwargs["callback"] = report_sampling_progress
                output = loaded.generate(**generate_kwargs)
            except ModelBackendError:
                raise
            except Exception as exc:
                raise GenerationError(
                    f"Stable Audio 3 {model_name} generation failed: {exc}"
                ) from exc

            array = self._to_numpy_waveform(output)
            try:
                shape = tuple(array.shape)
            except AttributeError as exc:
                raise GenerationError("Official model output has no tensor shape") from exc
            if len(shape) != 3 or shape[0] != 1 or shape[1] < 1 or shape[2] < 1:
                raise GenerationError(
                    f"Expected official output shape [1, C, T], got {shape!r}."
                )
            try:
                import numpy as np

                if not np.issubdtype(array.dtype, np.number) or not np.isfinite(array).all():
                    raise GenerationError("Generated output contains non-finite or non-numeric samples")
                if float(np.max(np.abs(array))) > 1.00001:
                    raise GenerationError(
                        "Generated output exceeds the expected [-1, 1] range; refusing silent clipping."
                    )
                waveform = np.asarray(array[0]).T.astype(np.float32, copy=False)
            except ImportError as exc:
                raise GenerationError("NumPy is required to validate generated audio") from exc

            destination.parent.mkdir(parents=True, exist_ok=True)
            try:
                import soundfile as sf

                sf.write(str(destination), waveform, sample_rate, subtype="FLOAT")
            except Exception as exc:
                raise GenerationError(f"Could not write generated WAV {destination}: {exc}") from exc

            output_hash = _sha256(destination)
            finished_utc = _utc_now()
            elapsed = time.perf_counter() - started_at
            runtime = {
                "python": platform.python_version(),
                "platform": platform.platform(),
                "torch": _package_version("torch"),
                "torchaudio": _package_version("torchaudio"),
                "stable_audio_3": _package_version("stable-audio-3"),
                "device": (
                    None
                    if getattr(loaded, "device", self.device) is None
                    else str(getattr(loaded, "device", self.device))
                ),
            }
            resolved_hashes = {
                key: {"path": str(path), "sha256": _sha256(path)}
                for key, path in self._resolved_files.items()
            }
            return {
                "schema_version": 1,
                "model_name": model_name,
                "model_id": spec.repo_id,
                "model_revision": self._resolved_revision,
                "source_commit": self._resolved_source_commit,
                "model": {
                    "name": model_name,
                    "id": spec.repo_id,
                    "revision": self._resolved_revision,
                    "source_commit": self._resolved_source_commit,
                },
                "resolved_file_hashes": resolved_hashes,
                "runtime": runtime,
                "arguments": {
                    "prompt": prompt,
                    "duration_seconds": duration,
                    "seed": actual_seed,
                    "parameters": actual_parameters,
                },
                "actual_arguments": {
                    "prompt": prompt,
                    "duration": model_duration,
                    "seed": actual_seed,
                    **actual_parameters,
                },
                "duration_policy": "whole_seconds_only",
                "sample_rate": sample_rate,
                "raw_output": {
                    "path": str(destination),
                    "sha256": output_hash,
                    "channels": int(shape[1]),
                    "samples": int(shape[2]),
                    "duration_seconds": float(shape[2] / sample_rate),
                },
                "raw_hash": output_hash,
                "started_at_utc": started_utc,
                "finished_at_utc": finished_utc,
                "elapsed_seconds": elapsed,
            }

    def _artifact_status(self, model_name: str) -> dict[str, Any]:
        spec = MODEL_SPECS[model_name]
        try:
            files, revision, model_lock = self._resolve_artifacts(model_name, required=False)
        except ModelBackendError as exc:
            return {
                "available": False,
                "repo_id": spec.repo_id,
                "error": str(exc),
            }
        return {
            "available": bool(files),
            "repo_id": spec.repo_id,
            "revision": revision,
            "files": {key: str(path) for key, path in files.items()},
            "license": model_lock.get("license") if isinstance(model_lock, Mapping) else None,
        }

    def doctor(self) -> dict[str, Any]:
        """Return serializable environment/model feasibility checks without downloading."""

        checks: dict[str, Any] = {
            "offline": {
                "HF_HUB_OFFLINE": os.environ.get("HF_HUB_OFFLINE"),
                "TRANSFORMERS_OFFLINE": os.environ.get("TRANSFORMERS_OFFLINE"),
                "generation_downloads": False,
            },
            "python": platform.python_version(),
            "platform": platform.platform(),
            "requirements": {
                "torch": "2.7.1",
                "torchaudio": "2.7.1",
                "transformers": ">=5.8.0",
                "numpy": ">=2.2.6",
                "flash_attention": "2.x for medium",
            },
            "models": {},
            "actions": [],
        }
        nvidia = {"available": False}
        if shutil.which("nvidia-smi"):
            try:
                result = subprocess.run(
                    ["nvidia-smi", "--query-gpu=name,memory.total,driver_version", "--format=csv,noheader"],
                    check=True,
                    capture_output=True,
                    text=True,
                    timeout=5,
                )
                nvidia = {"available": True, "devices": [line.strip() for line in result.stdout.splitlines() if line.strip()]}
            except (OSError, subprocess.SubprocessError) as exc:
                nvidia["error"] = str(exc)
        else:
            nvidia["error"] = "nvidia-smi not found"
        checks["nvidia_smi"] = nvidia
        try:
            lock_data = self._lock_data()
            checks["license"] = lock_data.get("license")
            license_ok = self._license_is_acknowledged(lock_data)
            if self.require_license_acknowledgement and not license_ok:
                checks["actions"].append(
                    "Review and explicitly acknowledge the checkpoint license before generation."
                )
        except ModelBackendError as exc:
            checks["license"] = None
            license_ok = False
            checks["actions"].append(str(exc))

        torch_info: dict[str, Any] = {"installed": False, "cuda_available": False}
        if importlib.util.find_spec("torch") is not None:
            try:
                torch = importlib.import_module("torch")
                torch_info.update(
                    {
                        "installed": True,
                        "version": getattr(torch, "__version__", None),
                        "cuda_available": bool(torch.cuda.is_available()),
                        "cuda_version": getattr(getattr(torch, "version", None), "cuda", None),
                        "device_count": int(torch.cuda.device_count()) if torch.cuda.is_available() else 0,
                    }
                )
            except Exception as exc:
                torch_info["error"] = str(exc)
        else:
            checks["actions"].append("Install the pinned model torch wheel to run Stable Audio locally.")
        checks["torch"] = torch_info
        packages = {name: _package_version(name) for name in ("stable-audio-3", "torchaudio", "transformers")}
        checks["model_packages"] = packages
        runtime_ok = torch_info.get("installed") is True and not torch_info.get("error") and all(packages.values())
        if not runtime_ok:
            checks["actions"].append("Complete the isolated model runtime installation before generating audio.")
        flash_info = _flash_attention_status()
        flash_info["required_for"] = ["medium"]
        checks["flash_attention_2"] = flash_info
        if not flash_info.get("importable"):
            checks["actions"].append("Install Flash Attention 2 before using the medium model.")

        checks["text_encoder"] = self._text_encoder_status()
        if not checks["text_encoder"].get("available"):
            checks["actions"].append(
                "Prepare the locked google/t5gemma-b-b-ul2 text encoder snapshot for offline generation."
            )

        for model_name in SUPPORTED_MODELS:
            checks["models"][model_name] = self._artifact_status(model_name)
            if not checks["models"][model_name].get("available"):
                checks["actions"].append(
                    f"Prepare the locked local {model_name} checkpoint with the setup script."
                )

        text_ok = checks["text_encoder"].get("available") is True
        medium_ok = (
            runtime_ok
            and torch_info.get("cuda_available") is True
            and flash_info.get("importable") is True
            and checks["models"].get("medium", {}).get("available") is True
            and text_ok
            and (not self.require_license_acknowledgement or license_ok)
        )
        small_ok = (
            runtime_ok and checks["models"].get("small-sfx", {}).get("available") is True and text_ok
            and (not self.require_license_acknowledgement or license_ok)
        )
        checks["feasible"] = {"medium": medium_ok, "small-sfx": small_ok}
        checks["ok"] = bool(small_ok or medium_ok)
        return checks


def doctor(**backend_options: Any) -> dict[str, Any]:
    """Compatibility entry point for the CLI and HTTP service."""

    return StableAudioBackend(**backend_options).doctor()


__all__ = [
    "GenerationError",
    "HardwareCapabilityError",
    "LicenseNotAcknowledgedError",
    "MODEL_SPECS",
    "ModelBackendError",
    "ModelSpec",
    "ModelUnavailableError",
    "StableAudioBackend",
    "SUPPORTED_MODELS",
    "UnsupportedModelError",
    "doctor",
]
