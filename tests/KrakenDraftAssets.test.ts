import { afterEach, expect, it, vi } from 'vitest';
import { loadKrakenDraftMetadata, reloadKrakenDraftAssets, updateKrakenDraftFilters } from '../src/dev/scenario/KrakenDraftAssets';
import { PIPELINE_RUNTIME_ASSETS } from '../src/config/pipelineAssets';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it('rejects draft loading and source switching outside Dev before any request', async () => {
  vi.stubEnv('DEV', false); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  await expect(loadKrakenDraftMetadata(null, 'draft')).rejects.toThrow(/Dev-only/);
  expect(() => reloadKrakenDraftAssets('draft')).toThrow(/Dev-only/);
  expect(fetch).not.toHaveBeenCalled();
});
it('falls back per role to independent production metadata when no draft exists', async () => {
  vi.stubEnv('DEV', true); const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const result = await loadKrakenDraftMetadata(null, 'draft');
  expect(result.assets.water).toEqual(PIPELINE_RUNTIME_ASSETS.find(a => a.id === 'abyssal-kraken'));
  expect(result.assets.water).not.toBe(PIPELINE_RUNTIME_ASSETS.find(a => a.id === 'abyssal-kraken'));
  const before = structuredClone(result.assets); result.resolvePaths();
  expect(result.assets).toEqual(before); expect(fetch).not.toHaveBeenCalled();
});
it('validates draft paths and the full runtime contract before changing URLs', async () => {
  vi.stubEnv('DEV', true);
  const asset = structuredClone(PIPELINE_RUNTIME_ASSETS.find(a => a.id === 'abyssal-kraken'))!;
  asset.revision = 'draft-fixture';
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(asset))));
  const version = { version: 'draft-fixture', publishedAt: 1, startedAt: 0, assets: { 'abyssal-kraken': { label: 'draft-fixture' } } };
  const result = await loadKrakenDraftMetadata(version, 'draft');
  const first = result.assets.water!.atlases.color.__rest.pages[0];
  expect(first.image).toMatch(/^\.\/assets\//);
  result.resolvePaths();
  expect(first.image).toMatch(/^\/art\/poc\/pipeline-v2\/drafts\/abyssal-kraken\/draft-fixture\/standard\//);
  version.assets['abyssal-kraken'].label = '../production';
  await expect(loadKrakenDraftMetadata(version, 'draft')).rejects.toThrow(/label/);
});
it('updates copied height bounds only for filters belonging to the reloaded residency', () => {
  vi.stubEnv('DEV', true);
  const filter = (key: string) => ({ renderNode: 'KrakenSubmersion', elevationFrame: { texture: { key } }, elevationMin: -1, elevationMax: 1 });
  const owned = filter('water:scope1:idle'), unrelated = filter('water:scope2:idle');
  const scene = { children: { list: [{ filters: { internal: { list: [owned, unrelated] } } }] } };
  updateKrakenDraftFilters(scene as never, { water: { textureKey: 'water' } } as never,
    { water: { elevation: { min: -4, max: 8 } } } as never, key => key.includes(':scope1:'));
  expect([owned.elevationMin, owned.elevationMax]).toEqual([-4, 8]);
  expect([unrelated.elevationMin, unrelated.elevationMax]).toEqual([-1, 1]);
});
