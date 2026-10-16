// Temporary in-game review of an animation draft (sheet assets only), never a production import.
// Copies the draft's idle/sheet into a target checkout and writes its runtime registry entry in the
// shape import-runtime produces, so the existing loaders (ArenaScene idle preload, BadgerAnimations
// sheets, getPipelineAssetForTexture clips) pick it up without runtime code. The production
// import (import-runtime.mjs after build/select/archive) later overwrites the same three files.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { repoRoot } from './preview-v2.mjs';
import { readDemandCatalog } from './pipeline-registry.mjs';
import { validateClipContracts } from './contracts-v2.mjs';

const json = async file => JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, ''));
const identifier = (value, pattern = /^[a-z0-9][a-z0-9-]*$/) => { if (!pattern.test(value ?? '')) throw Error(`Invalid identifier: ${value}`); return value; };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function importDraftSheet(argv, root = repoRoot) {
  const { values: args, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    into: { type: 'string' }, label: { type: 'string' }, drafts: { type: 'string' },
    'texture-key': { type: 'string' }, 'game-ids': { type: 'string' }, help: { type: 'boolean' },
  } });
  if (args.help || positionals.length !== 1 || !args.into) {
    console.log('node scripts/asset-pipeline/import-draft-sheet.mjs <asset> --into <checkout> [--label <draft>] [--drafts <dir>] [--texture-key <key>] [--game-ids a,b]');
    return null;
  }
  const id = identifier(positionals[0]);
  const spec = (await readDemandCatalog(root)).assets.find(a => a.id === id);
  if (!spec || spec.runtimeContract === 'boss') throw Error(`No sheet catalog asset: ${id}`);
  const drafts = path.resolve(root, args.drafts ?? 'art/poc/pipeline-v2/drafts');
  const label = identifier(args.label ?? (await json(path.join(drafts, id, 'latest.json'))).label);
  const folder = path.join(drafts, id, label, 'standard');
  const draft = await json(path.join(drafts, id, label, 'draft.json'));
  if (draft.status !== 'complete') throw Error(`Incomplete draft: ${label}`);
  const runtime = await json(path.join(folder, 'runtime.json'));
  if (runtime.id !== id || runtime.revision !== label || runtime.runtimeContract !== 'sheet') throw Error('Draft runtime does not match its asset/label');
  validateClipContracts(runtime.clips);
  const gameIds = args['game-ids'] ? args['game-ids'].split(',').map(v => identifier(v)) : spec.gameIds;
  const enemies = (await json(path.join(root, 'src/config/coopDefenseEnemies.json'))).enemies;
  const textureKey = identifier(args['texture-key'] ?? enemies.find(e => gameIds.includes(e.id))?.imageKey, /^[a-z0-9][a-z0-9_]*$/);
  const into = path.resolve(args.into), publicFolder = `assets/sprites/pipeline-v2/${id}`;
  const files = { idle: path.join(folder, runtime.idlePath.replace(/^\.\/assets\//, '')), sheet: path.join(folder, runtime.sheetPath.replace(/^\.\/assets\//, '')) };
  const hashes = {};
  await mkdir(path.join(into, 'public', publicFolder), { recursive: true });
  for (const [field, file] of Object.entries(files)) {
    hashes[field] = digest(await readFile(file));
    if (hashes[field] !== runtime.hashes[field]) throw Error(`Draft ${field} hash mismatch`);
    await copyFile(file, path.join(into, 'public', publicFolder, `${field}.png`));
  }
  const asset = {
    id, category: spec.category, gameIds, revision: label, variant: 'standard', sourceSize: runtime.sourceSize, textureKey,
    runtimeContract: 'sheet', forward: runtime.forward, pivot: runtime.pivot, displayScale: runtime.displayScale, idleFrame: runtime.idleFrame,
    clips: runtime.clips.map(({ name, frames, frameRate, loop, markers, start, end, next }) => ({ name, frames, frameRate, loop,
      ...(markers ? { markers } : {}), ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}), ...(next !== undefined ? { next } : {}) })),
    sheetTextureKey: `${textureKey}_walking`, idlePath: `./${publicFolder}/idle.png`, sheetPath: `./${publicFolder}/sheet.png`,
    layout: runtime.layout, hashes,
  };
  const registry = path.join(into, 'src/config/pipelineAssets/assets', `${id}.json`);
  await mkdir(path.dirname(registry), { recursive: true });
  await writeFile(registry, JSON.stringify(asset, null, 2) + '\n');
  console.log(`${id}: draft ${label} → ${registry} (textureKey ${textureKey}, ${runtime.layout.frameCount} frames, clips ${asset.clips.map(c => c.name).join(', ')})`);
  return asset;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  importDraftSheet(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
}
