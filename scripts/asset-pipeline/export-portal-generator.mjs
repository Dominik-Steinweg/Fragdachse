// Portal generator: authoring previews per state/outlet, then a sheet plus congruent emissive sheets.
//   node scripts/asset-pipeline/export-portal-generator.mjs render --label <prefix> [--blender <exe>]
//   node scripts/asset-pipeline/export-portal-generator.mjs export --label <prefix>
// Render uses the normal preview runner (same camera, lights, materials) once per state x outlet and
// portal-generator-passes.py for the emissive layers and sockets. Export never re-renders.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import sharp from 'sharp';
import { packSheet } from './export-v2.mjs';
import { preview, resolveBlender, renderProcess, repoRoot } from './preview-v2.mjs';
import { readDemandCatalog, readPipelineRegistry, writePipelineRegistry } from './pipeline-registry.mjs';

export const STATES = ['intact', 'damaged', 'rubble'];
export const OUTLETS = ['north', 'east', 'south', 'west'];
const ID = 'portal-generator';
const PUBLIC = `assets/sprites/pipeline-v2/${ID}`;
const MANIFEST = 'src/assets/manifests/portal-generator.json';
const hash = data => createHash('sha256').update(data).digest('hex');
const identifier = value => { if (!/^[a-z0-9][a-z0-9-]*$/.test(value ?? '')) throw Error(`Invalid label: ${value}`); return value; };
const previewFolder = (label, state, outlet) => path.join(repoRoot, 'art/poc/pipeline-v2/previews', `${label}-${state}-${outlet}`, ID);
const exists = file => access(file).then(() => true, () => false);

