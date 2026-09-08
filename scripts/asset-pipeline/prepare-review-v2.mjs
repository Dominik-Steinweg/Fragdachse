import { access, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

const helperFile = fileURLToPath(import.meta.url);
const helperRelative = 'scripts/asset-pipeline/prepare-review-v2.mjs';
const repoRoot = path.resolve(path.dirname(helperFile), '../..');
const hash = data => createHash('sha256').update(data).digest('hex');
const slash = value => value.split(path.sep).join('/');
const exists = file => access(file).then(() => true, () => false);
const json = async file => JSON.parse(await readFile(file, 'utf8'));

function contained(root, file) {
  const target = path.resolve(root, file), relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Review path escapes workspace');
  return target;
}

function referencePath(value) {
  if (typeof value !== 'string' || !value || /[\\:\0]/.test(value) || value.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Reference must use a contained repository-relative path');
  return value;
}

async function sourceFile(workspace, file) {
  const target = contained(workspace, file);
  // Resolve links as well as textual '..' segments before reading source bytes.
  contained(workspace, await realpath(target));
  return target;
}

async function destinationFile(assetRoot, file) {
  const target = contained(assetRoot, file);
  let ancestor = target;
  while (true) {
    try {
      if ((await lstat(ancestor)).isSymbolicLink()) throw new Error('Review destination cannot use symlinks or junctions');
      contained(assetRoot, await realpath(ancestor));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (ancestor === assetRoot) break;
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error('No contained review destination');
    ancestor = parent;
  }
  return target;
}

/** Prepare review-only archive inputs without changing the completed render revision. */
export async function prepareReviewV2(assetFolder, reviewJsonFile, workspace = repoRoot) {
  const root = await realpath(workspace);
  const asset = await realpath(await sourceFile(root, assetFolder));
  const runRoot = path.join(root, 'art/poc/pipeline-v2/runs');
  contained(runRoot, asset);
  const parts = path.relative(runRoot, asset).split(path.sep);
  if (parts.length !== 2 || parts.some(part => !/^[a-z0-9][a-z0-9-]*$/.test(part))) throw new Error('Expected a V2 revision asset folder');
  const selectionFile = path.join(asset, 'selection.json');
  if (await exists(selectionFile)) throw new Error('Selection already exists; review inputs are immutable');
  const build = await json(await sourceFile(root, path.join(asset, 'build.json')));
  if (build.status !== 'complete' || !/^[a-f0-9]{64}$/.test(build.inputHash)) throw new Error('Completed V2 build required before review');
  const manifests = await Promise.all(['calm', 'rich'].map(async variant => json(await sourceFile(root, path.join(asset, variant, 'render.json')))));
  for (const m of manifests) {
    if (m.pipelineVersion !== 2 || m.id !== parts[1] || m.revision !== parts[0]) throw new Error('Review manifest disagrees with asset folder');
  }
  const manifest = manifests[0];
  if (manifests.some(m => m.reference !== manifest.reference || m.previousReference?.path !== manifest.previousReference?.path)) throw new Error('Material variants disagree on review references');
  const reviewSource = await sourceFile(root, reviewJsonFile);
  const reviewRelative = slash(path.relative(root, reviewSource));
  if (reviewRelative === 'review-inputs.json') throw new Error('Review source collides with reserved archive metadata');
  const reviewBytes = await readFile(reviewSource);
  const review = JSON.parse(reviewBytes.toString('utf8'));
  if (!review || typeof review !== 'object' || Array.isArray(review)) throw new Error('Review JSON must contain an object');
  const inputs = new Map([[reviewRelative, reviewBytes], [helperRelative, await readFile(helperFile)]]);
  const references = [];
  for (const [role, relative] of [['reference', manifest.reference], ['previousReference', manifest.previousReference?.path]]) {
    if (role === 'previousReference' && relative === undefined) continue;
    referencePath(relative);
    const bytes = await readFile(await sourceFile(root, relative));
    if ((await sharp(bytes).metadata()).format !== 'png') throw new Error('Review references must be PNG images');
    inputs.set(relative, bytes);
    references.push({ role, path: relative, sha256: hash(bytes) });
  }
  const outputs = [];
  for (const [relative, bytes] of inputs) {
    const destination = await destinationFile(asset, path.join(asset, 'archive-source', relative));
    if (await exists(destination)) {
      if (!(await readFile(destination)).equals(bytes)) throw new Error(`Archived review input changed: ${relative}; retain its existing source snapshot`);
    } else outputs.push({ destination, bytes });
  }
  const metadata = {
    version: 2, stage: 'post-render-review', id: manifest.id, revision: manifest.revision, renderInputHash: build.inputHash,
    review: { path: reviewRelative, assetPath: 'review.json', sha256: hash(reviewBytes) }, references,
    helper: { path: helperRelative, sha256: hash(inputs.get(helperRelative)) },
    files: Object.fromEntries([...inputs].sort(([a], [b]) => a.localeCompare(b)).map(([relative, bytes]) => [relative, hash(bytes)])),
  };
  const reviewDestination = await destinationFile(asset, path.join(asset, 'review.json'));
  const metadataDestination = await destinationFile(asset, path.join(asset, 'archive-source/review-inputs.json'));
  // All source/path/conflict checks finish before adding any review-stage files.
  if (await exists(selectionFile)) throw new Error('Selection already exists; review inputs are immutable');
  for (const { destination, bytes } of outputs) {
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx' });
  }
  await writeFile(reviewDestination, reviewBytes);
  await writeFile(metadataDestination, JSON.stringify(metadata, null, 2) + '\n');
  return metadata;
}

if (process.argv[1] && path.resolve(process.argv[1]) === helperFile) {
  const [assetFolder, reviewFile, ...extra] = process.argv.slice(2);
  try {
    if (!assetFolder || !reviewFile || extra.length) throw new Error('Usage: node scripts/asset-pipeline/prepare-review-v2.mjs <asset-folder> <review.json>');
    console.log(JSON.stringify(await prepareReviewV2(assetFolder, reviewFile), null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
