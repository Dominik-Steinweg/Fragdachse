import copy

import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

from audio_studio.server import create_app
from audio_studio.storage import sha256


def test_music_defaults_prompt_identity_and_sync_preserve_authorship(studio):
    state = studio.catalog.read()
    music = state['catalog']['entries']['music_arena']
    assert music['repository']['music_role'] == 'arena'
    assert music['playback'] == 'loop'
    assert music['processing']['profile'] == 'music_loop'
    assert 60 <= music['generation_defaults']['duration_seconds'] <= 120
    assert music['prompt']['text'] == ''
    state = studio.catalog.edit('music_arena', {'prompt': {'text': '  Original music prompt.\nNo rewrite.  ', 'source': 'manual'}, 'musical_identity': 'shared-direction-v2', 'notes': 'Keep my composition brief.'}, state['revision'])
    authored = copy.deepcopy(state['catalog']['entries']['music_arena'])
    fresh = studio.catalog.sync()['catalog']['entries']['music_arena']
    for field in ('prompt', 'musical_identity', 'notes', 'generation_defaults', 'processing'):
        assert fresh[field] == authored[field]


def test_music_duration_and_model_are_checked_against_current_game_facts(studio, monkeypatch):
    state = studio.catalog.read()
    state = studio.catalog.edit('music_arena', {'prompt': {'text': 'Music.'}}, state['revision'])
    submitted = []
    monkeypatch.setattr(studio.jobs, 'submit', lambda key, author, facts, **kwargs: submitted.append((key, author, facts)))
    settings = {'model': 'medium', 'duration_seconds': 120, 'candidate_count': 1, 'steps': 8, 'cfg_scale': 1}
    studio.generate('music_arena', state['revision'], generation=settings, seed=9)
    assert submitted[0][1]['generation_defaults'] == settings
    assert submitted[0][2]['kind'] == 'music'
    for patch in ({'model': 'small-sfx'}, {'model': 'small-sfx-comfyui'}, {'duration_seconds': 120.5}, {'duration_seconds': 381}):
        with pytest.raises(ValueError):
            studio.generate('music_arena', state['revision'], generation={**settings, **patch})
    with pytest.raises(ValueError, match='47 seconds'):
        studio.generate('sfx_one', state['revision'], generation=settings)
    assert len(submitted) == 1


def test_music_profile_cannot_be_applied_to_sfx_through_authoring_or_processing(studio):
    with pytest.raises(ValueError, match='reserved'):
        studio.catalog.edit('sfx_one', {'category': 'music', 'processing': {'profile': 'music_loop'}}, studio.catalog.read()['revision'])
    run = studio.import_current('sfx_one')
    with pytest.raises(ValueError, match='reserved'):
        studio.process(run['id'], '0', 'loop', 'music_loop', {})


def test_legacy_music_wav_is_playable_but_blocked_before_export_review(studio):
    catalog = studio.root / 'src/audio/AudioCatalog.ts'
    catalog.write_text(catalog.read_text().replace("./assets/sounds/music.ogg", "./assets/sounds/music.wav"))
    target = studio.root / 'public/assets/sounds/music.wav'
    t = np.arange(16000) / 8000
    sf.write(target, .1 * np.sin(2 * np.pi * 220 * t), 8000)
    studio.catalog.sync()
    run = studio.import_current('music_arena')
    version = studio.process(run['id'], '0', 'loop', 'music_loop', {})
    with pytest.raises(ValueError, match='central game target must use .ogg'):
        studio.plan_export([{'run_id': run['id'], 'candidate_id': '0', 'version_id': version['id']}])
    assert studio.candidate(run['id'], '0')[1]['protected'] is False


def test_music_import_processing_audition_review_and_manual_publish(studio):
    target = studio.root / 'public/assets/sounds/music.ogg'
    rate = 8000
    t = np.arange(rate * 5) / rate
    sf.write(target, .08 * np.sin(2 * np.pi * 220 * t), rate, format='OGG', subtype='VORBIS')
    studio.catalog.sync()
    original = sha256(target)
    source_catalog = studio.root / 'src/audio/AudioCatalog.ts'
    before_catalog = source_catalog.read_bytes()
    run = studio.import_current('music_arena')
    raw = studio.audio_path(run['id'], '0')
    raw_hash = sha256(raw)
    with pytest.raises(ValueError, match='music_loop'):
        studio.process(run['id'], '0', 'oneshot', 'impact', {})
    version = studio.process(run['id'], '0', 'loop', 'music_loop', {'crossfade_ms': 500})
    selection = {'run_id': run['id'], 'candidate_id': '0', 'version_id': version['id']}
    assert sha256(raw) == raw_hash
    assert sha256(target) == original
    assert source_catalog.read_bytes() == before_catalog
    with TestClient(create_app(studio), base_url='http://127.0.0.1:8765') as client:
        for kind in ('raw', 'wav', 'ogg', 'loop'):
            url = f"/media/run/{run['id']}/0/{kind}?version_id={version['id']}"
            assert client.get(url).status_code == 200
        assert client.get('/media/game/music_arena').status_code == 200
        response = client.get(f"/api/waveform/{run['id']}/0?kind=wav&version_id={version['id']}")
        assert response.status_code == 200
        assert response.json()['duration_seconds'] > 0
    plan = studio.plan_export([selection])
    assert plan['items'][0]['key'] == 'music_arena'
    with pytest.raises(ValueError, match='human'):
        studio.commit_export(plan['id'], confirmed=False)
    assert sha256(target) == original
    studio.commit_export(plan['id'], confirmed=True)
    assert sha256(target) == sha256(studio.audio_path(**selection, kind='ogg'))
    assert studio.repository.scan()['entries']['music_arena']['shipped'] is True
