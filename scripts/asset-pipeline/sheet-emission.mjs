// Derives the emission sheet of a selected sheet asset (turret or enemy) from its archived asset.blend and
// publishes it beside the beauty sheet.
//
//   node scripts/asset-pipeline/sheet-emission.mjs <id> [--run-root <abs runs root>] [--samples 32] [--range 2]
//     Renders the live registry entry's selection and publishes it at once (the turret flow).
//   node scripts/asset-pipeline/sheet-emission.mjs <id> --revision <rev> --channel heat --neutral [--run-root <abs>]
//     Stages the sheet of a selected build that is not live yet; writes only inside that build.
//   node scripts/asset-pipeline/sheet-emission.mjs <id> --publish --channel heat [--run-root <abs>]
//     Publishes the staged sheet after import-runtime made its revision live; renders nothing.
//   node scripts/asset-pipeline/sheet-emission.mjs <id> --preview <preview folder> --channel heat --neutral
//     Authoring check: renders the poses of an assets:preview folder into it, nothing else.
//   Add `--zones` to a neutral channel run: the catalog entry's `emissionZones` assign every channel surface
//   to a stage (by part name), and the sheet carries the stage in red (encoding srgb-zone-alpha-coverage).
//
// The selected build (selection.json under <runs>/<revision>/<id>/) must still produce exactly the beauty sheet;
// the pass renders the same frames of the same scene with every light hidden (sheet-emission-passes.py), is
// resized like the beauty masters and packed into the same layout. `--channel` keeps only materials tagged
// FD_EmissionChannel = <channel>; `--neutral` makes them white at strength 1 with range 1, a coverage mask the
// runtime tints. Output: public/.../<id>/emission[-<channel>].png and the category's manifest
// (src/assets/manifests/turret-emission.json or enemy-emission.json). Enemy sheets must keep the eye anchors dark.
import { readFile, writeFile, mkdir, access, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { readDemandCatalog, readPipelineRegistry } from './pipeline-registry.mjs';
import { resizeMaster } from './export.mjs';
import { packSheet, verifySelectionV2 } from './export-v2.mjs';
import { repoRoot, resolveBlender, renderProcess } from './preview-v2.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const MANIFESTS = { turret: 'src/assets/manifests/turret-emission.json', enemy: 'src/assets/manifests/enemy-emission.json' };
const LAYOUT_KEYS = ['frameWidth', 'frameHeight', 'margin', 'spacing', 'columns', 'rows', 'frameCount', 'width', 'height'];
// Eyes have their own glow renderer; a channel sheet must leave their anchors transparent.
const EYE_ALPHA_LIMIT = .08;

const { values, positionals } = parseArgs({ allowPositionals: true, options: {
  'run-root': { type: 'string' }, samples: { type: 'string', default: '32' }, range: { type: 'string' },
  device: { type: 'string', default: 'OPTIX' }, blender: { type: 'string' }, channel: { type: 'string' },
  neutral: { type: 'boolean', default: false }, revision: { type: 'string' }, publish: { type: 'boolean', default: false },
  preview: { type: 'string' }, zones: { type: 'boolean', default: false },
} });
const [id] = positionals;
const usage = 'Usage: sheet-emission.mjs <id> [--revision <rev> | --publish | --preview <folder>] [--channel <name> [--neutral]] [--run-root <abs>] [--samples 32] [--range 2]';
if (!/^[a-z0-9-]+$/.test(id ?? '')) throw Error(usage);
const { channel, neutral } = values;
if (channel !== undefined && !/^[a-z][a-z0-9-]*$/.test(channel)) throw Error('Invalid channel name');
if (neutral && !channel) throw Error('--neutral needs --channel');
if (values.zones && !neutral) throw Error('--zones needs --channel <name> --neutral');
if ([values.revision, values.publish || undefined, values.preview].filter(v => v !== undefined).length > 1) throw Error(usage);
const range = Number(values.range ?? (neutral ? 1 : 2));
if (neutral && range !== 1) throw Error('A neutral mask uses range 1');
const name = channel ? `emission-${channel}${values.zones ? '-zones' : ''}` : 'emission';
const runs = values['run-root'] ? path.resolve(values['run-root']) : path.join(repoRoot, 'art/poc/pipeline-v2/runs');

/** Authored stage zones of the channel (catalog `emissionZones`), or null without `--zones`. */
async function emissionZones() {
  if (!values.zones) return null;
  const entry = (await readDemandCatalog(repoRoot)).assets.find(asset => asset.id === id);
  const authored = entry?.emissionZones;
  if (!authored || authored.channel !== channel || !Array.isArray(authored.zones) || !authored.zones.length)
    throw Error(`Catalog entry ${id} has no emissionZones for channel ${channel}`);
  const zones = authored.zones.map(({ stage, objects }) => ({ stage, objects }));
  zones.forEach((zone, index) => {
    if (zone.stage !== index + 1 || !Array.isArray(zone.objects) || !zone.objects.length || zone.objects.some(o => typeof o !== 'string' || !o))
      throw Error(`Emission zone ${index + 1} of ${id} must be stage ${index + 1} with part names`);
  });
  return zones;
}
const zones = await emissionZones();

async function renderPass(blend, output, frames) {
  await mkdir(output, { recursive: true });
  const job = path.join(output, 'job.json');
  await writeFile(job, JSON.stringify({ output, samples: Number(values.samples), range, device: values.device,
    ...(channel ? { channel, neutral } : {}), ...(zones ? { zones } : {}), frames }, null, 2));
  const blender = await resolveBlender(values.blender);
  const log = path.join(output, `blender-${Date.now()}.log`);
  await renderProcess(blender, ['--background', blend, '--python-exit-code', '1', '--python',
    path.join(repoRoot, 'scripts/asset-pipeline/sheet-emission-passes.py'), '--', job], log, repoRoot);
  const pass = await readJson(path.join(output, 'emission.json'));
  if (pass.frames.length !== frames.length) throw Error('Emission pass is missing frames');
  return pass;
}

async function eyeCheck(output, pass, render) {
  const anchors = render.eyeAnchors?.frames;
  if (!anchors) return null;
  let max = 0, sum = 0, samples = 0;
  for (const frame of pass.frames) {
    const { data, info } = await sharp(path.join(output, frame.file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const eyes = anchors[frame.index];
    for (const eye of [eyes.left, eyes.right, ...(eyes.extra ?? [])]) {
      const cx = eye.x * info.width, cy = eye.y * info.height, a = eye.width * info.width / 2, b = eye.height * info.height / 2;
      const cos = Math.cos(eye.rotation), sin = Math.sin(eye.rotation), reach = Math.ceil(Math.max(a, b));
      for (let y = Math.floor(cy - reach); y <= cy + reach; y++) for (let x = Math.floor(cx - reach); x <= cx + reach; x++) {
        const dx = x + .5 - cx, dy = y + .5 - cy, u = (dx * cos + dy * sin) / a, v = (dy * cos - dx * sin) / b;
        if (u * u + v * v > 1 || x < 0 || y < 0 || x >= info.width || y >= info.height) continue;
        const alpha = data[(y * info.width + x) * info.channels + 3] / 255;
        max = Math.max(max, alpha); sum += alpha; samples++;
      }
    }
  }
  if (!samples) throw Error('Eye anchors cover no emission pixels');
  const result = { frames: pass.frames.length, samples, maxAlpha: +max.toFixed(4), meanAlpha: +(sum / samples).toFixed(5), limit: EYE_ALPHA_LIMIT };
  if (max > EYE_ALPHA_LIMIT) throw Error(`Emission covers an eye anchor: ${JSON.stringify(result)}`);
  return result;
}

// The colour of the glow light: the sheet's hue weighted by squared intensity, so the brightest parts decide.
async function glowColour(buffer) {
  const { data } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += 4) {
    const w = (data[i + 3] / 255) ** 2;
    for (let c = 0; c < 3; c++) sum[c] += data[i + c] * w;
  }
  const peakChannel = Math.max(...sum, 1e-6);
  const color = sum.reduce((hex, value) => hex * 256 + Math.round(value / peakChannel * 255), 0);
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** Renders and packs the emission sheet of one selected build into <variant>/<name>/. */
async function stage(assetFolder, selection) {
  const folder = path.join(assetFolder, selection.variant), size = selection.size;
  const render = await readJson(path.join(folder, 'render.json'));
  if (!MANIFESTS[render.category]) throw Error(`No emission manifest for category ${render.category}`);
  const beautySheetSha256 = sha(await readFile(path.join(folder, `sheet-${size}.png`)));
  const output = path.join(folder, name);
  const pass = await renderPass(path.join(folder, 'asset.blend'), output, render.frames.map(({ index, blenderFrame }) => ({ index, blenderFrame })));
  const frames = await Promise.all(pass.frames.map(async frame => resizeMaster(await readFile(path.join(output, frame.file)), size)));
  const { buffer, layout } = await packSheet(frames, size);
  for (const key of LAYOUT_KEYS) if (layout[key] !== selection.layout[key]) throw Error(`Emission layout differs from the beauty sheet: ${key}`);
  const eyes = await eyeCheck(output, pass, render);
  await writeFile(path.join(output, `sheet-${size}.png`), buffer);
  const record = { id, category: render.category, revision: selection.revision, variant: selection.variant, sourceSize: size,
    sheetSha256: sha(buffer), beautySheetSha256, encoding: pass.encoding, range: pass.range,
    peak: Math.max(...pass.frames.map(frame => frame.peak)), layout,
    ...(channel ? { channel, hue: neutral ? 'neutral' : 'authored', channelMaterials: pass.channelMaterials } : {}),
    ...(zones ? { zones: zones.length, zoneObjects: pass.zones } : {}),
    ...(neutral ? {} : { color: await glowColour(buffer) }), ...(eyes ? { eyeCheck: eyes } : {}) };
  await writeFile(path.join(output, 'record.json'), JSON.stringify(record, null, 2) + '\n');
  console.log(`staged ${name} ${id}@${selection.revision}: ${pass.frames.length} frames, peak ${record.peak.toFixed(2)}${eyes ? `, eyes max alpha ${eyes.maxAlpha}` : ''} -> ${path.join(output, `sheet-${size}.png`)}`);
  return { output, record };
}

/** Copies a staged sheet of the live revision to public/ and records it in the category manifest. */
async function publish(live, output) {
  const record = await readJson(path.join(output, 'record.json'));
  const bytes = await readFile(path.join(output, `sheet-${live.sourceSize}.png`));
  if (record.id !== id || record.revision !== live.revision || record.variant !== live.variant || record.sourceSize !== live.sourceSize
    || record.beautySheetSha256 !== live.hashes.sheet || sha(bytes) !== record.sheetSha256 || (record.channel ?? undefined) !== channel)
    throw Error('Staged emission sheet does not belong to the live beauty sheet');
  for (const key of LAYOUT_KEYS) if (record.layout[key] !== live.layout[key]) throw Error(`Emission layout differs from the live sheet: ${key}`);
  const file = `assets/sprites/pipeline-v2/${id}/${name}.png`;
  await writeFile(path.join(repoRoot, 'public', file), bytes);
  const manifestFile = path.join(repoRoot, MANIFESTS[live.category]);
  const manifest = await access(manifestFile).then(() => readJson(manifestFile), () => ({ version: 1, assets: {} }));
  // Turret entries keep their original shape; channel masks also carry their binding and layout.
  manifest.assets[id] = { revision: live.revision, sheet: `./${file}`, sha256: record.sheetSha256, beautySheetSha256: live.hashes.sheet,
    ...(channel ? { channel, hue: record.hue, variant: live.variant, sourceSize: live.sourceSize } : {}),
    encoding: record.encoding, range: record.range, peak: record.peak, ...(record.zones ? { zones: record.zones } : {}),
    ...(record.color ? { color: record.color } : {}), ...(channel ? { layout: record.layout } : {}),
    ...(record.eyeCheck ? { eyeCheck: record.eyeCheck } : {}) };
  manifest.assets = Object.fromEntries(Object.entries(manifest.assets).sort(([a], [b]) => a.localeCompare(b)));
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`${name} ${id}: published ${record.layout.frameCount} frames -> public/${file}, ${MANIFESTS[live.category]}`);
}

async function liveEntry() {
  const registry = await readPipelineRegistry(repoRoot);
  const live = registry.assets.find(asset => asset.id === id);
  if (!live || !MANIFESTS[live.category]) throw Error(`No published turret or enemy ${id}`);
  return live;
}

if (values.preview) {
  // Authoring check on an assets:preview folder: its saved scene and posed frames, no sheet or manifest.
  const folder = path.resolve(values.preview), preview = await readJson(path.join(folder, 'preview.json'));
  if (preview.id !== id) throw Error('Preview belongs to another asset');
  const output = path.join(folder, name);
  const pass = await renderPass(path.join(folder, 'preview.blend'), output, preview.poses.map(({ index, blenderFrame }) => ({ index, blenderFrame })));
  console.log(`${name} preview ${id}: ${pass.frames.length} masters -> ${output}`);
} else if (values.revision) {
  if (!/^[a-z0-9-]+$/.test(values.revision)) throw Error('Invalid revision');
  const assetFolder = path.join(runs, values.revision, id);
  const selection = await verifySelectionV2(assetFolder);
  if (selection.id !== id || selection.revision !== values.revision) throw Error('Selection belongs to another build');
  await stage(assetFolder, selection);
} else {
  const live = await liveEntry();
  const assetFolder = path.join(runs, live.revision, id);
  if (values.publish) {
    await publish(live, path.join(assetFolder, live.variant, name));
  } else {
    const selection = await readJson(path.join(assetFolder, 'selection.json'));
    const variant = selection.variant ?? live.variant, size = selection.size ?? live.sourceSize;
    if (variant !== live.variant || size !== live.sourceSize) throw Error('Selection disagrees with the live registry entry');
    if (sha(await readFile(path.join(assetFolder, variant, `sheet-${size}.png`))) !== live.hashes.sheet) throw Error('Selected sheet is not the published one');
    const { output } = await stage(assetFolder, { ...selection, variant, size, layout: live.layout, revision: live.revision });
    await publish(live, output);
  }
}
