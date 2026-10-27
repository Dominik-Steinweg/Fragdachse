// Derives the emission sheet of a selected turret from its archived asset.blend and publishes it beside the
// beauty sheet: node scripts/asset-pipeline/turret-emission.mjs <id> [--run-root <abs runs root>] [--samples 32] [--range 2]
//
// The live registry entry names revision, variant and sheet layout. Its selected build (selection.json under
// <runs>/<revision>/<id>/) must still produce exactly the published beauty sheet; the emission pass renders the same
// frames of the same scene with every light hidden (turret-emission-passes.py), is resized like the beauty masters
// and packed into the same layout. Output: public/.../<id>/emission.png and src/assets/manifests/turret-emission.json.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { readPipelineRegistry } from './pipeline-registry.mjs';
import { resizeMaster } from './export.mjs';
import { packSheet } from './export-v2.mjs';
import { repoRoot, resolveBlender, renderProcess } from './preview-v2.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const MANIFEST = 'src/assets/manifests/turret-emission.json';

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'run-root': { type: 'string' }, samples: { type: 'string', default: '32' }, range: { type: 'string', default: '2' },
  device: { type: 'string', default: 'OPTIX' }, blender: { type: 'string' },
} });
const [id] = positionals;
if (!/^[a-z0-9-]+$/.test(id ?? '')) throw Error('Usage: turret-emission.mjs <id> [--run-root <abs>] [--samples 32] [--range 2]');

const registry = await readPipelineRegistry(repoRoot);
const live = registry.assets.find(asset => asset.id === id);
if (!live || live.category !== 'turret') throw Error(`No published turret ${id}`);
const runs = values['run-root'] ? path.resolve(values['run-root']) : path.join(repoRoot, 'art/poc/pipeline-v2/runs');
const assetFolder = path.join(runs, live.revision, id);
const selection = await readJson(path.join(assetFolder, 'selection.json'));
const variant = selection.variant ?? live.variant, size = selection.size ?? live.sourceSize;
if (variant !== live.variant || size !== live.sourceSize) throw Error('Selection disagrees with the live registry entry');
const folder = path.join(assetFolder, variant);
if (sha(await readFile(path.join(folder, `sheet-${size}.png`))) !== live.hashes.sheet) throw Error('Selected sheet is not the published one');
const render = await readJson(path.join(folder, 'render.json'));

const output = path.join(folder, 'emission');
await mkdir(output, { recursive: true });
const job = path.join(output, 'job.json');
await writeFile(job, JSON.stringify({ output, samples: Number(values.samples), range: Number(values.range), device: values.device,
  frames: render.frames.map(({ index, blenderFrame }) => ({ index, blenderFrame })) }, null, 2));
const blender = await resolveBlender(values.blender);
const log = path.join(output, `blender-${Date.now()}.log`);
await renderProcess(blender, ['--background', path.join(folder, 'asset.blend'), '--python-exit-code', '1', '--python',
  path.join(repoRoot, 'scripts/asset-pipeline/turret-emission-passes.py'), '--', job], log, repoRoot);
const pass = await readJson(path.join(output, 'emission.json'));
if (pass.frames.length !== render.frames.length) throw Error('Emission pass is missing frames');

const frames = await Promise.all(pass.frames.map(async frame => resizeMaster(await readFile(path.join(output, frame.file)), size)));
const { buffer, layout } = await packSheet(frames, size);
for (const key of ['frameWidth', 'frameHeight', 'margin', 'spacing', 'columns', 'rows', 'frameCount', 'width', 'height']) {
  if (layout[key] !== live.layout[key]) throw Error(`Emission layout differs from the beauty sheet: ${key}`);
}
// The colour of the glow light: the sheet's hue weighted by squared intensity, so the brightest parts decide.
const { data } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
const sum = [0, 0, 0];
let weight = 0;
for (let i = 0; i < data.length; i += 4) {
  const w = (data[i + 3] / 255) ** 2;
  for (let c = 0; c < 3; c++) sum[c] += data[i + c] * w;
  weight += w;
}
const peakChannel = Math.max(...sum, 1e-6);
const color = sum.reduce((hex, value) => hex * 256 + Math.round(value / peakChannel * 255), 0);
const file = `assets/sprites/pipeline-v2/${id}/emission.png`;
await writeFile(path.join(repoRoot, 'public', file), buffer);
const manifestFile = path.join(repoRoot, MANIFEST);
const manifest = await access(manifestFile).then(() => readJson(manifestFile), () => ({ version: 1, assets: {} }));
manifest.assets[id] = { revision: live.revision, sheet: `./${file}`, sha256: sha(buffer), beautySheetSha256: live.hashes.sheet,
  encoding: pass.encoding, range: pass.range, peak: Math.max(...pass.frames.map(frame => frame.peak)),
  color: `#${color.toString(16).padStart(6, '0')}` };
manifest.assets = Object.fromEntries(Object.entries(manifest.assets).sort(([a], [b]) => a.localeCompare(b)));
await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
console.log(`emission ${id}: ${pass.frames.length} frames, peak ${manifest.assets[id].peak.toFixed(2)} -> public/${file}`);
