import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm, rmdir, symlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { Workshop, REFERENCE_TEXT } from '../workshop.mjs';
import { createWorkshopServer } from '../server.mjs';
import { makeWorkflow, VoxGenerator, isOwnHistory } from '../generator.mjs';
import { ANNOUNCER, announcerDirection, announcerRoomGraph, roomImpulse } from '../announcer.mjs';
import { processAudio, runEncoder, audioStats, requireAnnouncerFilters } from '../audio.mjs';
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
test('deleting a voice erases historical media, packages, backup data and built game copies while retaining other voices', async t => {
  const root = await temp(t); const gameVoiceRoot = path.join(root, 'game'); const build = path.join(root, 'build');
  await mkdir(gameVoiceRoot); await mkdir(path.join(build, 'assets'), { recursive: true });
  const deletionRegistry = path.join(root, 'voice-deletions.json'); const cleaned = [];
  const workshop = new Workshop(root, { cleanup: async (job, options) => cleaned.push([job.id, options.purge]) }, { gameVoiceRoot, deletionRegistry, gameBuildRoots: [build] });
  await workshop.initialize();
  await workshop.action('voice', { name: 'Entfernen' }); await workshop.action('voice', { name: 'Behalten' });
  const [voice, keep] = workshop.state.voices;
  const id = '0a98bb44-c24a-47c0-9c8e-29e1d86817ea'; const oldId = '366cb196-2397-451e-95d6-529cd30b93f7';
  voice.reference = `${voice.id}-reference-1.wav`; keep.reference = `${keep.id}-reference-1.wav`;
  workshop.state.jobs.push({ id, voiceId: voice.id, status: 'review', generator: { promptId: 'own', privateCopiesPending: false }, raw: `${id}.flac`, audio: `${id}.ogg` });
  workshop.state.packages.push({ voiceId: voice.id, checksum: 'a'.repeat(64) }, { voiceId: keep.id, checksum: 'b'.repeat(64) });
  const backup = structuredClone(workshop.state); backup.jobs.push({ id: oldId, voiceId: voice.id, raw: `${oldId}.flac` });
  await writeFile(path.join(root, 'state.before-announcer-1.json'), JSON.stringify(backup));
  const names = [voice.reference, keep.reference, `${id}.flac`, `${id}.ogg`, `${id}-older-cut.ogg`, `${id}-fx-v5.ogg`, `${oldId}.flac`];
  for (const name of names) await writeFile(workshop.file(name), 'audio');
  const pack = { checksum: 'a'.repeat(64), manifest: { voiceId: voice.id }, files: { 'a.ogg': 'private-voice' } };
  const other = { checksum: 'b'.repeat(64), manifest: { voiceId: keep.id }, files: { 'b.ogg': 'keep-voice' } };
  for (const [name, packages] of [['a'.repeat(64), [pack]], ['b'.repeat(64), [other]], ['mixed', [pack, other]]]) {
    await writeFile(path.join(root, 'packages', `${name}.fdvoice`), JSON.stringify({ packages }));
  }
  await writeFile(path.join(gameVoiceRoot, `${voice.id}.fdvoice`), JSON.stringify({ packages: [pack] }));
  await writeFile(path.join(gameVoiceRoot, `${voice.id}.fdvoice.abandoned.pending`), JSON.stringify({ packages: [pack] }));
  await writeFile(path.join(gameVoiceRoot, `${keep.id}.fdvoice`), JSON.stringify({ packages: [other] }));
  await writeFile(path.join(build, 'index.html'), 'game');
  for (const name of [`${voice.id}-hash.js`, `${voice.id}-hash.js.map`, `${keep.id}-hash.js`]) await writeFile(path.join(build, 'assets', name), 'chunk');
  await workshop.save();
  await assert.rejects(workshop.action('delete-voice', { voiceId: voice.id, confirmName: 'Falsch' }), /Namen/);
  await workshop.action('delete-voice', { voiceId: voice.id, confirmName: voice.name });
  assert.deepEqual(await readdir(path.join(root, 'media')), [keep.reference]);
  assert.deepEqual(await readdir(gameVoiceRoot), [`${keep.id}.fdvoice`]);
  assert.deepEqual(await readdir(path.join(build, 'assets')), [`${keep.id}-hash.js`]);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'packages', 'mixed.fdvoice'), 'utf8')).packages, [other]);
  await assert.rejects(readFile(path.join(root, 'packages', `${'a'.repeat(64)}.fdvoice`)), { code: 'ENOENT' });
  assert.deepEqual(cleaned, [[id, true]], 'Even already cleaned jobs must purge remaining generator history');
  for (const file of ['state.json', 'state.before-announcer-1.json']) {
    const text = await readFile(path.join(root, file), 'utf8');
    assert.ok(!text.includes(voice.id) && !text.includes(id) && !text.includes(oldId) && !text.includes(voice.name));
    assert.ok(text.includes(keep.id));
  }
  const registry = JSON.parse(await readFile(deletionRegistry, 'utf8'));
  assert.deepEqual(registry, { voiceIds: [voice.id], checksums: ['a'.repeat(64)] });
  assert.deepEqual(JSON.parse(await readFile(path.join(build, 'voice-deletions.json'), 'utf8')), registry);
  const restarted = new Workshop(root); await restarted.initialize();
  assert.deepEqual(restarted.state.voices.map(v => v.id), [keep.id]); assert.equal(restarted.state.jobs.length, 0);
});

