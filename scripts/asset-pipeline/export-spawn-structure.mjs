// Spawn structure (GDD Spawnbauwerk V1): the building and its brood pit as two congruent sheet assets.
//   node scripts/asset-pipeline/export-spawn-structure.mjs render --label <prefix> [--blender <exe>]
//   node scripts/asset-pipeline/export-spawn-structure.mjs export --label <prefix>
//   node scripts/asset-pipeline/export-spawn-structure.mjs painted --label <prefix>
//   node scripts/asset-pipeline/export-spawn-structure.mjs blender --label <prefix>
// `blender` packs the Blender carcass layers (scripts/asset-pipeline/spawn-carcass): a frame per state and opening.
// `painted` packs the Brutkadaver layers cut from the concept image (spawn-structure-painted.py):
// one frame per state, opening south; the runtime turns the canvases toward the other openings.
// Render uses the normal preview runner (same camera, lights, materials) once per frame variant and
// structure-passes.py for the emissive layers and sockets. Export never re-renders. Both assets share
// the pivot (pit centre) and the scale (32 px per Blender unit), so the runtime stacks them exactly.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { packSheet } from './export-v2.mjs';
import { preview, resolveBlender, renderProcess, repoRoot } from './preview-v2.mjs';
import { readDemandCatalog, readPipelineRegistry, writePipelineRegistry } from './pipeline-registry.mjs';

const MANIFEST = 'src/assets/manifests/spawn-structure.json';
const ASSETS = {
  building: {
    id: 'spawn-structure', textureKey: 'construction_spawn_structure', states: ['intact', 'damaged', 'rubble'],
    outlets: ['north', 'east', 'south', 'west'],
    layers: { rim: ['Void rim seam'], veins: ['Void brood vein'], core: ['Void brood heart', 'Spent void residue'] },
    sockets: { mouth: 'Spawn structure mouth socket', core: 'Brood heart socket' },
    content: { rim: 'dashed violet light strips along every edge of the U (hostile base style); none in rubble',
      veins: 'brood veins along both arms toward the pit', core: 'brood heart slit; spent residue in rubble' },
  },
  pit: {
    id: 'spawn-brood-pit', textureKey: 'construction_spawn_brood_pit', states: ['sealed', 'active', 'dry'], outlets: [null],
    layers: { glow: ['Brood pool glow'] }, sockets: { orifice: 'Brood orifice socket' },
    content: { glow: 'faint depth glow in the brood pool; none when sealed or dry' },
  },
};
const hash = data => createHash('sha256').update(data).digest('hex');
const identifier = value => { if (!/^[a-z0-9][a-z0-9-]*$/.test(value ?? '')) throw Error(`Invalid label: ${value}`); return value; };
const variantName = (state, outlet) => outlet ? `${state}-${outlet}` : state;
const previewFolder = (asset, label, state, outlet) => path.join(repoRoot, 'art/poc/pipeline-v2/previews', `${label}-${variantName(state, outlet)}`, asset.id);
const exists = file => access(file).then(() => true, () => false);

async function render(label, blenderPath) {
  const catalog = (await readDemandCatalog(repoRoot)).assets;
  const blender = await resolveBlender(blenderPath);
  for (const asset of Object.values(ASSETS)) {
    const spec = catalog.find(a => a.id === asset.id);
    const work = path.join(repoRoot, 'art/poc/spawn-structure/patches', label, asset.id);
    await mkdir(work, { recursive: true });
    const layers = path.join(work, 'layers.json');
    await writeFile(layers, JSON.stringify({ layers: asset.layers, sockets: asset.sockets }, null, 2) + '\n');
    for (const state of asset.states) for (const outlet of asset.outlets) {
      const folder = previewFolder(asset, label, state, outlet);
      if (!await exists(path.join(folder, 'preview.json'))) {
        const patch = path.join(work, `${variantName(state, outlet)}.json`);
        await writeFile(patch, JSON.stringify({ [asset.id]: { model: { ...spec.model, state, ...(outlet ? { outlet } : {}) } } }, null, 2) + '\n');
        await preview([asset.id, '--patch', patch, '--label', `${label}-${variantName(state, outlet)}`]);
      }
      if (!await exists(path.join(folder, 'sockets.json'))) {
        await renderProcess(blender, ['--background', '--factory-startup', path.join(folder, 'preview.blend'), '--python-exit-code', '1',
          '--python', path.join(repoRoot, 'scripts/asset-pipeline/structure-passes.py'), '--', folder, layers], path.join(folder, 'passes.log'), repoRoot);
      }
      console.log(`${asset.id} ${variantName(state, outlet)}: ${path.relative(repoRoot, folder)}`);
    }
  }
}

/**
 * White RGB, alpha = authored emission intensity (max channel), so the runtime tints it freely.
 * Multiplied by the beauty coverage: the denoiser must not carry glow outside the structure.
 */
