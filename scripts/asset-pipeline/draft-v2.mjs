// Disposable, unselected exports. Never calls production build/select/archive/import.
import { readFile, writeFile, mkdir, rename, access, cp, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { resolveBlender, renderProcess, repoRoot } from './preview-v2.mjs';
import { packAtlas } from './atlas-v2.mjs';
import { packSheet } from './export-v2.mjs';
import { calibrateKrakenMaterial, resizeKrakenElevation } from './kraken-material-v2.mjs';
import { requiredSockets } from './socket-anchors.mjs';
import { readDemandCatalog } from './pipeline-registry.mjs';
import sharp from 'sharp';

export const krakenAssets = ['abyssal-kraken', 'abyssal-kraken-land', 'abyssal-kraken-tentacle', 'abyssal-kraken-egg', 'abyssal-kraken-spine'];
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const exists = file => access(file).then(() => true, () => false);
const save = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2) + '\n'); };
const identifier = value => { if (!/^[a-z0-9][a-z0-9-]*$/.test(value ?? '')) throw Error(`Invalid identifier: ${value}`); return value; };

/** Conservative transitive Python dependencies; dynamic motion dispatch is explicit below. */
export async function pythonSources(root, entry, found = {}) {
  const base = path.join(root, 'scripts/asset-pipeline');
  if (found[entry]) return found;
  const source = await readFile(path.join(base, entry), 'utf8');
  found[entry] = digest(source);
  for (const match of source.matchAll(/(?:^|\n)\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/g)) {
    const file = (match[1] ?? match[2]).replaceAll('.', '/') + '.py';
    if (await exists(path.join(base, file))) await pythonSources(root, file, found);
  }
  return found;
}
export function motionModule(motion) {
  for (const [prefix, module] of [['kraken_land_', 'kraken_motion_land_v2'], ['kraken_tentacle_', 'kraken_tentacle_motion_v2'],
    ['kraken_egg_', 'kraken_egg_motion_v2'], ['kraken_spine_', 'kraken_egg_motion_v2'], ['kraken_', 'kraken_motion_v2'],
    ['toad_', 'plague_toad_motion_v2'], ['kaboomtula_', 'kaboomtula_motion_v2'], ['rabbit_', 'rabid_rabbit_motion_v2'],
    ['demon_', 'demon_badger_motion_v2']]) {
    if (motion.startsWith(prefix)) return module + '.py';
  }
  return 'motions_v2.py';
}
export async function fingerprints(root, spec, settings) {
  const sources = await pythonSources(root, `recipes_v2/${spec.recipe}.py`);
  await pythonSources(root, 'blender_pipeline.py', sources);
  await pythonSources(root, 'draft-v2.py', sources);
  // Motion is deliberately excluded from the model key, including the draft driver's imports.
  const modelSources = Object.fromEntries(Object.entries(sources).filter(([name]) => !/motion/.test(name)));
  const textures = {};
  for (const file of Object.values(spec.textures ?? {})) textures[file] = digest(await readFile(path.resolve(root, file)));
  const { clips, requiredClips, ...modelSpec } = spec;
  const modelHash = digest({ modelSpec, modelSources, textures });
  const exporter = digest(await readFile(new URL('./draft-v2.mjs', import.meta.url)));
  const sharedMotion = await pythonSources(root, 'motions_v2.py');
  const clipHashes = {};
  const clipSpecs = {};
  for (const clip of clips) {
    const motion = await pythonSources(root, motionModule(clip.motion), { ...sharedMotion });
    clipHashes[clip.name] = digest({ modelHash, clip, motion, settings, exporter });
    clipSpecs[clip.name] = digest(clip);
  }
  clipHashes.__rest = digest({ modelHash, clips: clipHashes });
  return { modelHash, clipHashes, clipSpecs };
}
export function planClips(hashes, previous, explicit, full = false) {
  if (explicit?.some(name => !Object.hasOwn(hashes.clipHashes, name))) throw Error('Unknown clip selection');
  const sameModel = previous?.modelHash === hashes.modelHash;
  return Object.keys(hashes.clipHashes).filter(name => full || !sameModel || !previous.clipHashes?.[name]
    || hashes.clipSpecs?.[name] !== previous.clipSpecs?.[name]
    || (explicit ? (name === '__rest' && explicit.length > 0) || explicit.includes(name) : previous.clipHashes[name] !== hashes.clipHashes[name]));
}