test('incomplete deletion remains locked and resumes after restart without restoring already removed files', async t => {
  const root = await temp(t); const build = path.join(root, 'build'); const gameVoiceRoot = path.join(root, 'game');
  await mkdir(build); await mkdir(gameVoiceRoot); await mkdir(path.join(build, 'voice-deletions.json'));
  await writeFile(path.join(build, 'index.html'), 'game');
  const options = { gameVoiceRoot, deletionRegistry: path.join(root, 'voice-deletions.json'), gameBuildRoots: [build] };
  let workshop = new Workshop(root, {}, options); await workshop.initialize(); await workshop.action('voice', { name: 'Löschen' });
  const voice = workshop.state.voices[0]; voice.reference = `${voice.id}-reference.wav`;
  await writeFile(workshop.file(voice.reference), 'reference');
  await writeFile(path.join(gameVoiceRoot, `${voice.id}.fdvoice`), JSON.stringify({ packages: [{ manifest: { voiceId: voice.id }, checksum: 'a'.repeat(64) }] }));
  workshop.state.jobs.push({ id: 'queued', voiceId: voice.id, status: 'waiting' }); await workshop.save();
  await assert.rejects(workshop.action('delete-voice', { voiceId: voice.id, confirmName: voice.name }), /noch nicht vollständig/);
  assert.equal(workshop.state.jobs[0].status, 'cancelled');
  assert.ok(workshop.voice(voice.id).deletion.error); assert.equal(workshop.paused, true);
  await assert.rejects(readFile(path.join(gameVoiceRoot, `${voice.id}.fdvoice`)), { code: 'ENOENT' });
  await assert.rejects(workshop.action('generate', { voiceId: voice.id, tests: true }), /Löschung/);
  await rmdir(path.join(build, 'voice-deletions.json'));
  workshop = new Workshop(root, {}, options); await workshop.initialize();
  await workshop.action('delete-voice', { voiceId: voice.id, confirmName: voice.name });
  assert.equal(workshop.state.voices.length, 0); assert.equal(workshop.state.jobs.length, 0);
  assert.deepEqual(await readdir(path.join(root, 'media')), []);
});

test('deletion refuses active producers, unsafe media paths and linked build directories', async t => {
  const root = await temp(t); const workshop = new Workshop(root); await workshop.initialize();
  await workshop.action('voice', { name: 'Sicher' }); const voice = workshop.state.voices[0];
  const data = { voiceId: voice.id, confirmName: voice.name };
  workshop.state.jobs.push({ id: 'running', voiceId: voice.id, status: 'generating' });
  await assert.rejects(workshop.action('delete-voice', data), /Laufende Produktion/);
  assert.equal(voice.deletion, undefined);
  workshop.state.jobs[0].status = 'failed'; voice.reference = '../outside.wav';
  await assert.rejects(workshop.action('delete-voice', data), /Unsicherer Löschpfad/);
  voice.reference = null;
  const external = await temp(t); const build = path.join(root, 'build'); await mkdir(build);
  await writeFile(path.join(external, `${voice.id}-hash.js`), 'unrelated');
  await symlink(external, path.join(build, 'linked'), 'junction'); workshop.gameBuildRoots = [build];
  await assert.rejects(workshop.action('delete-voice', data), /Verknüpfung/);
  assert.equal(await readFile(path.join(external, `${voice.id}-hash.js`), 'utf8'), 'unrelated');
});