async function emissive(file, beauty, size) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const cover = await sharp(beauty).ensureAlpha().extractChannel(3).raw().toBuffer();
  if (cover.length !== info.width * info.height) throw Error(`Emission/beauty size mismatch: ${file}`);
  const out = Buffer.alloc(info.width * info.height * 4, 255);
  for (let i = 0, j = 0, k = 0; i < data.length; i += 3, j += 4, k++) {
    out[j + 3] = Math.round(Math.max(data[i], data[i + 1], data[i + 2]) * cover[k] / 255);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).resize(size, size).png().toBuffer();
}

async function exportAsset(asset, label, catalog, registry) {
  const spec = catalog.find(a => a.id === asset.id);
  const size = spec.sourceSizes[0];
  const color = [], passes = Object.fromEntries(Object.keys(asset.layers).map(name => [name, []])), frames = [], masters = [];
  for (const state of asset.states) for (const outlet of asset.outlets) {
    const folder = previewFolder(asset, label, state, outlet);
    const manifest = JSON.parse(await readFile(path.join(folder, 'preview.json'), 'utf8'));
    if (manifest.id !== asset.id || manifest.spec.model.state !== state || (outlet && manifest.spec.model.outlet !== outlet)
      || manifest.spec.orthoScale !== spec.orthoScale || manifest.spec.targetSize !== spec.targetSize) throw Error(`Unexpected preview: ${folder}`);
    const beauty = await readFile(path.join(folder, 'frame-0000.png'));
    color.push(await sharp(beauty).resize(size, size).png().toBuffer());
    const master = { state, ...(outlet ? { outlet } : {}), previewInputHash: manifest.inputHash, beauty: hash(beauty) };
    for (const name of Object.keys(asset.layers)) {
      const file = path.join(folder, `emission-${name}.png`);
      passes[name].push(await emissive(file, beauty, size));
      master[`emission-${name}`] = hash(await readFile(file));
    }
    const sockets = JSON.parse(await readFile(path.join(folder, 'sockets.json'), 'utf8'));
    frames.push({ index: frames.length, state, ...(outlet ? { outlet } : {}), sockets });
    masters.push(master);
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
      sha256: hash(packed.buffer), content: asset.content[name] };
  }
  for (const [name, data] of Object.entries(files)) await writeFile(path.join(directory, name), data);
  const runtime = {
    id: asset.id, category: spec.category, gameIds: spec.gameIds, revision: label, variant: 'standard', sourceSize: size,
    textureKey: asset.textureKey, sheetTextureKey: `${asset.textureKey}_sheet`,
    runtimeContract: 'sheet', forward: spec.forward, pivot: spec.pivot, idleFrame: 0,
    idlePath: `./${publicDir}/idle.png`, sheetPath: `./${publicDir}/sheet.png`, layout: sheet.layout, clips: [],
    hashes: { idle: hash(color[0]), sheet: hash(sheet.buffer) },
  };
  registry.assets = [...registry.assets.filter(a => a.id !== asset.id), runtime];
  await writeFile(path.join(directory, 'draft-source.json'), JSON.stringify({
    quality: 'accepted-authoring-preview', targetSize: spec.targetSize, masters, runtime, textures: spec.textures,
    export: { script: 'scripts/asset-pipeline/export-spawn-structure.mjs', passes: 'scripts/asset-pipeline/structure-passes.py', sharp: sharp.versions },
  }, null, 2) + '\n');
  console.log(`${publicDir}: ${color.length} frames of ${size}px, sheet ${sheet.layout.width}x${sheet.layout.height}`);
  return {
    id: asset.id, displaySize: spec.targetSize, sourceSize: size, canvasCells: spec.orthoScale,
    textureKey: runtime.textureKey, sheetTextureKey: runtime.sheetTextureKey, layout: sheet.layout,
    states: asset.states, ...(asset.outlets[0] ? { outlets: asset.outlets, frameOrder: 'index = stateIndex * outlets.length + outletIndex' }
      : { frameOrder: 'index = stateIndex' }),
    emissive: emissiveEntries, frames,
  };
}

