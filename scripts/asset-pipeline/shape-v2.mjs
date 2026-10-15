// Form -> animation draft -> production. All writes stay in disposable authoring folders.
import { readFile, writeFile, mkdir, open, rename, cp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { repoRoot, resolveBlender, renderProcess } from './preview-v2.mjs';
import { digest, pythonSources, assertProductionFinished, exportDraft } from './draft-v2.mjs';
import { safePath } from './review-preview-v2.mjs';
import { shapeBoard } from './shape-board-v2.mjs';
import { readDemandCatalog } from './pipeline-registry.mjs';

const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
const save = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2) + '\n'); };
const optional = async file => { try { return await json(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
const identifier = value => { if (!/^[a-z0-9][a-z0-9-]*$/.test(value ?? '')) throw Error('Asset/Label: Kleinbuchstaben, Zahlen und Bindestriche verwenden.'); return value; };
const defaultModelSettings = { voxelScale: 1.5, creaseSubdivisions: 0 };

export function shapeOptions(argv) {
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    label: { type: 'string' }, views: { type: 'string', default: 'top,side,silhouette' }, watch: { type: 'boolean' },
    blender: { type: 'string' }, samples: { type: 'string', default: '8' }, device: { type: 'string', default: 'OPTIX' },
    'model-settings': { type: 'string' }, 'no-denoise': { type: 'boolean' }, 'export-draft': { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) return { help: true };
  if (positionals.length !== 1) throw Error('Genau eine Asset-ID angeben; siehe --help.');
  const views = [...new Set(values.views.split(','))];
  if (!views.length || views.some(v => !['top', 'side', 'silhouette'].includes(v))) throw Error('--views: top,side,silhouette');
  const samples = Number(values.samples);
  if (!Number.isInteger(samples) || samples < 1 || samples > 1024) throw Error('--samples: 1…1024');
  if (!['OPTIX', 'CUDA', 'CPU', 'HIP', 'METAL', 'ONEAPI'].includes(values.device)) throw Error('Unsupported render device');
  const modelSettings = values['model-settings'] === undefined ? defaultModelSettings : JSON.parse(values['model-settings']);
  if (!modelSettings || typeof modelSettings !== 'object' || Array.isArray(modelSettings)) throw Error('--model-settings: JSON object required');
  if (modelSettings.voxelScale !== undefined && (!Number.isFinite(modelSettings.voxelScale) || modelSettings.voxelScale < 1 || modelSettings.voxelScale > 4)) throw Error('voxelScale: 1…4');
  if (modelSettings.creaseSubdivisions !== undefined && ![0, 1, 2].includes(modelSettings.creaseSubdivisions)) throw Error('creaseSubdivisions: 0,1,2');
  return { id: identifier(positionals[0]), label: values.label && identifier(values.label), views, watch: !!values.watch, blender: values.blender,
    settings: { samples, device: values.device, denoise: !values['no-denoise'] }, modelSettings, exportDraft: !!values['export-draft'] };
}

/** Model edits invalidate the scene; animation sources and clip edits do not enter this key. */
export async function shapeInputs(root, id, modelSettings) {
  const catalog = await readDemandCatalog(root);
  const original = catalog.assets.find(a => a.id === id);
  if (!original || original.production === 'planned') throw Error(`Keine ausführbare Rezeptur: ${id}`);
  const { clips, requiredClips, ...spec } = original;
  const sources = await pythonSources(root, `recipes_v2/${spec.recipe}.py`);
  for (const file of ['blender_pipeline.py', 'draft-v2.py', 'shape-v2.py']) await pythonSources(root, file, sources);
  for (const key of Object.keys(sources)) if (/motion/.test(key)) delete sources[key];
  const textures = {};
  for (const file of Object.values(spec.textures ?? {})) textures[file] = digest(await readFile(await safePath(root, file)));
  const modelSpec = { ...spec, clips: [], requiredClips: [], draft: { ...spec.draft, ...modelSettings } };
  return { spec: original, modelSpec, sources, textures, modelHash: digest({ spec: modelSpec, sources, textures }) };
}

export function restRecords(spec, frame) {
  return Object.fromEntries(['__rest', ...spec.clips.map(c => c.name)].map(name => [name, { frames: [frame] }]));
}

async function atomic(file, value) { const temp = file + '.' + randomUUID() + '.tmp'; await save(temp, value); await rename(temp, file); }

export async function publishShapeDraft(root, folder, spec, label, rendered, startedAt) {
  const drafts = path.join(root, 'art/poc/pipeline-v2/drafts'), draftLabel = 'shape-' + label;
  const destination = await safePath(drafts, `${spec.id}/${draftLabel}`);
  await mkdir(path.dirname(destination), { recursive: true });
  await mkdir(destination); // Refuse replacement of any completed draft.
  const standard = path.join(destination, 'standard');
  await mkdir(standard);
  const frame = rendered.frame;
  const files = new Set([frame.beauty, frame.color, frame.elevation, frame.emission, frame.mesh?.positions.file, frame.mesh?.indices.file].filter(Boolean));
  for (const file of files) await cp(path.join(folder, file), path.join(standard, file));
  const records = restRecords(spec, frame);
  await exportDraft(standard, spec, draftLabel, records);
  await save(path.join(destination, 'draft.json'), { status: 'complete', mode: 'shape', id: spec.id, label: draftLabel,
    records, rendered: [], reused: [], warnings: ['Form-Modus: alle Clips zeigen dieselbe Ruhepose; Marker auf Frame 0.'] });
  await atomic(path.join(drafts, spec.id, 'latest.json'), { label: draftLabel });
  // The existing dev loader resolves each role independently, including production fallback.
  const previousVersion = await optional(path.join(drafts, 'version.json'));
  await atomic(path.join(drafts, 'version.json'), { version: `${spec.id}-${draftLabel}-${randomUUID()}`, startedAt: Date.parse(startedAt), publishedAt: Date.now(),
    assets: { ...previousVersion?.assets, [spec.id]: { label: draftLabel } } });
  return { label: draftLabel, folder: destination };
}

export async function buildShape(options, root = repoRoot) {
  const started = performance.now(), startedAt = new Date().toISOString();
  await assertProductionFinished(root);
  const input = await shapeInputs(root, options.id, options.modelSettings);
  const shapes = path.join(root, 'art/poc/pipeline-v2/shapes');
  const assetFolder = await safePath(shapes, options.id);
  await mkdir(assetFolder, { recursive: true });
  const label = options.label ?? `shape-${Date.now()}-${randomUUID().slice(0, 6)}`;
  identifier(label);
  const folder = await safePath(assetFolder, label);
  const previousLabel = (await optional(path.join(assetFolder, 'latest.json')))?.label;
  const previous = previousLabel ? { label: identifier(previousLabel), folder: await safePath(assetFolder, previousLabel) } : null;
  // Share the draft GPU lock; shape and animation must never compete for the device.
  const lockFile = path.join(root, 'art/poc/pipeline-v2/drafts/.lock');
  await mkdir(path.dirname(lockFile), { recursive: true });
  const lock = await open(lockFile, 'wx');
  try {
    await mkdir(folder);
    const job = { spec: input.modelSpec, modelHash: input.modelHash, model: path.join(shapes, '.models', input.modelHash + '.blend'),
      settings: options.settings, output: folder, views: options.views, exportDraft: options.exportDraft };
    await save(path.join(folder, 'job.json'), job);
    await renderProcess(await resolveBlender(options.blender), ['--background', '--factory-startup', '--python-exit-code', '1',
      '--python', path.join(root, 'scripts/asset-pipeline/shape-v2.py'), '--', path.join(folder, 'job.json')], path.join(folder, 'blender.log'), root);
    const rendered = await json(path.join(folder, 'rendered.json'));
    if ((await shapeInputs(root, options.id, options.modelSettings)).modelHash !== input.modelHash) throw Error('Modellquellen während des Builds geändert; unvollständige Iteration wird nicht veröffentlicht.');
    const board = await shapeBoard(folder, input.spec, { root, views: options.views, previous, label });
    const warnings = [...rendered.warnings];
    if (!board.metrics.silhouetteArea) warnings.push('Leere Silhouette');
    if (board.metrics.canvasMargin !== null && board.metrics.canvasMargin < Math.ceil(board.metrics.width * .02)) warnings.push('Silhouette berührt den 2%-Canvas-Rand');
    const draft = options.exportDraft ? await publishShapeDraft(root, folder, input.spec, label, rendered, startedAt) : null;
    const result = { status: 'complete', mode: 'shape', id: options.id, label, startedAt, seconds: (performance.now() - started) / 1000,
      modelHash: input.modelHash, modelCacheHit: rendered.modelCacheHit, actionCount: rendered.actionCount, settings: options.settings,
      modelSettings: options.modelSettings, views: options.views, sources: input.sources, textures: input.textures, spec: input.spec,
      side: rendered.side, ...board, warnings, draft };
    await save(path.join(folder, 'shape.json'), result);
    await atomic(path.join(assetFolder, 'latest.json'), { label });
    console.log(`${options.id}: ${result.seconds.toFixed(2)} s · Modell-Cache ${result.modelCacheHit ? 'Treffer' : 'neu gebaut'} · 0 Animationsclips\n${path.join(folder, 'board.png')}`);
    for (const warning of warnings) console.warn('WARN ' + warning);
    return { ...result, folder };
  } finally { await lock.close(); await import('node:fs/promises').then(fs => fs.unlink(lockFile)); }
}

/** Serialize saves, coalesce bursts, and retry only when sources change after a failed build. */
export async function watchShapes(options, root = repoRoot, { signal, interval = 500, build = buildShape, inputs = shapeInputs } = {}) {
  let lastAttempt = null, iteration = 0;
  while (!signal?.aborted) {
    try {
      const snapshot = await inputs(root, options.id, options.modelSettings);
      if (snapshot.modelHash !== lastAttempt) {
        // Wait for a quiet save interval (editors may replace several dependent files).
        await new Promise(resolve => setTimeout(resolve, interval));
        const stable = await inputs(root, options.id, options.modelSettings);
        if (stable.modelHash !== snapshot.modelHash) continue;
        lastAttempt = stable.modelHash;
        const label = options.label ? (iteration ? `${options.label}-${Date.now()}-${iteration}` : options.label) : undefined;
        iteration++;
        try { await build({ ...options, label }, root); } catch (error) { console.error(error.message); }
      }
    } catch (error) { console.error(error.message); }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
}

export async function shape(argv, root = repoRoot) {
  const options = shapeOptions(argv);
  if (options.help) { console.log('npm run assets:shape -- <asset> [--label x] [--watch] [--views top,side,silhouette] [--export-draft] [--model-settings JSON] [--samples 8] [--device OPTIX|CPU] [--blender path]\n--model-settings ersetzt die Form-Defaults; {} verwendet die Modellqualität der Produktion.'); return; }
  if (!options.watch) return buildShape(options, root);
  console.log('Form-Watch aktiv; Rezept-/Modellquellen werden beobachtet. Beenden: Ctrl+C.');
  const abort = new AbortController(), stop = () => abort.abort();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try { await watchShapes(options, root, { signal: abort.signal }); }
  finally { process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) shape(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
