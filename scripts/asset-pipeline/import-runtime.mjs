// Publish an already selected production run; no rendering or image processing.
import { readFile, mkdir, copyFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifySelectionV2 } from './export-v2.mjs';
import { validateEyeAnchors } from './eye-anchors.mjs';
import { isBossRuntime, verifyBossRuntime } from './runtime-contract-v2.mjs';
import { validateClipContracts } from './contracts-v2.mjs';
import { PIPELINE_REGISTRY_DIR, pipelineRegistryText, readDemandCatalog, readPipelineRegistry, writePipelineRegistry } from './pipeline-registry.mjs';

/** Explicit identities: both bodies belong to one enemy; parts need no enemy-registry mapping. */
export const BOSS_TEXTURE_KEYS = Object.freeze({
  'abyssal-kraken': 'kraken_water', 'abyssal-kraken-land': 'kraken_land',
  'abyssal-kraken-tentacle': 'kraken_tentacle', 'abyssal-kraken-egg': 'kraken_egg',
  'abyssal-kraken-spine': 'kraken_spine',
});

// Published data identities only; gameplay bindings are authored separately.
export const DAWN_TEXTURE_KEYS = Object.freeze(Object.fromEntries([
  'construction_dawn_wreck_t1', 'construction_dawn_wreck_t2', 'construction_dawn_wreck_t3',
  'construction_dawn_extractor', 'construction_dawn_dealer_stall',
  'construction_dawn_wreck_tractor_t1', 'construction_dawn_wreck_tractor_t2', 'construction_dawn_wreck_tractor_t3',
  'construction_dawn_wreck_minecart_t1', 'construction_dawn_wreck_minecart_t2', 'construction_dawn_wreck_minecart_t3',
  'construction_dawn_broodnest',
  'construction_dawn_lobby_workshop', 'construction_dawn_lobby_yard', 'construction_dawn_lobby_armory',
  'construction_dawn_supply_capsule', 'dawn_supply_crate',
  'dawn_scrap_heap_t1', 'dawn_scrap_heap_t2', 'dawn_scrap_heap_t3',
  'dawn_scrap_t1', 'dawn_scrap_t2', 'dawn_scrap_t3', 'dawn_dealer',
  'dawn_scavenger_camp_t1', 'dawn_scavenger_camp_t2', 'dawn_scavenger_camp_t3',
  'dawn_supply_crate_carried',
].map(id => [id, id])));

// Dawn's fleeing scavenger uses enemy naming and eye anchors, but has no attack.
export const DAWN_ENEMY_TEXTURE_KEYS = Object.freeze({ enemy_dawn_scavenger: 'enemy_dawn_scavenger' });

