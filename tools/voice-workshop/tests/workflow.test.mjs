import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionProgress, explainError, TEST_IDS } from '../frontend/workflow.ts';
import { isOwnAudioOutput } from '../generator.mjs';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

test('production guidance requires consent, reference and all current accepted tests', () => {
  const voice = { consentGenerate: true, reference: 'ref.wav', transcript: 'Text', referenceRevision: 2, testedRevision: 1 };
  assert.equal(productionProgress(undefined, []).canTest, false);
  assert.match(productionProgress({ ...voice, consentGenerate: false }, []).reason, /Zustimmung/);
  assert.match(productionProgress({ ...voice, reference: null }, []).reason, /auf/);
  const jobs = TEST_IDS.map(sentenceId => ({ sentenceId, voiceId: 'v', test: true, status: 'review', decision: 'accepted' }));
  assert.equal(productionProgress(voice, jobs).testsAccepted, 3);
  assert.equal(productionProgress(voice, jobs).canProduce, false);
  assert.equal(productionProgress({ ...voice, testedRevision: 2 }, jobs).canProduce, true);
  assert.equal(productionProgress(voice, jobs.map(j => ({ ...j, stale: true }))).testsAccepted, 0);
  assert.equal(productionProgress(voice, [{ ...jobs[0], decision: 'rejected' }]).testsAvailable, 0);
});
test('LAN guidance needs one combined consent but no accepted tests', () => {
  const voice = { consentGenerate: true, consentLan: true, reference: 'ref.wav', transcript: 'Text', referenceRevision: 2, testedRevision: 0 };
  assert.equal(productionProgress(voice, [], true).canProduce, true);
  assert.equal(productionProgress({ ...voice, consentLan: false }, [], true).canProduce, false);
  assert.equal(productionProgress({ ...voice, archived: true }, [], true).canProduce, false);
  assert.equal(productionProgress({ ...voice, reference: undefined }, [], true).canProduce, false);
});

test('microphone and service failures explain the next action', () => {
  assert.match(explainError({ name: 'NotAllowedError' }), /Browser-Einstellungen/);
  assert.match(explainError(new TypeError('Failed to fetch')), /Werkstatt-Dienst/);
  assert.match(explainError(new Error('VOICE_COMFY_INPUT fehlt')), /Ein-\/Ausgabeordner/);
  assert.match(explainError({ name: 'EncodingError' }), /WAV/);
});
test('ComfyUI Windows separators are accepted only for the exact owned output folder', () => {
  const output = { type: 'output', subfolder: 'voice-workshop\\job', filename: 'take_00001.flac' };
  assert.equal(isOwnAudioOutput(output, 'voice-workshop/job'), true);
  assert.equal(isOwnAudioOutput({ ...output, subfolder: 'voice-workshop/job/../other' }, 'voice-workshop/job'), false);
  assert.equal(isOwnAudioOutput({ ...output, filename: '../take_00001.flac' }, 'voice-workshop/job'), false);
  assert.equal(isOwnAudioOutput({ ...output, type: 'input' }, 'voice-workshop/job'), false);
});

test('a failed microphone recorder cannot stop or overwrite the next recording', async () => {
  const elements = [], recorders = [], tracks = [], contexts = [], frames = [], editors = [];
  const makeNode = tag => {
    const node = { tag, textContent: '', children: [], dataset: {}, style: {}, classList: { add() {} },
      append(...children) { this.children.push(...children); }, prepend(...children) { this.children.unshift(...children); },
      replaceChildren(...children) { this.children = children; }, setAttribute() {}, scrollIntoView() {},
      get lastElementChild() { return this.children.at(-1); } };
    elements.push(node); return node;
  };
  const app = makeNode('app');
  const document = { createElement: makeNode, createElementNS: (_namespace, tag) => makeNode(tag),
    querySelector: selector => selector === '#app' ? app : selector.startsWith('meta') ? { content: 'test-token' }
      : elements.find(node => '#' + node.id === selector), querySelectorAll: () => [] };
  class Editor {
    busy = false; locked = false; loads = [];
    constructor() { editors.push(this); }
    setLocked(value) { this.locked = value; }
    destroy() {}
    async load(blob) { this.loads.push(blob); }
  }
  class Context {
    closed = false;
    constructor() { contexts.push(this); }
    createAnalyser() { return { fftSize: 256, getByteTimeDomainData: data => data.fill(128) }; }
    createMediaStreamSource() { return { connect() {} }; }
    async close() { this.closed = true; }
  }
  class Recorder {
    state = 'inactive'; mimeType = 'audio/webm';
    constructor() { recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; this.onstop?.(); }
  }
  const source = readFileSync(new URL('../frontend/workshop.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  runInNewContext(compiled, {
    exports: {}, document, AudioContext: Context, MediaRecorder: Recorder, Blob, Uint8Array, performance,
    requestAnimationFrame: callback => { frames.push(callback); return frames.length; },
    window: { addEventListener() {}, setInterval: () => 1 },
    navigator: { mediaDevices: { enumerateDevices: async () => [], getUserMedia: async () => {
      const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
      return { getTracks: () => [track] };
    } } },
    fetch: async () => ({ ok: true, json: async () => ({ voices: [{ id: 'speaker', name: 'Test', consentGenerate: true,
      consentLan: true }], jobs: [] }) }),
    require: id => id.endsWith('WaveformEditor') ? { WaveformEditor: Editor }
      : id.endsWith('workflow') ? { productionProgress, explainError, TEST_IDS }
      : id.endsWith('.json') ? { text: 'Test reference' } : {},
  });
  await new Promise(resolve => setImmediate(resolve));
  const recordButton = elements.find(node => node.textContent === 'Aufnehmen / neu aufnehmen');
  assert.ok(recordButton, app.textContent);
  await recordButton.onclick();
  recorders[0].ondataavailable({ data: new Blob(['failed audio']) });
  recorders[0].state = 'inactive'; recorders[0].onerror();
  assert.equal(tracks[0].stopped, true);
  await recordButton.onclick();
  assert.equal(recorders.length, 2);
  recorders[1].ondataavailable({ data: new Blob(['new audio']) });
  recorders[0].onstop();
  recorders[0].onerror();
  const scheduledFrames = frames.length;
  frames[0]();
  assert.equal(frames.length, scheduledFrames);
  assert.equal(tracks[1].stopped, false);
  assert.equal(contexts[1].closed, false);
  assert.equal(editors[0].loads.length, 0);
  assert.equal(editors[0].locked, true);
  await elements.find(node => node.textContent === 'Stoppen').onclick();
  assert.equal(tracks[1].stopped, true);
  assert.equal(contexts[1].closed, true);
  assert.equal(editors[0].loads.length, 1);
  assert.equal(await editors[0].loads[0].text(), 'new audio');
});
