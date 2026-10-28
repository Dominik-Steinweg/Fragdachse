import { afterEach, expect, it, vi } from 'vitest';
import { loadShapeDraft, ShapeDraftSpawn } from '../src/dev/scenario/ShapeDraftSpawn';
import { PIPELINE_RUNTIME_ASSETS } from '../src/config/pipelineAssets';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('rejects shape assets outside Dev before any IO or scene mutation', async () => {
  vi.stubEnv('DEV', false); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(loadShapeDraft('rabid-rabbit', new AbortController().signal)).rejects.toThrow(/Dev-only/);
  expect(() => new ShapeDraftSpawn({} as never)).toThrow(/Dev-only/);
  expect(fetch).not.toHaveBeenCalled();
});
it('loads only a completed shape export through validated local asset paths', async () => {
  vi.stubEnv('DEV', true);
  const asset = structuredClone(PIPELINE_RUNTIME_ASSETS.find(a => a.id === 'rabid-rabbit'))!;
  asset.revision = 'shape-example';
  const responses = [{ label: 'example' }, { status: 'complete', mode: 'shape', id: asset.id, draft: { label: asset.revision } }, asset];
  const fetch = vi.fn(async () => new Response(JSON.stringify(responses.shift()))); vi.stubGlobal('fetch', fetch);
  const result = await loadShapeDraft('rabid-rabbit', new AbortController().signal);
  expect(result.asset.runtimeContract).toBe('sheet');
  expect(result.url).toMatch(/^\/art\/poc\/pipeline-v2\/drafts\/rabid-badger\/shape-example\/standard\//);
  await expect(loadShapeDraft('../production', new AbortController().signal)).rejects.toThrow(/Invalid/);
  expect(fetch).toHaveBeenCalledTimes(3);
});
it('cancels a pending static spawn and never adds textures after teardown', async () => {
  vi.stubEnv('DEV', true);
  const fetch = vi.fn((_url: string, options: RequestInit) => new Promise((_resolve, reject) => {
    options.signal!.addEventListener('abort', () => reject(new Error('cancelled')));
  })); vi.stubGlobal('fetch', fetch);
  const scene = { textures: { exists: vi.fn(() => false), addImage: vi.fn(), remove: vi.fn() }, add: { image: vi.fn() } };
  const fixture = new ShapeDraftSpawn(scene as never), pending = fixture.initialize('rabid-rabbit', 0, 0);
  fixture.destroy(); fixture.destroy();
  await expect(pending).rejects.toThrow(/cancelled/);
  expect(scene.textures.addImage).not.toHaveBeenCalled(); expect(scene.add.image).not.toHaveBeenCalled();
});

it('owns only its static texture and image, releasing both on teardown', async () => {
  vi.stubEnv('DEV', true);
  const asset = structuredClone(PIPELINE_RUNTIME_ASSETS.find(a => a.id === 'rabid-rabbit'))!;
  asset.revision = 'shape-static';
  const responses = [{ label: 'static' }, { status: 'complete', mode: 'shape', id: asset.id, draft: { label: asset.revision } }, asset];
  vi.stubGlobal('fetch', vi.fn(async () => responses.length ? new Response(JSON.stringify(responses.shift())) : new Response(new Blob(['image']))));
  vi.stubGlobal('Image', class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  const sprite = { setOrigin: vi.fn().mockReturnThis(), setDisplaySize: vi.fn().mockReturnThis(), setDepth: vi.fn().mockReturnThis(), destroy: vi.fn() };
  const scene = { textures: { exists: vi.fn(() => true), addImage: vi.fn(() => ({})), remove: vi.fn() }, add: { image: vi.fn(() => sprite) } };
  const fixture = new ShapeDraftSpawn(scene as never);
  await fixture.initialize('rabid-rabbit', 10, 20);
  const key = scene.textures.addImage.mock.calls[0][0];
  expect(scene.add.image).toHaveBeenCalledWith(10, 20, key);
  expect(sprite.setDisplaySize).toHaveBeenCalledWith(asset.sourceSize, asset.sourceSize);
  fixture.destroy(); fixture.destroy();
  expect(sprite.destroy).toHaveBeenCalledTimes(1); expect(scene.textures.remove).toHaveBeenCalledExactlyOnceWith(key);
});
