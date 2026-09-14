"""Model routing shared by CLI and Studio; providers own generation, never publication."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Callable, Protocol

from .storage import read_json


def registered_model_names():
    """Authoring, CLI choices and generation share the versioned registry."""
    registry = read_json(Path(__file__).resolve().parents[1] / "catalog/generators.json")
    if not isinstance(registry, dict) or registry.get("schema_version") != 1 or not registry.get("models"):
        raise ValueError("Ungültige Generator-Konfiguration: catalog/generators.json")
    return tuple(registry["models"])


class Generator(Protocol):
    def load_model(self, name: str): ...

    def generate(self, name, prompt, duration, seed, output, parameters=None, *, progress_callback=None): ...

    def unload(self): ...


class GenerationRouter:
    """One model registry, lazy providers, and the existing Studio generation contract."""

    def __init__(self, tool: Path, *, registry=None, factories: dict[str, Callable] | None = None):
        self.tool = tool.resolve()
        self.registry = registry if registry is not None else read_json(self.tool / "catalog/generators.json")
        if not isinstance(self.registry, dict) or self.registry.get("schema_version") != 1:
            raise ValueError("Generator-Konfiguration fehlt oder hat eine unbekannte Version: catalog/generators.json")
        self.models = self.registry.get("models", {})
        if not self.models:
            raise ValueError("Keine Modelle in catalog/generators.json konfiguriert")
        self.factories = factories or {"python": self._python, "comfyui": self._comfyui}
        for name, model in self.models.items():
            if model.get("backend") not in self.factories:
                raise ValueError(f"Unbekannter Generator für {name}: {model.get('backend')}")
        self.providers: dict[str, Generator] = {}
        self.selected: tuple[str, str] | None = None

    def _python(self):
        from .models import StableAudioBackend
        return StableAudioBackend(lock_path=self.tool / "catalog/model-lock.json")

    def _comfyui(self):
        from .comfyui import ComfyUiGenerator
        settings = self.registry.get("comfyui", {})
        return ComfyUiGenerator(
            {name: model for name, model in self.models.items() if model["backend"] == "comfyui"},
            self.tool / "workflows",
            base_url=os.environ.get("AUDIO_STUDIO_COMFYUI_URL", settings.get("base_url", "http://127.0.0.1:8188")),
            job_timeout_seconds=settings.get("job_timeout_seconds", 1800),
        )

    def _provider(self, name):
        if name not in self.models:
            raise ValueError(f"Unbekanntes Modell: {name}")
        key = self.models[name]["backend"]
        if key not in self.providers:
            self.providers[key] = self.factories[key]()
        return key, self.providers[key]

    def _license(self):
        return (read_json(self.tool / "catalog/model-lock.json") or {}).get("license", {})

    def load_model(self, name):
        key, provider = self._provider(name)
        # Native Python retains its own existing gate. ComfyUI uses the same
        # recorded human acknowledgement, not a second access/approval list.
        if key == "comfyui" and self._license().get("acknowledged") is not True:
            raise ValueError("Lizenzfreigabe fehlt. Modelllizenz prüfen und mit scripts/setup_models.py --acknowledge-license bestätigen.")
        if key == "comfyui":
            # This is API/schema/model preflight only. A missing remote model
            # must not evict a working Small-SFX model from the local process.
            provider.load_model(name)
        if self.selected and self.selected[0] != key:
            self.providers[self.selected[0]].unload()
            self.selected = None
        if key != "comfyui":
            provider.load_model(name)
        self.selected = (key, name)
        return provider

    @property
    def loaded_model_name(self):
        return self.selected[1] if self.selected else None

    @property
    def model_options(self):
        return [
            {"name": name, "label": model.get("label", name), "backend": model["backend"]}
            for name, model in self.models.items()
        ]

    def generate(self, name, prompt, duration, seed, output, parameters=None, *, progress_callback=None):
        provider = self.load_model(name)
        return provider.generate(name, prompt, duration, seed, output, parameters=parameters, progress_callback=progress_callback)

    def unload(self):
        # ComfyUI owns its process and GPU cache. Its provider must never free
        # or interrupt other API clients' jobs as part of a Studio unload.
        for provider in self.providers.values():
            provider.unload()
        self.selected = None

    def close(self):
        for provider in self.providers.values():
            close = getattr(provider, "close", None)
            if close:
                close()

    def doctor(self):
        results = {}
        reports = {}
        for name, model in self.models.items():
            key = model["backend"]
            try:
                if key not in reports:
                    reports[key] = self._provider(name)[1].doctor()
                report = reports[key]
                if key == "python":
                    ready = bool(report.get("feasible", {}).get(name))
                    results[name] = {
                        "backend": key, "ready": ready,
                        "checkpoint": report.get("models", {}).get(name),
                        "text_encoder": report.get("text_encoder"),
                        "torch": report.get("torch"), "model_packages": report.get("model_packages"),
                        "license": report.get("license"),
                    }
                    if not ready:
                        results[name]["error"] = "Python-Laufzeit, Checkpoint, Textencoder und Lizenzfreigabe prüfen; siehe docs/model-setup.md."
                else:
                    results[name] = {"backend": key, **report.get("models", {}).get(name, {})}
                    if self._license().get("acknowledged") is not True:
                        results[name].update(ready=False, error="Lizenzfreigabe fehlt; siehe docs/comfyui.md.")
            except Exception as exc:
                results[name] = {"backend": key, "ready": False, "error": str(exc)}
        feasible = {name: item.get("ready") is True for name, item in results.items()}
        return {"ok": any(feasible.values()), "feasible": feasible, "models": results}


def doctor(tool: Path | None = None):
    router = GenerationRouter(tool or Path(__file__).resolve().parents[1])
    try:
        return router.doctor()
    finally:
        router.close()