export async function assertProductionFinished(root) {
  const file = path.join(root, 'art/poc/kraken-v13/build/build-times.json');
  if (!await exists(file)) return;
  const value = await json(file), rows = Array.isArray(value) ? value : [value];
  if (!krakenAssets.every(id => rows.some(row => row.asset === id && row.exitCode === 0 && row.ended))) {
    throw Error('kraken-v13 is not complete (five successful assets required in build-times.json). No GPU work started.');
  }
}

export async function exportDraft(folder, spec, label, records) {
  const size = Math.round(spec.targetSize * (spec.displayScale ?? 1)), packed = !!spec.materialPass;
  let index = 0;
  const frames = [], socketFrames = [], meshes = [], clips = [], atlases = { color: {}, ...(packed ? { elevation: {}, emission: {} } : {}) };
  const budget = { clips: {}, totals: { color: 0, elevation: 0, emission: 0, total: 0 } };
  const groups = [{ name: '__rest' }, ...spec.clips];
  for (const clip of groups) {
    const record = records[clip.name], sourceFrames = record.frames.map(() => index++);
    const sockets = record.frames.map(f => f.sockets);
    socketFrames.push(...sockets);
    frames.push(...record.frames.map((f, i) => ({ ...f, index: sourceFrames[i] })));
    meshes.push(...record.frames.map(f => f.mesh));
    if (clip.name !== '__rest') {
      const { frameCount, ...metadata } = clip;
      if (metadata.markers) metadata.markers = Object.fromEntries(Object.entries(metadata.markers).map(([name, value]) =>
        [name, Math.max(0, Math.min(sourceFrames.length - 1, Number.isFinite(value) ? Math.round(value) : 0))]));
      if (metadata.next && (metadata.end !== 'free' || !spec.clips.some(c => c.name === metadata.next))) delete metadata.next;
      clips.push({ ...metadata, frames: sourceFrames });
    }
    const counts = budget.clips[clip.name] = { color: 0, elevation: 0, emission: 0, total: 0 };
    for (const pass of Object.keys(atlases)) {
      const passSize = pass === 'elevation' ? Math.round(size * (spec.elevation.scale ?? .5)) : size;
      const buffers = await Promise.all(record.frames.map(async f => {
        const input = await readFile(path.join(folder, f[pass]));
        return pass === 'elevation' && passSize !== size ? resizeKrakenElevation(input, await readFile(path.join(folder, f.color)), passSize) : input;
      }));
      const frameNames = sourceFrames.map((_, i) => `${clip.name}/${String(i).padStart(4, '0')}`);
      const pages = await packAtlas(buffers, { frameNames, sourceFrames, socketFrames: sockets, size: passSize, pivot: spec.pivot, prefix: `atlases/${size}/${pass}/${clip.name}` });
      const descriptors = [];
      for (const page of pages) {
        const { png, metadata, ...descriptor } = page;
        await mkdir(path.dirname(path.join(folder, page.image)), { recursive: true });
        await writeFile(path.join(folder, page.image), png); await save(path.join(folder, page.json), metadata);
        descriptors.push({ ...descriptor, sha256: digest(png), jsonSha256: digest(await readFile(path.join(folder, page.json))), frameNames: Object.keys(metadata.frames) });
        counts[pass] += page.gpuBytesRGBA8;
      }
      atlases[pass][clip.name] = { sourceSize: passSize, logicalSourceSize: size, pivot: spec.pivot, sourceFrames, frameNames, pages: descriptors };
    }
    counts.total = counts.color + counts.elevation + counts.emission;
    for (const key of Object.keys(counts)) budget.totals[key] += counts[key];
  }
  const manifest = { ...spec, pipelineVersion: 2, revision: label, variant: 'standard', idleFrame: 0, frames, clips,
    sockets: Object.fromEntries(Object.entries(socketFrames[0]).map(([n, p]) => [n, [p.x, p.y]])), socketFrames };
  if (packed) Object.assign(manifest, { elevationPass: { encoding: spec.materialPass.normal, ...spec.elevation, waterline: 0,
    alpha: 'beauty-coverage', colorSpace: 'non-color', premultiplied: false },
    materialPass: { ...spec.materialPass, worldPxPerBU: size / spec.orthoScale, emissionRange: 8, exposure: 1, tint: [1, 1, 1], saturation: 1 },
    shadowMesh: { version: 1, encoding: 'u16-world-xyz-per-pose-v1', frames: meshes } });
  if (packed && records.__rest.frames[0].beauty) {
    const rest = records.__rest.frames[0];
    const [color, elevation, beauty] = await Promise.all([rest.color, rest.elevation, rest.beauty].map(file => readFile(path.join(folder, file))));
    const normals = await resizeKrakenElevation(elevation, color, Math.round(size / 2));
    const fit = await calibrateKrakenMaterial(color, normals, beauty, size, spec.id === 'abyssal-kraken' ? .55 : 1,
      ['abyssal-kraken', 'abyssal-kraken-land'].includes(spec.id) ? [.4, .43, .6, .77] : null);
    Object.assign(manifest.materialPass, { exposure: fit.exposure, tint: fit.tint, saturation: fit.saturation });
    await save(path.join(folder, 'material-calibration.json'), fit);
  }
  // Runtime descriptor uses production-shaped placeholder paths. The Dev boundary validates
  // this contract before resolving them to the immutable draft directory.
  const runtime = { id: spec.id, category: spec.category, gameIds: spec.gameIds, revision: label, variant: 'standard', sourceSize: size,
    textureKey: `draft-${spec.id}-${label}`, forward: spec.forward, pivot: spec.pivot, displayScale: spec.displayScale, idleFrame: 0,
    clips: clips.map(({ name, frames, frameRate, loop, markers, start, end, next }) => ({ name, frames, frameRate, loop, markers, start, end, next })) };
  const sheets = {};
  if (packed) {
    const elevation = { min: spec.elevation.min, max: spec.elevation.max, scale: spec.elevation.scale ?? .5,
      ...(spec.elevation.previewWaterLevel !== undefined ? { previewWaterLevel: spec.elevation.previewWaterLevel } : {}) };
    Object.assign(runtime, { runtimeContract: 'boss', targetSize: spec.targetSize, runtimeBudgetMB: spec.runtimeBudgetMB,
      sockets: manifest.sockets, socketFrames, elevation, elevationPass: { ...manifest.elevationPass, min: elevation.min, max: elevation.max, scale: elevation.scale },
      materialPass: manifest.materialPass, shadowMesh: manifest.shadowMesh, atlases, budget });
    delete runtime.elevationPass.previewWaterLevel;
  } else {
    const buffers = await Promise.all(frames.map(f => readFile(path.join(folder, f.color))));
    const sheet = await packSheet(buffers, size);
    await writeFile(path.join(folder, `sheet-${size}.png`), sheet.buffer);
    await writeFile(path.join(folder, `idle-${size}.png`), buffers[0]);
    sheets[size] = sheet.layout;
    Object.assign(runtime, { runtimeContract: 'sheet', sheetTextureKey: runtime.textureKey + '-sheet', idlePath: `idle-${size}.png`, sheetPath: `sheet-${size}.png`,
      layout: sheet.layout, hashes: { idle: digest(buffers[0]), sheet: digest(sheet.buffer) }, ...(spec.heldItem ? { heldItem: spec.heldItem } : {}) });
  }
  await save(path.join(folder, 'export.json'), { manifest, sheets, atlases: { [size]: atlases } });
  await save(path.join(folder, 'budget.json'), budget);
  const prefixPaths = value => {
    if (Array.isArray(value)) return value.map(prefixPaths);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, ['image', 'json', 'file', 'idlePath', 'sheetPath'].includes(k) && typeof v === 'string' ? './assets/' + v : prefixPaths(v)]));
  };
  await save(path.join(folder, 'runtime.json'), prefixPaths(runtime));
}

