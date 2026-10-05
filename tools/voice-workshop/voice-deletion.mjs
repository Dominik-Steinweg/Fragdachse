import { lstat, readFile, readdir, realpath, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
const ownedName = (name, id) => name.startsWith(`${id}.`) || name.startsWith(`${id}-`);

async function entries(directory) {
  try { return await readdir(directory, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

/** Deletion never follows links, even when a saved filename or configured directory was changed. */
async function checked(directory, name) {
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) throw new Error('Unsicherer Löschpfad.');
  const base = path.resolve(directory);
  if (path.normalize(await realpath(base)) !== path.normalize(base)) throw new Error('Verknüpfte Löschordner werden nicht unterstützt.');
  const file = path.join(base, name);
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Keine reguläre Datei: ${name}`);
  return file;
}

async function replaceJson(directory, name, value) {
  const target = await checked(directory, name).catch(error => { if (error.code === 'ENOENT') return path.join(path.resolve(directory), name); throw error; });
  const temporary = `${target}.${randomUUID()}.purging`;
  try { await writeFile(temporary, JSON.stringify(value, null, 2), { flag: 'wx' }); await rename(temporary, target); }
  finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
}

function withoutVoice(state, voiceId) {
  return { ...state, voices: state.voices.filter(v => v.id !== voiceId), jobs: state.jobs.filter(j => j.voiceId !== voiceId),
    packages: state.packages.filter(p => p.voiceId !== voiceId) };
}

/** Collect history before erasing it, so abandoned cuts and pre-migration jobs remain attributable. */
export async function planVoiceDeletion(workshop, voiceId) {
  if (!safeId(voiceId)) throw new Error('Ungültige Stimm-ID.');
  const snapshots = [{ state: workshop.state }];
  for (const entry of await entries(workshop.root)) {
    if (!/^state[.-].*\.(json|bak)$/.test(entry.name) || entry.name === 'state.json') continue;
    const file = await checked(workshop.root, entry.name);
    const state = JSON.parse(await readFile(file, 'utf8'));
    if (![state.voices, state.jobs, state.packages].every(Array.isArray)) throw new Error(`Datensicherung ${entry.name} kann nicht sicher bereinigt werden.`);
    snapshots.push({ state, name: entry.name });
  }
  const jobs = new Map(); const media = new Set(); const checksums = new Set();
  for (const { state } of snapshots) {
    for (const voice of state.voices.filter(v => v.id === voiceId)) {
      if (voice.reference) media.add(voice.reference);
      if (voice.gamePackage?.checksum) checksums.add(voice.gamePackage.checksum);
    }
    for (const job of state.jobs.filter(j => j.voiceId === voiceId)) {
      if (!safeId(job.id)) throw new Error('Ungültige Auftrags-ID im Löschbestand.');
      // Preserve both old and current generator receipts; a retry must still find all copies.
      const key = `${job.id}:${job.generator?.promptId ?? ''}`;
      if (!jobs.has(key)) jobs.set(key, job);
      for (const file of [job.reference, job.raw, job.audio]) if (file) media.add(file);
    }
    for (const pack of state.packages.filter(p => p.voiceId === voiceId)) checksums.add(pack.checksum);
  }
  const jobIds = new Set([...jobs.values()].map(j => j.id));
  for (const entry of await entries(path.join(workshop.root, 'media'))) {
    if (ownedName(entry.name, voiceId) || [...jobIds].some(id => ownedName(entry.name, id))) media.add(entry.name);
  }
  const otherFiles = new Set(snapshots.flatMap(({ state }) => [
    ...state.voices.filter(v => v.id !== voiceId).map(v => v.reference),
    ...state.jobs.filter(j => j.voiceId !== voiceId).flatMap(j => [j.reference, j.raw, j.audio]),
  ]).filter(Boolean));
  if ([...media].some(file => otherFiles.has(file))) throw new Error('Eine Audiodatei wird von mehreren Stimmen verwendet. Löschung zur Sicherheit angehalten.');
  // Validate every owned path before the first destructive operation.
  for (const name of media) await checked(path.join(workshop.root, 'media'), name).catch(error => { if (error.code !== 'ENOENT') throw error; });
  return { voiceId, jobs: [...jobs.values()], media, checksums, snapshots };
}

async function purgePackages(directory, plan) {
  for (const entry of await entries(directory)) {
    if (!entry.name.endsWith('.fdvoice') && !entry.name.endsWith('.pending')) continue;
    const file = await checked(directory, entry.name);
    const named = ownedName(entry.name, plan.voiceId) || [...plan.checksums].some(sum => ownedName(entry.name, sum));
    let bundle;
    try { bundle = JSON.parse(await readFile(file, 'utf8')); }
    catch (error) { if (named) { await unlink(file); continue; } if (error instanceof SyntaxError) continue; throw error; }
    if (!Array.isArray(bundle.packages)) { if (named) await unlink(file); continue; }
    const owned = bundle.packages.filter(p => p.manifest?.voiceId === plan.voiceId);
    for (const pack of owned) plan.checksums.add(pack.checksum);
    if (!owned.length) continue;
    const remaining = bundle.packages.filter(p => p.manifest?.voiceId !== plan.voiceId);
    if (remaining.length) await replaceJson(directory, entry.name, { ...bundle, packages: remaining });
    else await unlink(file);
  }
}

async function updateRevocations(file, plan) {
  let previous = { voiceIds: [], checksums: [] };
  try { previous = JSON.parse(await readFile(await checked(path.dirname(file), path.basename(file)), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const checksum = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
  if (!Array.isArray(previous.voiceIds) || !previous.voiceIds.every(safeId) || !Array.isArray(previous.checksums) || !previous.checksums.every(checksum)) throw new Error('Löschregister ist beschädigt.');
  const registry = { voiceIds: [...new Set([...previous.voiceIds, plan.voiceId])].sort(),
    checksums: [...new Set([...previous.checksums, ...plan.checksums])].filter(checksum).sort() };
  await replaceJson(path.dirname(file), path.basename(file), registry);
  return registry;
}

/** Vite keeps each ?raw voice in a separate named chunk. Remove only that voice's chunks. */
async function purgeBuild(directory, plan, registry) {
  const files = await entries(directory); if (!files.length) return;
  const base = path.resolve(directory);
  if (path.normalize(await realpath(base)) !== path.normalize(base)) throw new Error('Verknüpfter Buildordner wird nicht bereinigt.');
  if (files.some(e => e.name.endsWith('.html') && e.isFile()) && registry) await replaceJson(directory, 'voice-deletions.json', registry);
  for (const entry of files) {
    if (entry.isSymbolicLink()) throw new Error('Verknüpfung im Buildordner verhindert vollständige Bereinigung.');
    if (entry.isDirectory()) await purgeBuild(path.join(base, entry.name), plan, registry);
    else if (ownedName(entry.name, plan.voiceId) && /\.js(?:\.map)?$/.test(entry.name)) await unlink(await checked(base, entry.name));
  }
}

export async function eraseVoiceFiles(workshop, plan) {
  // ComfyUI must prove that no producer can recreate files before local ownership is erased.
  for (const job of plan.jobs.filter(j => j.generator)) {
    if (typeof workshop.generator.cleanup !== 'function') throw new Error('Generator-Bereinigung ist nicht verfügbar.');
    await workshop.generator.cleanup(job, { purge: true });
  }
  await purgePackages(path.join(workshop.root, 'packages'), plan);
  if (workshop.gameVoiceRoot) await purgePackages(workshop.gameVoiceRoot, plan);
  const registry = workshop.deletionRegistry ? await updateRevocations(workshop.deletionRegistry, plan) : null;
  for (const root of workshop.gameBuildRoots) await purgeBuild(root, plan, registry);
  for (const name of plan.media) {
    try { await unlink(await checked(path.join(workshop.root, 'media'), name)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  for (const snapshot of plan.snapshots.filter(s => s.name)) {
    await replaceJson(workshop.root, snapshot.name, withoutVoice(snapshot.state, plan.voiceId));
  }
  return withoutVoice(workshop.state, plan.voiceId);
}
