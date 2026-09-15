"""Own the server lock and bound shutdown, including Windows console interrupts."""
from __future__ import annotations

import ctypes
import os
import sys
import threading
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

from filelock import FileLock, Timeout

from .storage import atomic_json, read_json


SHUTDOWN_SECONDS = 15


@contextmanager
def windows_process(pid: int, *, terminate=False):
    """Keep a handle open so PID reuse cannot redirect a forced stop."""
    from ctypes import wintypes

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    kernel.OpenProcess.restype = wintypes.HANDLE
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    kernel.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
    kernel.GetProcessTimes.restype = wintypes.BOOL
    kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
    kernel.TerminateProcess.restype = wintypes.BOOL
    handle = kernel.OpenProcess(0x1000 | (0x0001 if terminate else 0), False, pid)
    if not handle:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        created, exited, system, user = (wintypes.FILETIME() for _ in range(4))
        if not kernel.GetProcessTimes(handle, *(ctypes.byref(t) for t in (created, exited, system, user))):
            raise ctypes.WinError(ctypes.get_last_error())
        birth = (created.dwHighDateTime << 32) | created.dwLowDateTime
        yield kernel, handle, birth
    finally:
        kernel.CloseHandle(handle)


def process_birth():
    if sys.platform != "win32":
        return None
    with windows_process(os.getpid()) as (_, _, birth):
        return birth


def lock_available(tool: Path) -> bool:
    try:
        with FileLock(str(tool / ".server.lock"), timeout=0):
            return True
    except Timeout:
        return False


class ServerOwner:
    """The stop request works even when HTTP has already stopped accepting requests."""

    def __init__(self, tool: Path, *, shutdown_seconds=SHUTDOWN_SECONDS):
        self.tool = tool.resolve()
        self.lock = FileLock(str(self.tool / ".server.lock"), timeout=0)
        self.instance = uuid.uuid4().hex
        self.shutdown_seconds = shutdown_seconds
        self.done = threading.Event()
        self.stopping = threading.Event()
        self.mutex = threading.RLock()
        self.watchdog = None
        self.watcher = None
        self.on_stop = lambda: None

    def __enter__(self):
        self.lock.acquire()
        try:
            atomic_json(self.tool / ".server-state.json", {
                "instance": self.instance, "pid": os.getpid(), "birth": process_birth(),
                "tool": str(self.tool),
            })
            self.watcher = threading.Thread(target=self._watch, name="studio-stop", daemon=True)
            self.watcher.start()
            return self
        except BaseException:
            self.lock.release()
            raise

    def request_stop(self):
        with self.mutex:
            if self.stopping.is_set() or self.done.is_set():
                return
            self.stopping.set()
            self.watchdog = threading.Timer(self.shutdown_seconds, self._expired)
            self.watchdog.daemon = True
            self.watchdog.start()
        self.on_stop()

    def _expired(self):
        # Exit only this owner, never a PID from a file or a shared model service.
        # OS file locks are released on exit; completed atomic records remain intact.
        with self.mutex:
            if not self.done.is_set():
                print("Studio shutdown timed out; exiting. Unfinished runs will be recovered on restart.",
                      file=sys.stderr, flush=True)
                os._exit(1)

    def _watch(self):
        while not self.done.wait(0.2):
            try:
                request = read_json(self.tool / ".server-stop.json", {})
                if request.get("instance") == self.instance:
                    self.request_stop()
            except (OSError, ValueError):
                # A transient scanner/atomic replacement must not kill the monitor.
                continue

    def __exit__(self, *_):
        with self.mutex:
            self.done.set()
            if self.watchdog:
                self.watchdog.cancel()
        if self.watcher:
            self.watcher.join(timeout=1)
        try:
            # Remove only this owner's metadata, while still holding the server lock.
            (self.tool / ".server-state.json").unlink(missing_ok=True)
            (self.tool / ".server-stop.json").unlink(missing_ok=True)
        finally:
            self.lock.release()


def force_stop(tool: Path, state: dict):
    if sys.platform != "win32":
        raise ValueError("Forced stop is supported on Windows only; use the Studio terminal on this platform.")
    if read_json(tool / ".server-state.json") != state:
        raise ValueError("Studio instance changed; run stop again.")
    pid, expected_birth = state.get("pid"), state.get("birth")
    if not isinstance(pid, int) or pid <= 0 or not isinstance(expected_birth, int):
        raise ValueError("Missing process identity; refusing to terminate an unverified process.")
    with windows_process(pid, terminate=True) as (kernel, handle, birth):
        if birth != expected_birth:
            raise ValueError("Studio PID has been reused; refusing to terminate another process.")
        if not kernel.TerminateProcess(handle, 1):
            raise ctypes.WinError(ctypes.get_last_error())


def stop_server(tool: Path, *, force=False, timeout=SHUTDOWN_SECONDS + 5):
    tool = tool.resolve()
    if lock_available(tool):
        return {"status": "already_stopped"}
    state = read_json(tool / ".server-state.json", {})
    if state.get("tool") != str(tool) or not state.get("instance"):
        raise ValueError("The lock belongs to an older Studio or a model smoke test. "
                         "Stop its terminal first; no process was terminated.")
    atomic_json(tool / ".server-stop.json", {"instance": state["instance"]})
    deadline = time.monotonic() + (2 if force else timeout)
    while time.monotonic() < deadline:
        if lock_available(tool):
            return {"status": "stopped"}
        current = read_json(tool / ".server-state.json", {})
        if current and current.get("instance") != state["instance"]:
            raise ValueError("Another Studio started during shutdown; it was not stopped.")
        time.sleep(0.1)
    if not force:
        raise ValueError("Studio has not exited. Retry with npm stop -- --force for a verified Windows process stop.")
    # Recheck before opening the process handle; completed shutdown is not an error.
    if lock_available(tool):
        return {"status": "stopped"}
    force_stop(tool, state)
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if lock_available(tool):
            return {"status": "force_stopped"}
        time.sleep(0.1)
    raise ValueError("Process stop was requested but the server lock is still occupied.")