test('generator purge deletes only the finished owned job folders and history', async t => {
  const root = await temp(t); const id = 'c6f99f20-8fba-45db-8585-1a721139a5ae'; const calls = [];
  const generator = new VoxGenerator({ inputRoot: path.join(root, 'input'), outputRoot: path.join(root, 'output') });
  for (const base of [generator.inputRoot, generator.outputRoot]) {
    await mkdir(path.join(base, 'voice-workshop', id), { recursive: true });
    await mkdir(path.join(base, 'voice-workshop', 'unrelated'));
    await writeFile(path.join(base, 'voice-workshop', id, base === generator.inputRoot ? 'reference.wav' : 'take_00001.flac'), 'private');
  }
  let running = true;
  const record = { prompt: [0, 'prompt', makeWorkflow(`voice-workshop/${id}/reference.wav`, 'Text', 'Regie', 1, `voice-workshop/${id}/take`), { client_id: `voice-workshop-${id}` }] };
  generator.request = async (route, init) => { calls.push([route, init]); return { json: async () => route.startsWith('/history') ? { prompt: record } : { queue_running: running ? [[0, 'prompt', {}]] : [], queue_pending: [] } }; };
  const job = { id, generator: { promptId: 'prompt', privateCopiesPending: false } };
  await assert.rejects(generator.cleanup(job, { purge: true }), /läuft noch/);
  running = false; await generator.cleanup(job, { purge: true });
  for (const base of [generator.inputRoot, generator.outputRoot]) assert.deepEqual(await readdir(path.join(base, 'voice-workshop')), ['unrelated']);
  assert.deepEqual(JSON.parse(calls.find(([route]) => route === '/history')[1].body), { delete: ['prompt'] });
  assert.ok(!calls.some(([route]) => ['/interrupt', '/free'].includes(route)));
  assert.equal(isOwnHistory(record, id), true);
  for (const mutate of [r => { r.prompt[3].client_id += '-foreign'; }, r => { r.prompt[2]['2'].inputs.audio += '.other'; }, r => { r.prompt[2]['4'].inputs.filename_prefix += '-other'; }]) {
    const foreign = structuredClone(record); mutate(foreign); assert.equal(isOwnHistory(foreign, id), false);
  }
  const foreign = structuredClone(record); foreign.prompt[3].client_id = 'someone-else';
  generator.request = async (route, init) => { calls.push([route, init]); return { json: async () => route === '/history' ? { owned: record, unrelated: foreign } : { queue_running: [], queue_pending: [] } }; };
  await generator.cleanup({ id, generator: { promptId: null } }, { purge: true });
  assert.deepEqual(JSON.parse(calls.at(-1)[1].body), { delete: ['owned'] }, 'Unknown receipts still need all exact ownership fields');
});

test('announcer workflow preserves exact text and freezes direction separately from reference and output effects', () => {
  const hint = 'Letztes Wort betonen.';
  const direction = announcerDirection('ultimate', hint);
  const graph = makeWorkflow('voice-workshop/id/reference.wav', 'Exakter Satz.', direction, 5, 'voice-workshop/id/take');
  assert.equal(graph['3'].inputs.text, 'Exakter Satz.');
  assert.equal(graph['3'].inputs.control_instruction, direction);
  assert.ok(direction.includes(ANNOUNCER.direction));
  assert.ok(direction.includes(ANNOUNCER.events.ultimate)); assert.ok(direction.includes(hint));
  assert.equal(graph['3'].inputs.ultimate_clone, false);
  assert.equal(graph['3'].inputs.reference_audio_text, '');
  assert.deepEqual(graph['3'].inputs.reference_audio, ['2', 0]);
  assert.throws(() => makeWorkflow('ref.wav', 'Text', '', 1, 'take'), /Regie/);
  assert.throws(() => announcerDirection('unknown'), /Spielanlass/);
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
  assert.equal(neutralJob.cloningMode, 'controllable');
  assert.equal(neutralJob.referenceTranscript, '');
  await workshop.save();
  const restarted = new Workshop(root, generator); await restarted.initialize();
  assert.equal(restarted.state.jobs.at(-1).status, 'interrupted'); assert.equal(restarted.state.packages.length, 1);
  const neutral = restarted.state.catalog.find(s => s.id === 'ready_02');
  await restarted.action('sentence', { ...neutral, directionHint: 'Letztes Wort betonen.' });
  assert.equal(restarted.stale(restarted.state.jobs.at(-1)), true);
  await restarted.action('generate', { voiceId: voice.id, sentenceId: 'ready_02' });
  assert.equal(restarted.state.jobs.at(-1).cloningMode, 'controllable');
  assert.equal(restarted.state.jobs.at(-1).referenceTranscript, '');
  await restarted.action('cancel');
  await restarted.action('generate', { voiceId: voice.id, tests: true });
  assert.deepEqual(restarted.state.jobs.slice(-3).map(j => j.cloningMode), ['controllable', 'controllable', 'controllable']);
  await restarted.action('cancel');
  const testJob = restarted.state.jobs.at(-3);
  await restarted.action('reference', reference);
  assert.equal(restarted.stale(testJob), true);
  assert.equal(testJob.referenceTranscript, '');
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
  for (const job of workshop.state.jobs) { job.status = 'review'; job.audioInfo = { processingVersion: ANNOUNCER.processingVersion }; }
  await workshop.action('generate', { voiceId: voice.id, tests: true });
  assert.equal(workshop.state.jobs.length, 3);
  workshop.state.jobs[0].decision = 'rejected';
  await workshop.action('generate', { voiceId: voice.id, tests: true });
  assert.equal(workshop.state.jobs.length, 4); assert.equal(workshop.state.jobs.at(-1).sentenceId, 'test_neutral');
});

