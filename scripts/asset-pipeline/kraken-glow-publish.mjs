// Publishes a complete, verified kraken glow-point run (kraken-glow-points.mjs + kraken-glow-boards.mjs):
// copies each glow-points.bin to public/assets/sprites/pipeline-v2/<id>/glow/points.bin and writes its entry in
// src/config/krakenGlowPoints.json (read by src/effects/kraken/KrakenGlowPoints.ts). Registry assets and atlases stay untouched.
// node scripts/asset-pipeline/kraken-glow-publish.mjs --revision kraken-v14-glow-<n> [--runs art/poc/pipeline-v2/runs]
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { KRAKEN_GLOW_ASSETS, KRAKEN_GLOW_REVISION } from './kraken-glow-common.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const revision = arg('--revision');
if (!KRAKEN_GLOW_REVISION.test(revision ?? '')) throw Error('Expected --revision kraken-v14-glow-<n>');
const runs = path.resolve(arg('--runs') ?? 'art/poc/pipeline-v2/runs');
const sha = buffer => createHash('sha256').update(buffer).digest('hex');
const indexFile = 'src/config/krakenGlowPoints.json';

const verification = JSON.parse(await fs.readFile(path.join(runs, revision, 'verification.json'), 'utf8'));
if (!verification.passed || verification.preview) throw Error('Run kraken-glow-boards.mjs on the full run first; its verification must pass');
const index = JSON.parse(await fs.readFile(indexFile, 'utf8'));
if (index.version !== 1) throw Error('Unknown glow index version');
const staged = [];
for (const [, id] of KRAKEN_GLOW_ASSETS) {
  const asset = JSON.parse(await fs.readFile(path.resolve('src/config/pipelineAssets/assets', `${id}.json`), 'utf8'));
  const out = path.join(runs, revision, id, asset.variant);
  const result = JSON.parse(await fs.readFile(path.join(out, 'glow-points.json'), 'utf8'));
  // krakenGlowPointEntry only accepts the selected revision and variant; refuse to publish anything else.
  if (result.sourceRevision !== asset.revision || result.variant !== asset.variant || result.revision !== revision) {
    throw Error(`${id}: glow points are for ${result.sourceRevision}/${result.variant}, the registry selects ${asset.revision}/${asset.variant}`);
  }
  const bin = await fs.readFile(path.join(out, result.file));
  if (!result.complete || result.frames.length !== asset.socketFrames.length || sha(bin) !== result.sha256 || bin.length !== result.bytes
      || !verification.assets.some(a => a.id === id && Object.values(a.checks).every(Boolean))) {
    throw Error(`${id}: incomplete or unverified glow points`);
  }
  const file = `./assets/sprites/pipeline-v2/${id}/glow/points.bin`;
  staged.push({ id, bin, target: path.join('public', file), entry: { revision: asset.revision, variant: asset.variant, file,
    sha256: result.sha256, bytes: result.bytes, frames: result.frames } });
}
for (const { id, bin, target, entry } of staged) {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, bin);
  index.assets[id] = entry;
  console.log(`${id}: ${entry.bytes / 10} points, ${entry.frames.length} poses -> ${target}`);
}
index.assets = Object.fromEntries(Object.entries(index.assets).sort(([a], [b]) => (a < b ? -1 : 1)));
// One [first, count] pair per line keeps the index readable and its diffs local.
await fs.writeFile(indexFile, JSON.stringify(index, null, 2).replace(/\[\n\s+(\d+),\n\s+(\d+)\n\s+\]/g, '[$1, $2]') + '\n');
console.log(indexFile);
