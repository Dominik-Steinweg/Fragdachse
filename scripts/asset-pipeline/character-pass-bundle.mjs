import { readFile, writeFile, readdir, lstat, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { digest, relativePath, validatePassManifest } from './character-pass-contract.mjs';
import { verifyPackedPasses } from './export-character-passes.mjs';

export async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
export async function runTool(executable, args, cwd) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'],
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(Error(`Tool exited ${code}: ${executable}`)));
  });
}
async function walk(root, dir = '') {
  const result = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const name = relativePath([dir, entry.name].filter(Boolean).join('/'));
    if (entry.isSymbolicLink()) throw Error('Symlink in revision: ' + name);
    if (entry.isDirectory()) result.push(...await walk(root, name));
    else if (entry.isFile()) result.push(name);
    else throw Error('Unsupported revision member: ' + name);
  }
  return result.sort();
}
export async function sealCharacterPasses(root, revision, python) {
  const started = performance.now();
  const manifest = validatePassManifest(JSON.parse(await readFile(path.join(root, 'render-passes.json'))));
  const files = {};
  for (const name of await walk(root)) files[name] = await fileHash(path.join(root, name));
  const selection = { schema: 'fd-character-pass-selection', version: 2, id: manifest.spec.assetId, revision,
    status: manifest.status, source: manifest.source, poseIndices: manifest.poses.map(p => p.index),
    renderManifest: 'render-passes.json', atlasManifest: 'atlas-passes.json',
    review: 'review/index.json', files };
  const bytes = JSON.stringify(selection, null, 2) + '\n';
  await writeFile(path.join(root, 'selection.json'), bytes, { flag: 'wx' });
  await runTool(python, ['-B', path.join(root, 'source-tools/archive-character-passes.py'), '--create', root], root);
  const receipt = { schema: 'fd-character-pass-archive-receipt', version: 1,
    selectionSha256: digest(bytes), archiveSha256: await fileHash(path.join(root, 'source-bundle.zip')),
    archiveBytes: (await lstat(path.join(root, 'source-bundle.zip'))).size,
    sealWallSeconds: (performance.now() - started) / 1000 };
  await writeFile(path.join(root, 'archive-receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  return receipt;
}
export async function verifyCharacterBundle(root, { production = false } = {}) {
  const selectionBytes = await readFile(path.join(root, 'selection.json'));
  const selection = JSON.parse(selectionBytes);
  if (selection.schema !== 'fd-character-pass-selection' || selection.version !== 2 || !selection.files
    || !/^[a-z0-9][a-zA-Z0-9-]*$/.test(selection.revision) || selection.id !== 'badger') throw Error('Invalid pass selection');
  const base = await realpath(root);
  for (const [name, expected] of Object.entries(selection.files)) {
    const file = path.join(root, relativePath(name)), resolved = await realpath(file);
    const rel = path.relative(base, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel) || (await lstat(file)).isSymbolicLink()
      || await fileHash(file) !== expected) throw Error('Changed selected file: ' + name);
  }
  const render = validatePassManifest(JSON.parse(await readFile(path.join(root, 'render-passes.json'))));
  if (selection.status !== render.status || JSON.stringify(selection.source) !== JSON.stringify(render.source)
    || JSON.stringify(selection.poseIndices) !== JSON.stringify(render.spec.poseIndices)) throw Error('Selection binding mismatch');
  if (production && (render.status !== 'production-unreviewed' || render.poses.length !== 37 || render.sourceFrameCount !== 37)) throw Error('Runtime import requires all 37 production poses');
  for (const name of ['render-passes.json', 'atlas-passes.json', 'completion.json', 'job.json', 'spec.json', 'source.blend',
    'source-render.json', 'source-selection.json', 'source-beauty-bundle.zip', 'review/index.json']) {
    if (!selection.files[name]) throw Error('Unselected required file: ' + name);
  }
  const bindings = { 'source.blend': 'blendSha256', 'source-render.json': 'renderSha256',
    'source-selection.json': 'selectionSha256', 'spec.json': 'specSha256', 'source-spec.json': 'authoredSpecSha256',
    'source-beauty-bundle.zip': 'beautyArchiveSha256' };
  for (const [name, key] of Object.entries(bindings)) if (selection.files[name] !== render.source[key]) throw Error('Source hash mismatch: ' + name);
  const spec = JSON.parse(await readFile(path.join(root, 'spec.json')));
  const sourceRender = JSON.parse(await readFile(path.join(root, 'source-render.json')));
  if (JSON.stringify(spec) !== JSON.stringify(render.spec) || sourceRender.id !== spec.assetId
    || sourceRender.frames.length !== render.sourceFrameCount) throw Error('Source spec/frame count mismatch');
  for (const pose of render.poses) {
    const original = sourceRender.frames[pose.index];
    if (!original || original.index !== pose.index || original.blenderFrame !== pose.blenderFrame
      || original.file !== pose.beautyFile || original.sha256 !== pose.beautySha256) throw Error('Source animation mapping mismatch');
  }
  for (const [name, hash] of Object.entries(render.source.tools)) if (selection.files['source-tools/' + relativePath(name)] !== hash) throw Error('Tool hash mismatch');
  for (const pose of render.poses) if (selection.files['source-beauty/' + relativePath(pose.beautyFile)] !== pose.beautySha256) throw Error('Beauty hash mismatch');
  const atlas = JSON.parse(await readFile(path.join(root, 'atlas-passes.json')));
  for (const file of [...render.images, ...atlas.pages]) if (selection.files[file.file] !== file.sha256) throw Error('Unselected pass image');
  const receipt = JSON.parse(await readFile(path.join(root, 'archive-receipt.json')));
  if (receipt.schema !== 'fd-character-pass-archive-receipt' || receipt.version !== 1
    || receipt.selectionSha256 !== digest(selectionBytes) || receipt.archiveSha256 !== await fileHash(path.join(root, 'source-bundle.zip'))
    || receipt.archiveBytes !== (await lstat(path.join(root, 'source-bundle.zip'))).size) throw Error('Archive receipt mismatch');
  const stats = await verifyPackedPasses(root);
  return { selection, atlas, receipt, stats };
}
