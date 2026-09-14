import json
from pathlib import Path

import pytest

from audio_studio import storage


def test_json_read_recovers_from_transient_permission_denial(tmp_path, monkeypatch):
    path = tmp_path / 'generation.json'
    path.write_text('{"status":"complete"}', encoding='utf-8')
    original = Path.read_text
    attempts, waits = [], []

    def temporarily_locked(self, *args, **kwargs):
        attempts.append(self)
        if len(attempts) <= 2:
            raise PermissionError(13, 'sharing violation', str(self))
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Path, 'read_text', temporarily_locked)
    monkeypatch.setattr(storage.time, 'sleep', waits.append)
    assert storage.read_json(path) == {'status': 'complete'}
    assert len(attempts) == 3
    assert waits == [.025, .05]


def test_persistent_denial_is_bounded_and_never_becomes_default(tmp_path, monkeypatch):
    waits = []

    def locked(self, *args, **kwargs):
        raise PermissionError(13, 'denied', str(self))

    monkeypatch.setattr(Path, 'read_text', locked)
    monkeypatch.setattr(storage.time, 'sleep', waits.append)
    with pytest.raises(PermissionError):
        storage.read_json(tmp_path / 'generation.json', default={})
    assert len(waits) == 4
    assert sum(waits) < 1


def test_missing_and_corrupt_json_remain_distinct(tmp_path):
    path = tmp_path / 'generation.json'
    assert storage.read_json(path, default={'missing': True}) == {'missing': True}
    path.write_text('{broken', encoding='utf-8')
    with pytest.raises(json.JSONDecodeError):
        storage.read_json(path, default={})


@pytest.mark.parametrize('denials', [1, 4])
def test_atomic_write_retries_without_removing_previous_record(tmp_path, monkeypatch, denials):
    path = tmp_path / 'generation.json'
    storage.atomic_json(path, {'completed': 3})
    original = storage.os.replace
    attempts, waits = [], []

    def locked(source, destination):
        attempts.append(source)
        assert storage.read_json(path) == {'completed': 3}
        assert storage.read_json(Path(source)) == {'completed': 4}
        if len(attempts) <= denials:
            raise PermissionError(13, 'sharing violation', str(destination))
        return original(source, destination)

    monkeypatch.setattr(storage.os, 'replace', locked)
    monkeypatch.setattr(storage.time, 'sleep', waits.append)
    storage.atomic_json(path, {'completed': 4})
    assert storage.read_json(path) == {'completed': 4}
    assert len(attempts) == denials + 1
    assert len(set(attempts)) == 1
    assert not list(tmp_path.glob('*.tmp'))


@pytest.mark.parametrize('error', [PermissionError(13, 'denied'), OSError(28, 'disk full')])
def test_failed_atomic_write_preserves_old_record_and_is_bounded(tmp_path, monkeypatch, error):
    path = tmp_path / 'generation.json'
    storage.atomic_json(path, {'completed': 3})
    attempts, waits = [], []

    def fail(*args):
        attempts.append(args)
        raise error

    monkeypatch.setattr(storage.os, 'replace', fail)
    monkeypatch.setattr(storage.time, 'sleep', waits.append)
    with pytest.raises(type(error)):
        storage.atomic_json(path, {'completed': 4})
    assert len(attempts) == (9 if isinstance(error, PermissionError) else 1)
    assert sum(waits) < 2
    assert storage.read_json(path) == {'completed': 3}
    assert not list(tmp_path.glob('*.tmp'))


def test_atomic_retry_rechecks_concurrent_edit(tmp_path, monkeypatch):
    path = tmp_path / 'sounds.json'
    storage.atomic_json(path, {'prompt': 'original'})
    expected = storage.sha256(path)
    attempts = []

    def fail(*args):
        attempts.append(args)
        raise PermissionError(13, 'sharing violation')

    def edit_during_wait(_):
        path.write_text('{"prompt":"newer edit"}', encoding='utf-8')

    monkeypatch.setattr(storage.os, 'replace', fail)
    monkeypatch.setattr(storage.time, 'sleep', edit_during_wait)
    with pytest.raises(storage.Conflict):
        storage.atomic_json(path, {'prompt': 'outdated edit'}, expected=expected, check=True)
    assert len(attempts) == 1
    assert storage.read_json(path) == {'prompt': 'newer edit'}
    assert not list(tmp_path.glob('*.tmp'))
