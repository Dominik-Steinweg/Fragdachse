// Publish an already selected production run; no rendering or image processing.
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const revision = process.argv[2] ?? 'v2-g';
if (!/^v2-[a-z0-9-]+$/.test(revision)) throw new Error('Invalid revision');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const catalog = await readJson('scripts/asset-pipeline/catalog-v2.json');
const enemies = (await readJson('src/config/coopDefenseEnemies.json')).enemies;
const requestedIds = process.argv.slice(3);
if (new Set(requestedIds).size !== requestedIds.length
    || requestedIds.some(id => !catalog.assets.some(entry => entry.id === id))) {
  throw new Error('Specify distinct catalog asset IDs for a partial import');
}
const previous = requestedIds.length ? await readJson('src/config/pipelineAssets.json') : null;
if (previous && (previous.version !== 2 || requestedIds.some(id => !previous.assets.some(asset => asset.id === id)))) {
  throw new Error('Partial import requires an existing V2 runtime package containing the requested assets');
}
const assets = [];
const copies = [];
for (const entry of catalog.assets.filter(entry => !requestedIds.length || requestedIds.includes(entry.id))) {
  const source = `art/poc/pipeline-v2/runs/${revision}/${entry.id}`;
  const selected = await readJson(`${source}/selection.json`);
  if (selected.id !== entry.id || selected.revision !== revision) throw new Error(`Selection mismatch: ${entry.id}`);
  const folder = `assets/sprites/pipeline-v2/${entry.id}`;
  const hashes = {};
  for (const [field, name] of [['idle', 'idle.png'], ['sheet', 'sheet.png']]) {
    const relative = selected[field];
    if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Invalid asset path');
    const file = `${source}/${relative}`;
    const hash = createHash('sha256').update(await readFile(file)).digest('hex');
    if (selected.files[relative] !== hash) throw new Error(`Selection hash mismatch: ${file}`);
    copies.push({ file, destination: `public/${folder}/${name}` });
    hashes[field] = hash;
  }
  const textureKey = entry.category === 'turret'
    ? `turret_weapon_${entry.id.replaceAll('-', '_')}`
    : entry.id === 'badger' ? 'badger' : enemies.find((enemy) => entry.gameIds.includes(enemy.id))?.imageKey;
  if (!textureKey) throw new Error(`Missing game mapping: ${entry.id}`);
  assets.push({
    id: entry.id, category: entry.category, gameIds: entry.gameIds, revision,
    variant: selected.variant, sourceSize: selected.size, textureKey,
    sheetTextureKey: `${textureKey}_${entry.category === 'turret' ? 'animated' : 'walking'}`,
    idlePath: `./${folder}/idle.png`, sheetPath: `./${folder}/sheet.png`,
    forward: entry.forward, pivot: entry.pivot, layout: selected.layout,
    idleFrame: selected.idleFrame,
    clips: selected.clips.map(({ name, frames, frameRate, loop }) => ({ name, frames, frameRate, loop })),
    hashes,
  });
}
// Resolve and hash every selected input before modifying the runtime package.
for (const { file, destination } of copies) {
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(file, destination);
}
// The package revision records the last full import; individual revisions override it.
const manifest = previous
  ? { ...previous, assets: previous.assets.map(existing => assets.find(asset => asset.id === existing.id) ?? existing) }
  : { version: 2, revision, assets };
await writeFile('src/config/pipelineAssets.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`Imported ${assets.length} selected assets from ${revision}`);
