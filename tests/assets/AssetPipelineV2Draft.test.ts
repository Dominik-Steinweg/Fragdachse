import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { assertProductionFinished, digest, exportDraft, fingerprints, krakenAssets, planClips } from '../../scripts/asset-pipeline/draft-v2.mjs';
import { normalizePipelineAsset } from '../../src/config/pipelineAssetContracts';
import { verifyBossRuntime } from '../../scripts/asset-pipeline/runtime-contract-v2.mjs';

const roots: string[] = [];
async function root() { const value = await mkdtemp(path.join(tmpdir(), 'fd-draft-')); roots.push(value); return value; }
async function save(root: string, file: string, value: unknown) {
  const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}
afterEach(async () => {
  for (const dir of roots.splice(0)) {
    if (!dir.startsWith(path.join(tmpdir(), 'fd-draft-'))) throw Error('Unsafe cleanup');
    await rm(dir, { recursive: true, force: true });
  }
});

it('invalidates clips for motion/catalog changes while retaining the model; shared model edits invalidate all', async () => {
  const dir = await root(), base = 'scripts/asset-pipeline/';
  for (const file of ['blender_pipeline.py', 'draft-v2.py', 'motions_v2.py', 'kraken_motion_v2.py', 'recipes_v2/example.py']) await save(dir, base + file, '# fixture');
  const spec = { recipe: 'example', clips: [{ name: 'one', motion: 'kraken_one' }, { name: 'two', motion: 'kraken_two' }] };
  const initial = await fingerprints(dir, spec, {});
  expect(planClips(initial, initial)).toEqual([]);
  const edited = structuredClone(spec); edited.clips[0].motion = 'kraken_changed';
  const clip = await fingerprints(dir, edited, {});
  expect(clip.modelHash).toBe(initial.modelHash);
  expect(planClips(clip, initial)).toEqual(['one', '__rest']);
  await save(dir, base + 'kraken_motion_v2.py', '# motion changed');
  const motion = await fingerprints(dir, spec, {});
  expect(motion.modelHash).toBe(initial.modelHash);
  expect(planClips(motion, initial)).toEqual(['one', 'two', '__rest']);
  expect(planClips(motion, initial, ['one'])).toEqual(['one', '__rest']);
  await save(dir, base + 'recipes_v2/example.py', '# model changed');
  const model = await fingerprints(dir, spec, {});
  expect(model.modelHash).not.toBe(initial.modelHash);
  expect(planClips(model, initial, ['one'])).toEqual(['one', 'two', '__rest']);
  expect(planClips(initial, initial, undefined, true)).toEqual(['one', 'two', '__rest']);
  expect(() => planClips(initial, initial, ['unknown'])).toThrow();
});

it('will not start GPU work while any of the five production jobs is incomplete or failed', async () => {
  const dir = await root(), file = 'art/poc/kraken-v13/build/build-times.json';
  const rows = krakenAssets.map((asset: string) => ({ asset, ended: 'done', exitCode: 0 }));
  await save(dir, file, rows.slice(0, 4)); await expect(assertProductionFinished(dir)).rejects.toThrow(/five/);
  await save(dir, file, rows); await expect(assertProductionFinished(dir)).resolves.toBeUndefined();
  rows[4].exitCode = 1; await save(dir, file, rows); await expect(assertProductionFinished(dir)).rejects.toThrow();
});

it('exports production-compatible color/elevation/emission atlases, sockets, markers, mesh bytes and budgets', async () => {
  const dir = await root();
  const spec = { id: 'fixture', category: 'boss-part', gameIds: [], runtimeContract: 'boss', runtimeAtlas: true, recipe: 'fixture',
    targetSize: 8, sourceSizes: [8], orthoScale: 2, pivot: [.5, .5], forward: 'north', runtimeBudgetMB: 16,
    elevation: { min: -2, max: 2, scale: .5 },
    materialPass: { version: 1, color: 'srgb-albedo-baked-cavity-v1', normal: 'linear-unorm8-z-oct-normal-v1', emission: 'linear-rgb-unorm8-scaled-v1' },
    clips: [{ name: 'idle', motion: 'fixture', frameCount: 2, frameRate: 12, loop: true, markers: { impact: 1 }, end: 'rest' }] };
  const image = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#8080ffff' } }).png().toBuffer();
  const records: Record<string, { frames: object[] }> = {};
  for (const [name, count] of [['__rest', 1], ['idle', 2]] as const) {
    const frames = [];
    for (let i = 0; i < count; i++) {
      const prefix = `clips/${name}/${i}`;
      await save(dir, prefix + '.png', image);
      const positions = Buffer.alloc(18), indices = Buffer.from(new Uint16Array([0, 1, 2]).buffer);
      await save(dir, prefix + '-p.bin', positions); await save(dir, prefix + '-i.bin', indices);
      frames.push({ color: prefix + '.png', elevation: prefix + '.png', emission: prefix + '.png', sockets: { tip: { x: .5, y: .5, z: 1 } },
        mesh: { vertexCount: 3, triangleCount: 1, bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          positions: { file: prefix + '-p.bin', bytes: positions.length, sha256: digest(positions) },
          indices: { file: prefix + '-i.bin', bytes: indices.length, sha256: digest(indices) } } });
    }
    records[name] = { frames };
  }
  await exportDraft(dir, spec, 'fixture-draft', records);
  const asset = normalizePipelineAsset(JSON.parse(await readFile(path.join(dir, 'runtime.json'), 'utf8')));
  expect(asset.runtimeContract).toBe('boss');
  expect(asset.clips[0].markers).toEqual({ impact: 1 });
  await expect(verifyBossRuntime(spec, asset, (file: string) => readFile(path.join(dir, file.replace('./assets/', ''))))).resolves.toBeDefined();
  const exported = JSON.parse(await readFile(path.join(dir, 'export.json'), 'utf8'));
  expect(exported.manifest.socketFrames).toHaveLength(3);
  expect(exported.atlases[8].color.idle.sourceFrames).toEqual([1, 2]);
});