export async function quickDraftWarnings(folder, spec, records, tolerance = .06) {
  const warnings = [], required = requiredSockets(spec.id);
  for (const [clip, record] of Object.entries(records)) {
    if (record.frames.some(f => required.some(name => !f.sockets[name]))) warnings.push(`${clip}: required sockets missing`);
  }
  const images = new Map();
  const alpha = async frame => {
    if (!images.has(frame.color)) images.set(frame.color, await sharp(path.join(folder, frame.color)).resize(64, 64).ensureAlpha().extractChannel('alpha').raw().toBuffer());
    return images.get(frame.color);
  };
  for (const clip of spec.clips) {
    const frames = records[clip.name].frames;
    if (Object.values(clip.markers ?? {}).some(i => !Number.isInteger(i) || i < 0 || i >= frames.length)) warnings.push(`${clip.name}: marker outside clip (clamped in draft)`);
    if (clip.next && (clip.end !== 'free' || !records[clip.next])) warnings.push(`${clip.name}: invalid end/next (next omitted in draft)`);
    const end = clip.loop ? frames[0] : clip.next ? records[clip.next]?.frames[0] : clip.end !== 'terminal' && clip.end !== 'free' ? records.__rest.frames[0] : null;
    if (!end) continue;
    const [a, b] = await Promise.all([alpha(frames.at(-1)), alpha(end)]);
    const difference = a.reduce((sum, value, i) => sum + Math.abs(value - b[i]), 0) / (a.length * 255);
    if (difference > tolerance) warnings.push(`${clip.name}: end/${clip.next ?? (clip.loop ? 'loop' : 'rest')} silhouette discontinuity (${difference.toFixed(3)})`);
  }
  return warnings;
}

