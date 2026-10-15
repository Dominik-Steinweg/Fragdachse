import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { archiveManifestV2, exportRunV2, exportVariantV2, selectVariantV2, sheetLayout, validateManifestV2, verifySelectionV2 } from '../../scripts/asset-pipeline/export-v2.mjs';
import { prepareReviewV2 } from '../../scripts/asset-pipeline/prepare-review-v2.mjs';
import { packAtlas } from '../../scripts/asset-pipeline/atlas-v2.mjs';
import { elevationEncoding, resizeElevation, verifyElevationPixels } from '../../scripts/asset-pipeline/elevation-v2.mjs';
import { verifyBossRuntime } from '../../scripts/asset-pipeline/runtime-contract-v2.mjs';
import { requiredSockets, restSockets, validateSocketFrames } from '../../scripts/asset-pipeline/socket-anchors.mjs';
import { KRAKEN_ASSET_REQUIREMENTS } from '../../src/config/krakenBoss';
import { normalizePipelineAsset } from '../../src/config/pipelineAssetContracts';
import { importRuntime, BOSS_TEXTURE_KEYS } from '../../scripts/asset-pipeline/import-runtime.mjs';
import { readPipelineRegistry, writeDemandCatalog, writePipelineRegistry } from '../../scripts/asset-pipeline/pipeline-registry.mjs';

const roots: string[] = [];
const hash = (data: Buffer | string) => createHash('sha256').update(data).digest('hex');
const save = async (file: string, data: unknown) => writeFile(file, JSON.stringify(data, null, 2) + '\n');
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(tmpdir()) + path.sep + 'fd-asset-v2-')) throw new Error('Unsafe test cleanup');
    await rm(root, { recursive: true, force: true });
  }
});