test('uploaded reference text is preserved privately and reference revisions invalidate announcer jobs', async t => {
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
  const job = workshop.state.jobs.at(-1); assert.equal(job.referenceTranscript, '');
  await workshop.action('cancel');
  await workshop.action('reference', { ...upload, transcript: 'Ein neuer exakter Wortlaut.' });
  assert.equal(workshop.stale(job), true); assert.equal(job.referenceTranscript, '');
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
  const custom = { ...sentence, voiceId: alice.id, text: 'Alices eigener Spruch.', directionHint: 'Letztes Wort betonen.' };
  await workshop.action('sentence', custom);
  assert.equal(workshop.stale(originalAlice), true); assert.equal(workshop.stale(originalBob), false);
  assert.equal(originalAlice.text, sentence.text, 'Queued input remains frozen');
  const customJob = await queue(alice);
  assert.equal(customJob.text, custom.text); assert.equal(customJob.directionHint, custom.directionHint);
  assert.ok(customJob.controlInstruction.includes(custom.directionHint));
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

test('announcer migration preserves history and packages, regenerates every active line once and cannot revive legacy audio by trimming', async t => {
  const root = await temp(t);
  const workshop = new Workshop(root, { generate: async () => tone() }); await workshop.initialize();
  await workshop.action('voice', { name: 'Altbestand', consentGenerate: true, consentLan: true });
  const voice = workshop.state.voices[0];
  Object.assign(voice, { reference: 'fixture.wav', transcript: 'Privater Referenztext.', referenceRevision: 1, testedRevision: 1 });
  workshop.state.catalog.forEach((s, i) => { s.active = i < 2; });
  await workshop.action('generate', { voiceId: voice.id, lan: true });
  workshop.paused = false; await workshop.pump(); workshop.paused = true;
  await workshop.action('lan-release', { voiceId: voice.id });
  const savedPackage = workshop.state.packages[0];
  const packagePath = path.join(root, 'packages', savedPackage.checksum + '.fdvoice');
  const published = await readFile(packagePath);
  const oldJobs = workshop.state.jobs;
  for (const job of oldJobs) {
    delete job.productionVersion; delete job.processingVersion;
    job.style = 'Gelassen'; job.cloningMode = 'ultimate'; job.referenceTranscript = voice.transcript;
  }
  delete workshop.state.productionVersion;
  workshop.state.catalog[0].style = 'Ruhig'; workshop.state.catalog[0].cloningMode = 'ultimate';
  voice.sentences = { [workshop.state.catalog[1].id]: { text: 'Eigener Text.', style: 'Leise', cloningMode: 'ultimate', revision: 1, active: true } };
  await workshop.save();
  const restored = new Workshop(root, {}); await restored.initialize();
  assert.equal(restored.paused, true);
  assert.ok(restored.state.jobs.every(j => restored.stale(j)));
  assert.equal(restored.state.jobs[0].cloningMode, 'ultimate');
  assert.equal(restored.state.jobs[0].style, 'Gelassen');
  assert.equal(restored.state.jobs[0].referenceTranscript, voice.transcript);
  assert.equal(restored.state.catalog[0].directionHint, '');
  assert.equal(restored.state.catalog[0].legacyDirection.style, 'Ruhig');
  assert.equal(restored.catalog(restored.voice(voice.id))[1].text, 'Eigener Text.');
  assert.equal(restored.catalog(restored.voice(voice.id))[1].directionHint, '');
  assert.equal(restored.state.voices[0].testedRevision, 0);
  assert.equal(restored.releaseSummary(voice.id, true).jobs.length, 0);
  await assert.rejects(restored.action('trim', { id: oldJobs[0].id, start: 0, end: 0.5 }), /neu erzeugen/);
  await restored.action('generate', { voiceId: voice.id, lan: true });
  await restored.action('generate', { voiceId: voice.id, lan: true });
  const fresh = restored.state.jobs.filter(j => j.status === 'waiting');
  assert.equal(fresh.length, 2);
  assert.ok(fresh.every(j => j.productionVersion === ANNOUNCER.productionVersion && j.cloningMode === 'controllable'));
  assert.equal(fresh[1].text, 'Eigener Text.');
  assert.deepEqual(await readFile(packagePath), published);
  const again = new Workshop(root, {}); await again.initialize();
  assert.equal(again.state.catalogVersion, restored.state.catalogVersion, 'Migration is idempotent');
  assert.equal(again.state.jobs.length, restored.state.jobs.length);
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

async function decoded(file, rate = ANNOUNCER.audio.sampleRate) {
  const data = await runEncoder(['-i', 'pipe:0', '-f', 'f32le', '-ac', '1', '-ar', String(rate), 'pipe:1'], await readFile(file));
  return new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
}
function magnitude(samples, hz, rate, start, end) {
  let re = 0; let im = 0;
  for (let i = start; i < end; i++) { re += samples[i] * Math.cos(2 * Math.PI * hz * i / rate); im += samples[i] * Math.sin(2 * Math.PI * hz * i / rate); }
  return 2 * Math.hypot(re, im) / (end - start);
}
test('announcer audio adds a simultaneous octave and a bounded reverb tail while preserving safe playable exports', async t => {
  const root = await temp(t); const file = path.join(root, 'announcer.ogg');
  const info = await processAudio(tone(1), file); const samples = await decoded(file); const rate = info.sampleRate;
  const fundamental = magnitude(samples, 440, rate, rate / 4, 3 * rate / 4);
  const octave = magnitude(samples, 220, rate, rate / 4, 3 * rate / 4);
  assert.ok(fundamental > 0.01 && octave > 0.003, 'Main voice and down-octave coexist at the original tempo');
  assert.ok(fundamental > octave, 'The human voice stays ahead of the synthetic octave');
  assert.ok(audioStats(samples.slice(Math.ceil(rate * 1.04), Math.floor(rate * 1.15))).rms > 0.0001, 'Tail is audible after speech ends');
  assert.ok(audioStats(samples.slice(Math.ceil(rate * 1.45))).rms < 0.001, 'Tail decays before the boundary');
  assert.ok(info.duration > 1 && info.duration < 2);
  assert.equal(info.duration, samples.length / rate);
  assert.ok(samples.every(Number.isFinite)); assert.ok(info.peak < 1);
  assert.equal(info.processingVersion, ANNOUNCER.processingVersion);
  const short = await processAudio(tone(0.12), path.join(root, 'short.ogg'));
  assert.ok(Number.isFinite(short.outputGain) && short.peak < 1);
  const boundary = await processAudio(tone(ANNOUNCER.audio.maxSpeechSeconds), path.join(root, 'boundary.ogg'));
  assert.ok(boundary.duration <= ANNOUNCER.audio.maxClipSeconds);
  await assert.rejects(processAudio(tone(ANNOUNCER.audio.maxSpeechSeconds + 0.1), path.join(root, 'long.ogg')), /Kürzen oder neu erzeugen/);
  const reference = path.join(root, 'reference.wav');
  const referenceInfo = await processAudio(tone(1), reference, { reference: true });
  const clean = await decoded(reference, referenceInfo.sampleRate);
  assert.equal(referenceInfo.duration, 1); assert.equal(referenceInfo.processingVersion, undefined);
  assert.ok(magnitude(clean, 220, referenceInfo.sampleRate, 0, clean.length) < 0.0001, 'Reference stays unprocessed');
  const filters = (await runEncoder(['-filters'])).toString();
  assert.throws(() => requireAnnouncerFilters(filters.split('\n').filter(l => !l.includes('rubberband')).join('\n')), /Fehlende Filter: rubberband/);
  assert.throws(() => requireAnnouncerFilters(filters.split('\n').filter(l => !l.includes('sidechaincompress')).join('\n')), /Fehlende Filter: sidechaincompress/);
  assert.throws(() => audioStats(new Float32Array([NaN])), /ungültige Samples/);
});
test('room is deterministic, leaves the voice onset clear and recovers after ducking under speech', async t => {
  const root = await temp(t); const rate = ANNOUNCER.audio.sampleRate;
  const response = roomImpulse(); assert.deepEqual(response, roomImpulse());
  const ir = new Float32Array(response.buffer.slice(response.byteOffset, response.byteOffset + response.byteLength));
  assert.ok(ir.every(Number.isFinite));
  assert.ok(ir.slice(0, Math.round(ANNOUNCER.audio.reverb.predelaySeconds * rate)).every(x => x === 0));
  assert.ok(audioStats(ir.slice(Math.floor(ir.length * 0.8))).rms < audioStats(ir.slice(0, Math.floor(ir.length * 0.2))).rms);
  const impulseFile = path.join(root, 'room.f32'); await writeFile(impulseFile, response);
  const total = rate + ir.length;
  async function render(keyFilter) {
    const pcm = await runEncoder(['-i', 'pipe:0', '-f', 'f32le', '-ar', String(rate), '-ac', '1', '-i', impulseFile,
      '-filter_complex', `[0:a]aresample=${rate},apad=whole_len=${total},atrim=end_sample=${total},asplit=2[send][control];[control]${keyFilter}[key];${announcerRoomGraph()}`,
      '-map', '[room]', '-f', 'f32le', '-ar', String(rate), '-ac', '1', 'pipe:1'], tone(1));
    return new Float32Array(pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength));
  }
  const ducked = await render('anull'); const unkeyed = await render('volume=0');
  const rms = (samples, from, to) => audioStats(samples.slice(Math.round(from * rate), Math.round(to * rate))).rms;
  assert.ok(rms(ducked, 0.3, 0.9) < rms(unkeyed, 0.3, 0.9) * 0.8, 'Reverb recedes while words are active');
  assert.ok(rms(ducked, 1.3, 1.4) > rms(unkeyed, 1.3, 1.4) * 0.9, 'The tail returns when the voice stops');
  assert.equal(ducked.length, total);
});

test('recutting always uses raw audio and failed replacement keeps the previous export and decision', async t => {
  const root = await temp(t); const workshop = new Workshop(root, { generate: async () => tone(1) }); await workshop.initialize();
  await workshop.action('voice', { name: 'Schnitt', consentGenerate: true, consentLan: true });
  const voice = workshop.state.voices[0]; Object.assign(voice, { reference: 'fixture.wav', referenceRevision: 1 });
  await workshop.action('generate', { voiceId: voice.id, sentenceId: 'ready_01' });
  workshop.paused = false; await workshop.pump(); workshop.paused = true;
  const job = workshop.state.jobs[0]; const raw = await readFile(workshop.file(job.raw));
  await workshop.action('trim', { id: job.id, start: 0.1, end: 0.8 });
  const first = await decoded(workshop.file(job.audio));
  await workshop.action('trim', { id: job.id, start: 0.1, end: 0.8 });
  assert.deepEqual(await decoded(workshop.file(job.audio)), first, 'Effects must not accumulate');
  assert.deepEqual(await readFile(workshop.file(job.raw)), raw);
  job.decision = 'accepted'; const previous = structuredClone(job);
  await assert.rejects(workshop.action('trim', { id: job.id, start: 9, end: null }), /Leerer Schnittbereich/);
  assert.deepEqual(job, previous);
  const sentence = workshop.catalog(voice)[0];
  await workshop.action('sentence', { ...sentence, voiceId: voice.id, directionHint: 'Schlusswort betonen.' });
  assert.equal(workshop.stale(job), true);
  assert.equal(job.directionHint, '');
  await assert.rejects(workshop.action('sentence', { ...sentence, style: 'Leise', cloningMode: 'ultimate' }), /neu laden/);
});
