import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The runtime pipeline registry is stored as one file per asset, so lanes that add or re-export
 * different assets never edit the same file: `registry.json` holds the package version and the
 * revision of the last full import, `assets/<id>.json` one registry entry each. The loaders assemble
 * the familiar `{ version, revision, assets }` document with assets ordered by id.
 */
export const PIPELINE_REGISTRY_DIR = 'src/config/pipelineAssets';
const ASSET_ID = /^[a-z0-9][a-z0-9_-]*$/;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const text = value => JSON.stringify(value, null, 2) + '\n';

export async function readPipelineRegistry(root = process.cwd()) {
  const directory = path.join(root, PIPELINE_REGISTRY_DIR);
  const meta = JSON.parse(await readFile(path.join(directory, 'registry.json'), 'utf8'));
  const files = (await readdir(path.join(directory, 'assets'))).filter(file => file.endsWith('.json'));
  const assets = await Promise.all(files.map(async file => {
    const asset = JSON.parse(await readFile(path.join(directory, 'assets', file), 'utf8'));
    if (`${asset.id}.json` !== file) throw new Error(`Pipeline registry file ${file} holds asset ${asset.id}`);
    return asset;
  }));
  return { ...meta, assets: assets.sort(byId) };
}

/** Writes changed entries only and removes entries that are no longer part of the registry. */
export async function writePipelineRegistry(root, registry) {
  const { assets, ...meta } = registry;
  const directory = path.join(root, PIPELINE_REGISTRY_DIR), assetDirectory = path.join(directory, 'assets');
  const ids = new Set();
  for (const asset of assets) {
    if (typeof asset.id !== 'string' || !ASSET_ID.test(asset.id)) throw new Error(`Invalid pipeline asset id: ${asset.id}`);
    if (ids.has(asset.id)) throw new Error(`Duplicate pipeline asset id: ${asset.id}`);
    ids.add(asset.id);
  }
  await mkdir(assetDirectory, { recursive: true });
  const save = async (file, content) => {
    if (await readFile(file, 'utf8').catch(() => null) !== content) await writeFile(file, content);
  };
  await save(path.join(directory, 'registry.json'), text(meta));
  for (const asset of assets) await save(path.join(assetDirectory, `${asset.id}.json`), text(asset));
  for (const file of await readdir(assetDirectory)) {
    if (file.endsWith('.json') && !ids.has(file.slice(0, -'.json'.length))) await rm(path.join(assetDirectory, file));
  }
}

/** Single-document form, used for isolated review packages and frozen provenance copies. */
export function pipelineRegistryText(registry) {
  return text(registry);
}

/** Freezes the current registry into one file, for source binders that hash and copy a path. */
export async function pipelineRegistrySnapshot(root = process.cwd()) {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'fragdachse-pipeline-registry-')), 'pipelineAssets.json');
  await writeFile(file, pipelineRegistryText(await readPipelineRegistry(root)));
  return file;
}
