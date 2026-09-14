"""Loopback-only HTTP surface for the same use cases used by Tool 1."""
from __future__ import annotations

import secrets
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError

from .profiles import PROFILES
from .storage import Conflict


def create_app(studio):
    token = secrets.token_urlsafe(32)

    @asynccontextmanager
    async def lifespan(app):
        yield
        studio.jobs.close()

    app = FastAPI(title="Fragdachse Audio Studio", docs_url=None, redoc_url=None, lifespan=lifespan)

    @app.middleware("http")
    async def local_only(request: Request, call_next):
        host = request.headers.get("host", "")
        hostname = host.partition(":")[0]
        if hostname not in {"127.0.0.1", "localhost"}:
            return JSONResponse({"error": "Only loopback hosts are accepted"}, status_code=403)
        origin = request.headers.get("origin")
        if origin and origin != f"http://{host}":
            return JSONResponse({"error": "Foreign browser origin rejected"}, status_code=403)
        if request.headers.get("sec-fetch-site") == "cross-site":
            return JSONResponse({"error": "Cross-site request rejected"}, status_code=403)
        if request.method not in {"GET", "HEAD"}:
            if not secrets.compare_digest(request.headers.get("x-studio-token", ""), token):
                return JSONResponse({"error": "Studio token missing; reload this local page"}, status_code=403)
            if request.headers.get("content-type", "").split(";")[0] != "application/json":
                return JSONResponse({"error": "JSON is required"}, status_code=415)
        response = await call_next(request)
        response.headers["Cache-Control"] = "no-store"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Content-Security-Policy"] = "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
        return response

    @app.exception_handler(Conflict)
    async def conflict(request, exc):
        return JSONResponse({"error": str(exc)}, status_code=409)

    @app.exception_handler(PermissionError)
    async def storage_unavailable(request, exc):
        return JSONResponse(
            {"error": "Zugriff auf eine Studio-Datei vorübergehend gesperrt. Bitte kurz warten und erneut versuchen. Bleibt die Meldung bestehen, Dateiberechtigungen und sperrende Programme prüfen."},
            status_code=503,
            headers={"Retry-After": "1"},
        )

    @app.exception_handler(ValueError)
    async def invalid(request, exc):
        return JSONResponse({"error": str(exc)}, status_code=400)

    @app.exception_handler(KeyError)
    async def missing(request, exc):
        return JSONResponse({"error": f"Unknown or missing field: {exc}"}, status_code=400)

    @app.exception_handler(ValidationError)
    async def invalid_schema(request, exc):
        return JSONResponse({"error": str(exc)}, status_code=400)

    @app.get("/api/state")
    def state():
        return {
            **studio.catalog.read(), "runs": studio.jobs.list(), "profiles": PROFILES, "token": token,
            "generation_models": getattr(studio.jobs.backend, "model_options", []),
        }

    @app.get("/api/doctor")
    def doctor():
        from .generators import doctor
        return doctor(studio.tool)

    @app.post("/api/sync")
    def sync():
        return studio.catalog.sync()

    @app.patch("/api/catalog/{key}")
    def edit(key: str, body: dict):
        return studio.catalog.edit(key, body["patch"], body["revision"], propose=body.get("propose", False))

    @app.post("/api/catalog/{key}/hide-notice")
    def hide(key: str, body: dict):
        return studio.catalog.hide_notice(key, body["revision"])

    @app.post("/api/generate/{key}")
    def generate(key: str, body: dict):
        return studio.generate(key, body["revision"], generation=body.get("generation"), seed=body.get("seed"))

    @app.post("/api/import/{key}")
    def import_game(key: str):
        return studio.import_current(key)

    @app.post("/api/runs/{run_id}/cancel")
    def cancel(run_id: str):
        return studio.jobs.cancel(run_id)

    @app.post("/api/model/unload")
    def unload():
        studio.jobs.unload()
        return {"status": "unloaded"}

    @app.post("/api/runs/{run_id}/{candidate_id}/process")
    def process(run_id: str, candidate_id: str, body: dict):
        replace_overrides = body.get("replace_overrides", False)
        if type(replace_overrides) is not bool:
            raise ValueError("replace_overrides must be a boolean")
        return studio.process(
            run_id,
            candidate_id,
            body["playback"],
            body["profile"],
            body.get("overrides", {}),
            replace_overrides=replace_overrides,
        )

    @app.patch("/api/runs/{run_id}/{candidate_id}")
    def mark(run_id: str, candidate_id: str, body: dict):
        if set(body) - {"favorite", "discarded"} or any(type(v) is not bool for v in body.values()):
            raise ValueError("Only boolean favorite/discarded decisions are accepted")
        return studio.mark(run_id, candidate_id, **body)

    @app.post("/api/exports/plan")
    def export_plan(body: dict):
        return studio.plan_export(body["selections"])

    @app.post("/api/exports/commit")
    def export_commit(body: dict):
        return studio.commit_export(body["plan_id"], confirmed=body.get("confirmed", False))

    @app.post("/api/cleanup/plan")
    def cleanup_plan(body: dict):
        return studio.cleanup_plan(mode=body.get("mode", "discarded"))

    @app.post("/api/cleanup/commit")
    def cleanup(body: dict):
        return studio.cleanup(body["plan_id"], body.get("confirmed", False))

    @app.get("/media/game/{key}")
    def game_media(key: str):
        return FileResponse(studio.game_audio(key))

    @app.get("/media/run/{run_id}/{candidate_id}/{kind}")
    def run_media(run_id: str, candidate_id: str, kind: str, version_id: str | None = None):
        return FileResponse(studio.audio_path(run_id, candidate_id, version_id, kind))

    @app.get("/api/waveform/{run_id}/{candidate_id}")
    def waveform(run_id: str, candidate_id: str, kind: str = "raw", version_id: str | None = None):
        import numpy as np
        from .processor import read_audio, inspect_audio
        path = studio.audio_path(run_id, candidate_id, version_id, kind)
        data, rate = read_audio(path)
        amplitude = np.max(np.abs(data), axis=1)
        signed = np.mean(data, axis=1)
        points = []
        for block_index, block in enumerate(np.array_split(np.arange(len(data)), min(700, len(data)))):
            if len(block) == 0:
                continue
            start_frame, end_frame = int(block[0]), int(block[-1]) + 1
            values = signed[start_frame:end_frame]
            points.append(
                {
                    "start_seconds": start_frame / rate,
                    "end_seconds": end_frame / rate,
                    "time_seconds": ((start_frame + end_frame) / 2) / rate,
                    "min": float(np.min(values)),
                    "max": float(np.max(values)),
                    "peak": float(np.max(amplitude[start_frame:end_frame])),
                }
            )
        return {
            # Keep the original compact numeric series for existing clients.
            "peaks": [point["peak"] for point in points],
            # Timed points allow the UI to place cut markers against the real
            # sample timeline for both RAW and processed WAV versions.
            "points": points,
            "frames": int(len(data)),
            "sample_rate": int(rate),
            "duration_seconds": len(data) / rate,
            "analysis": inspect_audio(path),
        }

    frontend = studio.tool / "frontend"
    app.mount("/static", StaticFiles(directory=frontend), name="static")

    @app.get("/")
    def home():
        return FileResponse(frontend / "index.html")

    return app
