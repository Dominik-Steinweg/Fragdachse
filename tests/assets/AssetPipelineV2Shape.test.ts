import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { shapeInputs, shapeOptions, restRecords, watchShapes, publishShapeDraft } from '../../scripts/asset-pipeline/shape-v2.mjs';
import { silhouetteMetrics, differenceOverlay } from '../../scripts/asset-pipeline/shape-board-v2.mjs';
import { exportDraft } from '../../scripts/asset-pipeline/draft-v2.mjs';
import { normalizePipelineAsset } from '../../src/config/pipelineAssetContracts';

const folders: string[] = [];
async function fixture() { const root = await mkdtemp(path.join(tmpdir(), 'fd-shape-')); folders.push(root); return root; }
async function save(root: string, name: string, data: unknown) {
  const file = path.join(root, name); await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data));
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const folder of folders.splice(0)) {
    if (!folder.startsWith(path.join(tmpdir(), 'fd-shape-'))) throw Error('Unsafe cleanup');
    await rm(folder, { recursive: true, force: true });
  }
});

it('tracks transitive model and texture edits, excluding motion and catalog clips from the model', async () => {
  const root = await fixture(), base = 'scripts/asset-pipeline/';
  for (const name of ['blender_pipeline.py', 'shape-v2.py', 'draft-v2.py', 'motions_v2.py', 'parts.py']) await save(root, base + name, '# fixture');
  await save(root, base + 'recipes_v2/test.py', 'from parts import build\nimport motions_v2');
  await save(root, 'texture.png', 'pixels');
  const spec = { id: 'test', recipe: 'test', clips: [{ name: 'move', frameCount: 12 }], requiredClips: ['move'], textures: { organic: 'texture.png' }, model: { length: 1 } };
  await save(root, base + 'catalog-v2.json', { assets: [spec] });
  const before = await shapeInputs(root, 'test', {});
  expect(before.modelSpec.clips).toEqual([]);
  await save(root, base + 'motions_v2.py', '# edit motion');
  spec.clips[0].frameCount++;
  await save(root, base + 'catalog-v2.json', { assets: [spec] });
  expect((await shapeInputs(root, 'test', {})).modelHash).toBe(before.modelHash);
  await save(root, base + 'parts.py', '# edit model');
  expect((await shapeInputs(root, 'test', {})).modelHash).not.toBe(before.modelHash);
  await save(root, base + 'parts.py', '# fixture');
  await save(root, 'texture.png', 'changed pixels');
  expect((await shapeInputs(root, 'test', {})).modelHash).not.toBe(before.modelHash);
  expect((await shapeInputs(root, 'test', { voxelScale: 2 })).modelHash).not.toBe((await shapeInputs(root, 'test', {})).modelHash);
});

it('rejects unsafe labels, empty views and invalid model/render settings before rendering', () => {
  expect(() => shapeOptions(['test', '--label', '../run'])).toThrow();
  expect(() => shapeOptions(['test', '--views', ''])).toThrow();
  expect(() => shapeOptions(['test', '--samples', '0'])).toThrow();
  expect(() => shapeOptions(['test', '--model-settings', '{"voxelScale":0}'])).toThrow();
  expect(shapeOptions(['test', '--model-settings', '{}']).modelSettings).toEqual({});
});

it('measures fixed-canvas bounds and detects added/removed silhouette pixels without recentering', async () => {
  const a = Buffer.alloc(8 * 8 * 4), b = Buffer.alloc(a.length);
  a.set([100, 100, 100, 255], (2 * 8 + 1) * 4);
  b.set([100, 100, 100, 255], (2 * 8 + 5) * 4);
  const image = (buffer: Buffer) => sharp(buffer, { raw: { width: 8, height: 8, channels: 4 as const } }).png().toBuffer();
  const [before, after] = await Promise.all([image(a), image(b)]);
  expect(await silhouetteMetrics(before)).toMatchObject({ silhouetteArea: 1, canvasMargin: 1, bbox: { x: 1, y: 2, width: 1, height: 1 } });
  expect((await differenceOverlay(before, after)).changedPixels).toBe(2);
  expect((await differenceOverlay(before, before)).changedPixels).toBe(0);
});

it('exports every authored clip as a single rest frame with valid runtime markers', async () => {
  const root = await fixture();
  const spec = { id: 'test', category: 'enemy', gameIds: ['test'], recipe: 'test', forward: 'north', pivot: [.5, .5], targetSize: 8,
    clips: [{ name: 'move', frameCount: 12, frameRate: 12, loop: true }, { name: 'attack', frameCount: 8, frameRate: 24, loop: false, markers: { impact: 5 } }] };
  const pixel = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#cc8040ff' } }).png().toBuffer();
  await save(root, 'top.png', pixel);
  await exportDraft(root, spec, 'shape-test', restRecords(spec, { beauty: 'top.png', color: 'top.png', sockets: {} }));
  const runtime = normalizePipelineAsset(JSON.parse(await readFile(path.join(root, 'runtime.json'), 'utf8')));
  expect(runtime.clips.map(c => c.frames.length)).toEqual([1, 1]);
  expect(runtime.clips[1].markers?.impact).toBe(0);
});

it('watch serializes builds and catches edits made during a build; failures preserve the watch loop', async () => {
  const abort = new AbortController(), labels: string[] = [];
  let hash = 'one', active = 0, maxActive = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  await watchShapes({ id: 'test', label: 'watch', modelSettings: {} }, '', { signal: abort.signal, interval: 1,
    inputs: async () => ({ modelHash: hash }),
    build: async (options: { label: string }) => {
      labels.push(options.label); maxActive = Math.max(maxActive, ++active);
      await new Promise(resolve => setTimeout(resolve, 2));
      active--;
      if (hash === 'one') { hash = 'two'; throw Error('saved during build'); }
      abort.abort();
    } });
  expect(labels).toHaveLength(2); expect(new Set(labels).size).toBe(2); expect(maxActive).toBe(1);
});

it('publishes a rest export without losing other draft roles or accepting replacement labels', async () => {
  const root = await fixture();
  const spec = { id: 'test', category: 'enemy', gameIds: ['test'], recipe: 'test', forward: 'north', pivot: [.5, .5], targetSize: 8, clips: [] };
  const pixel = await sharp({ create: { width: 8, height: 8, channels: 4, background: '#cc8040ff' } }).png().toBuffer();
  await save(root, 'top.png', pixel);
  const versionFile = 'art/poc/pipeline-v2/drafts/version.json';
  await save(root, versionFile, { version: 'old', assets: { 'abyssal-kraken': { label: 'keep-me' } } });
  const rendered = { frame: { beauty: 'top.png', color: 'top.png', sockets: {} } }, started = '2026-10-12T10:00:00Z';
  await publishShapeDraft(root, root, spec, 'fixture', rendered, started);
  const version = JSON.parse(await readFile(path.join(root, versionFile), 'utf8'));
  expect(version.assets).toEqual({ 'abyssal-kraken': { label: 'keep-me' }, test: { label: 'shape-fixture' } });
  expect(version.startedAt).toBe(Date.parse(started));
  await expect(publishShapeDraft(root, root, spec, 'fixture', rendered, started)).rejects.toThrow();
  expect(JSON.parse(await readFile(path.join(root, versionFile), 'utf8'))).toEqual(version);
});
