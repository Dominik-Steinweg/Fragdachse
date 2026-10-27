// Persistent base fort and outpost kit: render their passes in Blender, publish runtime files.
// node scripts/asset-pipeline/export-base-structures.mjs --label <revision> [--samples 64] [--publish] [--skip-render] [--kit]
// --kit renders the 47-mask outpost kit (fort style, one frame per mask on a 2 m pitch, three variants) instead of the core.
// Renders go to <worktree>/build/base-rustic/runs/<label>/{structure,ground}/. --publish copies the passes to
// public/assets/sprites/pipeline-v2/base-fort-core/ and rewrites src/assets/manifests/base-structures.json.
// Sockets are game pixels relative to the core's centre cell; the art is symmetric under the core's quarter turns.
import { readFile, writeFile, mkdir, copyFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { repoRoot, resolveBlender, renderProcess } from './preview-v2.mjs';
import { digest, pythonSources } from './draft-v2.mjs';
import { deriveCasterHeight } from './export-lobby-structures.mjs';

const CELL = 32;
const ASSET = 'base-fort-core';
/** Core canvas: 11 m square round the centre cell, 64 source px per metre, shown at 32 px per metre. */
const CORE = { orthoScale: 11, sourceSize: 704, displaySize: 352, elevation: { min: 0, max: 2.4, scale: .5 }, deck: 1.25 };

/** Kit sheet: 7 x 7 frames of 2 m, one per corner-suppressed mask, cell centred in its frame. */
const KIT = { asset: 'base-fort-kit', variants: 3, columns: 7, framePx: 64, orthoScale: 14, sourceSize: 896, displaySize: 448,
  elevation: { min: 0, max: 2.4, scale: .5 }, deck: 1.2 };
const N = 1, NE = 2, E = 4, SE = 8, S = 16, SW = 32, W = 64, NW = 128;

/** The 47 corner-suppressed 8-neighbour masks in ascending order (base_structure_parts.all_masks). */
function allMasks() {
  const found = new Set();
  for (let bits = 0; bits < 256; bits++) {
    let mask = bits & (N | E | S | W);
    if (bits & N && bits & E && bits & NE) mask |= NE;
    if (bits & S && bits & E && bits & SE) mask |= SE;
    if (bits & S && bits & W && bits & SW) mask |= SW;
    if (bits & N && bits & W && bits & NW) mask |= NW;
    found.add(mask);
  }
  return [...found].sort((a, b) => a - b);
}

const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const exists = file => access(file).then(() => true, () => false);

async function main() {
  const { values } = parseArgs({ options: {
    label: { type: 'string' }, samples: { type: 'string', default: '64' }, device: { type: 'string', default: 'OPTIX' },
    blender: { type: 'string' }, publish: { type: 'boolean' }, 'skip-render': { type: 'boolean' }, kit: { type: 'boolean' },
  } });
  if (values.kit) return exportKit(values);
  if (!values.label || !/^[a-z0-9][a-z0-9-]*$/.test(values.label)) throw Error('--label <revision> required (lowercase-kebab)');
  const runs = path.join(repoRoot, 'build/base-rustic/runs', values.label);
  const base = JSON.parse(await readFile(path.join(repoRoot, 'scripts/asset-pipeline/catalog-v2/assets/base-structure.json'), 'utf8'));
  const spec = { ...base, clips: [], requiredClips: [], orthoScale: CORE.orthoScale, sourceSizes: [CORE.sourceSize],
    targetSize: CORE.displaySize, elevation: CORE.elevation,
    model: { ...base.model, style: 'fort', layout: 'core', master: true, ground: 'gravel', conceptGround: false } };
  if (!values['skip-render']) {
    const blender = await resolveBlender(values.blender);
    const sources = await pythonSources(repoRoot, `recipes_v2/${spec.recipe}.py`);
    sources['base-structure-shapes.json'] = await readFile(path.join(repoRoot, 'scripts/asset-pipeline/base-structure-shapes.json'), 'utf8');
    const modelHash = digest({ spec, sources });
    for (const part of ['structure', 'ground']) {
      const run = path.join(runs, part);
      await mkdir(run, { recursive: true });
      const job = { spec, part, modelHash, model: path.join(runs, '.models', modelHash + '.blend'), output: run, size: CORE.sourceSize,
        settings: { samples: Number(values.samples), device: values.device, denoise: true } };
      await writeFile(path.join(run, 'job.json'), JSON.stringify(job, null, 2));
      const started = performance.now();
      await renderProcess(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python',
        path.join(repoRoot, 'scripts/asset-pipeline/base-structure-passes.py'), '--', path.join(run, 'job.json')],
        path.join(run, 'blender.log'), repoRoot);
      console.log(`${part}: rendered in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    }
  }
  const structure = path.join(runs, 'structure'), ground = path.join(runs, 'ground');
  const passes = JSON.parse(await readFile(path.join(structure, 'passes.json'), 'utf8'));
  await writeFile(path.join(structure, 'caster-height.png'), await deriveCasterHeight(structure, CORE.displaySize));
  if (!values.publish) return;
  const target = path.join(repoRoot, 'public/assets/sprites/pipeline-v2', ASSET);
  await mkdir(target, { recursive: true });
  const files = { beauty: [structure, 'top.png'], albedo: [structure, 'color.png'], elevation: [structure, 'elevation.png'],
    solid: [structure, 'solid.png'], 'caster-height': [structure, 'caster-height.png'], ground: [ground, 'color.png'],
    ...Object.fromEntries(passes.layers.map(layer => [`emission-${layer}`, [structure, `emission-${layer}.png`]])) };
  const hashes = {};
  for (const [name, [dir, file]] of Object.entries(files)) {
    hashes[name] = sha(await readFile(path.join(dir, file)));
    await copyFile(path.join(dir, file), path.join(target, name + '.png'));
  }
  const manifestFile = path.join(repoRoot, 'src/assets/manifests/base-structures.json');
  const manifest = await exists(manifestFile) ? JSON.parse(await readFile(manifestFile, 'utf8')) : { structures: {} };
  const half = CORE.displaySize / 2;
  manifest.revision = values.label;
  manifest.structures['persistent-core'] = {
    asset: ASSET, sourceSize: CORE.sourceSize, displaySize: CORE.displaySize,
    heightPx: { min: CORE.elevation.min * CELL, max: CORE.elevation.max * CELL }, deckPx: CORE.deck * CELL,
    layers: passes.layers,
    sockets: Object.fromEntries(Object.entries(passes.sockets).map(([name, s]) => [name, {
      x: Math.round((s.x * CORE.displaySize - half) * 10) / 10, y: Math.round((s.y * CORE.displaySize - half) * 10) / 10,
      z: Math.round(s.z * CELL * 10) / 10 }])),
    sha256: hashes,
  };
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log('published', manifestFile, Object.keys(manifest.structures['persistent-core'].sockets).length, 'sockets');
}

async function exportKit(values) {
  const runs = path.join(repoRoot, 'build/base-rustic/runs', values.label);
  const base = JSON.parse(await readFile(path.join(repoRoot, 'scripts/asset-pipeline/catalog-v2/assets/base-structure.json'), 'utf8'));
  const masks = allMasks();
  const blender = values['skip-render'] ? null : await resolveBlender(values.blender);
  const variants = [];
  for (let variant = 0; variant < KIT.variants; variant++) {
    const spec = { ...base, clips: [], requiredClips: [], orthoScale: KIT.orthoScale, sourceSizes: [KIT.sourceSize],
      targetSize: KIT.displaySize, elevation: KIT.elevation,
      model: { ...base.model, style: 'fort', layout: 'kit', variant, master: false, conceptGround: false } };
    const run = path.join(runs, `kit-v${variant}`);
    if (blender) {
      const sources = await pythonSources(repoRoot, `recipes_v2/${spec.recipe}.py`);
      sources['base-structure-shapes.json'] = await readFile(path.join(repoRoot, 'scripts/asset-pipeline/base-structure-shapes.json'), 'utf8');
      const modelHash = digest({ spec, sources });
      await mkdir(run, { recursive: true });
      const job = { spec, part: 'structure', modelHash, model: path.join(runs, '.models', modelHash + '.blend'), output: run, size: KIT.sourceSize,
        settings: { samples: Number(values.samples), device: values.device, denoise: true } };
      await writeFile(path.join(run, 'job.json'), JSON.stringify(job, null, 2));
      const started = performance.now();
      await renderProcess(blender, ['--background', '--factory-startup', '--python-exit-code', '1', '--python',
        path.join(repoRoot, 'scripts/asset-pipeline/base-structure-passes.py'), '--', path.join(run, 'job.json')],
        path.join(run, 'blender.log'), repoRoot);
      console.log(`kit variant ${variant}: rendered in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    }
    const passes = JSON.parse(await readFile(path.join(run, 'passes.json'), 'utf8'));
    await writeFile(path.join(run, 'caster-height.png'), await deriveCasterHeight(run, KIT.displaySize));
    // Sockets belong to the frame they stand in; positions are display px relative to that frame's cell centre.
    const frames = masks.map(mask => ({ mask, sockets: {} }));
    for (const [name, s] of Object.entries(passes.sockets)) {
      const x = s.x * KIT.displaySize, y = s.y * KIT.displaySize;
      const column = Math.floor(x / KIT.framePx), row = Math.floor(y / KIT.framePx), index = row * KIT.columns + column;
      if (!frames[index]) throw Error(`socket ${name} outside the kit frames`);
      frames[index].sockets[name] = { x: Math.round((x - (column + .5) * KIT.framePx) * 10) / 10,
        y: Math.round((y - (row + .5) * KIT.framePx) * 10) / 10, z: Math.round(s.z * CELL * 10) / 10 };
    }
    variants.push({ run, passes, frames, asset: `${KIT.asset}-v${variant}` });
  }
  if (!values.publish) return;
  const published = [];
  for (const { run, passes, frames, asset } of variants) {
    const target = path.join(repoRoot, 'public/assets/sprites/pipeline-v2', asset);
    await mkdir(target, { recursive: true });
    const files = { beauty: 'top.png', albedo: 'color.png', elevation: 'elevation.png', solid: 'solid.png', 'caster-height': 'caster-height.png',
      ...Object.fromEntries(passes.layers.map(layer => [`emission-${layer}`, `emission-${layer}.png`])) };
    const hashes = {};
    for (const [name, file] of Object.entries(files)) {
      hashes[name] = sha(await readFile(path.join(run, file)));
      await copyFile(path.join(run, file), path.join(target, name + '.png'));
    }
    published.push({ asset, frames, sha256: hashes });
  }
  const manifestFile = path.join(repoRoot, 'src/assets/manifests/base-structures.json');
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  manifest.structures['outpost-kit'] = {
    sourceSize: KIT.sourceSize, displaySize: KIT.displaySize,
    heightPx: { min: KIT.elevation.min * CELL, max: KIT.elevation.max * CELL }, deckPx: KIT.deck * CELL,
    layers: variants[0].passes.layers, columns: KIT.columns, framePx: KIT.framePx, variants: published,
  };
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log('published', published.length, 'kit variants', published.reduce((n, v) => n + v.frames.reduce((m, f) => m + Object.keys(f.sockets).length, 0), 0), 'sockets');
}

await main();
