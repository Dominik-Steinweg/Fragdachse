import { readFile, writeFile, readdir, access, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { indexLibrary } from './index-library.mjs';
import { validateEyeAnchors } from './eye-anchors.mjs';
import { exportProvenance } from './export-provenance.mjs';
import { validateClipContracts, validateExtensions } from './contracts-v2.mjs';
import { packAtlas } from './atlas-v2.mjs';
import { validateElevationManifest, verifyElevationPixels, resizeElevation } from './elevation-v2.mjs';
import { inside, inspectMaster, nativeMetrics, repoRoot, resizeMaster, validateManifest, variantLabel } from './export.mjs';

const sha256 = data => createHash('sha256').update(data).digest('hex');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const exists = file => access(file).then(() => true, () => false);
const digestPattern = /^[a-f0-9]{64}$/;
const validVariant = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/.test(value);
const slash = value => value.split(path.sep).join('/');
const execute = promisify(execFile);

function relativeFile(value) {
  if (typeof value !== 'string' || !value || /[\\:\0]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..') || value.startsWith('/')) throw new Error('Invalid relative bundle path');
  return value;
}

function validateDigests(values, label) {
  if (!values || typeof values !== 'object' || Array.isArray(values) || !Object.keys(values).length) throw new Error(`${label} provenance missing`);
  for (const [file, hash] of Object.entries(values)) {
    relativeFile(file);
    if (!digestPattern.test(hash)) throw new Error(`Invalid ${label} SHA-256: ${file}`);
  }
}

export function validateManifestV2(m) {
  if (m.pipelineVersion !== 2) throw new Error('Expected V2 asset manifest');
  validateManifest({ ...m, pipelineVersion: 1 });
  if (m.displayScale !== undefined && (!Number.isFinite(m.displayScale) || m.displayScale < 1 || m.displayScale > 3)) throw new Error('Invalid display scale');
  if (!/^[a-z0-9][a-z0-9-]*$/.test(m.revision)) throw new Error('Invalid revision');
  if (!Array.isArray(m.frames) || !m.frames.length || m.idleFrame !== 0) throw new Error('V2 requires frames and idleFrame 0');
  // Historical immutable V2 bundles remain readable; new enemy builds require sockets.
  if (m.eyeAnchors !== undefined) validateEyeAnchors(m.eyeAnchors, m.frames.length);
  for (const [index, frame] of m.frames.entries()) {
    if (frame.index !== index || frame.file !== `masters/frame-${String(index).padStart(4, '0')}.png` || !Number.isFinite(frame.blenderFrame) || !digestPattern.test(frame.sha256)) throw new Error(`Invalid frame ${index}`);
    if (!Array.isArray(frame.bounds) || frame.bounds.length !== 4 || frame.bounds.some(n => !Number.isFinite(n)) || frame.bounds[0] > frame.bounds[2] || frame.bounds[1] > frame.bounds[3]) throw new Error(`Invalid frame bounds ${index}`);
    if (m.mount && (!Number.isFinite(frame.baseDiameter) || frame.baseDiameter <= 0 || frame.baseDiameter > m.mount.maxBaseDiameter + 1e-5)) throw new Error(`Turret base footprint missing or exceeded in frame ${index}`);
  }
  if (m.mount && (m.category !== 'turret' || m.mount.rockSize !== 32 || !Number.isFinite(m.mount.maxBaseDiameter) || m.mount.maxBaseDiameter <= 0 || m.mount.maxBaseDiameter >= m.mount.rockSize)) throw new Error('Turret base must fit its 32-pixel rock');
  if (!Array.isArray(m.clips) || (!m.clips.length && !['weapon', 'utility', 'construction', 'companion', 'powerup'].includes(m.category))) throw new Error('Animation clips missing');
  validateExtensions(m);
  validateElevationManifest(m);
  const names = new Set();
  for (const clip of m.clips) {
    if (!/^[a-z][a-z0-9-]*$/.test(clip.name) || names.has(clip.name) || typeof clip.motion !== 'string' || !clip.motion || !Number.isFinite(clip.frameRate) || clip.frameRate <= 0 || typeof clip.loop !== 'boolean' || !Array.isArray(clip.frames) || !clip.frames.length || clip.frames.some(n => !Number.isInteger(n) || n < 0 || n >= m.frames.length)) throw new Error('Invalid animation clip');
    names.add(clip.name);
  }
  validateClipContracts(m.clips);
  const required = ['weapon', 'utility', 'construction', 'companion', 'powerup', 'boss-part'].includes(m.category) ? null : m.category === 'turret' ? 'fire' : 'move';
  if (required && !names.has(required)) throw new Error(`Required ${required} clip missing`);
  if (['weapon', 'utility'].includes(m.category)) {
    const h = m.heldItem;
    if (!h || h.referenceSize !== m.targetSize || !['grip', 'muzzle'].every(key => Array.isArray(h[key]) && h[key].length === 2
      && h[key].every(n => Number.isFinite(n) && n >= 0 && n <= h.referenceSize))) throw new Error('Held-item grip/muzzle contract missing or invalid');
  }
  if (required === 'move' && !m.clips.find(c => c.name === 'move').loop) throw new Error('Movement clip must loop');
  validateDigests(m.sources, 'Source');
  for (const texture of Object.values(m.textures)) {
    relativeFile(texture.path);
    if (!digestPattern.test(texture.sha256)) throw new Error('Invalid texture SHA-256');
  }
  if (m.reference) relativeFile(m.reference);
  if (m.referenceTransform) for (const key of ['centerCorrectionX', 'centerCorrectionY', 'rotationOffset']) {
    if (m.referenceTransform[key] !== undefined && !Number.isFinite(m.referenceTransform[key])) throw new Error('Invalid reference transform');
  }
}

export function sheetLayout(frameSize, frameCount) {
  if (!Number.isInteger(frameSize) || frameSize < 1 || !Number.isInteger(frameCount) || frameCount < 1) throw new Error('Invalid sheet dimensions');
  const columns = Math.min(8, frameCount), rows = Math.ceil(frameCount / columns);
  return { frameWidth: frameSize, frameHeight: frameSize, margin: 2, spacing: 4, columns, rows, frameCount,
    width: columns * (frameSize + 4), height: rows * (frameSize + 4) };
}

export async function packSheet(frames, frameSize) {
  const layout = sheetLayout(frameSize, frames.length);
  const layers = frames.map((input, index) => ({ input, left: 2 + (index % layout.columns) * (frameSize + 4), top: 2 + Math.floor(index / layout.columns) * (frameSize + 4) }));
  const buffer = await sharp({ create: { width: layout.width, height: layout.height, channels: 4, background: '#00000000' } }).composite(layers).png().toBuffer();
  return { buffer, layout };
}

async function completedBuild(assetFolder) {
  const build = await readJson(path.join(assetFolder, 'build.json'));
  if (build.status !== 'complete' || !digestPattern.test(build.inputHash)) throw new Error('Asset build is incomplete or has no input hash');
  return build;
}

export async function verifyArchivedSources(assetFolder, manifest) {
  const files = { ...manifest.sources };
  for (const texture of Object.values(manifest.textures)) {
    if (files[texture.path] && files[texture.path] !== texture.sha256) throw new Error('Conflicting source provenance');
    files[texture.path] = texture.sha256;
  }
  const checked = {};
  for (const [file, hash] of Object.entries(files).sort(([a], [b]) => a.localeCompare(b))) {
    relativeFile(file);
    const archived = `archive-source/${file}`;
    if (sha256(await readFile(inside(assetFolder, archived))) !== hash) throw new Error(`Archived source changed: ${file}`);
    checked[archived] = hash;
  }
  return checked;
}

// Existing exports can only be recreated from the identical manifest and masters.
export async function exportVariantV2(folder, workspace = repoRoot) {
  const assetFolder = path.dirname(folder), build = await completedBuild(assetFolder);
  const m = await readJson(path.join(folder, 'render.json'));
  validateManifestV2(m);
  if (m.inputHash !== undefined && m.inputHash !== build.inputHash) throw new Error('Manifest disagrees with completed input hash');
  const acceptedFrames = build.variants?.[m.variant]?.frames;
  if (acceptedFrames && (acceptedFrames.length !== m.frames.length || m.frames.some((frame, index) => acceptedFrames[index].index !== frame.index || acceptedFrames[index].sha256 !== frame.sha256))) throw new Error('Manifest disagrees with completed frames');
  if (path.basename(folder) !== m.variant || path.basename(assetFolder) !== m.id || path.basename(path.dirname(assetFolder)) !== m.revision) throw new Error('Manifest disagrees with revision folder');
  await verifyArchivedSources(assetFolder, m);
  const masters = [], reports = [], elevationMasters = [];
  for (const frame of m.frames) {
    const input = await readFile(inside(folder, frame.file));
    if (sha256(input) !== frame.sha256) throw new Error(`Master frame changed: ${frame.file}`);
    const report = await inspectMaster(input, m.masterSize);
    report.native = await nativeMetrics(input, Math.round(m.targetSize * (m.displayScale ?? 1)));
    masters.push(input); reports.push(report);
    if (m.elevation) {
      const e = frame.elevation, bytes = await readFile(inside(folder, e.file));
      if (sha256(bytes) !== e.sha256 || sha256(await readFile(inside(folder, e.exrFile))) !== e.exrSha256) throw new Error('Elevation master changed');
      await verifyElevationPixels(bytes, input, m.masterSize);
      elevationMasters.push(bytes);
    }
  }
  const blendHash = sha256(await readFile(path.join(folder, 'asset.blend')));
  const exportFile = path.join(folder, 'export.json');
  const prior = await exists(exportFile) ? await readJson(exportFile) : null;
  if (prior && (JSON.stringify(prior.manifest) !== JSON.stringify(m) || prior.inputHash !== build.inputHash || prior.blendSha256 !== blendHash)) throw new Error('Rendered revision changed; create a new revision instead');
  const provenance = await exportProvenance(m);
  // Reuse only after inputs AND every output byte have been revalidated. A tool/library
  // change invalidates this optimization and still has to satisfy pixel parity below.
  if (prior && !m.runtimeAtlas && !m.elevation && JSON.stringify(prior.provenance) === JSON.stringify(provenance)) {
    let valid = Object.keys(prior.outputs).length === new Set([m.targetSize,...m.sourceSizes]).size * 2;
    for (const [name, expected] of Object.entries(prior.outputs)) {
      const bytes = await readFile(inside(folder, relativeFile(name))).catch(() => null);
      if (!bytes || sha256(bytes) !== expected) valid = false;
    }
    if (valid) return prior;
  }
  const outputs = {}, sheets = {}, atlases = {};
  const budget = { version: 1, format: 'RGBA8', mipmaps: false, unit: 'bytes', sizes: {} };
  const buffers = new Map();
  for (const size of [...new Set([m.targetSize, ...m.sourceSizes])]) {
    const frames = await Promise.all(masters.map(input => resizeMaster(input, size)));
    const { buffer, layout } = await packSheet(frames, size);
    buffers.set(`sprite-${size}.png`, frames[m.idleFrame]);
    buffers.set(`sheet-${size}.png`, buffer);
    sheets[size] = layout;
    let elevations = [];
    const elevationSize = m.elevation ? Math.round(size * (m.elevation.scale ?? .5)) : null;
    if (m.elevation) {
      elevations = await Promise.all(elevationMasters.map((input, i) => resizeElevation(input, masters[i], elevationSize)));
      elevations.forEach((bytes, i) => buffers.set(`elevation/frames-${size}/frame-${String(i).padStart(4, '0')}.png`, bytes));
    }
    if (m.runtimeAtlas) {
      atlases[size] = { color: {}, elevation: {} };
      const clips = [{ name: '__rest', frames: [m.idleFrame] }, ...m.clips];
      const totals = { color: 0, elevation: 0, total: 0 }, clipBudgets = {};
      for (const clip of clips) {
        const frameNames = clip.frames.map((_, i) => `${clip.name}/${String(i).padStart(4, '0')}`);
        const clipBudget = { color: 0, elevation: 0, total: 0 };
        for (const pass of m.elevation ? ['color', 'elevation'] : ['color']) {
          const passSize = pass === 'color' ? size : elevationSize;
          const pages = await packAtlas(clip.frames.map(i => (pass === 'color' ? frames : elevations)[i]),
            { frameNames, sourceFrames: clip.frames, size: passSize, pivot: m.pivot, prefix: `atlas/${size}/${pass}-${clip.name}` });
          const records = [];
          for (const page of pages) {
            const bytes = jsonBytes(page.metadata);
            buffers.set(page.image, page.png); buffers.set(page.json, bytes);
            records.push({ image: page.image, json: page.json, width: page.width, height: page.height,
              gpuBytesRGBA8: page.gpuBytesRGBA8, sha256: sha256(page.png), jsonSha256: sha256(bytes) });
            clipBudget[pass] += page.gpuBytesRGBA8;
          }
          atlases[size][pass][clip.name] = { pages: records, frameNames, sourceFrames: clip.frames,
            sourceSize: passSize, logicalSourceSize: size, pivot: m.pivot };
        }
        clipBudget.total = clipBudget.color + clipBudget.elevation;
        clipBudgets[clip.name] = clipBudget;
        for (const pass of ['color', 'elevation', 'total']) totals[pass] += clipBudget[pass];
      }
      budget.sizes[size] = { clips: clipBudgets, totals };
    }
  }
  if (m.runtimeAtlas) buffers.set('budget.json', jsonBytes(budget));
  for (const [name, buffer] of buffers) {
    outputs[name] = sha256(buffer);
    if (prior && prior.outputs[name] !== outputs[name]) throw new Error('Export algorithm changed; create a new revision instead');
  }
  const result = { pipelineVersion: 2, provenance, manifest: m, inputHash: build.inputHash, blendSha256: blendHash, outputs, sheets,
    ...(m.runtimeAtlas ? { atlases, budget } : {}),
    ...(m.elevation ? { elevation: m.elevationPass } : {}), report: { frames: reports, native: reports[m.idleFrame].native } };
  for (const [name, buffer] of buffers) {
    await mkdir(path.dirname(path.join(folder, name)), { recursive: true });
    await writeFile(path.join(folder, name), buffer);
  }
  await writeFile(exportFile, jsonBytes(result));
  if (m.runtimeAtlas) {
    const variants = {};
    for (const variant of await readdir(assetFolder, { withFileTypes: true })) if (variant.isDirectory()) {
      const report = await readJson(path.join(assetFolder, variant.name, 'budget.json')).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (report) variants[variant.name] = report;
    }
    await writeFile(path.join(assetFolder, 'budget.json'), jsonBytes({ version: 1, id: m.id, revision: m.revision,
      policy: 'Each size/variant is an alternative resident set; totals include the separate rest pose, exclude legacy sheets and mipmaps.', variants }));
  }
  return result;
}

function presentationContract(m) {
  return JSON.stringify({ id: m.id, revision: m.revision, category: m.category, targetSize: m.targetSize, displayScale: m.displayScale, sourceSizes: m.sourceSizes, pivot: m.pivot, forward: m.forward,
    masterSize: m.masterSize, idleFrame: m.idleFrame, frames: m.frames.map(({ index, file, blenderFrame }) => ({ index, file, blenderFrame })), clips: m.clips,
    elevation: m.elevation, runtimeAtlas: m.runtimeAtlas, runtimeContract: m.runtimeContract, runtimeBudgetMB: m.runtimeBudgetMB,
    camera: { ...m.camera, bounds: undefined }, textures: m.textures, sources: m.sources, reference: m.reference, referenceTransform: m.referenceTransform, heldItem: m.heldItem });
}

async function listFiles(folder, prefix = '') {
  const files = [];
  for (const entry of await readdir(inside(folder, prefix || '.'), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`Symlinks are not allowed in source archive: ${rel}`);
    if (entry.isDirectory()) files.push(...await listFiles(folder, rel));
    else if (entry.isFile()) files.push(rel);
  }
  return files.sort();
}

async function bundleFiles(assetFolder, variant, size) {
  const build = await completedBuild(assetFolder);
  const folder = path.join(assetFolder, variant), exported = await readJson(path.join(folder, 'export.json'));
  const m = await readJson(path.join(folder, 'render.json'));
  validateManifestV2(m);
  if (exported.inputHash !== build.inputHash || JSON.stringify(exported.manifest) !== JSON.stringify(m)) throw new Error('Export no longer matches completed build');
  if (!m.sourceSizes.includes(size)) throw new Error('Choose a production source size');
  const checked = await verifyArchivedSources(assetFolder, m);
  // Preserve auxiliary snapshot inputs (for example the resolved catalog) as well.
  for (const file of await listFiles(path.join(assetFolder, 'archive-source'))) checked[`archive-source/${file}`] = sha256(await readFile(inside(assetFolder, `archive-source/${file}`)));
  const wanted = ['build.json', `${variant}/render.json`, `${variant}/export.json`, `${variant}/asset.blend`,
    `${variant}/sprite-${size}.png`, `${variant}/sheet-${size}.png`, ...m.frames.map(f => `${variant}/${f.file}`)];
  const extraOutputs = m.runtimeAtlas || m.elevation ? Object.keys(exported.outputs).filter(name => name === 'budget.json'
    || name.startsWith(`atlas/${size}/`) || name.startsWith(`elevation/frames-${size}/`)) : [];
  wanted.push(...extraOutputs.map(name => `${variant}/${name}`));
  if (m.elevation) wanted.push(...m.frames.flatMap(f => [`${variant}/${f.elevation.file}`, `${variant}/${f.elevation.exrFile}`]));
  for (const file of wanted) checked[file] = sha256(await readFile(inside(assetFolder, file)));
  if (checked[`${variant}/asset.blend`] !== exported.blendSha256) throw new Error('Packed Blender source changed');
  for (const name of [`sprite-${size}.png`, `sheet-${size}.png`]) if (checked[`${variant}/${name}`] !== exported.outputs[name]) throw new Error(`Selected export changed: ${name}`);
  for (const name of extraOutputs) if (checked[`${variant}/${name}`] !== exported.outputs[name]) throw new Error(`Selected export changed: ${name}`);
  for (const frame of m.frames) if (checked[`${variant}/${frame.file}`] !== frame.sha256) throw new Error(`Selected master changed: ${frame.file}`);
  if (m.elevation) for (const frame of m.frames) for (const [key, hash] of [['file', 'sha256'], ['exrFile', 'exrSha256']]) {
    if (checked[`${variant}/${frame.elevation[key]}`] !== frame.elevation[hash]) throw new Error('Selected elevation master changed');
  }
  return { files: Object.fromEntries(Object.entries(checked).sort(([a], [b]) => a.localeCompare(b))), manifest: m, exported };
}

export async function selectVariantV2(assetFolder, variant, size, reason) {
  if (!validVariant(variant) || typeof reason !== 'string' || !reason.trim()) throw new Error('Supply variant, size and review reason');
  const selectionFile = path.join(assetFolder, 'selection.json');
  if (await exists(selectionFile)) throw new Error('Selection already exists; retain approved revision');
  const { files, manifest: m, exported } = await bundleFiles(assetFolder, variant, size);
  const selection = { version: 2, id: m.id, revision: m.revision, inputHash: exported.inputHash, variant, size, reason: reason.trim(),
    ...(m.displayScale !== undefined ? { displayScale: m.displayScale } : {}),
    ...(m.runtimeAtlas ? { atlases: exported.atlases[size], budget: exported.budget.sizes[size] } : {}),
    idle: `${variant}/sprite-${size}.png`, sheet: `${variant}/sheet-${size}.png`, layout: exported.sheets[size], idleFrame: m.idleFrame, clips: m.clips,
    files, bundleSha256: sha256(jsonBytes(files)) };
  await writeFile(selectionFile, jsonBytes(selection), { flag: 'wx' });
  return selection;
}

export async function verifySelectionV2(assetFolder) {
  const selection = await readJson(path.join(assetFolder, 'selection.json'));
  if (selection.version !== 2 || !validVariant(selection.variant) || !selection.reason?.trim()) throw new Error('Invalid V2 selection');
  const { files, manifest: m, exported } = await bundleFiles(assetFolder, selection.variant, selection.size);
  if (JSON.stringify(selection.files) !== JSON.stringify(files) || selection.bundleSha256 !== sha256(jsonBytes(files)) || selection.inputHash !== exported.inputHash || selection.id !== m.id || selection.revision !== m.revision
    || selection.displayScale !== m.displayScale
    || JSON.stringify(selection.atlases) !== JSON.stringify(exported.atlases?.[selection.size])
    || JSON.stringify(selection.budget) !== JSON.stringify(exported.budget?.sizes[selection.size])
    || selection.idle !== `${selection.variant}/sprite-${selection.size}.png` || selection.sheet !== `${selection.variant}/sheet-${selection.size}.png`
    || JSON.stringify(selection.layout) !== JSON.stringify(exported.sheets[selection.size]) || selection.idleFrame !== m.idleFrame || JSON.stringify(selection.clips) !== JSON.stringify(m.clips)) throw new Error('Selected bundle changed; retain approved revision');
  return selection;
}

export async function archiveManifestV2(assetFolder) {
  const selection = await verifySelectionV2(assetFolder);
  const files = { ...selection.files, 'selection.json': sha256(await readFile(path.join(assetFolder, 'selection.json'))) };
  return { version: 2, id: selection.id, revision: selection.revision, selectionSha256: files['selection.json'], files };
}

export async function archiveAssetV2(assetFolder, python = process.env.FD_ASSET_PYTHON || 'python') {
  const manifest = await archiveManifestV2(assetFolder);
  const destination = path.join(assetFolder, 'source-bundle.zip');
  if (await exists(destination)) throw new Error('Source archive already exists; retain approved revision');
  await execute(python, [path.join(repoRoot, 'scripts/asset-pipeline/archive-v2.py'), assetFolder, destination], { windowsHide: true, maxBuffer: 1024 * 1024 });
  // The helper independently verifies the same bytes immediately before archiving.
  await verifySelectionV2(assetFolder);
  return { path: destination, sha256: sha256(await readFile(destination)), manifest };
}

export async function reviewAssetV2(assetFolder, exports) {
  const layers = [], labels = [];
  const cell = Math.max(108, ...exports.map(e => Math.round(e.manifest.targetSize * (e.manifest.displayScale ?? 1)) + 40)), labelHeight = 28, columns = 8;
  let row = 0;
  for (const result of exports) {
    const m = result.manifest;
    labels.push({ text: `${variantLabel(m)} · ${m.targetSize} px nominal`, x: 10, y: row * cell + 20 });
    row++;
    const canvasSize = Math.round(m.targetSize * (m.displayScale ?? 1));
    for (let index = 0; index < m.frames.length; index++) {
      const png = await resizeMaster(inside(path.join(assetFolder, m.variant), m.frames[index].file), canvasSize);
      layers.push({ input: png, left: (index % columns) * cell + Math.floor((cell - canvasSize) / 2), top: row * cell + Math.floor((cell - canvasSize) / 2) });
      labels.push({ text: String(index), x: (index % columns) * cell + 8, y: row * cell + labelHeight });
      if (index % columns === columns - 1 || index === m.frames.length - 1) row++;
    }
  }
  const width = columns * cell, height = Math.max(cell, row * cell);
  const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
  const text = `<svg width="${width}" height="${height}">${labels.map(l => `<text x="${l.x}" y="${l.y}" fill="#dce4d7" font-size="14" font-family="Arial">${escape(l.text)}</text>`).join('')}</svg>`;
  layers.push({ input: Buffer.from(text), left: 0, top: 0 });
  await sharp({ create: { width, height, channels: 4, background: '#243238' } }).composite(layers).png().toFile(path.join(assetFolder, 'review.png'));
}

export async function exportRunV2(runFolder, workspace = repoRoot) {
  const runRoot = path.join(workspace, 'art/poc/pipeline-v2/runs');
  const folder = inside(runRoot, path.relative(runRoot, path.resolve(runFolder)));
  const assets = [];
  for (const dir of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!dir.isDirectory() || dir.name.startsWith('.')) continue;
    const assetFolder = path.join(folder, dir.name), results = [];
    const build = await completedBuild(assetFolder);
    const variants = Object.keys(build.variants ?? {});
    // Early V2 builds did not record their variant list; retain their two-folder format.
    if (!variants.length) variants.push('calm', 'rich');
    if (variants.some(variant => !validVariant(variant))) throw new Error('Invalid build variants');
    for (const variant of variants) results.push(await exportVariantV2(path.join(assetFolder, variant), workspace));
    if (results.some(result => presentationContract(result.manifest) !== presentationContract(results[0].manifest))) throw new Error('Variants disagree on animation presentation contract');
    const m = results[0].manifest;
    const url = file => '/' + slash(path.relative(workspace, file));
    const entries = results.map(result => {
      const spec = result.manifest, base = path.join(assetFolder, spec.variant);
      return { variant: spec.variant, label: variantLabel(spec), nativeMetrics: result.report.native,
        master: url(path.join(base, spec.frames[spec.idleFrame].file)), clips: spec.clips, idleFrame: spec.idleFrame, frameCount: spec.frames.length,
        sources: Object.entries(result.sheets).map(([size, layout]) => ({ size: Number(size), url: url(path.join(base, `sheet-${size}.png`)), idleUrl: url(path.join(base, `sprite-${size}.png`)), ...layout })) };
    });
    await reviewAssetV2(assetFolder, results);
    const preferred = await exists(path.join(assetFolder, 'selection.json')) ? await verifySelectionV2(assetFolder) : undefined;
    let previousReference;
    if (m.previousReference) {
      const previous = inside(workspace, m.previousReference.path);
      const meta = await sharp(previous).metadata();
      previousReference = { label: m.previousReference.label, url: url(previous), sourceSize: meta.width, nativeMetrics: await nativeMetrics(previous, m.targetSize) };
    }
    assets.push({ id: m.id, label: m.label, category: m.category, targetSize: m.targetSize, displayScale: m.displayScale, forward: m.forward, pivot: m.pivot,
      collisionDiameter: m.collisionDiameter, mount: m.mount, heldItem: m.heldItem, previousReference, reference: m.reference ? '/' + m.reference.replace(/^public\//, '') : undefined,
      referenceTransform: m.referenceTransform, referenceMetrics: m.reference ? await nativeMetrics(inside(workspace, m.reference), m.targetSize) : undefined,
      variants: entries, preferred: preferred ? { variant: preferred.variant, size: preferred.size, reason: preferred.reason } : undefined });
  }
  if (!assets.length) throw new Error('No assets in run');
  const temporary = path.join(folder, '.catalog.json.tmp');
  await writeFile(temporary, jsonBytes({ version: 2, assets }));
  await rename(temporary, path.join(folder, 'catalog.json'));
  await indexLibrary(workspace);
  return assets.map(a => a.id);
}
