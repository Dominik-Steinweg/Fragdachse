import {test} from 'node:test';
import assert from 'node:assert/strict';
import {milliseconds, moveMarker, processingOverrides, drawWaveform} from './waveform.js';
import {jobProgress} from './progress.js';
import {generationLabel, generationSettings} from './generation.js';

const range = {duration_ms: 2000, start_ms: 100, end_ms: 1800, fade_in_ms: 10, fade_out_ms: 40};
test('comparison labels retain provider identity and the recorded parameters', () => {
  const models = [
    {name: 'small-sfx', label: 'Small-SFX', backend: 'python'},
    {name: 'small-sfx-comfyui', label: 'Small-SFX', backend: 'comfyui'},
    {name: 'medium', label: 'Medium', backend: 'comfyui'},
  ];
  const run = {author_snapshot: {generation_defaults: {model: 'small-sfx', duration_seconds: 3, steps: 8, cfg_scale: 1}}};
  const candidate = {seed: 42, generation: {model_id: 'stabilityai/stable-audio-3-small-sfx'}};
  assert.equal(generationLabel(run, candidate, models), 'Small-SFX (Python)');
  run.author_snapshot.generation_defaults.model = 'small-sfx-comfyui';
  candidate.generation = {backend: 'comfyui'};
  assert.equal(generationLabel(run, candidate, models), 'Small-SFX (ComfyUI)');
  assert.equal(generationSettings(run, candidate), 'Seed 42 · 3 s · 8 Schritte · CFG 1');
  run.author_snapshot.generation_defaults.model = 'medium';
  candidate.generation = {model_id: 'stabilityai/stable-audio-3-medium'};
  assert.equal(generationLabel(run, candidate, models), 'Medium (Python)');
  assert.equal(generationLabel({status: 'imported'}, null, models), 'Game-Import');
});
test('mouse markers preserve a nonempty source range and respect the source bounds', () => {
  assert.equal(moveMarker(range, 'start', -1).start_ms, 0);
  assert.equal(moveMarker(range, 'start', 1).start_ms, 1799);
  assert.equal(moveMarker(range, 'end', 0).end_ms, 101);
  assert.equal(moveMarker(range, 'end', 2).end_ms, 2000);
  assert.deepEqual(range, {duration_ms: 2000, start_ms: 100, end_ms: 1800, fade_in_ms: 10, fade_out_ms: 40});
});
test('fade pointer positions are relative to the selected cut, not the file edge', () => {
  assert.equal(moveMarker(range, 'fade-in', .2).fade_in_ms, 300);
  assert.equal(moveMarker(range, 'fade-out', .7).fade_out_ms, 400);
  assert.equal(moveMarker(range, 'fade-in', 1).fade_in_ms, 1000);
  const short = moveMarker(range, 'end', .051);
  assert.equal(short.fade_out_ms, short.end_ms - short.start_ms);
});
test('millisecond fields convert once to the shared processor contract; zero is explicit', () => {
  assert.deepEqual(processingOverrides({start: '0', end: '1234.5', fade_in: '2.5', fade_out: '', crossfade: '', gain: '-3', curve: 'linear', auto_trim: true}),
    {start_seconds: 0, end_seconds: 1.2345, fade_in_ms: 2.5, output_gain_db: -3, crossfade_curve: 'linear', auto_trim: true});
  assert.equal(milliseconds(1.23456), 1234.6);
});
test('progress reports real steps without claiming completion before WAV finalization', () => {
  const base = {status: 'generating', completed: 1, seeds: [1, 2], progress: {stage: 'sampling', fraction: .5, completed_steps: 4, total_steps: 8}};
  assert.equal(jobProgress(base).percent, 75);
  assert.match(jobProgress(base).detail, /4 \/ 8/);
  assert.equal(jobProgress({...base, completed: 0, status: 'loading'}).percent, null);
  assert.equal(jobProgress({...base, progress: {stage: 'finalizing'}}).percent, 99);
  assert.equal(jobProgress({...base, status: 'complete', completed: 2}).percent, 100);
  assert.equal(jobProgress({...base, status: 'failed'}).kind, 'error');
  assert.equal(jobProgress({...base, status: 'failed'}).percent, 50);
});
test('raw and processed waveform use identical amplitude scale with independent time axes', () => {
  function draw(duration, peaks) {
    const lines = [], labels = [];
    const ctx = {clearRect(){},beginPath(){},stroke(){},moveTo(...p){lines.push(p);},lineTo(...p){lines.push(p);},fillText(...p){labels.push(p);}};
    drawWaveform({width: 1000, height: 240, getContext: () => ctx}, {duration_seconds: duration, peaks});return {lines, labels};
  }
  const raw = draw(2, [.5]), processed = draw(1, [.5]);
  assert.deepEqual(raw.lines, processed.lines);
  assert.ok(raw.labels.some(label => label[0] === '2000 ms'));
  assert.ok(processed.labels.some(label => label[0] === '1000 ms'));
});
test('remote queue and sampling show reported status without inventing step percentages', () => {
  const run = {status: 'generating', completed: 0, seeds: [1], progress: {stage: 'queued', detail: 'ComfyUI wartet.'}};
  assert.equal(jobProgress(run).percent, null);
  assert.equal(jobProgress(run).detail, 'ComfyUI wartet.');
  run.progress = {stage: 'sampling', indeterminate: true, detail: 'ComfyUI generiert.'};
  assert.equal(jobProgress(run).percent, null);
  assert.equal(jobProgress(run).detail, 'ComfyUI generiert.');
  run.status = 'cancelling';
  run.progress.stage = 'queued';
  assert.equal(jobProgress(run).label, 'Abbruch angefordert');
});
