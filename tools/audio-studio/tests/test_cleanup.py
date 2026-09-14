import copy

import pytest
from fastapi.testclient import TestClient

from audio_studio.server import create_app
from audio_studio.service import Studio
from audio_studio.storage import Conflict


@pytest.mark.parametrize('change', ['favorite', 'protected', 'cleaned', 'processing', 'active'])
def test_unprocessed_selection_protects_author_choices_and_active_runs(change):
    run = {'status': 'complete'}
    candidate = {'favorite': False, 'protected': False, 'cleaned': False, 'discarded': False, 'versions': []}
    assert Studio._cleanup_eligible(run, candidate, 'unprocessed')
    assert not Studio._cleanup_eligible(run, candidate, 'discarded')
    if change == 'active':
        run['status'] = 'generating'
    elif change == 'processing':
        candidate['versions'].append({'status': 'failed', 'files': {}})
    else:
        candidate[change] = True
    assert not Studio._cleanup_eligible(run, candidate, 'unprocessed')


def test_unprocessed_http_preview_and_confirmation_remove_raw_only(studio):
    run = studio.import_current('sfx_one')
    raw = studio.audio_path(run['id'], '0')
    raw_bytes = raw.stat().st_size
    source = studio.game_audio('sfx_one')
    source_before = source.read_bytes()
    catalog_before = studio.store.catalog_path.read_bytes()
    author = copy.deepcopy(run['author_snapshot'])
    with TestClient(create_app(studio), base_url='http://127.0.0.1:8765') as client:
        token = {'X-Studio-Token': client.get('/api/state').json()['token']}
        assert client.post('/api/cleanup/plan', json={'mode': 'invalid'}, headers=token).status_code == 400
        assert client.post('/api/cleanup/plan', json={}, headers=token).json()['items'] == []
        response = client.post('/api/cleanup/plan', json={'mode': 'unprocessed'}, headers=token)
        assert response.status_code == 200
        plan = response.json()
        assert plan['mode'] == 'unprocessed'
        assert len(plan['items']) == 1
        assert plan['items'][0]['key'] == 'sfx_one'
        assert plan['items'][0]['bytes'] == raw_bytes
        assert raw.is_file()
        assert client.post('/api/cleanup/commit', json={'plan_id': plan['id'], 'confirmed': False}, headers=token).status_code == 400
        assert raw.is_file()
        assert client.post('/api/cleanup/commit', json={'plan_id': plan['id'], 'confirmed': True}, headers=token).status_code == 200
        assert not raw.exists()
        assert client.post('/api/cleanup/commit', json={'plan_id': plan['id'], 'confirmed': True}, headers=token).status_code == 409
        saved = studio.jobs.read(run['id'])
        assert saved['author_snapshot'] == author
        assert saved['candidates'][0]['cleaned'] is True
        assert studio.cleanup_plan('unprocessed')['items'] == []
        assert source.read_bytes() == source_before
        assert studio.store.catalog_path.read_bytes() == catalog_before


@pytest.mark.parametrize('change', ['favorite', 'processing', 'active'])
def test_changed_selection_blocks_entire_cleanup_before_first_delete(studio, change):
    first = studio.import_current('sfx_one')
    second = studio.import_current('sfx_one')
    paths = [studio.audio_path(r['id'], '0') for r in (first, second)]
    plan = studio.cleanup_plan('unprocessed')
    assert len(plan['items']) == 2

    def update(run):
        if change == 'active':
            run['status'] = 'generating'
        elif change == 'processing':
            # Even failed processing with no new file is a protected selection.
            run['candidates'][0]['versions'].append({'status': 'failed', 'files': {}})
        else:
            run['candidates'][0]['favorite'] = True

    studio.jobs.update(second['id'], update)
    with pytest.raises(Conflict, match='protected'):
        studio.cleanup(plan['id'], True)
    assert all(path.is_file() for path in paths)
