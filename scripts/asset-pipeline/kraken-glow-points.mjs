// Kraken sucker glow points from the hash-pinned scenes of the selected revision (kraken_glow_points.py).
// node scripts/asset-pipeline/kraken-glow-points.mjs [--revision kraken-v14-glow-<n>] [--preview [role:clip:selector,...]]
//   [--resume] [--runs art/poc/pipeline-v2/runs] [--blender <exe>] [--only <asset id>]
// Never writes into the source revision; the output lands in <runs>/<revision>/<id>/standard[/preview].
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { GM1_SAMPLES, KRAKEN_GLOW_ASSETS, KRAKEN_GLOW_REVISION, KRAKEN_GLOW_SOURCE_REVISION as SOURCE_REVISION,
  masterPose, parseSamples } from './kraken-glow-common.mjs';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const flag = name => process.argv.includes(name);
const revision = arg('--revision') ?? 'kraken-v14-glow-1';
if (!KRAKEN_GLOW_REVISION.test(revision)) throw Error('Expected a kraken-v14-glow-<n> revision');
const runs = path.resolve(arg('--runs') ?? 'art/poc/pipeline-v2/runs');
const preview = flag('--preview') ? (arg('--preview') && !arg('--preview').startsWith('--') ? arg('--preview') : GM1_SAMPLES) : null;
const blender = arg('--blender') ?? process.env.BLENDER_PATH ?? 'blender';
const helper = path.resolve('scripts/asset-pipeline/kraken_glow_points.py');
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const samples = preview ? parseSamples(preview) : [];

for (const [role, id] of KRAKEN_GLOW_ASSETS) {
  if (arg('--only') && arg('--only') !== id) continue;
  if (preview && !samples.some(s => s.role === role)) continue;
  const registry = path.resolve('src/config/pipelineAssets/assets', `${id}.json`);
  const asset = JSON.parse(await fs.readFile(registry, 'utf8'));
  if (asset.revision !== SOURCE_REVISION || asset.variant !== 'standard') throw Error(`${id}: registry selects ${asset.revision}/${asset.variant}`);
  const source = path.join(runs, SOURCE_REVISION, id, asset.variant);
  const render = JSON.parse(await fs.readFile(path.join(source, 'render.json'), 'utf8'));
  const masterCount = asset.socketFrames.length;
  if (render.revision !== asset.revision || render.variant !== asset.variant || render.frames.length !== masterCount
      || Math.max(...asset.clips.flatMap(c => c.frames)) !== masterCount - 1
      || asset.clips.some(c => JSON.stringify(c.frames) !== JSON.stringify(render.clips.find(r => r.name === c.name)?.frames))) {
    throw Error(`${id}: render.json differs from the selected registry asset`);
  }
  const labels = new Map(preview ? samples.filter(s => s.role === role).map(s => [masterPose(asset, s.clip, s.selector), `${s.clip}:${s.selector}`])
    : render.frames.map(f => [f.index, null]));
  const poses = [...labels].sort(([a], [b]) => a - b)
    .map(([index, label]) => ({ index, blenderFrame: render.frames[index].blenderFrame, ...(label ? { label } : {}) }));
  const out = path.join(runs, revision, id, asset.variant, ...(preview ? ['preview'] : []));
  await fs.mkdir(out, { recursive: true });
  const job = { revision, sourceRevision: SOURCE_REVISION, id, role, variant: asset.variant, source, out,
    sourceSize: asset.sourceSize, elevation: { min: asset.elevation.min, max: asset.elevation.max }, idleFrame: asset.idleFrame,
    masterCount, poses, debug: Boolean(preview),
    provenance: { blend: await hash(path.join(source, 'asset.blend')), render: await hash(path.join(source, 'render.json')), registry: await hash(registry) },
    helperHashes: { 'kraken_glow_points.py': await hash(helper) } };
  const jobFile = path.join(out, 'glow-job.json');
  const existing = await fs.readFile(jobFile, 'utf8').catch(() => null);
  if (existing !== null && !flag('--resume')) throw Error(`${out} exists; pass --resume or use a new revision`);
  if (existing !== null && existing !== JSON.stringify(job, null, 2) + '\n') throw Error('Resume source/tool mismatch; use a new revision');
  if (existing === null) await fs.writeFile(jobFile, JSON.stringify(job, null, 2) + '\n');
  const done = await fs.readFile(path.join(out, 'glow-points.json'), 'utf8').then(JSON.parse).catch(() => null);
  if (!done) {
    const log = await fs.open(path.join(out, 'glow-points.log'), 'a');
    const args = ['-b', path.join(source, 'asset.blend'), '--python-exit-code', '1', '--python', helper, '--', '--job', jobFile];
    const started = Date.now();
    const exitCode = await new Promise((resolve, reject) => {
      const p = spawn(blender, args, { windowsHide: true, stdio: ['ignore', log.fd, log.fd], env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
      p.on('error', reject); p.on('exit', resolve);
    });
    await log.close();
    if (exitCode !== 0) throw Error(`${id} Blender failed (${exitCode}); see ${out}/glow-points.log`);
    console.log(`${id}: ${poses.length} poses in ${((Date.now() - started) / 1000).toFixed(0)} s`);
  }
  const result = JSON.parse(await fs.readFile(path.join(out, 'glow-points.json'), 'utf8'));
  const bin = await fs.readFile(path.join(out, result.file));
  if (bin.length !== result.bytes || bin.length !== result.records * 10 || createHash('sha256').update(bin).digest('hex') !== result.sha256
      || result.frames.length !== masterCount || result.frames.reduce((n, [, count]) => n + count, 0) !== result.records
      || result.complete !== !preview || result.provenance.blend !== job.provenance.blend) {
    throw Error(`${id}: glow-points output is inconsistent`);
  }
  console.log(`${id}: ${JSON.stringify(result.stats)}`);
}
