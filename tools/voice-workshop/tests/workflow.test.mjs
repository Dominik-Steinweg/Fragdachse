import { test } from 'node:test';
import assert from 'node:assert/strict';
import { productionProgress, explainError, TEST_IDS, ACTIVE_JOBS } from '../frontend/workflow.ts';
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

async function frontendFixture(initial = { voices: [{ id: 'speaker', name: 'Test', consentGenerate: true, consentLan: true, catalog: [] }], catalog: [], jobs: [], packages: [] }) {
  const elements = [], recorders = [], tracks = [], contexts = [], frames = [], editors = [];
  const requests = []; let poll;
  const makeNode = tag => {
    const node = { tag, textContent: '', children: [], attributes: {}, dataset: {}, style: {}, classList: { add() {} },
      append(...children) { this.children.push(...children); }, prepend(...children) { this.children.unshift(...children); },
      replaceChildren(...children) { this.children = children; }, setAttribute(key, value) { this.attributes[key] = value; }, scrollIntoView() {}, focus() {},
      get lastElementChild() { return this.children.at(-1); } };
    elements.push(node); return node;
  };
  const app = makeNode('app');
  const document = { createElement: makeNode, createElementNS: (_namespace, tag) => makeNode(tag),
    querySelector: selector => selector === '#app' ? app : selector.startsWith('meta') ? { content: 'test-token' }
      : elements.find(node => '#' + node.id === selector), querySelectorAll: () => [] };
  class Editor {
    busy = false; locked = false; loads = [];
    constructor(_parent, draft, onChange) { this.draft = draft; this.onChange = onChange; editors.push(this); }
    setLocked(value) { this.locked = value; }
    destroy() {}
    async load(blob) { this.loads.push(blob); this.onChange({ blob, selection: { start: 0, end: 10 } }); }
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
    FileReader: class { readAsDataURL() { this.result = 'data:audio/wav;base64,c3ludGhldGlj'; this.onload(); } },
    window: { addEventListener() {}, setInterval: callback => { poll = callback; return 1; } },
    navigator: { mediaDevices: { enumerateDevices: async () => [], getUserMedia: async () => {
      const track = { stopped: false, stop() { this.stopped = true; } }; tracks.push(track);
      return { getTracks: () => [track] };
    } } },
    fetch: async (url, options) => {
      if (options?.body) requests.push({ url, data: JSON.parse(options.body) });
      return { ok: true, json: async () => structuredClone(initial) };
    },
    require: id => id.endsWith('WaveformEditor') ? { WaveformEditor: Editor }
      : id.endsWith('workflow') ? { productionProgress, explainError, TEST_IDS, ACTIVE_JOBS }
      : id.endsWith('.json') ? { id: 'reference-test', text: 'Test reference' } : {},
  });
  await new Promise(resolve => setImmediate(resolve));
  const nodes = (root = app) => [root, ...root.children.flatMap(nodes)];
  const visible = (root = app) => root.hidden ? [] : [root, ...root.children.flatMap(visible)];
  return { app, elements, recorders, tracks, contexts, frames, editors, requests, nodes, visible, poll };
}

