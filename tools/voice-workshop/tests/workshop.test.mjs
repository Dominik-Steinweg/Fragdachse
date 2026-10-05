import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { Workshop, REFERENCE_TEXT } from '../workshop.mjs';
import { createWorkshopServer } from '../server.mjs';
import { makeWorkflow } from '../generator.mjs';
import { validateVoiceBundle, voiceHash, canonicalJson } from '../../../src/voice/VoicePackage.ts';

function tone(seconds = 1) {
  const count = Math.floor(24000 * seconds); const wave = Buffer.alloc(44 + count * 2);
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8); wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(24000, 24); wave.writeUInt32LE(48000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++) wave.writeInt16LE(Math.round(Math.sin(i * 2 * Math.PI * 440 / 24000) * 5000), 44 + i * 2);
  return wave;
}
async function temp(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fd-voice-test-'));
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'fd-voice-test-'));
  t.after(() => rm(dir, { recursive: true, force: true })); return dir;
}
test('fixed cloning workflow preserves text and style as separate fields', () => {
  const graph = makeWorkflow('voice-workshop/id/reference.wav', 'Exakter Satz.', 'Trocken', 5, 'voice-workshop/id/take');
  assert.equal(graph['3'].inputs.text, 'Exakter Satz.'); assert.equal(graph['3'].inputs.control_instruction, 'Trocken');
  assert.equal(graph['3'].inputs.ultimate_clone, false); assert.deepEqual(graph['3'].inputs.reference_audio, ['2', 0]);
  const ultimate = makeWorkflow('reference.wav', 'Exakter Satz.', 'Nicht verwenden', 5, 'take', { mode: 'ultimate', transcript: 'Genau so gesprochen.' });
  assert.equal(ultimate['3'].inputs.ultimate_clone, true);
  assert.equal(ultimate['3'].inputs.reference_audio_text, 'Genau so gesprochen.');
  assert.equal(ultimate['3'].inputs.control_instruction, '');
  assert.equal(ultimate['3'].inputs.text, 'Exakter Satz.');
  assert.throws(() => makeWorkflow('reference.wav', 'Text', '', 1, 'take', { mode: 'ultimate' }), /Transkript/);
  assert.throws(() => makeWorkflow('reference.wav', 'Text', '', 1, 'take', { mode: 'unknown' }), /Modus/);
  const controlled = makeWorkflow('reference.wav', 'Text', 'Energisch', 1, 'take', { mode: 'controllable', transcript: 'Privat' });
  assert.equal(controlled['3'].inputs.reference_audio_text, '');
});
test('offline workshop persists jobs, releases private-data-free immutable Vorbis bundles and rejects stale takes', async t => {
  const root = await temp(t); const generator = { generate: async (_j, _r, submitted) => { await submitted({ workflow: 'fixture', model: 'test-tone' }); return tone(); } };
  const workshop = new Workshop(root, generator); await workshop.initialize();
  await workshop.action('voice', { name: 'Teststimme', consentGenerate: true, consentLan: true });
  const voice = workshop.state.voices[0];
  const reference = { voiceId: voice.id, audio: tone(10).toString('base64'), referenceTextId: REFERENCE_TEXT.id };
  await assert.rejects(workshop.action('reference', { ...reference, referenceTextId: 'old-text' }), /Vorlesetext/);
  assert.equal(voice.referenceRevision, 0);
  await workshop.action('reference', { ...reference, transcript: 'Dieser Text darf nicht übernommen werden.', start: 1, end: 9 });
  assert.equal(voice.transcript, REFERENCE_TEXT.text);
  assert.equal(voice.referenceTextId, REFERENCE_TEXT.id);
  assert.equal(voice.referenceInfo.duration, 8, 'The waveform selection is the saved reference interval');
  assert.equal(voice.referenceInfo.trimStart, 1); assert.equal(voice.referenceInfo.trimEnd, 9);
  await assert.rejects(workshop.action('transcript', { voiceId: voice.id, transcript: 'Anderer Text' }), /Unbekannte Aktion/);
  await workshop.action('generate', { voiceId: voice.id, sentenceId: 'ready_01' });
  const job = workshop.state.jobs[0];
  workshop.paused = false; await workshop.pump(); assert.equal(job.status, 'review', job.error);
  await assert.rejects(workshop.action('review', { id: job.id, decision: 'accepted' }), /anhören/);
  await workshop.action('review', { id: job.id, decision: 'accepted', listened: true });
  await assert.rejects(workshop.release(voice.id, false), /Teilpaket/);
  await workshop.release(voice.id, true);
  const entry = workshop.state.packages[0]; const original = await readFile(path.join(root, 'packages', `${entry.checksum}.fdvoice`), 'utf8');
  const bundle = await validateVoiceBundle(JSON.parse(original));
  assert.equal(bundle.packages[0].manifest.clips[0].codec, 'vorbis');
  for (const privateField of ['referenceRevision', 'transcript', 'workflow', 'seed', 'reference.wav', 'consentGenerate']) assert.ok(!original.includes(privateField));
  const sentence = workshop.state.catalog.find(s => s.id === 'ready_01');
  await workshop.action('sentence', { ...sentence, text: 'Ein neuer Satz.' });
  assert.equal(workshop.stale(job), true);
  await assert.rejects(workshop.action('review', { id: job.id, decision: 'accepted', listened: true }), /aktuelle/);
  assert.equal(await readFile(path.join(root, 'packages', `${entry.checksum}.fdvoice`), 'utf8'), original);
  const tampered = structuredClone(bundle); tampered.packages[0].manifest.clips[0].file = '../reference.wav';
  await assert.rejects(validateVoiceBundle(tampered));
  const extra = structuredClone(bundle); extra.packages[0].manifest.reference = 'private'; await assert.rejects(validateVoiceBundle(extra));
  const hash = structuredClone(bundle); hash.packages[0].files[hash.packages[0].manifest.clips[0].file] = 'AAAA'; await assert.rejects(validateVoiceBundle(hash));
  const long = structuredClone(bundle); const clip = long.packages[0].manifest.clips[0]; const bytes = Buffer.from(long.packages[0].files[clip.file], 'base64');
  bytes.writeBigUInt64LE(999999999n, 6); clip.sha256 = await voiceHash(bytes); long.packages[0].files[clip.file] = bytes.toString('base64'); long.packages[0].checksum = await voiceHash(canonicalJson(long.packages[0].manifest));
  await assert.rejects(validateVoiceBundle(long));
  workshop.paused = true;
  await workshop.action('generate', { voiceId: voice.id, sentenceId: 'ready_02' });
  const neutralJob = workshop.state.jobs.at(-1);
  assert.equal(neutralJob.cloningMode, 'ultimate');
  assert.equal(neutralJob.referenceTranscript, REFERENCE_TEXT.text);
  await workshop.save();
  const restarted = new Workshop(root, generator); await restarted.initialize();
  assert.equal(restarted.state.jobs.at(-1).status, 'interrupted'); assert.equal(restarted.state.packages.length, 1);
  const neutral = restarted.state.catalog.find(s => s.id === 'ready_02');
  await restarted.action('sentence', { ...neutral, cloningMode: 'controllable', style: 'Fröhlich' });
  assert.equal(restarted.stale(restarted.state.jobs.at(-1)), true);
  await restarted.action('generate', { voiceId: voice.id, sentenceId: 'ready_02' });
  assert.equal(restarted.state.jobs.at(-1).cloningMode, 'controllable');
  assert.equal(restarted.state.jobs.at(-1).referenceTranscript, '');
  await restarted.action('cancel');
  await restarted.action('generate', { voiceId: voice.id, tests: true });
  assert.deepEqual(restarted.state.jobs.slice(-3).map(j => j.cloningMode), ['ultimate', 'controllable', 'controllable']);
  await restarted.action('cancel');
  const testJob = restarted.state.jobs.at(-3);
  await restarted.action('reference', reference);
  assert.equal(restarted.stale(testJob), true);
  assert.equal(testJob.referenceTranscript, REFERENCE_TEXT.text);
});
test('starting tests validates the generator first and repeated requests do not duplicate queued or reviewable tests', async t => {
  const workshop = new Workshop(await temp(t), { preflight: async () => { throw new Error('Generator offline'); } }); await workshop.initialize();
  await workshop.action('voice', { name: 'Test', consentGenerate: true });
  const voice = workshop.state.voices[0]; Object.assign(voice, { reference: 'fixture.wav', transcript: REFERENCE_TEXT.text, referenceRevision: 1 });
  await assert.rejects(workshop.action('generate', { voiceId: voice.id, tests: true, start: true }), /Generator offline/);
  assert.equal(workshop.state.jobs.length, 0); assert.equal(workshop.paused, true);
  await workshop.action('generate', { voiceId: voice.id, tests: true });
  await workshop.action('generate', { voiceId: voice.id, tests: true });
  assert.equal(workshop.state.jobs.length, 3);
  for (const job of workshop.state.jobs) job.status = 'review';
  await workshop.action('generate', { voiceId: voice.id, tests: true });
  assert.equal(workshop.state.jobs.length, 3);
  workshop.state.jobs[0].decision = 'rejected';
  await workshop.action('generate', { voiceId: voice.id, tests: true });
  assert.equal(workshop.state.jobs.length, 4); assert.equal(workshop.state.jobs.at(-1).sentenceId, 'test_neutral');
});

