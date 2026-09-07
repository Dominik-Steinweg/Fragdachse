import { readFile, writeFile, readdir, copyFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hash = data => createHash('sha256').update(data).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const exists = async file => access(file).then(() => true, () => false);
const saveJson = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
export const variantLabel = m => m.variantLabel || (m.variant === 'rich' ? 'Detailreich' : 'Ruhig / illustrativ');

export function inside(root, relative) {
  const target = path.resolve(root, relative);
  const rel = path.relative(path.resolve(root), target);
  if (rel.startsWith('..' + path.sep) || rel === '..' || path.isAbsolute(rel)) throw new Error('Path escapes output root');
  return target;
}

export function validateManifest(m) {
  if (m.pipelineVersion !== 1 || !/^[a-z0-9][a-z0-9-]*$/.test(m.id)) throw new Error('Invalid asset manifest');
  if (!['calm', 'rich'].includes(m.variant) || !['north', 'east'].includes(m.forward)) throw new Error('Invalid variant/orientation');
  if (!['character', 'enemy', 'turret'].includes(m.category)) throw new Error('Invalid category');
  if (m.forward !== (m.category === 'turret' ? 'east' : 'north')) throw new Error('Orientation disagrees with asset category');
  if (!Number.isInteger(m.targetSize) || m.targetSize < 1 || m.targetSize > 1024) throw new Error('Invalid target size');
  if (!Array.isArray(m.sourceSizes) || !m.sourceSizes.length || m.sourceSizes.some(n => !Number.isInteger(n) || n < m.targetSize || n > 1024)) throw new Error('Invalid source sizes');
  if (!Array.isArray(m.pivot) || m.pivot.length !== 2 || m.pivot.some(n => !Number.isFinite(n) || n < 0 || n > 1)) throw new Error('Invalid pivot');
  if (m.camera?.type !== 'ORTHO' || m.camera.rotation?.length !== 3 || m.camera.rotation.some(n => !Number.isFinite(n) || Math.abs(n) > 1e-7)) throw new Error('Camera must be exact orthographic -Z');
  {
    const c = m.camera, p = m.pivot;
    if (!Array.isArray(c.location) || c.location.length !== 3 || c.location.some(n => !Number.isFinite(n)) || !Number.isFinite(c.orthoScale) || !(c.orthoScale > 0) || c.transparent !== true) throw new Error('Invalid camera projection');
    if (Math.abs(c.location[0] - (.5 - p[0]) * c.orthoScale) > 1e-6 || Math.abs(c.location[1] - (p[1] - .5) * c.orthoScale) > 1e-6) throw new Error('Camera placement shifts declared pivot');
  }
  if (!Number.isInteger(m.masterSize) || m.masterSize < m.targetSize) throw new Error('Invalid master size');
  if (!m.textures || !Object.keys(m.textures).length) throw new Error('Texture provenance missing');
  if (m.collisionDiameter !== undefined && (!Number.isFinite(m.collisionDiameter) || m.collisionDiameter <= 0)) throw new Error('Invalid collision diameter');
  if (m.variantLabel !== undefined && (typeof m.variantLabel !== 'string' || !m.variantLabel.trim())) throw new Error('Invalid variant label');
  if (m.materialParameters) for (const key of ['textureStrength', 'formShadowStrength']) {
    const value = m.materialParameters[key];
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error(`Invalid material parameter: ${key}`);
  }
}

export async function inspectMaster(input, expectedSize) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const metadata = await sharp(input).metadata();
  if (metadata.format !== 'png' || !metadata.hasAlpha || info.width !== expectedSize || info.height !== expectedSize) throw new Error('Expected square RGBA PNG master');
  let clear = 0, opaque = 0, clipped = false, highlights = 0;
  let minX = expectedSize, minY = expectedSize, maxX = -1, maxY = -1;
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    const i = (y * info.width + x) * 4, a = data[i + 3];
    if (a === 0) clear++;
    if (a > 250) {
      opaque++;
      if (data[i] > 250 && data[i + 1] > 250 && data[i + 2] > 250) highlights++;
    }
    if (a > 8) {
      minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
      if (x < 2 || y < 2 || x >= info.width - 2 || y >= info.height - 2) clipped = true;
    }
  }
  if (!clear || !opaque) throw new Error('Master must contain transparent and opaque pixels');
  if (clipped) throw new Error('Visible silhouette touches export border');
  return { bounds: [minX, minY, maxX, maxY], transparentPixels: clear, opaquePixels: opaque, clippedWhiteFraction: highlights / opaque };
}

// sharp/libvips premultiplies alpha for resize and unpremultiplies for PNG output.
// Always resize the original master; never cascade exports or sharpen alpha edges.
export async function resizeMaster(input, size) {
  return sharp(input).resize(size, size, { fit: 'fill', kernel: 'lanczos3' }).png().toBuffer();
}

