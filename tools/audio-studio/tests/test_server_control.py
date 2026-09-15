import os
import subprocess
import sys
import threading
import time
from contextlib import contextmanager

import pytest
from filelock import FileLock, Timeout

from audio_studio import server_control as control
from audio_studio.storage import atomic_json, read_json


def test_stale_files_do_not_block_a_stopped_server(tmp_path):
    (tmp_path / '.server.lock').touch()
    atomic_json(tmp_path / '.server-state.json', {'pid': 123, 'instance': 'old'})
    assert control.stop_server(tmp_path) == {'status': 'already_stopped'}


def test_stop_and_restart_release_owner_and_ignore_old_requests(tmp_path):
    for _ in range(2):
        ready, stopped = threading.Event(), threading.Event()
        atomic_json(tmp_path / '.server-stop.json', {'instance': 'previous-instance'})

        def serve():
            with control.ServerOwner(tmp_path) as owner:
                owner.on_stop = stopped.set
                ready.set()
                assert stopped.wait(5)

        worker = threading.Thread(target=serve)
        worker.start()
        assert ready.wait(5)
        assert not stopped.wait(0.3)
        assert control.stop_server(tmp_path) == {'status': 'stopped'}
        worker.join(5)
        assert not worker.is_alive()
        assert control.lock_available(tmp_path)
        assert not (tmp_path / '.server-state.json').exists()


def test_second_owner_cannot_replace_live_metadata(tmp_path):
    with control.ServerOwner(tmp_path):
        original = read_json(tmp_path / '.server-state.json')
        with pytest.raises(Timeout):
            with control.ServerOwner(tmp_path):
                pytest.fail('A second owner acquired the server lock')
        assert read_json(tmp_path / '.server-state.json') == original


def test_smoke_or_legacy_owner_is_never_guessed_or_killed(tmp_path):
    with FileLock(str(tmp_path / '.server.lock')):
        with pytest.raises(ValueError, match='older Studio or a model smoke test'):
            control.stop_server(tmp_path, force=True)


def child_owner(tmp_path, script):
    process = subprocess.Popen([sys.executable, '-c', script, str(tmp_path)],
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0)
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if (tmp_path / '.server-state.json').exists():
            return process
        if process.poll() is not None:
            pytest.fail(str(process.communicate()))
        time.sleep(0.02)
    process.kill()
    process.communicate()
    pytest.fail('Server owner did not start')


def test_shutdown_watchdog_releases_lock_when_cleanup_never_returns(tmp_path):
    process = child_owner(tmp_path, '''
import sys, time
from pathlib import Path
from audio_studio.server_control import ServerOwner
with ServerOwner(Path(sys.argv[1]), shutdown_seconds=0.5) as owner:
    owner.request_stop()
    while True: time.sleep(0.1)
''')
    try:
        _, error = process.communicate(timeout=10)
        assert process.returncode == 1
        assert b'shutdown timed out' in error
        assert control.lock_available(tmp_path)
        assert control.stop_server(tmp_path)['status'] == 'already_stopped'
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()


@pytest.mark.skipif(sys.platform != 'win32', reason='Windows process-handle verification')
def test_forced_stop_terminates_only_the_verified_owner(tmp_path):
    process = child_owner(tmp_path, '''
import os, sys, time
from pathlib import Path
from filelock import FileLock
from audio_studio.server_control import process_birth
from audio_studio.storage import atomic_json
tool = Path(sys.argv[1]).resolve()
with FileLock(str(tool / '.server.lock')):
    atomic_json(tool / '.server-state.json', {
        'pid': os.getpid(), 'birth': process_birth(), 'instance': 'unresponsive', 'tool': str(tool)})
    while True: time.sleep(0.1)
''')
    try:
        assert control.stop_server(tmp_path, force=True)['status'] == 'force_stopped'
        process.communicate(timeout=5)
        assert control.lock_available(tmp_path)
    finally:
        if process.poll() is None:
            process.kill()
            process.communicate()


@pytest.mark.skipif(sys.platform != 'win32', reason='Windows process-handle verification')
def test_force_stop_rejects_reused_pid_and_changed_owner(tmp_path, monkeypatch):
    state = {'pid': 123, 'birth': 100, 'instance': 'first', 'tool': str(tmp_path)}
    atomic_json(tmp_path / '.server-state.json', state)

    @contextmanager
    def reused(*args, **kwargs):
        yield None, None, 200

    monkeypatch.setattr(control, 'windows_process', reused)
    with pytest.raises(ValueError, match='PID has been reused'):
        control.force_stop(tmp_path, state)
    atomic_json(tmp_path / '.server-state.json', {**state, 'instance': 'second'})
    with pytest.raises(ValueError, match='instance changed'):
        control.force_stop(tmp_path, state)
