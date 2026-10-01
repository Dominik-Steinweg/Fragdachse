import { readFile, mkdir, copyFile, writeFile, realpath } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { digest, relativePath, validatePassSpec } from './character-pass-contract.mjs';
import { exportCharacterPasses } from './export-character-passes.mjs';
import { reviewCharacterPasses } from './review-character-passes.mjs';
import { fileHash, runTool, sealCharacterPasses, verifyCharacterBundle } from './character-pass-bundle.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({ options: {
  plan: { type: 'boolean', default: false },
  production: { type: 'boolean', default: false },
  poses: { type: 'string' },
  blender: { type: 'string', default: 'D:/Blender Foundation/Blender 5.2/blender.exe' },
  python: { type: 'string', default: 'D:/Blender Foundation/Blender 5.2/5.2/python/bin/python.exe' },
  root: { type: 'string', default: 'D:/Fragdachse-render' },
  revision: { type: 'string', default: `player-shadow-${new Date().toISOString().replace(/[:.]/g, '-')}` },
  device: { type: 'string', default: 'OPTIX' },
} });
if (!/^[a-z0-9][a-zA-Z0-9-]*$/.test(values.revision) || !['CPU', 'CUDA', 'OPTIX'].includes(values.device)) throw Error('Invalid revision/device');
if (values.production && values.poses !== undefined) throw Error('Production cannot select a pose subset');
const outputRoot = await realpath(values.root);
const allowedRoot = await realpath('D:/Fragdachse-render');
if (outputRoot.toLowerCase() !== allowedRoot.toLowerCase() || path.parse(outputRoot).root.toLowerCase() !== 'd:\\') throw Error('Render output must stay in D:/Fragdachse-render');
const output = path.join(outputRoot, values.revision);
const authoredSpecBytes = await readFile(path.join(repo, 'scripts/asset-pipeline/player-shadow-v1.json'));
const spec = validatePassSpec(JSON.parse(authoredSpecBytes));
const source = path.join(repo, spec.source);
const renderBytes = await readFile(path.join(source, 'render.json')), render = JSON.parse(renderBytes);
const selectionBytes = await readFile(path.join(source, '../selection.json')), selection = JSON.parse(selectionBytes);
if (render.id !== spec.assetId || selection.id !== render.id || selection.revision !== render.revision || selection.variant !== render.variant) throw Error('Foreign source selection');
if (values.production) {
  if (render.frames.length !== 37 || render.frames.some((f, i) => f.index !== i)) throw Error('Expected all 37 bound badger frames');
  spec.status = 'production'; spec.poseIndices = render.frames.map(f => f.index);
} else if (values.poses !== undefined) {
  if (!/^\d+(,\d+)*$/.test(values.poses)) throw Error('Use comma-separated pose indices');
  spec.poseIndices = values.poses.split(',').map(Number);
}
validatePassSpec(spec);
const specBytes = Buffer.from(JSON.stringify(spec, null, 2) + '\n');
const blend = path.join(source, 'asset.blend'), blendSha256 = await fileHash(blend);
for (const [file, hash] of [[`${render.variant}/asset.blend`, blendSha256], [`${render.variant}/render.json`, digest(renderBytes)]]) {
  if (selection.files[file] !== hash) throw Error('Selection hash mismatch: ' + file);
}
const poses = [];
for (const index of spec.poseIndices) {
  const f = render.frames[index];
  if (!f || f.index !== index) throw Error('Missing source pose: ' + index);
  const bytes = await readFile(path.join(source, relativePath(f.file)));
  if (digest(bytes) !== f.sha256 || selection.files[`${render.variant}/${f.file}`] !== f.sha256) throw Error('Changed beauty master');
  poses.push({ index, blenderFrame: f.blenderFrame, beautyFile: f.file, beautySha256: f.sha256 });
}
const toolHashes = {};
for (const name of ['character_pass_blender.py', 'character-pass-contract.mjs', 'export-character-passes.mjs',
  'review-character-passes.mjs', 'player-shadow-pilot.mjs', 'player-shadow-run.mjs', 'character-passes.d.ts', 'character-pass-bundle.mjs',
  'archive-character-passes.py', 'import-character-passes.mjs', 'inspect-character-materials.py', 'CHARACTER-PASSES.md']) {
  toolHashes[name] = await fileHash(path.join(repo, 'scripts/asset-pipeline', name));
}
const sourceArchive = path.join(source, '../source-bundle.zip');
const job = { repo, outputRoot, sourceFolder: source, beautyRoot: 'source-beauty', groundFile: 'source-ground.png',
  spec, render, poses, device: values.device,
  source: { blendSha256, renderSha256: digest(renderBytes), selectionSha256: digest(selectionBytes), specSha256: digest(specBytes),
    authoredSpecSha256: digest(authoredSpecBytes), beautyArchiveSha256: await fileHash(sourceArchive), tools: toolHashes } };
