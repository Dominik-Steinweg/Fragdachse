import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Asset-keyed pipeline documents are stored as one file per asset, so lanes that add or edit
 * different assets never edit the same file: `registry.json` holds the document's other fields,
 * `assets/<id>.json` one entry each. The loaders assemble the familiar `{ version, ..., assets }`
 * document with assets ordered by id. Two documents use this layout: the runtime pipeline registry
 * (package version, revision of the last full import) and the V2 demand catalog (catalog version).
 */
export const PIPELINE_REGISTRY_DIR = 'src/config/pipelineAssets';
export const DEMAND_CATALOG_DIR = 'scripts/asset-pipeline/catalog-v2';
const ASSET_ID = /^[a-z0-9][a-z0-9_-]*$/;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const text = value => JSON.stringify(value, null, 2) + '\n';

export async function readPipelineRegistry(root = process.cwd(), store = PIPELINE_REGISTRY_DIR) {
  const directory = path.join(root, store);
  const meta = JSON.parse(await readFile(path.join(directory, 'registry.json'), 'utf8'));
  const files = (await readdir(path.join(directory, 'assets'))).filter(file => file.endsWith('.json'));
  const assets = await Promise.all(files.map(async file => {
    const asset = JSON.parse(await readFile(path.join(directory, 'assets', file), 'utf8'));
    if (`${asset.id}.json` !== file) throw new Error(`${store} file ${file} holds asset ${asset.id}`);
    return asset;
  }));
  return { ...meta, assets: assets.sort(byId) };
}

/** Writes changed entries only and removes entries that are no longer part of the document. */
export async function writePipelineRegistry(root, registry, store = PIPELINE_REGISTRY_DIR) {
  const { assets, ...meta } = registry;
  const directory = path.join(root, store), assetDirectory = path.join(directory, 'assets');
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

/** Freezes the current document into one file, for source binders that hash and copy a path. */
export async function pipelineRegistrySnapshot(root = process.cwd(), store = PIPELINE_REGISTRY_DIR) {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'fragdachse-pipeline-registry-')), `${path.basename(store)}.json`);
  await writeFile(file, pipelineRegistryText(await readPipelineRegistry(root, store)));
  return file;
}

export const readDemandCatalog = (root = process.cwd()) => readPipelineRegistry(root, DEMAND_CATALOG_DIR);
export const writeDemandCatalog = (root, catalog) => writePipelineRegistry(root, catalog, DEMAND_CATALOG_DIR);
export const demandCatalogSnapshot = (root = process.cwd()) => pipelineRegistrySnapshot(root, DEMAND_CATALOG_DIR);
