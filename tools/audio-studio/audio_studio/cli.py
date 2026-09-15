"""Catalog Builder and Studio entry points; no embedded LLM calls."""
from __future__ import annotations

import argparse
import json
import os
import sys
import threading
import webbrowser
from pathlib import Path

from filelock import FileLock, Timeout

from .storage import read_json


def main():
    tool = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description="Fragdachse local SFX and music production")
    parser.add_argument("--root", type=Path, default=tool.parents[1])
    parser.add_argument("--workspace", type=Path, default=Path(os.environ.get("AUDIO_STUDIO_WORKSPACE", tool / ".audio-workspace")))
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("scan", help="Read game SFX and supported music inventory as JSON")
    commands.add_parser("sync", help="Merge current repository facts, preserving authorship")
    commands.add_parser("validate", help="Validate the production catalog")
    commands.add_parser("schema", help="Print the shared authoring JSON Schema")
    edit = commands.add_parser("edit", help="Apply explicit authoring patch (or propose it)")
    edit.add_argument("key")
    edit.add_argument("patch", type=Path)
    edit.add_argument("--revision", required=True, help="Current catalog SHA-256 from sync/validate")
    edit.add_argument("--propose", action="store_true")
    serve = commands.add_parser("serve", help="Start one local server and open the Studio")
    serve.add_argument("--port", type=int, default=8765)
    serve.add_argument("--no-open", action="store_true")
    stop = commands.add_parser("stop", help="Stop this project's Studio, including after its HTTP port closes")
    stop.add_argument("--force", action="store_true", help="Force a verified Windows owner to exit if graceful stop stalls")
    commands.add_parser("doctor", help="Report actual local model and hardware prerequisites")
    smoke = commands.add_parser("smoke", help="Attempt a real local generation; never publishes")
    from .generators import registered_model_names
    smoke.add_argument("--model", choices=registered_model_names(), required=True)
    smoke.add_argument("--prompt", default="A single dry metallic impact, isolated sound effect, no music or speech.")
    smoke.add_argument("--duration", type=float, default=2)
    smoke.add_argument("--seed", type=int, default=1701)
    recover = commands.add_parser("recover", help="Explicitly repair an interrupted publication transaction")
    recover.add_argument("transaction_id")
    args = parser.parse_args()
    try:
        if args.command == "stop":
            from .server_control import stop_server
            result = stop_server(tool, force=args.force)
        elif args.command == "schema":
            from .catalog import Catalog
            result = Catalog.model_json_schema()
        elif args.command == "doctor":
            from .generators import doctor
            result = doctor(tool)
        else:
            from .service import Studio
            studio = Studio(args.root, tool, args.workspace)
            if args.command == "scan":
                result = studio.repository.scan()
            elif args.command == "sync":
                result = studio.catalog.sync()
            elif args.command == "validate":
                result = studio.catalog.read()
            elif args.command == "edit":
                result = studio.catalog.edit(args.key, read_json(args.patch), args.revision, propose=args.propose)
            elif args.command == "recover":
                with studio.store.writing():
                    result = studio.repository.call("recover", workspace=str(studio.store.workspace), transaction_id=args.transaction_id)
            elif args.command == "smoke":
                import uuid
                from .storage import atomic_json
                folder = studio.store.path(f"smoke/{args.model}-{uuid.uuid4().hex}")
                folder.mkdir(parents=True, exist_ok=True)
                attempted = False
                try:
                    with FileLock(str(tool / ".server.lock"), timeout=0):
                        studio.jobs.backend.load_model(args.model)
                        attempted = True
                        result = studio.jobs.backend.generate(args.model, args.prompt, args.duration, args.seed, folder / "raw.wav")
                        atomic_json(folder / "result.json", {"status": "generated_not_auditioned", "metadata": result})
                except Exception as exc:
                    atomic_json(folder / "result.json", {"status": "failed" if attempted else "not_executed", "error": str(exc)})
                    raise
                finally:
                    studio.jobs.backend.unload()
                    studio.jobs.backend.close()
            elif args.command == "serve":
                import uvicorn
                from .server import create_app
                from .server_control import ServerOwner

                owner = ServerOwner(tool)

                class StudioServer(uvicorn.Server):
                    def handle_exit(self, sig, frame):
                        super().handle_exit(sig, frame)
                        owner.request_stop()

                server = StudioServer(uvicorn.Config(create_app(studio), host="127.0.0.1",
                                                    port=args.port, workers=1, timeout_graceful_shutdown=5))
                owner.on_stop = lambda: setattr(server, "should_exit", True)
                # One server/model owner even if two different workspace settings are used.
                with owner:
                    studio.jobs.recover_interrupted()
                    studio.catalog.sync()
                    if owner.stopping.is_set():
                        return
                    browser_timer = None
                    try:
                        if not args.no_open:
                            browser_timer = threading.Timer(1, lambda: None if owner.stopping.is_set()
                                                            else webbrowser.open(f"http://127.0.0.1:{args.port}"))
                            browser_timer.daemon = True
                            browser_timer.start()
                        server.run()
                    finally:
                        if browser_timer:
                            browser_timer.cancel()
                return
        print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    except KeyboardInterrupt:
        return
    except Timeout as exc:
        if Path(exc.lock_file).name == ".server.lock":
            print("Audio Studio is already running or still shutting down. Run npm stop, "
                  "then npm start. If stuck: npm stop -- --force.", file=sys.stderr)
        else:
            print("Another Studio writer holds .studio.lock. Wait for its operation to finish and retry.", file=sys.stderr)
        raise SystemExit(1)
    except Exception as exc:
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