const plan = { status: 'prepared-not-rendered', mode: values.production ? 'production' : 'pilot', output, poses,
  shadowJobs: poses.length * 48, receiverJobs: 48, materialJobs: poses.length * 3, source: job.source,
  fullProductionShadowJobs: render.frames.length * 48, review: path.join(output, 'review'), archive: path.join(output, 'source-bundle.zip') };
if (values.plan) {
  console.log(JSON.stringify(plan, null, 2));
} else {
  // No retry/resume, overwrite or C: fallback. Caller must have a writable D: workspace.
  await runTool(values.python, ['-B', path.join(repo, 'scripts/asset-pipeline/archive-character-passes.py'), '--verify', sourceArchive, job.source.selectionSha256], repo);
  await mkdir(output);
  const started = performance.now();
  for (const sub of ['intermediate', 'shadow', 'albedo', 'normal', 'source-tools', 'source-beauty', 'review']) await mkdir(path.join(output, sub));
  await copyFile(blend, path.join(output, 'source.blend'));
  await copyFile(sourceArchive, path.join(output, 'source-beauty-bundle.zip'));
  await copyFile(path.join(repo, 'public/assets/sprites/gras_bg_tile.png'), path.join(output, job.groundFile));
  for (const pose of poses) {
    const target = path.join(output, job.beautyRoot, pose.beautyFile);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(source, pose.beautyFile), target);
  }
  for (const name of Object.keys(toolHashes)) await copyFile(path.join(repo, 'scripts/asset-pipeline', name), path.join(output, 'source-tools', name));
  for (const [name, bytes] of [['source-render.json', renderBytes], ['source-selection.json', selectionBytes],
    ['source-spec.json', authoredSpecBytes], ['spec.json', specBytes], ['job.json', JSON.stringify(job, null, 2) + '\n']]) {
    await writeFile(path.join(output, name), bytes, { flag: 'wx' });
  }
  const log = createWriteStream(path.join(output, 'blender.log'), { flags: 'wx' });
  const renderStart = performance.now();
  try {
    await new Promise((resolve, reject) => {
      const child = spawn(values.blender, ['--factory-startup', '-b', path.join(output, 'source.blend'), '--python-exit-code', '1',
        '--python', path.join(output, 'source-tools/character_pass_blender.py'), '--', '--job', path.join(output, 'job.json')],
      { cwd: output, windowsHide: true, env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1',
        TEMP: path.join(output, 'intermediate'), TMP: path.join(output, 'intermediate') } });
      child.stdout.on('data', bytes => { log.write(bytes); for (const line of String(bytes).split('\n')) if (line.startsWith('FD_')) console.log(line); });
      child.stderr.on('data', bytes => log.write(bytes));
      child.on('error', reject);
      child.on('close', code => code === 0 ? resolve() : reject(Error(`Blender exited ${code}; see ${output}/blender.log`)));
    });
  } finally { await new Promise(resolve => log.end(resolve)); }
  const blenderWallSeconds = (performance.now() - renderStart) / 1000;
  if (await fileHash(blend) !== blendSha256) throw Error('Original blend changed during render');
  for (const [name, expected] of Object.entries(toolHashes)) {
    if (await fileHash(path.join(repo, 'scripts/asset-pipeline', name)) !== expected
      || await fileHash(path.join(output, 'source-tools', name)) !== expected) throw Error('Tool changed during run: ' + name);
  }
  const atlas = await exportCharacterPasses(output);
  const pages = [];
  for (let first = 0; first < poses.length; first += 8) {
    const folder = `page-${String(pages.length + 1).padStart(2, '0')}`;
    const report = await reviewCharacterPasses(output, path.join(output, 'review', folder), { poseIndices: poses.slice(first, first + 8).map(p => p.index) });
    pages.push({ folder, ...report });
  }
  await writeFile(path.join(output, 'review/index.json'), JSON.stringify({ status: 'awaiting-human-review', pages }, null, 2) + '\n', { flag: 'wx' });
  await writeFile(path.join(output, 'completion.json'), JSON.stringify({ ...pages[0], reviewFiles: ['review/index.json'],
    totalWallSecondsBeforeArchive: (performance.now() - started) / 1000, blenderWallSeconds,
    atlasDownloadBytes: atlas.totalDownloadBytes, atlasGpuBytes: atlas.totalGpuBytes }, null, 2) + '\n', { flag: 'wx' });
  const receipt = await sealCharacterPasses(output, values.revision, values.python);
  await verifyCharacterBundle(output, { production: values.production });
  console.log(JSON.stringify({ output, review: 'review/index.json', receipt, totalWallSeconds: (performance.now() - started) / 1000 }, null, 2));
}
