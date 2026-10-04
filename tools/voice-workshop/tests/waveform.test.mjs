import { test } from 'node:test';
import assert from 'node:assert/strict';
import { moveCut, waveformPeaks, WaveformEditor } from '../frontend/WaveformEditor.ts';

test('cut markers clamp to the recording and cannot cross, including pointer drags outside the canvas', () => {
  const selection = { start: 2, end: 8 };
  assert.deepEqual(moveCut(selection, 'start', -10, 10), { start: 0, end: 8 });
  assert.deepEqual(moveCut(selection, 'end', 50, 10), { start: 2, end: 10 });
  assert.deepEqual(moveCut(selection, 'start', 9, 10), { start: 7.999, end: 8 });
  assert.deepEqual(moveCut(selection, 'end', 0, 10), { start: 2, end: 2.001 });
  assert.deepEqual(moveCut(selection, 'start', NaN, 10), selection);
  assert.deepEqual(moveCut(selection, 'end', 3.25, 10), { start: 2, end: 3.25 });
});

test('waveform bins retain short peaks and do not normalize quiet references', () => {
  const input = new Float32Array(10000); input[123] = -.5; input[9999] = .25;
  const peaks = waveformPeaks(input, 100);
  assert.equal(peaks.length, 100); assert.equal(peaks[1], .5); assert.equal(peaks[99], .25);
  assert.equal(peaks[0], 0);
  assert.equal(waveformPeaks(new Float32Array()).length, 0);
});

test('scaled pointer drags select the exact preview interval and teardown stops its audio', async t => {
  const originals = new Map(['document', 'AudioContext', 'requestAnimationFrame', 'cancelAnimationFrame'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  t.after(() => { for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  const elements = []; const sources = []; let closed = 0;
  const context = new Proxy({}, { get: (target, key) => target[key] ?? (() => {}) });
  globalThis.document = { createElement: tag => {
    const capture = new Set(); const node = { tag, children: [], attributes: {}, append(...nodes) { this.children.push(...nodes); },
      setAttribute(key, value) { this.attributes[key] = value; }, getContext: () => context,
      getBoundingClientRect: () => ({ left: 50, width: 550 }), focus() {},
      setPointerCapture(id) { capture.add(id); }, hasPointerCapture: id => capture.has(id), releasePointerCapture(id) { capture.delete(id); } };
    elements.push(node); return node;
  } };
  globalThis.requestAnimationFrame = () => 1; globalThis.cancelAnimationFrame = () => {};
  globalThis.AudioContext = class {
    currentTime = 0; destination = {};
    resume() { return Promise.resolve(); }
    close() { closed++; return Promise.resolve(); }
    createBufferSource() { const source = { connect() {}, disconnect() {}, start(...args) { this.started = args; }, stop() { this.stopped = true; } }; sources.push(source); return source; }
  };
  const draft = { blob: new Blob(), buffer: { duration: 10, getChannelData: () => new Float32Array([.1, -.3]) }, selection: { start: 0, end: 10 } };
  let changed;
  const editor = new WaveformEditor(document.createElement('section'), draft, value => { changed = value; }, error => assert.fail(error));
  const canvas = elements.find(e => e.tag === 'canvas');
  const event = x => ({ button: 0, pointerId: 1, clientX: x, preventDefault() {} });
  canvas.onpointerdown(event(50)); canvas.onpointermove(event(160)); canvas.onpointerup(event(160));
  canvas.onpointerdown(event(600)); canvas.onpointermove(event(490)); canvas.onpointerup(event(490));
  assert.deepEqual(changed.selection, { start: 2, end: 8 });
  elements.find(e => e.textContent === 'Auswahl anhören').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sources[0].started, [0, 2, 6]);
  editor.setLocked(true); assert.equal(sources[0].stopped, true);
  canvas.onpointerdown(event(50)); assert.deepEqual(draft.selection, { start: 2, end: 8 });
  editor.setLocked(false);
  elements.find(e => e.textContent === 'Ganze Aufnahme anhören').onclick();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sources[1].started, [0, 0, 10]);
  editor.destroy(); assert.equal(sources[1].stopped, true); assert.equal(closed, 1);
});