async function exportSheets(label) {
  const catalog = (await readDemandCatalog(repoRoot)).assets;
  const registry = await readPipelineRegistry(repoRoot);
  const building = await exportAsset(ASSETS.building, label, catalog, registry);
  const pit = await exportAsset(ASSETS.pit, label, catalog, registry);
  await writePipelineRegistry(repoRoot, registry);
  const manifest = {
    version: 1, revision: label,
    pivot: 'both canvases are centred on the brood pit centre; one Blender unit is one 32 px world cell',
    emissiveEncoding: 'white RGB, alpha = emission intensity; congruent with the sheet layout; tint and blend (ADD) at runtime',
    sockets: 'normalized full-canvas x/y (0..1, y down), z in Blender units',
    building, pit,
  };
  await mkdir(path.dirname(path.join(repoRoot, MANIFEST)), { recursive: true });
  await writeFile(path.join(repoRoot, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest ${MANIFEST}`);
}

const PAINTED = {
  building: { ...ASSETS.building, outlets: [null],
    content: { rim: 'the flank facing the nest catches its violet light', veins: 'torn hide and crevices, pulse with an announced release',
      core: 'violet flesh in the tears; spent residue in rubble' } },
  pit: { ...ASSETS.pit, content: { glow: 'egg highlights and creep veins; none when dry' } },
};

/** One painted asset: congruent colour and emissive frames per state, already at source size. */
async function exportPaintedAsset(asset, label, catalog, registry) {
  const spec = catalog.find(a => a.id === asset.id);
  const folder = path.join(repoRoot, 'art/poc/spawn-structure/painted', label, asset.id);
  const { canvasCells, sourceSize: size, sockets } = JSON.parse(await readFile(path.join(folder, 'sockets.json'), 'utf8'));
  if (size !== spec.sourceSizes[0] || canvasCells * 32 !== spec.targetSize) throw Error(`${asset.id}: painted canvas does not match the catalog`);
  const color = [], passes = Object.fromEntries(Object.keys(asset.content).map(name => [name, []])), frames = [], masters = [];
  for (const state of asset.states) {
    const beauty = await readFile(path.join(folder, `${state}.png`));
    const meta = await sharp(beauty).metadata();
    if (meta.width !== size || meta.height !== size) throw Error(`${asset.id}/${state}: expected ${size}px`);
    color.push(beauty);
    const master = { state, beauty: hash(beauty) };
    for (const name of Object.keys(asset.content)) {
      const pass = await readFile(path.join(folder, `${state}-emission-${name}.png`));
      passes[name].push(pass);
      master[`emission-${name}`] = hash(pass);
    }
    frames.push({ index: frames.length, state, sockets });
    masters.push(master);
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
      sha256: hash(packed.buffer), content: asset.content[name] };
  }
  for (const [name, data] of Object.entries(files)) await writeFile(path.join(directory, name), data);
  const runtime = {
    id: asset.id, category: spec.category, gameIds: spec.gameIds, revision: label, variant: 'standard', sourceSize: size,
    textureKey: asset.textureKey, sheetTextureKey: `${asset.textureKey}_sheet`,
    runtimeContract: 'sheet', forward: spec.forward, pivot: spec.pivot, idleFrame: 0,
    idlePath: `./${publicDir}/idle.png`, sheetPath: `./${publicDir}/sheet.png`, layout: sheet.layout, clips: [],
    hashes: { idle: hash(color[0]), sheet: hash(sheet.buffer) },
  };
  registry.assets = [...registry.assets.filter(a => a.id !== asset.id), runtime];
  await writeFile(path.join(directory, 'draft-source.json'), JSON.stringify({
    quality: 'painted-concept-cut', targetSize: spec.targetSize, masters, runtime, sources: 'tools/source-art/spawn-structure',
    export: { script: 'scripts/asset-pipeline/export-spawn-structure.mjs painted', cut: 'scripts/asset-pipeline/spawn-structure-painted.py', sharp: sharp.versions },
  }, null, 2) + '\n');
  console.log(`${publicDir}: ${color.length} frames of ${size}px, sheet ${sheet.layout.width}x${sheet.layout.height}`);
  return {
    id: asset.id, displaySize: spec.targetSize, sourceSize: size, canvasCells,
    textureKey: runtime.textureKey, sheetTextureKey: runtime.sheetTextureKey, layout: sheet.layout,
    states: asset.states, frameOrder: 'index = stateIndex', emissive: emissiveEntries, frames,
  };
}

async function exportPainted(label) {
  const catalog = (await readDemandCatalog(repoRoot)).assets;
  const registry = await readPipelineRegistry(repoRoot);
  const building = await exportPaintedAsset(PAINTED.building, label, catalog, registry);
  const pit = await exportPaintedAsset(PAINTED.pit, label, catalog, registry);
  await writePipelineRegistry(repoRoot, registry);
  const manifest = {
    version: 1, revision: label,
    pivot: 'both canvases are centred on the brood nest centre at 32 px per world cell, opening south',
    rotation: 'runtime: turn both canvases clockwise by quarter turns toward the outlet (src/config/spawnStructure.ts)',
    emissiveEncoding: 'white RGB, alpha = emission intensity; congruent with the sheet layout; tint and blend (ADD) at runtime',
    sockets: 'normalized full-canvas x/y (0..1, y down) of the south-facing canvas',
    building, pit,
  };
  await writeFile(path.join(repoRoot, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`manifest ${MANIFEST}`);
}

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

const { values, positionals } = parseArgs({ allowPositionals: true, options: { label: { type: 'string' }, blender: { type: 'string' } } });
const label = identifier(values.label);
if (positionals[0] === 'render') await render(label, values.blender);
else if (positionals[0] === 'export') await exportSheets(label);
else if (positionals[0] === 'painted') await exportPainted(label);
else if (positionals[0] === 'blender') await exportCarcass(label);
else throw Error('Usage: export-spawn-structure.mjs render|export|painted|blender --label <prefix>');