async function frame(color: string) {
  const center = await sharp({ create: { width: 32, height: 32, channels: 4, background: color } }).png().toBuffer();
  return sharp({ create: { width: 64, height: 64, channels: 4, background: '#00000000' } })
    .composite([{ input: center, left: 16, top: 16 }]).png().toBuffer();
}

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'fd-asset-v2-')); roots.push(root);
  const run = path.join(root, 'art/poc/pipeline-v2/runs/reference-test');
  const asset = path.join(run, 'fixture');
  const frames = await Promise.all(['#ef3010', '#25bb55', '#3355dd', '#ddaa22'].map(frame));
  const source = 'def build(context, spec):\n    return {}\n';
  const files = { 'scripts/asset-pipeline/recipes/fixture.py': Buffer.from(source), 'art/poc/pipeline-v2/textures/organic.png': frames[0] };
  for (const [name, contents] of Object.entries(files)) {
    const file = path.join(asset, 'archive-source', name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
  await save(path.join(asset, 'build.json'), { status: 'complete', inputHash: hash('resolved fixture') });
  for (const variant of ['calm', 'rich']) {
    const folder = path.join(asset, variant);
    await mkdir(path.join(folder, 'masters'), { recursive: true });
    const manifest = {
      pipelineVersion: 2, id: 'fixture', label: 'Fixture', revision: 'reference-test', category: 'character', variant,
      targetSize: 16, sourceSizes: [32], masterSize: 64, pivot: [.5, .5], forward: 'north',
      camera: { type: 'ORTHO', rotation: [0, 0, 0], location: [0, 0, 8], orthoScale: 2, transparent: true },
      sources: { 'scripts/asset-pipeline/recipes/fixture.py': hash(source) },
      textures: { organic: { path: 'art/poc/pipeline-v2/textures/organic.png', sha256: hash(frames[0]) } },
      idleFrame: 0,
      frames: frames.map((data, index) => ({ index, file: `masters/frame-${String(index).padStart(4, '0')}.png`, blenderFrame: index + 1, sha256: hash(data), bounds: [16, 16, 47, 47] })),
      clips: [{ name: 'move', motion: 'biped-walk', frameRate: 12, loop: true, frames: [1, 2, 3] }],
    };
    await save(path.join(folder, 'render.json'), manifest);
    await writeFile(path.join(folder, 'asset.blend'), 'Packed Blender fixture');
    for (const f of manifest.frames) await writeFile(path.join(folder, f.file), frames[f.index]);
  }
  const folder = path.join(asset, 'calm');
  const manifest = JSON.parse(await readFile(path.join(folder, 'render.json'), 'utf8'));
  return { root, run, asset, folder, manifest, frames };
}

describe('V2 animated asset export contracts', () => {
  it.each([
    ['construction_dawn_extractor', 'construction'], ['dawn_scrap_t2', 'powerup'], ['dawn_dealer', 'character'],
    ['construction_dawn_wreck_tractor_t1', 'construction'], ['construction_dawn_wreck_minecart_t3', 'construction'],
    ['construction_dawn_broodnest', 'construction'],
    ['construction_dawn_supply_capsule', 'construction'], ['dawn_supply_crate', 'powerup'],
    ['dawn_scrap_heap_t1', 'construction'], ['dawn_scrap_heap_t2', 'construction'], ['dawn_scrap_heap_t3', 'construction'],
  ])('imports the unbound Dawn identity %s without inventing gameplay bindings', async (id, category) => {
    const f = await fixture();
    const asset = path.join(f.run, id);
    await rename(f.asset, asset);
    const folder = path.join(asset, 'calm');
    const m = { ...f.manifest, id, category, gameIds: [], requiredClips: ['idle'],
      clips: [{ ...f.manifest.clips[0], name: 'idle', motion: 'player_idle' }] };
    await save(path.join(folder, 'render.json'), m);
    await exportVariantV2(folder, f.root);
    await selectVariantV2(asset, 'calm', 32, 'Reviewed unbound identity.');
    await mkdir(path.join(f.root, 'scripts/asset-pipeline'), { recursive: true });
    await mkdir(path.join(f.root, 'src/config'), { recursive: true });
    await writeDemandCatalog(f.root, { version: 2, assets: [m] });
    await save(path.join(f.root, 'src/config/coopDefenseEnemies.json'), { enemies: [] });
    await writePipelineRegistry(f.root, { version: 2, assets: [] });
    const result = await importRuntime({ root: f.root, revision: m.revision, requestedIds: [id], outputRoot: path.join(f.root, 'published') });
    expect(result.manifest.assets[0]).toMatchObject({ textureKey: id, sheetTextureKey: `${id}_sheet`, gameIds: [], clips: [{ name: 'idle' }] });
    expect(result.copiedFiles).toBe(2);
    expect(await readFile(path.join(f.root, 'published/public/assets/sprites/pipeline-v2', id, 'sheet.png'))).toEqual(await readFile(path.join(folder, 'sheet-32.png')));
  });

  it('imports the fleeing Dawn enemy with enemy sheet naming and bound eye anchors, without a claw attack', async () => {
    const f = await fixture(), id = 'enemy_dawn_scavenger', asset = path.join(f.run, id);
    await rename(f.asset, asset);
    const folder = path.join(asset, 'calm');
    const eye = { x: .45, y: .3, width: .03, height: .02, rotation: 0 };
    const m = { ...f.manifest, id, category: 'enemy', gameIds: [], requiredClips: ['idle', 'move'],
      clips: [{ ...f.manifest.clips[0], name: 'idle' }, f.manifest.clips[0]],
      eyeAnchors: { version: 1, frames: f.frames.map(() => ({ left: eye, right: { ...eye, x: .55 } })) } };
    await save(path.join(folder, 'render.json'), m);
    await exportVariantV2(folder, f.root);
    await selectVariantV2(asset, 'calm', 32, 'Approved fleeing enemy.');
    await mkdir(path.join(f.root, 'scripts/asset-pipeline'), { recursive: true });
    await mkdir(path.join(f.root, 'src/config'), { recursive: true });
    await writeDemandCatalog(f.root, { version: 2, assets: [m] });
    await save(path.join(f.root, 'src/config/coopDefenseEnemies.json'), { enemies: [] });
    await writePipelineRegistry(f.root, { version: 2, assets: [] });
    const result = await importRuntime({ root: f.root, revision: m.revision, requestedIds: [id], outputRoot: path.join(f.root, 'published') });
    const imported = result.manifest.assets[0];
    expect(imported).toMatchObject({ category: 'enemy', textureKey: id, sheetTextureKey: `${id}_walking`, gameIds: [], clips: [{ name: 'idle' }, { name: 'move' }] });
    expect(imported.eyeAnchors.source).toMatchObject({ revision: m.revision, sheetSha256: imported.hashes.sheet, idleSha256: imported.hashes.idle });
    expect(result.copiedFiles).toBe(2);
  });

  it('permits idle-only unbound characters but keeps movement mandatory for the player', async () => {
    const { manifest } = await fixture();
    const npc = { ...manifest, category: 'character', gameIds: [], requiredClips: ['idle'],
      clips: [{ ...manifest.clips[0], name: 'idle', motion: 'player_idle' }] };
    expect(() => validateManifestV2(npc)).not.toThrow();
    expect(() => validateManifestV2({ ...npc, gameIds: ['player'] })).toThrow(/move/);
    expect(() => validateManifestV2({ ...npc, requiredClips: ['move', 'idle'] })).toThrow(/move/);
    expect(() => validateManifestV2({ ...npc, clips: [{ ...npc.clips[0], loop: false }] })).toThrow(/loop/);
    expect(() => validateManifestV2({ ...npc, clips: [] })).toThrow();
  });
  it('accepts explicit procedural provenance and safe underscore IDs without accepting missing dependencies', async () => {
    const { manifest } = await fixture();
    const procedural = { ...manifest, id: 'construction_dawn_wreck_t1', materialSource: 'procedural', textures: {} };
    expect(() => validateManifestV2(procedural)).not.toThrow();
    expect(() => validateManifestV2({ ...procedural, materialSource: undefined })).toThrow(/provenance/);
    expect(() => validateManifestV2({ ...procedural, textures: manifest.textures })).toThrow(/Procedural/);
    for (const id of ['../wreck', 'dawn/wreck', 'dawn\\wreck']) expect(() => validateManifestV2({ ...procedural, id })).toThrow();
  });
  it('requires AP0 socket names, finite full-canvas samples and per-egg release markers', async () => {
    const { manifest } = await fixture();
    for (const [role, id] of [['water', 'abyssal-kraken'], ['land', 'abyssal-kraken-land'],
      ['tentacle', 'abyssal-kraken-tentacle'], ['egg', 'abyssal-kraken-egg'], ['spine', 'abyssal-kraken-spine']] as const) {
      expect(requiredSockets(id)).toEqual(KRAKEN_ASSET_REQUIREMENTS[role].sockets);
    }
    const socketFrames = manifest.frames.map((_: unknown, i: number) => Object.fromEntries(requiredSockets('abyssal-kraken')
      .map(name => [name, { x: .2 + i * .1, y: .4, z: i - 2 }])));
    const m = { ...manifest, id: 'abyssal-kraken', socketFrames, sockets: restSockets(socketFrames, 0),
      clips: [...manifest.clips, { name: 'egg-throw', motion: 'fixture', frameRate: 12, loop: false,
        frames: [0, 1, 2, 3, 0, 1, 2], markers: Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`release-${i + 1}`, i])) }] };
    expect(() => validateManifestV2(m)).not.toThrow();
    for (const frames of [socketFrames.slice(1), socketFrames.map((f: object) => ({ ...f, egg6: undefined })),
      socketFrames.map((f: object) => ({ ...f, mouth: { x: 1.01, y: .5, z: 0 } })),
      socketFrames.map((f: object) => ({ ...f, mouth: { x: .5, y: .5, z: NaN } })),
      socketFrames.map((f: object) => ({ ...f, eyeLeft: { x: .5, y: .5, z: 0 } }))]) {
      expect(() => validateSocketFrames(frames, socketFrames.length, requiredSockets(m.id))).toThrow(/socket/i);
    }
    expect(() => validateManifestV2({ ...m, socketFrames: undefined })).toThrow(/Socket/);
    expect(() => validateManifestV2({ ...m, sockets: {} })).toThrow(/Rest sockets/);
    expect(() => validateManifestV2({ ...m, clips: manifest.clips })).toThrow(/release-k/);
    const egg = { ...manifest, id: 'abyssal-kraken-egg', category: 'boss-part',
      clips: [{ ...manifest.clips[0], name: 'hatch', loop: false, markers: { spawn: 1 } }] };
    expect(() => validateManifestV2(egg)).not.toThrow();
    expect(() => validateManifestV2({ ...egg, clips: [{ ...egg.clips[0], markers: {} }] })).toThrow(/spawn/);
  });
  it('accepts arbitrary sortable markers and explicit clip transitions without relaxing claw', async () => {
    const { manifest: m } = await fixture();
    const rise = { name: 'rise', motion: 'fixture', frameRate: 12, loop: false, frames: [0, 1, 2, 3],
      start: 'free', end: 'free', next: 'hover', markers: { release: 3, lift: 0 } };
    const hover = { ...m.clips[0], name: 'hover' };
    const base = { ...m, category: 'boss-part', clips: [rise, hover] };
    expect(() => validateManifestV2(base)).not.toThrow();
    for (const patch of [{ markers: { Bad: 1 } }, { markers: { lift: -1 } }, { markers: { lift: 4 } },
      { markers: { lift: 1.5 } }, { markers: { lift: 1, release: 1 } }, { markers: null },
      { end: 'unknown' }, { start: 'unknown' }, { next: 'missing' }, { end: 'terminal' }, { loop: true }]) {
      expect(() => validateManifestV2({ ...base, clips: [{ ...rise, ...patch }, hover] })).toThrow();
    }
    for (const end of ['free', 'terminal', 'rest']) expect(() => validateManifestV2({ ...base, clips: [{ ...rise, next: undefined, end }, hover] })).not.toThrow();
    expect(() => validateManifestV2({ ...base, clips: [{ ...rise, name: 'claw', end: 'rest', next: undefined, markers: { strike: 1, impact: 2, extra: 0 } }] })).toThrow(/Claw/);
  });

  it('packs multiple trimmed atlas pages with lossless pixels, stable names, canvas and pivot', async () => {
    const inputs = await Promise.all(['#ab523380', '#16aa22ff', '#1122cc40'].map(frame));
    const socketFrames = inputs.map((_, i) => ({ anchor: { x: .1 + i * .1, y: .9, z: i - 1 } }));
    const pages = await packAtlas(inputs, { frameNames: ['clip/0', 'clip/1', 'clip/2'], sourceFrames: [3, 7, 9], size: 64,
      socketFrames, pivot: [.5, .5], prefix: 'atlas/clip', maxSize: 40 });
    expect(pages).toHaveLength(3);
    for (const [i, page] of pages.entries()) {
      expect(page.width).toBeLessThanOrEqual(40); expect(page.height).toBeLessThanOrEqual(40);
      const record = page.metadata.frames[`clip/${i}`];
      expect(record.sockets).toEqual(socketFrames[i]);
      expect(record).toMatchObject({ sourceSize: { w: 64, h: 64 }, pivot: { x: .5, y: .5 },
        spriteSourceSize: { x: 16, y: 16, w: 32, h: 32 }, trimmed: true, sourceFrame: [3, 7, 9][i] });
      const { x, y, w, h } = record.frame;
      const actual = await sharp(page.png).extract({ left: x, top: y, width: w, height: h }).raw().toBuffer();
      const expected = await sharp(inputs[i]).extract({ left: 16, top: 16, width: 32, height: 32 }).raw().toBuffer();
      expect(actual).toEqual(expected);
      const raw = await sharp(page.png).raw().toBuffer();
      expect(raw.subarray(0, page.width * 2 * 4).every(v => v === 0)).toBe(true);
    }
  });

  it('exports hash-bound height atlases and a byte-accurate resident budget without changing sheets', async () => {
    const f = await fixture();
    const elevation = { min: -2, max: 3, scale: .5 };
    const socketFrames = f.manifest.frames.map((_: unknown, i: number) => ({ waterEntry: { x: .2 + .1 * i, y: .8, z: 0 - i } }));
    const m = { ...f.manifest, gameIds: [], displayScale: 2, category: 'boss-part', runtimeAtlas: true, runtimeContract: 'boss', runtimeBudgetMB: 2, elevation,
      socketFrames, sockets: restSockets(socketFrames, 0),
      elevationPass: { ...elevation, encoding: elevationEncoding, waterline: 0, alpha: 'beauty-coverage', masterSize: 64, colorSpace: 'non-color', premultiplied: false },
      clips: [{ name: 'hatch', motion: 'fixture', frameRate: 12, loop: false, frames: [1, 2, 3], end: 'terminal', markers: { release: 1 } }] };
    for (const record of m.frames) {
      const data = await frame('#808080'), base = `elevation/masters/frame-${String(record.index).padStart(4, '0')}`;
      const exr = Buffer.from('Float EXR fixture; Blender verification is separate');
      record.elevation = { file: base + '.png', exrFile: base + '.exr', sha256: hash(data), exrSha256: hash(exr), width: 64, height: 64, encoding: elevationEncoding };
      await mkdir(path.join(f.folder, 'elevation/masters'), { recursive: true });
      await writeFile(path.join(f.folder, record.elevation.file), data);
      await writeFile(path.join(f.folder, record.elevation.exrFile), exr);
    }
    await save(path.join(f.folder, 'render.json'), m);
    const result = await exportVariantV2(f.folder, f.root);
    const sheet = await readFile(path.join(f.folder, 'sheet-32.png'));
    expect(result.sheets[32]).toMatchObject({ frameCount: 4, width: 144, height: 36 });
    expect(result.atlases[32].color.hatch.frameNames).toEqual(result.atlases[32].elevation.hatch.frameNames);
    expect(result.atlases[32].elevation.hatch).toMatchObject({ sourceSize: 16, logicalSourceSize: 32, pivot: [.5, .5] });
    expect(JSON.parse(await readFile(path.join(f.asset, 'budget.json'), 'utf8')).variants.calm).toEqual(result.budget);
    const entry = { ...m, clips: m.clips.map(c => ({ ...c, frameCount: c.frames.length })) };
    const runtime = { ...m, sourceSize: 32, atlases: result.atlases[32], budget: result.budget.sizes[32] };
    expect(result.socketFrames).toEqual(socketFrames);
    expect(result.sockets).toEqual(m.sockets);
    for (const pass of ['color', 'elevation']) for (const page of result.atlases[32][pass].hatch.pages) {
      const metadata = JSON.parse(await readFile(path.join(f.folder, page.json), 'utf8'));
      expect(page.frameNames).toEqual(Object.keys(metadata.frames));
      for (const record of Object.values(metadata.frames) as { sockets: unknown; sourceFrame: number }[]) {
        expect(record.sockets).toEqual(socketFrames[record.sourceFrame]);
      }
    }
    // The static rest projection and page ownership already satisfy unchanged AP0.
    const published = structuredClone(runtime.atlases);
    for (const pass of Object.values(published) as Record<string, { pages: { image: string; json: string }[] }>[]) {
      for (const atlas of Object.values(pass)) for (const page of atlas.pages) {
        page.image = `./assets/${page.image}`; page.json = `./assets/${page.json}`;
      }
    }
    const ap0 = { id: m.id, category: m.category, gameIds: [], revision: m.revision, variant: m.variant,
      sourceSize: 32, textureKey: 'fixture', forward: m.forward, pivot: m.pivot, idleFrame: 0, clips: m.clips,
      runtimeContract: 'boss', targetSize: 32, runtimeBudgetMB: m.runtimeBudgetMB, sockets: m.sockets, socketFrames,
      elevation, elevationPass: { encoding: elevationEncoding, ...elevation, waterline: 0, alpha: 'beauty-coverage', colorSpace: 'non-color', premultiplied: false },
      atlases: published, budget: runtime.budget };
    expect(normalizePipelineAsset(ap0)).toMatchObject({ sockets: m.sockets });
    await expect(verifyBossRuntime(entry, runtime, name => readFile(path.join(f.folder, name)))).resolves.toEqual(runtime.budget);
    const changed = structuredClone(runtime), changedPage = changed.atlases.elevation.hatch.pages[0];
    const metadata = JSON.parse(await readFile(path.join(f.folder, changedPage.json), 'utf8'));
    metadata.frames['hatch/0000'].sockets.waterEntry.z += 1;
    const changedBytes = Buffer.from(JSON.stringify(metadata));
    changedPage.jsonSha256 = hash(changedBytes);
    await expect(verifyBossRuntime(entry, changed, name => name === changedPage.json ? Promise.resolve(changedBytes)
      : readFile(path.join(f.folder, name)))).rejects.toThrow(/socket frame\/pass mapping/);
    await exportVariantV2(f.folder, f.root);
    expect(await readFile(path.join(f.folder, 'sheet-32.png'))).toEqual(sheet);
    await save(path.join(f.folder, 'export.json'), { ...result, socketFrames: socketFrames.slice(1) });
    await expect(selectVariantV2(f.asset, 'calm', 32, 'Reject socket drift.')).rejects.toThrow(/no longer matches/);
    await save(path.join(f.folder, 'export.json'), result);
    const selected = await selectVariantV2(f.asset, 'calm', 32, 'Boss contract fixture.');
    expect(selected.clips[0]).toMatchObject({ end: 'terminal', markers: { release: 1 } });
    expect(selected.atlases).toEqual(runtime.atlases);
    expect(selected.socketFrames).toEqual(socketFrames);
    expect(selected.sockets).toEqual(m.sockets);
    await verifySelectionV2(f.asset);
    // Import the complete selected fixture into a NEW isolated destination, never public/ in the repo.
    await mkdir(path.join(f.root, 'scripts/asset-pipeline'), { recursive: true });
    await mkdir(path.join(f.root, 'src/config'), { recursive: true });
    await writeDemandCatalog(f.root, { version: 2, assets: [{ ...entry, textureKey: 'fixture_boss' }] });
    await save(path.join(f.root, 'src/config/coopDefenseEnemies.json'), { enemies: [] });
    await writePipelineRegistry(f.root, { version: 2, revision: 'original', assets: [] });
    const outputRoot = path.join(f.root, 'isolated-import');
    const imported = await importRuntime({ root: f.root, revision: m.revision, requestedIds: [m.id], outputRoot });
    const publishedAsset = normalizePipelineAsset(imported.manifest.assets[0]);
    expect(publishedAsset).toMatchObject({ runtimeContract: 'boss', textureKey: 'fixture_boss', sourceSize: 32,
      targetSize: 16, displayScale: 2, sockets: m.sockets, socketFrames });
    expect(imported.manifest.assets[0]).not.toHaveProperty('sheetPath');
    expect(imported.manifest.assets[0]).not.toHaveProperty('idlePath');
    expect(JSON.stringify(imported.manifest)).not.toContain('/art/poc/');
    expect(new Set(Object.values(BOSS_TEXTURE_KEYS)).size).toBe(Object.keys(BOSS_TEXTURE_KEYS).length);
    const fileCount = Object.values(runtime.atlases).flatMap((pass: any) => Object.values(pass).flatMap((clip: any) => clip.pages)).length * 2;
    expect(imported.copiedFiles).toBe(fileCount);
    await expect(readFile(path.join(outputRoot, 'public/assets/sprites/pipeline-v2/fixture/idle.png'))).rejects.toThrow();
    expect((await readPipelineRegistry(f.root)).assets).toEqual([]);
    await verifyBossRuntime(entry, publishedAsset, name => readFile(path.join(outputRoot, 'public', name)));
    // Collision detection happens before writing destination files.
    await writePipelineRegistry(f.root, { version: 2, assets: [{ id: 'other', textureKey: 'fixture_boss' }] });
    await expect(importRuntime({ root: f.root, revision: m.revision, requestedIds: [m.id], outputRoot: path.join(f.root, 'collision') })).rejects.toThrow(/Duplicate runtime texture/);
    await expect(readFile(path.join(f.root, 'collision/pipelineAssets.json'))).rejects.toThrow();
    await save(path.join(f.asset, 'selection.json'), { ...selected, socketFrames: socketFrames.slice(1) });
    await expect(verifySelectionV2(f.asset)).rejects.toThrow(/bundle changed/);
    await save(path.join(f.asset, 'selection.json'), selected);
    const page = runtime.atlases.elevation.hatch.pages[0];
    await writeFile(path.join(f.folder, page.image), f.frames[0]);
    await expect(verifySelectionV2(f.asset)).rejects.toThrow(/Selected export changed/);
  });

  it('preserves numeric height and Beauty coverage during reduction and rejects mismatched alpha', async () => {
    const beauty = await frame('#dd2255'), data = await frame('#808080');
    const resized = await resizeElevation(data, beauty, 16);
    const raw = await sharp(resized).raw().toBuffer();
    expect(raw[(8 * 16 + 8) * 4]).toBe(128);
    await expect(verifyElevationPixels(data, beauty, 64)).resolves.toBeUndefined();
    await expect(verifyElevationPixels(await frame('#80808080'), beauty, 64)).rejects.toThrow(/alpha/);
    await expect(verifyElevationPixels(await frame('#ff0080'), beauty, 64)).rejects.toThrow(/scalar/);
  });
  it('preserves claw markers through export and selection and rejects ambiguous timing', async () => {
    const f = await fixture();
    const claw = { name: 'claw', motion: 'claw_quadruped', frameRate: 24, loop: false,
      frames: [0, 1, 2, 3], markers: { strike: 1, impact: 2 } };
    const m = { ...f.manifest, displayScale: 2, clips: [...f.manifest.clips, claw] };
    for (const displayScale of [0, -1, Number.NaN, Infinity, 4]) {
      expect(() => validateManifestV2({ ...m, displayScale })).toThrow(/display scale/);
    }
    for (const bad of [{ ...claw, loop: true }, { ...claw, markers: undefined },
      { ...claw, markers: { strike: 2, impact: 1 } }, { ...claw, markers: { strike: 1, impact: 3 } }]) {
      expect(() => validateManifestV2({ ...m, clips: [m.clips[0], bad] })).toThrow(/Claw/);
    }
    await save(path.join(f.folder, 'render.json'), m);
    await exportVariantV2(f.folder, f.root);
    await selectVariantV2(f.asset, 'calm', 32, 'Contract fixture with explicit attack phase markers.');
    expect((await verifySelectionV2(f.asset)).clips.find(c => c.name === 'claw')).toEqual(claw);
    expect((await verifySelectionV2(f.asset)).displayScale).toBe(m.displayScale);
    const selected = JSON.parse(await readFile(path.join(f.asset, 'selection.json'), 'utf8'));
    await save(path.join(f.asset, 'selection.json'), { ...selected, displayScale: 1 });
    await expect(verifySelectionV2(f.asset)).rejects.toThrow(/bundle changed/);
  });
  it.each(['weapon', 'utility'])('exports and selects a static %s and retains its socket contract', async (category) => {
    const f = await fixture();
    const folder = path.join(f.asset, 'standard');
    await rename(f.folder, folder);
    const manifest = { ...f.manifest, variant: 'standard', category, clips: [], frames: f.manifest.frames.slice(0, 1),
      heldItem: { referenceSize: f.manifest.targetSize, grip: [8, 12], muzzle: [8, 2], referenceGrip: [2, 10] } };
    await save(path.join(folder, 'render.json'), manifest);
    await save(path.join(f.asset, 'build.json'), { status: 'complete', inputHash: hash('resolved fixture'), variants: { standard: { frames: manifest.frames } } });
    expect(() => validateManifestV2({ ...manifest, heldItem: undefined })).toThrow(/grip/);
    await exportRunV2(f.run, f.root);
    const catalog = JSON.parse(await readFile(path.join(f.run, 'catalog.json'), 'utf8'));
    expect(catalog.assets[0].variants.map((v: { variant: string }) => v.variant)).toEqual(['standard']);
    expect(catalog.assets[0].heldItem).toEqual(manifest.heldItem);
    await selectVariantV2(f.asset, 'standard', 32, 'The single idle frame preserves the authored grip.');
    expect(await verifySelectionV2(f.asset)).toMatchObject({ variant: 'standard', clips: [], layout: { frameCount: 1 } });
    const library = JSON.parse(await readFile(path.join(f.root, 'art/poc/asset-library.json'), 'utf8'));
    expect(library.constructions[0].assets[0].id).toBe('fixture');
  });
  it('requires evaluated support evidence for every frame of a mounted turret', async () => {
    const { manifest } = await fixture();
    const m = { ...manifest, category: 'turret', forward: 'east', mount: { rockSize: 32, maxBaseDiameter: 27 },
      frames: manifest.frames.map(frame => ({ ...frame, baseDiameter: 25 })),
      clips: [{ ...manifest.clips[0], name: 'fire', motion: 'mechanical_fire', loop: false }] };
    expect(() => validateManifestV2(m)).not.toThrow();
    expect(() => validateManifestV2({ ...m, frames: m.frames.map((frame, i) => i === 2 ? { ...frame, baseDiameter: 28 } : frame) })).toThrow(/footprint/);
    expect(() => validateManifestV2({ ...m, frames: manifest.frames })).toThrow(/footprint/);
    expect(() => validateManifestV2({ ...m, mount: { rockSize: 32, maxBaseDiameter: 32 } })).toThrow(/32-pixel rock/);
  });

  it('validates frame indices, clip references, required behavior and source provenance', async () => {
    const { manifest: m } = await fixture();
    expect(() => validateManifestV2(m)).not.toThrow();
    expect(() => validateManifestV2({ ...m, idleFrame: 1 })).toThrow(/idleFrame/);
    expect(() => validateManifestV2({ ...m, frames: [{ ...m.frames[0], index: 2 }, ...m.frames.slice(1)] })).toThrow(/frame/);
    expect(() => validateManifestV2({ ...m, clips: [{ ...m.clips[0], frames: [99] }] })).toThrow(/clip/);
    expect(() => validateManifestV2({ ...m, clips: [{ ...m.clips[0], loop: false }] })).toThrow(/loop/);
    expect(() => validateManifestV2({ ...m, clips: [{ ...m.clips[0], name: 'fire' }] })).toThrow(/move/);
    expect(() => validateManifestV2({ ...m, sources: { '../outside.py': hash('outside') } })).toThrow(/path/);
    expect(() => validateManifestV2({ ...m, clips: [m.clips[0], m.clips[0]] })).toThrow(/clip/);
  });

  it('packs untrimmed frames with transparent gutters and exports the true idle frame', async () => {
    const f = await fixture();
    const exported = await exportVariantV2(f.folder, f.root);
    expect(sheetLayout(32, 9)).toMatchObject({ columns: 8, rows: 2, width: 288, height: 72, margin: 2, spacing: 4 });
    expect(exported.sheets[32]).toMatchObject({ width: 144, height: 36, frameWidth: 32, frameHeight: 32, frameCount: 4 });
    const sheet = await readFile(path.join(f.folder, 'sheet-32.png'));
    const { data, info } = await sharp(sheet).raw().toBuffer({ resolveWithObject: true });
    const pixel = (x: number, y: number) => [...data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4)];
    expect(pixel(18, 18)).toEqual([239, 48, 16, 255]);
    expect(pixel(54, 18)).toEqual([37, 187, 85, 255]);
    for (const x of [0, 1, 34, 35, 36, 37, 142, 143]) expect(pixel(x, 18)[3]).toBe(0);
    expect(exported.outputs['sheet-32.png']).toBe(hash(sheet));
    const idle = await readFile(path.join(f.folder, 'sprite-32.png'));
    expect(await sharp(idle).metadata()).toMatchObject({ width: 32, height: 32 });
    expect(exported.outputs['sprite-32.png']).toBe(hash(idle));
    const report = await readFile(path.join(f.folder, 'export.json'));
    await exportVariantV2(f.folder, f.root);
    expect(await readFile(path.join(f.folder, 'export.json'))).toEqual(report);
    expect(await readFile(path.join(f.folder, 'sheet-32.png'))).toEqual(sheet);
  });

  it('rejects incomplete builds, changed masters, packed source or archived input', async () => {
    const f = await fixture();
    await save(path.join(f.asset, 'build.json'), { status: 'rendering', inputHash: hash('resolved fixture') });
    await expect(exportVariantV2(f.folder, f.root)).rejects.toThrow(/incomplete/);
    await save(path.join(f.asset, 'build.json'), { status: 'complete', inputHash: hash('resolved fixture') });
    await exportVariantV2(f.folder, f.root);
    await writeFile(path.join(f.folder, 'masters/frame-0002.png'), f.frames[0]);
    await expect(exportVariantV2(f.folder, f.root)).rejects.toThrow(/Master frame changed/);
    await writeFile(path.join(f.folder, 'masters/frame-0002.png'), f.frames[2]);
    await writeFile(path.join(f.folder, 'asset.blend'), 'changed model');
    await expect(exportVariantV2(f.folder, f.root)).rejects.toThrow(/revision changed/);
    await writeFile(path.join(f.folder, 'asset.blend'), 'Packed Blender fixture');
    await writeFile(path.join(f.asset, 'archive-source/scripts/asset-pipeline/recipes/fixture.py'), 'changed recipe');
    await expect(exportVariantV2(f.folder, f.root)).rejects.toThrow(/Archived source changed/);
  });

  it('publishes consistent sheet metadata and rejects divergent variant clips', async () => {
    const f = await fixture();
    expect(await exportRunV2(f.run, f.root)).toEqual(['fixture']);
    const catalog = JSON.parse(await readFile(path.join(f.run, 'catalog.json'), 'utf8'));
    expect(catalog.version).toBe(2);
    const asset = catalog.assets[0];
    expect(asset.variants).toHaveLength(2);
    expect(asset.variants[0]).toMatchObject({ idleFrame: 0, frameCount: 4, clips: f.manifest.clips });
    expect(asset.variants[0].sources.find((s: { size: number }) => s.size === 32)).toMatchObject({
      url: '/art/poc/pipeline-v2/runs/reference-test/fixture/calm/sheet-32.png',
      idleUrl: '/art/poc/pipeline-v2/runs/reference-test/fixture/calm/sprite-32.png', margin: 2, spacing: 4,
    });
    expect(await sharp(path.join(f.asset, 'review.png')).metadata()).toMatchObject({ format: 'png' });
    const other = await fixture();
    const manifestFile = path.join(other.asset, 'rich/render.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    manifest.clips[0].frameRate = 15;
    await save(manifestFile, manifest);
    await expect(exportRunV2(other.run, other.root)).rejects.toThrow(/Variants disagree/);
  });

  it('binds every selected animation/source file immutably and verifies archive inventory', async () => {
    const f = await fixture();
    await exportRunV2(f.run, f.root);
    const selection = await selectVariantV2(f.asset, 'calm', 32, 'Readable stance and continuous walk.');
    expect(selection).toMatchObject({ version: 2, variant: 'calm', size: 32, idleFrame: 0, clips: f.manifest.clips });
    expect(Object.keys(selection.files)).toEqual(expect.arrayContaining(['calm/sprite-32.png', 'calm/sheet-32.png', 'calm/asset.blend',
      'calm/render.json', 'calm/export.json', 'calm/masters/frame-0003.png', 'build.json', 'archive-source/scripts/asset-pipeline/recipes/fixture.py',
      'archive-source/art/poc/pipeline-v2/textures/organic.png']));
    expect(await verifySelectionV2(f.asset)).toEqual(selection);
    for (const field of ['materialPass', 'shadowMesh']) {
      await save(path.join(f.asset, 'selection.json'), { ...selection, [field]: { version: 1 } });
      await expect(verifySelectionV2(f.asset)).rejects.toThrow(/Selected bundle changed/);
    }
    await save(path.join(f.asset, 'selection.json'), selection);
    const archive = await archiveManifestV2(f.asset);
    expect(archive.files).toMatchObject(selection.files);
    expect(archive.selectionSha256).toBe(hash(await readFile(path.join(f.asset, 'selection.json'))));
    await expect(selectVariantV2(f.asset, 'rich', 32, 'overwrite')).rejects.toThrow(/already exists/);
    await writeFile(path.join(f.folder, 'sheet-32.png'), f.frames[0]);
    await expect(archiveManifestV2(f.asset)).rejects.toThrow(/Selected export changed/);
  });

  it('archives reference images, raw review JSON and its helper without changing render/export provenance', async () => {
    const f = await fixture();
    const reference = 'public/assets/reference.png', previous = 'art/poc/previous.png';
    for (const relative of [reference, previous]) {
      await mkdir(path.dirname(path.join(f.root, relative)), { recursive: true });
      await writeFile(path.join(f.root, relative), f.frames[0]);
    }
    for (const variant of ['calm', 'rich']) {
      const file = path.join(f.asset, variant, 'render.json');
      const manifest = JSON.parse(await readFile(file, 'utf8'));
      await save(file, { ...manifest, reference, previousReference: { label: 'Previous', path: previous } });
    }
    await exportRunV2(f.run, f.root);
    const immutable = ['build.json', 'calm/render.json', 'rich/render.json', 'calm/export.json', 'rich/export.json'];
    const before = await Promise.all(immutable.map(file => readFile(path.join(f.asset, file))));
    const reportFile = path.join(f.root, 'art/poc/qa.json');
    const rawReport = '{ "nominalSize": "readable", "browserVerified": false }\n';
    await writeFile(reportFile, rawReport);
    const result = await prepareReviewV2(f.asset, reportFile, f.root);
    expect(result.references).toEqual([
      { role: 'reference', path: reference, sha256: hash(f.frames[0]) },
      { role: 'previousReference', path: previous, sha256: hash(f.frames[0]) },
    ]);
    expect(result.review).toEqual({ path: 'art/poc/qa.json', assetPath: 'review.json', sha256: hash(rawReport) });
    expect(await readFile(path.join(f.asset, 'review.json'), 'utf8')).toBe(rawReport);
    expect(await readFile(path.join(f.asset, 'archive-source/art/poc/qa.json'), 'utf8')).toBe(rawReport);
    for (const [relative, expected] of Object.entries(result.files)) expect(hash(await readFile(path.join(f.asset, 'archive-source', relative)))).toBe(expected);
    expect(await prepareReviewV2(f.asset, reportFile, f.root)).toEqual(result);
    for (const [index, file] of immutable.entries()) expect(await readFile(path.join(f.asset, file))).toEqual(before[index]);
    const selected = await selectVariantV2(f.asset, 'calm', 32, 'Review input archive fixture.');
    expect(Object.keys(selected.files)).toEqual(expect.arrayContaining(['archive-source/review-inputs.json', `archive-source/${reference}`,
      `archive-source/${previous}`, 'archive-source/art/poc/qa.json', 'archive-source/scripts/asset-pipeline/prepare-review-v2.mjs']));
    await expect(prepareReviewV2(f.asset, reportFile, f.root)).rejects.toThrow(/Selection already exists/);
  });

  it('rejects escaping review references and conflicting source snapshots before writing review files', async () => {
    const f = await fixture();
    const reportFile = path.join(f.root, 'qa.json');
    await save(reportFile, { checked: true });
    for (const variant of ['calm', 'rich']) {
      const file = path.join(f.asset, variant, 'render.json');
      await save(file, { ...f.manifest, variant, reference: '../outside.png' });
    }
    await expect(prepareReviewV2(f.asset, reportFile, f.root)).rejects.toThrow(/repository-relative/);
    await expect(readFile(path.join(f.asset, 'review.json'))).rejects.toThrow(/ENOENT/);
    await expect(prepareReviewV2(f.asset, path.join(f.root, '../outside.json'), f.root)).rejects.toThrow(/escapes/);
    const reference = 'public/reference.png';
    await mkdir(path.join(f.root, 'public'));
    await writeFile(path.join(f.root, reference), f.frames[0]);
    for (const variant of ['calm', 'rich']) await save(path.join(f.asset, variant, 'render.json'), { ...f.manifest, variant, reference });
    const linkedDestination = path.join(f.asset, 'archive-source/public');
    await symlink(path.join(f.root, 'public'), linkedDestination, 'junction');
    await expect(prepareReviewV2(f.asset, reportFile, f.root)).rejects.toThrow(/escapes|symlinks|junctions/);
    await unlink(linkedDestination);
    await mkdir(path.join(f.asset, 'archive-source/public'));
    await writeFile(path.join(f.asset, 'archive-source', reference), f.frames[1]);
    await expect(prepareReviewV2(f.asset, reportFile, f.root)).rejects.toThrow(/Archived review input changed/);
    expect(await readFile(path.join(f.asset, 'archive-source', reference))).toEqual(f.frames[1]);
    await expect(readFile(path.join(f.asset, 'review.json'))).rejects.toThrow(/ENOENT/);
  });

  it('attaches verifier receipts to an explicit external run without changing its source snapshot', async () => {
    const f = await fixture();
    const external = await mkdtemp(path.join(tmpdir(), 'fd-asset-v2-')); roots.push(external);
    const runRoot = path.join(external, 'runs'), asset = path.join(runRoot, 'reference-test/dawn_dealer');
    await mkdir(path.dirname(asset), { recursive: true });
    await rename(f.asset, asset);
    const reference = 'reference.png';
    await writeFile(path.join(f.root, reference), f.frames[0]);
    for (const variant of ['calm', 'rich']) await save(path.join(asset, variant, 'render.json'), { ...f.manifest, id: 'dawn_dealer', variant, reference });
    const receipt = 'verification.json', report = path.join(f.root, 'review.json');
    await save(path.join(f.root, receipt), { status: 'passed' });
    await save(report, { archiveInputs: [receipt] });
    await expect(prepareReviewV2(asset, report, f.root)).rejects.toThrow(/escapes/);
    const result = await prepareReviewV2(asset, report, f.root, { runRoot });
    expect(result.files[receipt]).toBe(hash(await readFile(path.join(f.root, receipt))));
    expect(await readFile(path.join(asset, 'archive-source', receipt))).toEqual(await readFile(path.join(f.root, receipt)));
    await save(report, { archiveInputs: ['../escape.json'] });
    await expect(prepareReviewV2(asset, report, f.root, { runRoot })).rejects.toThrow(/repository-relative/);
    await save(report, { archiveInputs: [receipt] });
    await save(path.join(f.root, receipt), { status: 'changed' });
    await expect(prepareReviewV2(asset, report, f.root, { runRoot })).rejects.toThrow(/Archived review input changed/);
  });
});
import { decodeOct, encodeOct, resizeKrakenElevation } from '../../scripts/asset-pipeline/kraken-material-v2.mjs';

it('averages decoded packed shading normals across the lower-hemisphere seam and preserves Beauty coverage', async () => {
  const a = encodeOct(.02, .02, -1), b = encodeOct(-.02, .02, -1);
  const pixels = Buffer.from([100, ...a, 255, 100, ...b, 255, 100, ...a, 255, 100, ...b, 255]);
  const packed = await sharp(pixels, { raw: { width: 2, height: 2, channels: 4 } }).png().toBuffer();
  const beauty = await sharp({ create: { width: 2, height: 2, channels: 4, background: '#604080' } }).png().toBuffer();
  const result = await sharp(await resizeKrakenElevation(packed, beauty, 1)).raw().toBuffer();
  expect(result[0]).toBe(100); expect(result[3]).toBe(255);
  expect(decodeOct(result[1] / 255, result[2] / 255)[2]).toBeLessThan(-.99);
});
