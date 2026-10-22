// Spawn structure (GDD Spawnbauwerk V1): the carcass and its brood nest as two congruent sheet assets.
//   node scripts/asset-pipeline/export-spawn-structure.mjs blender --label <prefix>
// Packs the layers rendered from the live Blender carcass (scripts/asset-pipeline/spawn-carcass): a frame per
// state and opening, rendered with a fixed sun. Export never re-renders. Both assets share the pivot (nest
// centre) and the scale (32 px per world cell), so the runtime stacks them exactly.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { packSheet } from './export-v2.mjs';
import { repoRoot } from './preview-v2.mjs';
import { readDemandCatalog, readPipelineRegistry, writePipelineRegistry } from './pipeline-registry.mjs';

const MANIFEST = 'src/assets/manifests/spawn-structure.json';
const hash = data => createHash('sha256').update(data).digest('hex');
const identifier = value => { if (!/^[a-z0-9][a-z0-9-]*$/.test(value ?? '')) throw Error(`Invalid label: ${value}`); return value; };

const OUTLETS = ['north', 'east', 'south', 'west'];
const CARCASS = {
  // Destruction is a runtime bone burst: no damaged or rubble frames, the ground fades out.
  building: { id: 'spawn-structure', textureKey: 'construction_spawn_structure', states: ['intact'],
    emissive: { core: 'dark violet embers in the eye sockets (the runtime lights the eyes)' }, cells: 'buildingCells' },
  pit: { id: 'spawn-brood-pit', textureKey: 'construction_spawn_brood_pit', states: ['sealed', 'active'],
    emissive: { glow: 'glowing eggs and the veins of the void growth' }, cells: 'pitCells' },
};

/** Emission render (emitters lit, everything else black) to white RGB with alpha = emission strength. */
async function emissionMask(file, size) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(info.width * info.height * 4, 255);
  for (let i = 0; i < data.length; i += 4) out[i + 3] = Math.min(255, Math.round(Math.max(data[i], data[i + 1], data[i + 2]) * 1.3 * data[i + 3] / 255));
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).resize(size, size).png().toBuffer();
}

/** One Blender-rendered layer: a frame per state and opening (fixed sun), resized to the catalog source size. */
async function exportCarcassAsset(asset, label, catalog, registry, settings) {
  const spec = catalog.find(a => a.id === asset.id);
  const folder = path.join(repoRoot, 'art/poc/spawn-structure/blender', label, asset.id);
  const size = spec.sourceSizes[0];
  const canvasCells = settings[asset.cells];
  if (canvasCells * 32 !== spec.targetSize) throw Error(`${asset.id}: rendered canvas does not match the catalog`);
  const color = [], passes = Object.fromEntries(Object.keys(asset.emissive).map(name => [name, []])), frames = [], masters = [];
  for (const state of asset.states) for (const outlet of OUTLETS) {
    const beautyFile = path.join(folder, `${state}-${outlet}.png`), emitFile = path.join(folder, `${state}-${outlet}-emit.png`);
    const beauty = await readFile(beautyFile);
    color.push(await sharp(beauty).resize(size, size).png().toBuffer());
    for (const name of Object.keys(asset.emissive)) passes[name].push(await emissionMask(emitFile, size));
    frames.push({ index: frames.length, state, outlet, ...(asset.id === 'spawn-structure' ? { sockets: settings.sockets } : {}) });
    masters.push({ state, outlet, beauty: hash(beauty), emit: hash(await readFile(emitFile)) });
  }
  const publicDir = `assets/sprites/pipeline-v2/${asset.id}`;
  const directory = path.join(repoRoot, 'public', publicDir);
  await mkdir(directory, { recursive: true });
  const sheet = await packSheet(color, size);
  const files = { 'idle.png': color[0], 'sheet.png': sheet.buffer };
  const emissiveEntries = {};
  for (const [name, frameBuffers] of Object.entries(passes)) {
    const packed = await packSheet(frameBuffers, size);
    files[`emissive-${name}.png`] = packed.buffer;
    emissiveEntries[name] = { key: `${asset.textureKey}_emissive_${name}`, path: `./${publicDir}/emissive-${name}.png`,
      sha256: hash(packed.buffer), content: asset.emissive[name] };
  }
  for (const [name, data] of Object.entries(files)) await writeFile(path.join(directory, name), data);
  const runtime = {
    id: asset.id, category: spec.category, gameIds: spec.gameIds, revision: label, variant: 'standard', sourceSize: size,
    textureKey: asset.textureKey, sheetTextureKey: `${asset.textureKey}_sheet`,
    runtimeContract: 'sheet', forward: spec.forward, pivot: spec.pivot, idleFrame: 0,
    idlePath: `./${publicDir}/idle.png`, sheetPath: `./${publicDir}/sheet.png`, layout: sheet.layout, clips: [],
    hashes: { idle: hash(files['idle.png']), sheet: hash(sheet.buffer) },
  };
  registry.assets = [...registry.assets.filter(a => a.id !== asset.id), runtime];
  await writeFile(path.join(directory, 'draft-source.json'), JSON.stringify({
    quality: 'blender-render-draft', targetSize: spec.targetSize, masters, runtime,
    sources: 'scripts/asset-pipeline/spawn-carcass (README.md)',
    export: { script: 'scripts/asset-pipeline/export-spawn-structure.mjs blender', sharp: sharp.versions },
  }, null, 2) + '\n');
  console.log(`${publicDir}: ${color.length} frames of ${size}px, sheet ${sheet.layout.width}x${sheet.layout.height}`);
  return {
    id: asset.id, displaySize: spec.targetSize, sourceSize: size, canvasCells,
    textureKey: runtime.textureKey, sheetTextureKey: runtime.sheetTextureKey, layout: sheet.layout,
    states: asset.states, outlets: OUTLETS, frameOrder: 'index = stateIndex * outlets.length + outletIndex',
    emissive: emissiveEntries, frames,
  };
}

async function exportCarcass(label) {
  const catalog = (await readDemandCatalog(repoRoot)).assets;
  const registry = await readPipelineRegistry(repoRoot);
  const settings = JSON.parse(await readFile(path.join(repoRoot, 'art/poc/spawn-structure/blender', label, 'export.json'), 'utf8'));
  const building = await exportCarcassAsset(CARCASS.building, label, catalog, registry, settings);
  const pit = await exportCarcassAsset(CARCASS.pit, label, catalog, registry, settings);
  await writePipelineRegistry(repoRoot, registry);
  const manifest = {
    version: 1, revision: label,
    pivot: 'both canvases are centred on the brood nest centre at 32 px per world cell',
    rotation: 'baked: one frame per opening, rendered with a fixed sun',
    emissiveEncoding: 'white RGB, alpha = emission intensity; congruent with the sheet layout; tint and blend (ADD) at runtime',
    sockets: 'normalized full-canvas x/y (0..1, y down) of the south-facing building frame',
    building, pit,
  };
  await writeFile(path.join(repoRoot, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest ${MANIFEST}`);
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: { label: { type: 'string' } } });
const label = identifier(values.label);
if (positionals[0] === 'blender') await exportCarcass(label);
else throw Error('Usage: export-spawn-structure.mjs blender --label <prefix>');