export async function nativeMetrics(input, size) {
  const { data } = await sharp(await resizeMaster(input, size)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let left = size, top = size, right = -1, bottom = -1, area = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if (data[(y * size + x) * 4 + 3] < 128) continue;
    area++; left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { canvasSize: size, alphaThreshold: 128, width: area ? right-left+1 : 0, height: area ? bottom-top+1 : 0, area,
    bounds: area ? [left, top, right, bottom] : null };
}

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
function textLayer(text, width, height, size = 16) {
  return Buffer.from(`<svg width="${width}" height="${height}"><text x="0" y="${size + 2}" font-size="${size}" font-family="Arial" fill="#dce4d7">${escape(text)}</text></svg>`);
}

export async function reviewAsset(assetFolder) {
  const calm = await json(path.join(assetFolder, 'calm/render.json'));
  if (calm.previousReference) return reviewRevision(assetFolder, calm);
  const size = calm.targetSize;
  const layers = [{ input: textLayer(`${calm.label} / ${calm.revision}`, 950, 35, 22), left: 24, top: 18 }];
  const sourceFolders = ['calm', 'rich'];
  for (let j = 0; j < sourceFolders.length; j++) {
    const folder = path.join(assetFolder, sourceFolders[j]);
    const x = 24 + j * 475;
    const manifest = await json(path.join(folder, 'render.json'));
    layers.push({ input: textLayer(variantLabel(manifest), 440, 25), left: x, top: 58 });
    layers.push({ input: await resizeMaster(path.join(folder, 'master.png'), 300), left: x + 65, top: 95 });
    layers.push({ input: await readFile(path.join(folder, `sprite-${size}.png`)), left: x + 28, top: 421 });
    layers.push({ input: textLayer(`${size} px`, 90, 25, 13), left: x + 10, top: 470 });
    for (let k = 0; k < calm.sourceSizes.length; k++) {
      const n = calm.sourceSizes[k];
      const source = await readFile(path.join(folder, `sprite-${n}.png`));
      layers.push({ input: await resizeMaster(source, size), left: x + 160 + k * 120, top: 421 });
      layers.push({ input: textLayer(`${n} → ${size} px*`, 112, 25, 13), left: x + 133 + k * 120, top: 470 });
    }
  }
  layers.push({ input: textLayer('* Offline-Verkleinerung. Rotation und GPU-Skalierung im Viewer beurteilen.', 920, 30, 14), left: 24, top: 520 });
  await sharp({ create: { width: 975, height: 565, channels: 4, background: '#243238' } }).composite(layers).png().toFile(path.join(assetFolder, 'review.png'));
}

async function reviewRevision(folder, m) {
  const entries = [];
  for (const variant of ['calm', 'rich']) {
    const spec = await json(path.join(folder, variant, 'render.json'));
    entries.push({ label: variantLabel(spec), file: path.join(folder, variant, 'master.png') });
  }
  entries.push({ label: m.previousReference.label, file: inside(repoRoot, m.previousReference.path) });
  entries.push({ label: 'Original', file: inside(repoRoot, m.reference) });
  const layers = [{ input: textLayer(`${m.label} / ${m.revision} / identische Anzeigegröße`, 1160, 36, 22), left: 24, top: 18 }];
  const metrics = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i], x = i*300 + 24;
    const native = await nativeMetrics(e.file, m.targetSize);
    metrics.push({ label: e.label, ...native });
    layers.push({ input: textLayer(e.label, 275, 25), left: x, top: 68 });
    layers.push({ input: await resizeMaster(e.file, 240), left: x + 6, top: 110 });
    if (m.collisionDiameter) {
      layers.push({ input: Buffer.from(`<svg width="64" height="64"><circle cx="32" cy="32" r="${m.collisionDiameter/2}" stroke="#e7c887" stroke-width="1" fill="none" opacity="0.7"/></svg>`), left: x + 98, top: 377 });
    }
    layers.push({ input: await resizeMaster(e.file, m.targetSize), left: x + 130 - m.targetSize/2, top: 409 - m.targetSize/2 });
    layers.push({ input: textLayer(`${native.width} × ${native.height} px / ${native.area} Pixel`, 270, 25, 14), left: x, top: 460 });
  }
  layers.push({ input: textLayer(`Unten: ${m.targetSize}-px-Canvas${m.collisionDiameter ? ', Referenzkreis ' + m.collisionDiameter : ''}. Messung ab 50% Alpha. Oben: ergänzende Vergrößerung.`, 1160, 25, 14), left: 24, top: 515 });
  await sharp({ create: { width: 1200, height: 560, channels: 4, background: '#243238' } }).composite(layers).png().toFile(path.join(folder, 'review.png'));
  await saveJson(path.join(folder, 'native-comparison.json'), metrics);
}

