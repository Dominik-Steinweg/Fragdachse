// Publish the accepted relay draft through the V2 sheet packer; no HQ build or art/ writes.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { packSheet } from './export-v2.mjs';
import { readPipelineRegistry, writePipelineRegistry } from './pipeline-registry.mjs';

const source = path.resolve(process.argv[2] ?? 'D:/Fragdachse-render/fire-control/fire-control-relay/preview');
const preview = JSON.parse(await readFile(path.join(source, 'preview.json'), 'utf8'));
const catalog = JSON.parse(await readFile('scripts/asset-pipeline/catalog-v2.json', 'utf8'));
const spec = catalog.assets.find(a => a.id === 'fire-control-relay');
if (preview.id !== spec.id || preview.spec.orthoScale !== spec.orthoScale
  || preview.spec.targetSize !== spec.targetSize) throw Error('Unexpected relay draft');
const deploy = preview.clips.find(c => c.name === 'deploy');
const indices = [0, ...deploy.frames];
if (JSON.stringify(indices) !== JSON.stringify(preview.indices)) throw Error('Incomplete relay poses');
const hash = data => createHash('sha256').update(data).digest('hex');
const masters = await Promise.all(indices.map(i => readFile(path.join(source, `frame-${String(i).padStart(4, '0')}.png`))));
const size = spec.sourceSizes[0];
const frames = await Promise.all(masters.map(bytes => sharp(bytes).resize(size, size).png().toBuffer()));
const sheet = await packSheet(frames, size);
const directory = 'public/assets/sprites/pipeline-v2/fire-control-relay';
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'idle.png'), frames[0]);
await writeFile(path.join(directory, 'sheet.png'), sheet.buffer);
const runtime = {
  id: spec.id, category: spec.category, gameIds: spec.gameIds,
  revision: 'devices-relay-v2-runtime-draft', variant: 'standard', sourceSize: size,
  textureKey: 'fire_control_relay', sheetTextureKey: 'fire_control_relay_sheet',
  runtimeContract: 'sheet', forward: spec.forward, pivot: spec.pivot, idleFrame: 0,
  idlePath: './assets/sprites/pipeline-v2/fire-control-relay/idle.png',
  sheetPath: './assets/sprites/pipeline-v2/fire-control-relay/sheet.png',
  layout: sheet.layout,
  // Same sampled motion, stretched to the copies' 400 ms materialization. Quiet rest loop.
  clips: [{ name: 'deploy', frames: deploy.frames, frameRate: deploy.frames.length / .4, loop: false, start: 'free', end: 'rest' },
    { name: 'idle', frames: [0], frameRate: 1, loop: true, start: 'rest', end: 'rest' }],
  hashes: { idle: hash(frames[0]), sheet: hash(sheet.buffer) },
};
const registry = await readPipelineRegistry();
registry.assets = [...registry.assets.filter(a => a.id !== spec.id), runtime];
await writePipelineRegistry(process.cwd(), registry);
await writeFile(path.join(directory, 'draft-source.json'), JSON.stringify({
  quality: 'accepted-authoring-draft', previewInputHash: preview.inputHash, targetSize: spec.targetSize,
  masters: masters.map((data, i) => ({ frame: indices[i], sha256: hash(data) })),
  runtime, export: { script: 'scripts/asset-pipeline/export-fire-control-relay.mjs', sharp: sharp.versions },
}, null, 2) + '\n');
console.log(`${directory}: ${size}px frames, ${sheet.layout.width}x${sheet.layout.height} sheet, ${spec.targetSize}px world canvas`);
