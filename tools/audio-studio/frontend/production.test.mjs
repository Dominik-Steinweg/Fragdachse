import test from 'node:test';
import assert from 'node:assert/strict';
import {allowedModels, allowedProfiles, durationLimit, matchesCategory} from './production.js';
import {moveMarker, processingOverrides} from './waveform.js';

test('repository music classification selects shared Medium provider and music processing', () => {
  const music = {repository: {kind: 'music'}, category: 'custom'}, sfx = {repository: {kind: 'sfx'}, category: 'music'};
  const models = [{name: 'small-sfx'}, {name: 'medium'}, {name: 'small-sfx-comfyui'}];
  assert.deepEqual(allowedModels(music, models), [{name: 'medium'}]);
  assert.deepEqual(allowedModels(sfx, models), models);
  assert.deepEqual(allowedProfiles(music, {impact: {}, music_loop: {}}), ['music_loop']);
  assert.deepEqual(allowedProfiles(sfx, {impact: {}, music_loop: {}}), ['impact']);
  assert.ok(durationLimit(music) >= 120);
  assert.equal(durationLimit(sfx), 47);
  assert.equal(matchesCategory(music, 'kind:music'), true);
  assert.equal(matchesCategory(sfx, 'kind:music'), false);
  assert.equal(matchesCategory(sfx, 'category:music'), true);
});

test('long music endpoints can be set by pointer and converted from ms', () => {
  const range = {duration_ms: 120000, start_ms: 0, end_ms: 120000, fade_in_ms: 0, fade_out_ms: 0};
  const cut = moveMarker(range, 'start', .5);
  assert.equal(cut.start_ms, 60000);
  assert.equal(moveMarker(cut, 'end', .9).end_ms, 108000);
  const result = processingOverrides({start: '60000', end: '108000', fade_in: '', fade_out: '', gain: '0', crossfade: '3000', curve: 'linear', auto_trim: false});
  assert.equal(result.start_seconds, 60);
  assert.equal(result.end_seconds, 108);
  assert.equal(result.crossfade_ms, 3000);
});