export async function exportVariant(folder, workspace = repoRoot) {
  const m = await json(path.join(folder, 'render.json'));
  validateManifest(m);
  for (const texture of Object.values(m.textures)) {
    const input = await readFile(inside(workspace, texture.path));
    if (hash(input) !== texture.sha256) throw new Error(`Texture changed since render: ${texture.path}`);
  }
  const input = await readFile(path.join(folder, 'master.png'));
  const masterHash = hash(input);
  const report = await inspectMaster(input, m.masterSize);
  report.native = await nativeMetrics(input, m.targetSize);
  const priorFile = path.join(folder, 'export.json');
  if (await exists(priorFile)) {
    const prior = await json(priorFile);
    if (prior.masterSha256 !== masterHash || JSON.stringify(prior.manifest) !== JSON.stringify(m)) throw new Error('Rendered revision changed; create a new revision instead');
  }
  const sizes = [...new Set([m.targetSize, ...m.sourceSizes])];
  const outputs = {};
  for (const n of sizes) {
    const output = await resizeMaster(input, n);
    const name = `sprite-${n}.png`;
    await writeFile(path.join(folder, name), output);
    outputs[name] = hash(output);
  }
  await saveJson(priorFile, { manifest: m, masterSha256: masterHash, outputs, report });
  return m;
}

export async function exportRun(runFolder) {
  const folder = inside(path.join(repoRoot, 'art/poc/pipeline-v1/runs'), path.relative(path.join(repoRoot, 'art/poc/pipeline-v1/runs'), path.resolve(runFolder)));
  const assets = [];
  for (const dir of await readdir(folder, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const assetFolder = path.join(folder, dir.name);
    const variants = [];
    for (const variant of ['calm', 'rich']) {
      const m = await exportVariant(path.join(assetFolder, variant));
      const base = '/' + path.relative(repoRoot, path.join(assetFolder, variant)).split(path.sep).join('/');
      const exported = await json(path.join(assetFolder, variant, 'export.json'));
      variants.push({ variant, label: variantLabel(m), nativeMetrics: exported.report.native, master: `${base}/master.png`, sources: [...new Set([m.targetSize, ...m.sourceSizes])].map(size => ({ size, url: `${base}/sprite-${size}.png` })) });
    }
    const m = await json(path.join(assetFolder, 'calm/render.json'));
    await reviewAsset(assetFolder);
    const selectionFile = path.join(assetFolder, 'selection.json');
    const preferred = await exists(selectionFile) ? await json(selectionFile) : undefined;
    let previousReference;
    if (m.previousReference) {
      const previous = inside(repoRoot, m.previousReference.path);
      const meta = await sharp(previous).metadata();
      previousReference = { label: m.previousReference.label, url: '/' + m.previousReference.path.replaceAll('\\', '/'), sourceSize: meta.width, nativeMetrics: await nativeMetrics(previous, m.targetSize) };
    }
    assets.push({ id: m.id, label: m.label, category: m.category, targetSize: m.targetSize, forward: m.forward, pivot: m.pivot,
      collisionDiameter: m.collisionDiameter, previousReference,
      reference: '/' + m.reference.replace(/^public\//, ''), referenceMetrics: await nativeMetrics(inside(repoRoot, m.reference), m.targetSize), variants, preferred });
  }
  if (!assets.length) throw new Error('No assets in run');
  assets.sort((a, b) => a.id.localeCompare(b.id));
  await saveJson(path.join(folder, 'catalog.json'), { version: 1, assets });
  return assets.map(a => a.id);
}

export async function selectVariant(assetFolder, variant, size, reason) {
  if (!['calm', 'rich'].includes(variant) || !reason?.trim()) throw new Error('Supply variant, size and review reason');
  const selectionFile = path.join(assetFolder, 'selection.json');
  if (await exists(selectionFile)) throw new Error('Selection already exists; retain approved revision');
  const manifest = await json(path.join(assetFolder, variant, 'render.json'));
  if (!manifest.sourceSizes.includes(size)) throw new Error('Choose a production source size');
  const source = path.join(assetFolder, variant, `sprite-${size}.png`);
  await copyFile(source, path.join(assetFolder, 'preferred.png'));
  await saveJson(selectionFile, { variant, size, reason, sha256: hash(await readFile(source)) });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, folder, variant, size, ...reason] = process.argv.slice(2);
  try {
    if (command === 'export' && folder) console.log(await exportRun(folder));
    else if (command === 'select' && folder) {
      const safe = inside(path.join(repoRoot, 'art/poc/pipeline-v1/runs'), path.relative(path.join(repoRoot, 'art/poc/pipeline-v1/runs'), path.resolve(folder)));
      await selectVariant(safe, variant, Number(size), reason.join(' '));
    } else throw new Error('Usage: node scripts/asset-pipeline/export.mjs export <run-folder> | select <asset-folder> <calm|rich> <size> <reason>');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
