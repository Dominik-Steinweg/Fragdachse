// Persistent base fort: render the structure and ground passes in Blender, publish runtime files.
// node scripts/asset-pipeline/export-base-structures.mjs --label <revision> [--samples 64] [--publish] [--skip-render]
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
const CORE = { orthoScale: 11, sourceSize: 704, displaySize: 352, elevation: { min: 0, max: 2.4, scale: .5 } };

const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const exists = file => access(file).then(() => true, () => false);

async function main() {
  const { values } = parseArgs({ options: {
    label: { type: 'string' }, samples: { type: 'string', default: '64' }, device: { type: 'string', default: 'OPTIX' },
    blender: { type: 'string' }, publish: { type: 'boolean' }, 'skip-render': { type: 'boolean' },
  } });
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
    heightPx: { min: CORE.elevation.min * CELL, max: CORE.elevation.max * CELL },
    layers: passes.layers,
    sockets: Object.fromEntries(Object.entries(passes.sockets).map(([name, s]) => [name, {
      x: Math.round((s.x * CORE.displaySize - half) * 10) / 10, y: Math.round((s.y * CORE.displaySize - half) * 10) / 10,
      z: Math.round(s.z * CELL * 10) / 10 }])),
    sha256: hashes,
  };
  await writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n');
  console.log('published', manifestFile, Object.keys(manifest.structures['persistent-core'].sockets).length, 'sockets');
}

await main();