export async function importRuntime({ revision, requestedIds = [], root = process.cwd(),
  runRoot = path.join(root, 'art/poc/pipeline-v2/runs', revision), outputRoot } = {}) {
  // Use the same revision identifiers as the V2 builder/exporter; the manifest
  // carries the pipeline version independently of the human-readable run name.
  if (!/^[a-z0-9][a-z0-9-]*$/.test(revision)) throw new Error('Invalid revision');
  const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
  const catalog = await readDemandCatalog(root);
  const enemies = (await readJson(path.join(root, 'src/config/coopDefenseEnemies.json'))).enemies;
  if (new Set(requestedIds).size !== requestedIds.length
      || requestedIds.some(id => !catalog.assets.some(entry => entry.id === id))) {
    throw new Error('Specify distinct catalog asset IDs for a partial import');
  }
  const existingRuntime = await readPipelineRegistry(root);
  const previous = requestedIds.length ? existingRuntime : null;
  if (previous && previous.version !== 2) {
    throw new Error('Partial import requires an existing V2 runtime package');
  }
  const assets = [];
  const copies = [];
  for (const entry of catalog.assets.filter(entry => !requestedIds.length || requestedIds.includes(entry.id))) {
    const source = path.join(runRoot, entry.id);
    const selected = await verifySelectionV2(source);
    if (selected.id !== entry.id || selected.revision !== revision) throw new Error(`Selection mismatch: ${entry.id}`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(selected.variant)) throw new Error('Invalid selected variant');
    const rendered = await readJson(`${source}/${selected.variant}/render.json`);
    // A design rendered unbound (no game IDs) may be bound to its game IDs at the cutover import;
    // a selection rendered for other game IDs stays a mismatch.
    const boundAtImport = rendered.gameIds.length === 0 && entry.gameIds.length > 0;
    if (entry.category !== rendered.category || entry.forward !== rendered.forward
        || (!boundAtImport && JSON.stringify(entry.gameIds) !== JSON.stringify(rendered.gameIds))
        || JSON.stringify(entry.pivot) !== JSON.stringify(rendered.pivot)) {
      throw new Error(`Selected model no longer matches the runtime catalog: ${entry.id}`);
    }
    if (entry.targetSize !== rendered.targetSize || (entry.displayScale ?? 1) !== (rendered.displayScale ?? 1)) throw new Error(`Selected canvas scale differs from catalog: ${entry.id}`);
    if (entry.runtimeContract !== rendered.runtimeContract) throw new Error(`Selected runtime contract differs from catalog: ${entry.id}`);
    validateClipContracts(selected.clips);
    const dawnFleeingEnemy = entry.category === 'enemy' && Object.hasOwn(DAWN_ENEMY_TEXTURE_KEYS, entry.id);
    if (dawnFleeingEnemy && (entry.gameIds.length || selected.clips.length !== 2
        || !['idle', 'move'].every(name => selected.clips.some(c => c.name === name && c.loop)))) {
      throw new Error(`Dawn scavenger requires unbound idle + move loops: ${entry.id}`);
    }
    if (entry.category === 'enemy' && !isBossRuntime(entry) && !dawnFleeingEnemy && !selected.clips.some(c => c.name === 'claw')) throw new Error(`Enemy claw clip missing: ${entry.id}`);
    const folder = `assets/sprites/pipeline-v2/${entry.id}`;
    const hashes = {};
    for (const [field, name] of isBossRuntime(entry) ? [] : [['idle', 'idle.png'], ['sheet', 'sheet.png']]) {
      const relative = selected[field];
      if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes('..')) throw new Error('Invalid asset path');
      const file = `${source}/${relative}`;
      const hash = createHash('sha256').update(await readFile(file)).digest('hex');
      if (selected.files[relative] !== hash) throw new Error(`Selection hash mismatch: ${file}`);
      copies.push({ file, destination: `public/${folder}/${name}` });
      hashes[field] = hash;
    }
    const textureKey = DAWN_ENEMY_TEXTURE_KEYS[entry.id] ?? DAWN_TEXTURE_KEYS[entry.id] ?? (isBossRuntime(entry) ? (entry.textureKey ?? BOSS_TEXTURE_KEYS[entry.id])
      : entry.category === 'boss-part' ? entry.id.replaceAll('-', '_')
      : entry.category === 'construction' ? `construction_${entry.gameIds[0]}`
      : entry.category === 'companion' ? entry.id.replaceAll('-', '_')
      : entry.category === 'turret'
      ? `turret_weapon_${entry.id.replaceAll('-', '_')}`
      : ['weapon', 'utility'].includes(entry.category) ? `held_${entry.gameIds[0]}`
      : entry.id === 'badger' ? 'badger' : enemies.find((enemy) => entry.gameIds.includes(enemy.id))?.imageKey);
    if (!textureKey) throw new Error(`Missing game mapping: ${entry.id}`);
    const asset = {
      id: entry.id, category: entry.category, gameIds: entry.gameIds, revision,
      variant: selected.variant, sourceSize: selected.size, textureKey,
      runtimeContract: isBossRuntime(entry) ? 'boss' : 'sheet',
      forward: entry.forward, pivot: entry.pivot,
      ...(rendered.displayScale !== undefined ? { displayScale: rendered.displayScale } : {}),
      ...(['weapon', 'utility'].includes(entry.category) ? { heldItem: rendered.heldItem } : {}),
      idleFrame: selected.idleFrame,
      clips: selected.clips.map(({ name, frames, frameRate, loop, markers, start, end, next }) => ({ name, frames, frameRate, loop,
        ...(markers ? { markers } : {}), ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}), ...(next !== undefined ? { next } : {}) })),
      ...(!isBossRuntime(entry) ? {
        sheetTextureKey: `${textureKey}_${DAWN_TEXTURE_KEYS[entry.id] ? 'sheet' : ['weapon', 'utility'].includes(entry.category) ? 'static' : entry.category === 'turret' ? 'animated' : 'walking'}`,
        idlePath: `./${folder}/idle.png`, sheetPath: `./${folder}/sheet.png`, layout: selected.layout, hashes,
      } : {}),
    };
    if (isBossRuntime(entry)) {
      const { encoding, min, max, scale, waterline, alpha, colorSpace, premultiplied } = rendered.elevationPass;
      Object.assign(asset, { targetSize: rendered.targetSize, runtimeBudgetMB: entry.runtimeBudgetMB,
        sockets: selected.sockets ?? {}, ...(selected.socketFrames ? { socketFrames: selected.socketFrames } : {}),
        elevation: rendered.elevation, elevationPass: { encoding, min, max, scale, waterline, alpha, colorSpace, premultiplied },
        atlases: selected.atlases, budget: selected.budget,
        ...(rendered.materialPass ? { materialPass: selected.materialPass, shadowMesh: structuredClone(rendered.shadowMesh) } : {}) });
      if (asset.sourceSize !== Math.round(asset.targetSize * (asset.displayScale ?? 1))) throw new Error(`Boss must select displayed canvas resolution: ${entry.id}`);
      await verifyBossRuntime(entry, asset, async relative => {
        if (path.isAbsolute(relative) || /[\\:]/.test(relative) || relative.split('/').includes('..')) throw new Error('Invalid boss atlas path');
        const file = `${source}/${selected.variant}/${relative}`, bytes = await readFile(file);
        if (selected.files[`${selected.variant}/${relative}`] !== createHash('sha256').update(bytes).digest('hex')) throw new Error('Boss atlas is not selection-bound');
        return bytes;
      });
      if (asset.shadowMesh) for (const pose of asset.shadowMesh.frames) for (const key of ['positions', 'indices']) {
        const relative = pose[key].file;
        copies.push({ file: `${source}/${selected.variant}/${relative}`, destination: `public/${folder}/${relative}` });
        pose[key].file = `./${folder}/${relative}`;
      }
      asset.atlases = structuredClone(asset.atlases);
      for (const pass of Object.values(asset.atlases)) for (const clip of Object.values(pass)) for (const page of clip.pages) {
        for (const key of ['image', 'json']) {
          const relative = page[key];
          copies.push({ file: `${source}/${selected.variant}/${relative}`, destination: `public/${folder}/${relative}` });
          page[key] = `./${folder}/${relative}`;
        }
      }
    }
    if (entry.category === 'enemy' && !isBossRuntime(entry)) {
      // A reimport may retain a reviewed migration only for byte-identical selected images.
      const previousAsset = existingRuntime.assets.find(asset => asset.id === entry.id);
      asset.eyeAnchors = rendered.eyeAnchors ? {
        ...rendered.eyeAnchors,
        source: { revision, variant: selected.variant, blendSha256: selected.files[`${selected.variant}/asset.blend`],
          sheetSha256: hashes.sheet, idleSha256: hashes.idle },
      } : previousAsset?.eyeAnchors;
      validateEyeAnchors(asset.eyeAnchors, asset.layout.frameCount, asset, selected.files[`${selected.variant}/asset.blend`]);
    }
    assets.push(asset);
  }
  // The package revision records the last full import; individual revisions override it.
  const manifest = previous
    ? { ...previous, assets: [...previous.assets.map(existing => assets.find(asset => asset.id === existing.id) ?? existing),
        ...assets.filter(asset => !previous.assets.some(existing => existing.id === asset.id))] }
    : { version: 2, revision, assets };
  const keys = new Set();
  for (const asset of manifest.assets) for (const key of [asset.textureKey, asset.sheetTextureKey].filter(Boolean)) {
    if (keys.has(key)) throw new Error(`Duplicate runtime texture key: ${key}`);
    keys.add(key);
  }
  // Resolve and hash every selected input before modifying any destination.
  // An isolated target must be new; it never merges or writes into the live package.
  const destinationRoot = outputRoot ? path.resolve(outputRoot) : root;
  if (outputRoot) await mkdir(destinationRoot, { recursive: false });
  for (const { file, destination } of copies) {
    const target = path.join(destinationRoot, destination);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(file, target);
  }
  const manifestPath = path.join(destinationRoot, outputRoot ? 'pipelineAssets.json' : PIPELINE_REGISTRY_DIR);
  // Isolated runs contain only the imported assets, so every referenced file is present; they keep the
  // single-document form. The live registry is stored as one file per asset.
  const published = outputRoot ? { version: 2, revision, assets } : manifest;
  if (outputRoot) await writeFile(manifestPath, pipelineRegistryText(published));
  else await writePipelineRegistry(root, published);
  return { manifest: published, manifestPath, copiedFiles: copies.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [revision = 'v2-g', ...args] = process.argv.slice(2), requestedIds = [];
  const options = { revision, requestedIds };
  for (let i = 0; i < args.length; i++) {
    if (['--output-root', '--run-root'].includes(args[i])) {
      const option = args[i], value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`Missing ${option} path`);
      options[option === '--output-root' ? 'outputRoot' : 'runRoot'] = path.resolve(value);
    } else if (args[i].startsWith('--')) throw new Error(`Unknown option: ${args[i]}`);
    else requestedIds.push(args[i]);
  }
  const result = await importRuntime(options);
  console.log(`Imported ${result.manifest.assets.length} assets; ${result.copiedFiles} files; ${result.manifestPath}`);
}