test('uploaded reference text is required, persisted and frozen into Ultimate jobs', async t => {
  const root = await temp(t); const workshop = new Workshop(root, {}); await workshop.initialize();
  await workshop.action('voice', { name: 'Dateistimme', consentGenerate: true });
  const voice = workshop.state.voices[0];
  const upload = { voiceId: voice.id, source: 'upload', audio: tone(10).toString('base64'), start: 1, end: 9 };
  for (const transcript of [undefined, '', '   ', 'x'.repeat(5001)]) {
    await assert.rejects(workshop.action('reference', { ...upload, transcript }), /gesprochenen Text/);
  }
  await assert.rejects(workshop.action('reference', { ...upload, source: 'unknown', transcript: 'Hallo.' }), /Referenzquelle/);
  assert.equal(voice.referenceRevision, 0);
  const transcript = 'Hier spricht meine eigene Referenz. Grüße an die nächste Runde!';
  await workshop.action('reference', { ...upload, transcript: `  ${transcript}  ` });
  assert.equal(voice.referenceSource, 'upload'); assert.equal(voice.referenceTextId, null);
  assert.equal(voice.transcript, transcript); assert.equal(voice.referenceInfo.duration, 8);
  await workshop.action('generate', { voiceId: voice.id, testId: 'test_neutral' });
  const job = workshop.state.jobs.at(-1); assert.equal(job.referenceTranscript, transcript);
  await workshop.action('cancel');
  await workshop.action('reference', { ...upload, transcript: 'Ein neuer exakter Wortlaut.' });
  assert.equal(workshop.stale(job), true); assert.equal(job.referenceTranscript, transcript);
  const restored = new Workshop(root, {}); await restored.initialize();
  assert.equal(restored.state.voices[0].transcript, voice.transcript);
  assert.equal(restored.state.voices[0].referenceSource, 'upload');
});