test('a failed microphone recorder cannot stop or overwrite the next recording', async () => {
  const { app, elements, recorders, tracks, contexts, frames, editors } = await frontendFixture();
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

test('reference upload switches from the default script and submits the matching audio and transcript', async () => {
  const fixture = await frontendFixture(); const { visible, editors, requests } = fixture;
  const find = text => visible().find(node => node.textContent === text);
  assert.equal(find('Vorlesetext aufnehmen').attributes['aria-pressed'], 'true');
  assert.equal(find('Gesprochener Text der Datei'), undefined);
  await editors.at(-1).load(new Blob(['script recording']));
  await find('Eigene Datei + Text').onclick();
  const file = visible().find(node => node.type === 'file'); file.files = [new Blob(['uploaded recording'])];
  await file.onchange();
  const transcript = find('Gesprochener Text der Datei').children[0]; transcript.value = 'Mein exakter Referenztext.'; transcript.oninput();
  await find('Vorlesetext aufnehmen').onclick();
  assert.equal(await editors.at(-1).draft.blob.text(), 'script recording');
  await find('Eigene Datei + Text').onclick();
  assert.equal(await editors.at(-1).draft.blob.text(), 'uploaded recording');
  assert.equal(find('Gesprochener Text der Datei').children[0].value, 'Mein exakter Referenztext.');
  await find('Referenz speichern & weiter').onclick();
  const { data } = requests.find(request => request.url === '/api/reference');
  assert.equal(data.voiceId, 'speaker'); assert.equal(data.source, 'upload');
  assert.equal(data.transcript, 'Mein exakter Referenztext.'); assert.equal(data.referenceTextId, undefined);
  assert.equal(data.audio, 'c3ludGhldGlj');
});

test('profile text drafts survive switching and polling while playback stays beside its own sentence', async () => {
  const sentence = { id: 'ready_01', event: 'ready', text: 'Standard.', style: 'Ruhig', cloningMode: 'ultimate', active: true };
  const initial = { voices: ['alice', 'bob'].map(id => ({ id, name: id, reference: `${id}.wav`, transcript: 'Test reference',
    referenceInfo: { duration: 10, warnings: [] }, consentGenerate: true, consentLan: true, referenceRevision: 1,
    catalog: [{ ...sentence, text: `${id} spricht.` }] })), catalog: [sentence], packages: [], jobs: [
      { id: 'alice-take', voiceId: 'alice', sentenceId: sentence.id, text: 'alice spricht.', status: 'review', audio: 'alice.ogg', audioInfo: { warnings: [] } },
      { id: 'bob-take', voiceId: 'bob', sentenceId: sentence.id, text: 'bob spricht.', status: 'review', audio: 'bob.ogg', audioInfo: { warnings: [] } },
    ] };
  const { nodes, visible, requests, poll } = await frontendFixture(initial);
  const find = text => visible().find(node => node.textContent === text);
  const production = visible().find(node => node.tag === 'button' && nodes(node).some(child => child.textContent === 'Texte & Voice-Lines'));
  await production.onclick();
  const card = visible().find(node => node.className === 'sentence-card');
  assert.equal(nodes(card).find(node => node.tag === 'textarea').value, 'alice spricht.');
  assert.match(nodes(card).find(node => node.tag === 'audio').src, /alice\.ogg/);
  const text = nodes(card).find(node => node.tag === 'textarea'); text.value = 'Alice angepasst.'; text.oninput();
  const select = () => nodes(find('Stimmprofil')).find(node => node.tag === 'select');
  select().value = 'bob'; select().onchange();
  assert.equal(visible().find(node => node.tag === 'textarea').value, 'bob spricht.');
  assert.match(visible().find(node => node.tag === 'audio').src, /bob\.ogg/);
  select().value = 'alice'; select().onchange();
  initial.jobs[1].status = 'failed'; await poll();
  assert.equal(visible().find(node => node.tag === 'textarea').value, 'Alice angepasst.');
  await find('Speichern & erzeugen').onclick();
  assert.equal(requests[0].url, '/api/sentence'); assert.equal(requests[0].data.voiceId, 'alice');
  assert.equal(requests[0].data.text, 'Alice angepasst.');
  assert.equal(requests[1].url, '/api/generate'); assert.equal(requests[1].data.voiceId, 'alice');
  assert.equal(requests[1].data.sentenceId, sentence.id);
  await find('Standardkatalog').onclick();
  assert.equal(visible().some(node => node.tag === 'audio'), false);
  const standard = visible().find(node => node.tag === 'textarea'); standard.value = 'Neuer Standard.'; standard.oninput();
  await find('Text speichern').onclick();
  assert.equal(requests.at(-1).url, '/api/sentence'); assert.equal(requests.at(-1).data.voiceId, undefined);
});