async function render(label, blenderPath) {
  const spec = (await readDemandCatalog(repoRoot)).assets.find(a => a.id === ID);
  const blender = await resolveBlender(blenderPath);
  const patches = path.join(repoRoot, 'art/poc/portal-generator/patches', label);
  await mkdir(patches, { recursive: true });
  for (const state of STATES) for (const outlet of OUTLETS) {
    const folder = previewFolder(label, state, outlet);
    if (!await exists(path.join(folder, 'preview.json'))) {
      const patch = path.join(patches, `${state}-${outlet}.json`);
      await writeFile(patch, JSON.stringify({ [ID]: { model: { ...spec.model, state, outlet } } }, null, 2) + '\n');
      await preview([ID, '--patch', patch, '--label', `${label}-${state}-${outlet}`]);
    }
    if (!await exists(path.join(folder, 'sockets.json'))) {
      await renderProcess(blender, ['--background', '--factory-startup', path.join(folder, 'preview.blend'), '--python-exit-code', '1',
        '--python', path.join(repoRoot, 'scripts/asset-pipeline/portal-generator-passes.py'), '--', folder], path.join(folder, 'passes.log'), repoRoot);
    }
    console.log(`${state}/${outlet}: ${path.relative(repoRoot, folder)}`);
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

async function exportSheets(label) {
  const spec = (await readDemandCatalog(repoRoot)).assets.find(a => a.id === ID);
  const size = spec.sourceSizes[0];
  const color = [], core = [], flow = [], frames = [], masters = [];
  for (const state of STATES) for (const outlet of OUTLETS) {
    const folder = previewFolder(label, state, outlet);
    const manifest = JSON.parse(await readFile(path.join(folder, 'preview.json'), 'utf8'));
    if (manifest.id !== ID || manifest.spec.model.state !== state || manifest.spec.model.outlet !== outlet
      || manifest.spec.orthoScale !== spec.orthoScale || manifest.spec.targetSize !== spec.targetSize) throw Error(`Unexpected preview: ${folder}`);
    const beauty = await readFile(path.join(folder, 'frame-0000.png'));
    color.push(await sharp(beauty).resize(size, size).png().toBuffer());
    core.push(await emissive(path.join(folder, 'emission-core.png'), beauty, size));
    flow.push(await emissive(path.join(folder, 'emission-flow.png'), beauty, size));
    const sockets = JSON.parse(await readFile(path.join(folder, 'sockets.json'), 'utf8'));
    frames.push({ index: frames.length, state, outlet, sockets });
    masters.push({ state, outlet, previewInputHash: manifest.inputHash, beauty: hash(beauty),
      emissionCore: hash(await readFile(path.join(folder, 'emission-core.png'))),
      emissionFlow: hash(await readFile(path.join(folder, 'emission-flow.png'))) });
  }
  const sheet = await packSheet(color, size), coreSheet = await packSheet(core, size), flowSheet = await packSheet(flow, size);
  const directory = path.join(repoRoot, 'public', PUBLIC);
  await mkdir(directory, { recursive: true });
  const files = { 'idle.png': color[0], 'sheet.png': sheet.buffer, 'emissive-core.png': coreSheet.buffer, 'emissive-flow.png': flowSheet.buffer };
  for (const [name, data] of Object.entries(files)) await writeFile(path.join(directory, name), data);
  const runtime = {
    id: ID, category: spec.category, gameIds: spec.gameIds, revision: label, variant: 'standard', sourceSize: size,
    textureKey: 'construction_portal_generator', sheetTextureKey: 'construction_portal_generator_sheet',
    runtimeContract: 'sheet', forward: spec.forward, pivot: spec.pivot, idleFrame: 0,
    idlePath: `./${PUBLIC}/idle.png`, sheetPath: `./${PUBLIC}/sheet.png`, layout: sheet.layout, clips: [],
    hashes: { idle: hash(color[0]), sheet: hash(sheet.buffer) },
  };
  const registry = await readPipelineRegistry(repoRoot);
  registry.assets = [...registry.assets.filter(a => a.id !== ID), runtime];
  await writePipelineRegistry(repoRoot, registry);
  const manifest = {
    version: 1, id: ID, revision: label, displaySize: spec.targetSize, sourceSize: size,
    textureKey: runtime.textureKey, sheetTextureKey: runtime.sheetTextureKey, layout: sheet.layout,
    states: STATES, outlets: OUTLETS, frameOrder: 'index = stateIndex * outlets.length + outletIndex',
    emissive: {
      encoding: 'white RGB, alpha = emission intensity; congruent with sheet layout; tint and blend (ADD) at runtime',
      core: { key: 'construction_portal_generator_emissive_core', path: `./${PUBLIC}/emissive-core.png`, sha256: hash(coreSheet.buffer),
        content: 'resonance core, halo seam, coil tips, leaking crystal splinters; spent residue in rubble' },
      flow: { key: 'construction_portal_generator_emissive_flow', path: `./${PUBLIC}/emissive-flow.png`, sha256: hash(flowSheet.buffer),
        content: 'conduit flow slot, rupture discharge and emitter discharge slit; empty in rubble' },
    },
    sockets: 'normalized full-canvas x/y (0..1, y down), z in Blender units; outlet = emitter front toward the portal entry',
    frames,
  };
  await mkdir(path.dirname(path.join(repoRoot, MANIFEST)), { recursive: true });
  await writeFile(path.join(repoRoot, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  await writeFile(path.join(directory, 'draft-source.json'), JSON.stringify({
    quality: 'accepted-authoring-preview', targetSize: spec.targetSize, masters, runtime,
    textures: spec.textures, export: { script: 'scripts/asset-pipeline/export-portal-generator.mjs', passes: 'scripts/asset-pipeline/portal-generator-passes.py', sharp: sharp.versions },
  }, null, 2) + '\n');
  console.log(`${PUBLIC}: ${color.length} frames of ${size}px, sheet ${sheet.layout.width}x${sheet.layout.height}, manifest ${MANIFEST}`);
}

const { values, positionals } = parseArgs({ allowPositionals: true, options: { label: { type: 'string' }, blender: { type: 'string' } } });
const label = identifier(values.label);
if (positionals[0] === 'render') await render(label, values.blender);
else if (positionals[0] === 'export') await exportSheets(label);
else throw Error('Usage: export-portal-generator.mjs render|export --label <prefix>');