test('profile catalogs isolate edits, inherit defaults and never revive obsolete takes after reset', async t => {
  const root = await temp(t); const workshop = new Workshop(root, { generate: async () => tone() }); await workshop.initialize();
  for (const name of ['Alice', 'Bob']) await workshop.action('voice', { name, consentGenerate: true, consentLan: true });
  const [alice, bob] = workshop.state.voices;
  for (const voice of [alice, bob]) Object.assign(voice, { reference: 'fixture.wav', transcript: 'Referenz.', referenceRevision: 1 });
  const [sentence, second] = workshop.state.catalog;
  workshop.state.catalog.forEach(s => { s.active = s.id === sentence.id || s.id === second.id; });
  const queue = async voice => {
    await workshop.action('generate', { voiceId: voice.id, sentenceId: sentence.id });
    const job = workshop.state.jobs.at(-1); await workshop.action('cancel'); return job;
  };
  const originalAlice = await queue(alice); const originalBob = await queue(bob);
  // Historical jobs have no profile revision and remain valid until their profile changes.
  delete originalAlice.sentenceProfileRevision; delete originalBob.sentenceProfileRevision;
  assert.equal(workshop.stale(originalAlice), false);
  const custom = { ...sentence, voiceId: alice.id, text: 'Alices eigener Spruch.', style: 'Fröhlich', cloningMode: 'controllable' };
  await workshop.action('sentence', custom);
  assert.equal(workshop.stale(originalAlice), true); assert.equal(workshop.stale(originalBob), false);
  assert.equal(originalAlice.text, sentence.text, 'Queued input remains frozen');
  const customJob = await queue(alice);
  assert.equal(customJob.text, custom.text); assert.equal(customJob.style, custom.style);
  await workshop.action('sentence', custom);
  assert.equal(workshop.stale(customJob), false, 'Saving identical fields must not invalidate audio');
  await workshop.action('sentence', { ...sentence, text: 'Neuer Standardtext.' });
  assert.equal(workshop.stale(customJob), false); assert.equal(workshop.stale(originalBob), true);
  assert.equal(workshop.view().voices[0].catalog[0].text, custom.text);
  assert.equal(workshop.view().voices[1].catalog[0].text, 'Neuer Standardtext.');
  await workshop.action('sentence-reset', { voiceId: alice.id, id: sentence.id });
  assert.equal(workshop.stale(customJob), true);
  assert.equal(workshop.view().voices[0].catalog[0].customized, false);
  const resetJob = await queue(alice);
  await workshop.action('sentence', custom);
  assert.equal(workshop.stale(customJob), true, 'Recreating an override cannot revive its earlier takes');
  await workshop.action('sentence-reset', { voiceId: alice.id, id: sentence.id });
  assert.equal(workshop.stale(resetJob), true, 'Resetting again cannot revive earlier inherited takes');
  await workshop.action('sentence', custom);
  await workshop.action('sentence', { ...second, voiceId: alice.id, active: false });
  await workshop.action('generate', { voiceId: alice.id, lan: true });
  const queued = workshop.state.jobs.filter(j => j.status === 'waiting');
  assert.equal(queued.length, 1); assert.equal(queued[0].text, custom.text);
  workshop.paused = false; await workshop.pump();
  assert.equal(workshop.releaseSummary(alice.id, true).jobs[0].text, custom.text);
  await workshop.action('lan-release', { voiceId: alice.id });
  const bundle = await workshop.bundle([workshop.state.packages.at(-1).checksum]);
  assert.equal(bundle.packages[0].manifest.clips.length, 1);
  const restored = new Workshop(root, {}); await restored.initialize();
  assert.equal(restored.view().voices[0].catalog[0].text, custom.text);
  assert.equal(restored.view().voices[1].catalog[0].text, 'Neuer Standardtext.');
  assert.equal(restored.view().voices[1].catalog[1].active, true);
  assert.equal(restored.stale(restored.job(customJob.id)), true);
  assert.equal(restored.releaseSummary(alice.id, true).jobs.length, 1);
});
test('LAN production skips listening gates and exports current selected takes without inventing hearing decisions', async t => {
  const root = await temp(t);
  const gameVoiceRoot = path.join(root, 'game-voices');
  const workshop = new Workshop(root, { generate: async () => tone() }, { gameVoiceRoot }); await workshop.initialize();
  await workshop.action('voice', { name: 'LAN', consentGenerate: true, consentLan: true });
  const voice = workshop.state.voices[0];
  Object.assign(voice, { reference: 'fixture.wav', transcript: REFERENCE_TEXT.text, referenceRevision: 1 });
  // Keep this real audio/export test small; no test take or testedRevision is needed.
  workshop.state.catalog.forEach(s => { s.active = s.id === 'ready_01' || s.id === 'ready_02'; });
  await workshop.action('generate', { voiceId: voice.id, lan: true });
  await workshop.action('generate', { voiceId: voice.id, lan: true });
  assert.equal(workshop.state.jobs.length, 2, 'Repeated starts do not duplicate pending work');
  workshop.paused = false; await workshop.pump();
  assert.ok(workshop.state.jobs.every(j => j.status === 'review' && j.decision === null));
  assert.equal(voice.testedRevision, 0);
  await workshop.action('lan-release', { voiceId: voice.id });
  const first = workshop.state.packages.at(-1);
  const bundle = await workshop.bundle([first.checksum]);
  assert.equal(bundle.packages[0].manifest.clips.length, 2);
  assert.ok(bundle.packages[0].manifest.missingEvents.length > 0, 'Partial packages require no extra click');
  assert.ok(workshop.state.jobs.every(j => j.decision === null), 'Export must not claim a listening review');
  const original = await readFile(path.join(root, 'packages', first.checksum + '.fdvoice'), 'utf8');
  await workshop.action('install-game', { voiceId: voice.id });
  const installedFile = path.join(gameVoiceRoot, voice.id + '.fdvoice');
  const installed = await validateVoiceBundle(JSON.parse(await readFile(installedFile, 'utf8')));
  assert.equal(installed.packages[0].checksum, voice.gamePackage.checksum);
  assert.equal(installed.packages[0].manifest.clips.length, 2);
  assert.equal(voice.gamePackage.clips, 2);
  const latest = { ...workshop.state.jobs[0], id: 'replacement', decision: null };
  workshop.state.jobs.push(latest);
  await workshop.action('lan-selection', { id: latest.id, include: false });
  assert.equal(workshop.releaseSummary(voice.id, true).jobs.length, 1, 'Excluded replacement never falls back to an old take');
  workshop.paused = true;
  await workshop.action('generate', { voiceId: voice.id, lan: true });
  assert.equal(workshop.state.jobs.length, 3, 'Bulk generation respects deliberate omissions');
  await workshop.action('lan-selection', { id: latest.id, include: true });
  assert.equal(latest.decision, null);
  const sentence = workshop.state.catalog.find(s => s.id === latest.sentenceId);
  sentence.revision++;
  assert.equal(workshop.releaseSummary(voice.id, true).jobs.length, 1, 'Changed sentences exclude all stale revisions');
  await workshop.action('install-game', { voiceId: voice.id });
  const replacement = await validateVoiceBundle(JSON.parse(await readFile(installedFile, 'utf8')));
  assert.equal(replacement.packages[0].manifest.clips.length, 1);
  assert.ok(replacement.packages[0].manifest.version > installed.packages[0].manifest.version);
  assert.deepEqual(await readdir(gameVoiceRoot), [voice.id + '.fdvoice'], 'A new version replaces the build source instead of accumulating obsolete voices');
  for (const privateField of ['transcript', 'referenceRevision', 'consentGenerate', 'workflow']) assert.ok(!(await readFile(installedFile, 'utf8')).includes(privateField));
  await assert.rejects(workshop.action('lan-selection', { id: latest.id, include: true }), /aktuelle/);
  voice.consentLan = false;
  await assert.rejects(workshop.action('lan-release', { voiceId: voice.id }), /Teilnehmerkreis/);
  await assert.rejects(workshop.action('install-game', { voiceId: voice.id }), /Teilnehmerkreis/);
  await assert.rejects(workshop.action('generate', { voiceId: voice.id, lan: true }), /Zustimmung/);
  assert.equal(await readFile(path.join(root, 'packages', first.checksum + '.fdvoice'), 'utf8'), original);
});