export async function draft(argv, root = repoRoot) {
  const started = Date.now();
  const { values: args, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    clips: { type: 'string' }, label: { type: 'string' }, full: { type: 'boolean' }, blender: { type: 'string' },
    samples: { type: 'string', default: '8' }, device: { type: 'string', default: 'OPTIX' }, output: { type: 'string' },
    'mesh-triangles': { type: 'string', default: '512' }, 'no-denoise': { type: 'boolean' }, help: { type: 'boolean' },
    'border-ratio': { type: 'string', default: '0.02' }, 'continuity-tolerance': { type: 'string', default: '0.06' },
  } });
  if (args.help) { console.log('assets:draft -- <asset...> [--clips a,b] [--label x] [--full] [--samples 8] [--device OPTIX|CUDA|CPU] [--mesh-triangles 512] [--no-denoise] [--blender path]'); return; }
  if (!positionals.length) throw Error('At least one catalog asset is required');
  const settings = { samples: Number(args.samples), device: args.device, triangles: Number(args['mesh-triangles']), denoise: !args['no-denoise'],
    borderRatio: Number(args['border-ratio']), continuityTolerance: Number(args['continuity-tolerance']) };
  if (!Number.isInteger(settings.samples) || settings.samples < 1 || !Number.isInteger(settings.triangles) || settings.triangles < 12
    || !['OPTIX', 'CUDA', 'CPU'].includes(settings.device) || !Number.isFinite(settings.borderRatio) || settings.borderRatio < 0 || settings.borderRatio > .25
    || !Number.isFinite(settings.continuityTolerance) || settings.continuityTolerance < 0 || settings.continuityTolerance > 1) throw Error('Invalid render settings');
  const label = identifier(args.label ?? `draft-${Date.now()}-${randomUUID().slice(0, 8)}`);
  const base = args.output ? path.resolve(root, args.output) : path.join(root, 'art/poc/pipeline-v2/drafts'); await mkdir(base, { recursive: true });
  // Serialize publication across assets and prevent competing draft GPU jobs.
  const lock = await open(path.join(base, '.lock'), 'wx');
  try {
    const catalog = await readDemandCatalog(root);
    const jobs = [], results = [];
    const selected = args.clips?.split(',').map(identifier);
    if (selected?.some(name => !positionals.some(id => catalog.assets.find(a => a.id === id)?.clips.some(c => c.name === name)))) throw Error('Unknown clip selection');
    for (const id of [...new Set(positionals)]) {
      if (!/^[a-z][a-z0-9_-]*$/.test(id)) throw Error(`Invalid asset identifier: ${id}`);
      const spec = catalog.assets.find(a => a.id === id);
      if (!spec?.recipe || spec.production === 'planned') throw Error(`No recipe: ${id}`);
      const hashes = await fingerprints(root, spec, settings);
      const latestFile = path.join(base, id, 'latest.json');
      const latest = await exists(latestFile) ? await json(latestFile) : null;
      const previous = latest ? await json(path.join(base, id, identifier(latest.label), 'draft.json')) : null;
      const explicit = selected?.filter(n => spec.clips.some(c => c.name === n));
      const render = planClips(hashes, previous, explicit, args.full);
      const output = path.join(base, id, label);
      if (await exists(output)) throw Error(`Draft already exists: ${output}`);
      await mkdir(output, { recursive: true });
      const records = {}, warnings = [];
      for (const name of Object.keys(hashes.clipHashes)) if (!render.includes(name)) {
        await cp(path.join(base, id, latest.label, 'standard/clips', name), path.join(output, 'standard/clips', name), { recursive: true });
        records[name] = previous.records[name];
        if (previous.clipHashes[name] !== hashes.clipHashes[name]) warnings.push(`${name}: changed source retained by explicit --clips selection`);
        hashes.clipHashes[name] = previous.clipHashes[name];
      }
      const job = { spec, ...hashes, settings, render, output, model: path.join(base, '.models', hashes.modelHash + '.blend') };
      console.log(`${id}: ${render.length ? 'render ' + render.join(', ') : 'all clips cached'}`);
      jobs.push(job); results.push({ id, label, ...hashes, rendered: render, reused: Object.keys(records), records, warnings, output });
    }
    if (jobs.some(j => j.render.length)) {
      await assertProductionFinished(root);
      const blender = await resolveBlender(args.blender);
      const jobFile = path.join(base, `job-${label}.json`); await save(jobFile, jobs);
      console.log(`Blender log: ${path.join(base, `blender-${label}.log`)}`);
      await renderProcess(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python',
        path.join(root, 'scripts/asset-pipeline/draft-v2.py'), '--', jobFile], path.join(base, `blender-${label}.log`), root);
    }
    // Do not publish a cache built against changing sources (another author may be editing).
    for (const [i, job] of jobs.entries()) {
      const currentSpec = (await readDemandCatalog(root)).assets.find(a => a.id === job.spec.id);
      const current = await fingerprints(root, currentSpec, settings);
      if (current.modelHash !== job.modelHash || job.render.some(n => current.clipHashes[n] !== job.clipHashes[n])) throw Error('Sources changed during rendering; draft was not published. Retry.');
      const result = results[i];
      if (job.render.length) {
        const rendered = await json(path.join(job.output, 'rendered.json'));
        Object.assign(result.records, rendered.records); result.warnings.push(...rendered.warnings); result.renderSeconds = rendered.seconds;
        result.modelCacheHit = rendered.modelCacheHit;
      }
      result.warnings.push(...await quickDraftWarnings(path.join(job.output, 'standard'), job.spec, result.records, settings.continuityTolerance));
      await exportDraft(path.join(job.output, 'standard'), job.spec, label, result.records);
      result.seconds = (Date.now() - started) / 1000;
      await save(path.join(job.output, 'draft.json'), { ...result, status: 'complete' });
    }
    // Publication is last: polling never sees incomplete exports.
    const versionFile = path.join(base, 'version.json');
    const version = await exists(versionFile) ? await json(versionFile) : { assets: {} };
    for (const result of results) {
      await save(path.join(base, result.id, 'latest.tmp'), { label });
      await rename(path.join(base, result.id, 'latest.tmp'), path.join(base, result.id, 'latest.json'));
      version.assets[result.id] = { label };
      console.log(`${result.id}: rendered ${result.rendered.join(', ') || 'none'}; reused ${result.reused.join(', ') || 'none'}; ${result.seconds.toFixed(1)}s`);
      for (const warning of result.warnings) console.warn(`WARNING ${warning}`);
    }
    Object.assign(version, { version: label, startedAt: started, publishedAt: Date.now() });
    await save(path.join(base, 'version.tmp'), version); await rename(path.join(base, 'version.tmp'), versionFile);
    return results;
  } finally { await lock.close(); const { unlink } = await import('node:fs/promises'); await unlink(path.join(base, '.lock')); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  draft(process.argv.slice(2)).catch(error => { console.error(error); process.exitCode = 1; });
}