test('legacy controllable takes retain their provenance when neutral catalog entries migrate', async t => {
  const root = await temp(t); const workshop = new Workshop(root, {}); await workshop.initialize();
  await workshop.action('voice', { name: 'Altbestand' }); const voice = workshop.state.voices[0];
  voice.referenceRevision = 1; voice.testedRevision = 1;
  const sentence = workshop.state.catalog.find(s => s.id === 'ready_02');
  delete sentence.cloningMode;
  workshop.state.jobs.push({ id: 'old-take', voiceId: voice.id, sentenceId: sentence.id, sentenceRevision: sentence.revision, referenceRevision: 1, status: 'review', decision: 'accepted' });
  await writeFile(path.join(root, 'state.json'), JSON.stringify(workshop.state));
  const restored = new Workshop(root, {}); await restored.initialize();
  assert.equal(restored.state.catalog.find(s => s.id === sentence.id).cloningMode, 'ultimate');
  assert.equal(restored.state.jobs[0].cloningMode, 'controllable');
  assert.equal(restored.stale(restored.state.jobs[0]), true);
  assert.equal(restored.state.voices[0].testedRevision, 0);
});
test('loopback service requires host, origin and session token, and remains usable without the generator', async t => {
  const root = await temp(t); const { server, token } = await createWorkshopServer({ root, port: 0, generator: { preflight: async () => { throw new Error('Offline'); } } });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${url}/api/state`)).status, 403);
  assert.equal((await fetch(`${url}/api/state`, { headers: { 'x-voice-token': token } })).status, 200);
  assert.equal((await fetch(`${url}/api/state`, { headers: { 'x-voice-token': token, Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await fetch(`${url}/api/voice`, { method: 'POST', headers: { 'x-voice-token': token, 'content-type': 'application/json' }, body: '{}' })).status, 403);
  const badHostStatus = await new Promise(resolve => {
    http.get(`${url}/api/state`, { headers: { Host: 'evil.example', 'x-voice-token': token } }, response => { response.resume(); resolve(response.statusCode); });
  });
  assert.equal(badHostStatus, 403);
  assert.deepEqual(await (await fetch(`${url}/api/generator`, { headers: { 'x-voice-token': token } })).json(), { ok: false, message: 'Offline' });
});

test('loopback actions preserve UTF-8 text split across request chunks', async t => {
  const root = await temp(t); const { server, token, workshop } = await createWorkshopServer({ root, port: 0, generator: {} });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const name = 'Müller 🦡';
  const body = Buffer.from(JSON.stringify({ name }));
  const split = body.indexOf(Buffer.from('ü')) + 1;
  const response = await new Promise((resolve, reject) => {
    const request = http.request(`${url}/api/voice`, { method: 'POST', headers: {
      'x-voice-token': token, origin: url, 'content-type': 'application/json',
    } }, result => {
      const chunks = []; result.on('data', chunk => chunks.push(chunk));
      result.on('end', () => resolve({ status: result.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    request.on('error', reject);
    // Send the rest only after the server has received the incomplete UTF-8 prefix.
    server.once('request', incoming => incoming.once('data', () => request.end(body.subarray(split))));
    request.write(body.subarray(0, split));
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.voices[0].name, name);
  assert.equal(workshop.state.voices[0].name, name);
  const persisted = JSON.parse(await readFile(path.join(root, 'state.json'), 'utf8'));
  assert.equal(persisted.voices[0].name, name);
});
