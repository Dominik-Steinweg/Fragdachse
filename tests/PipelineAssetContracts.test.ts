import { expect, it } from 'vitest';
import { normalizePipelineAsset, normalizePipelineAssets, pipelineEggReleaseSocket, type PipelineBossAsset } from '../src/config/pipelineAssetContracts';
import { PIPELINE_ASSETS, PIPELINE_RUNTIME_ASSETS } from '../src/config/pipelineAssets';
import { KRAKEN_ASSET_REQUIREMENTS, KRAKEN_BOSS_DEFAULTS, validateKrakenAssetBindings } from '../src/config/krakenBoss';

function bossAsset(overrides: Partial<Pick<PipelineBossAsset, 'id' | 'textureKey' | 'clips' | 'sockets'>> = {}): PipelineBossAsset {
  const a: PipelineBossAsset = { runtimeContract: 'boss', id: 'boss', category: 'enemy', gameIds: ['one-boss'],
    revision: 'selected', variant: 'standard', sourceSize: 16, targetSize: 16, textureKey: 'boss_water',
    forward: 'north', pivot: [.5, .5], idleFrame: 0, sockets: { waterEntry: [.5, .8] },
    clips: [{ name: 'idle', frames: [1], frameRate: 10, loop: true }], runtimeBudgetMB: 1,
    elevation: { min: -1, max: 1, scale: .5 }, elevationPass: { encoding: 'linear-unorm8-world-z', min: -1, max: 1, scale: .5,
      waterline: 0, alpha: 'beauty-coverage', colorSpace: 'non-color', premultiplied: false },
    atlases: { color: {}, elevation: {} }, budget: { clips: {}, totals: { color: 0, elevation: 0, total: 0 } } };
  Object.assign(a, overrides);
  a.socketFrames = Array.from({ length: Math.max(a.idleFrame, ...a.clips.flatMap(c => c.frames)) + 1 }, () =>
    Object.fromEntries(Object.entries(a.sockets).map(([name, [x, y]]) => [name, { x, y, z: -2 }])));
  for (const { name, frames } of [{ name: '__rest', frames: [a.idleFrame] }, ...a.clips]) {
    for (const pass of ['color', 'elevation'] as const) {
      const size = pass === 'color' ? 16 : 8, frameNames = frames.map((_, i) => `${name}/${String(i).padStart(4, '0')}`);
      a.atlases[pass][name] = { sourceSize: size, logicalSourceSize: 16, pivot: [.5, .5], sourceFrames: frames,
        frameNames, pages: [{ image: `./assets/${pass}/${name}.png`, json: `./assets/${pass}/${name}.json`,
          sha256: 'a'.repeat(64), jsonSha256: 'b'.repeat(64), width: size, height: size, gpuBytesRGBA8: size * size * 4,
          frameNames }] };
    }
    a.budget.clips[name] = { color: 16 * 16 * 4, elevation: 8 * 8 * 4, total: (16 * 16 + 8 * 8) * 4 };
    for (const key of ['color', 'elevation', 'total'] as const) a.budget.totals[key] += a.budget.clips[name][key];
  }
  return a;
}

it('normalizes the existing sheet manifest and distinguishes boss atlases without sheet fallback', () => {
  expect(PIPELINE_ASSETS.length).toBeGreaterThan(0);
  expect(PIPELINE_ASSETS.every(a => a.runtimeContract === 'sheet')).toBe(true);
  expect(PIPELINE_RUNTIME_ASSETS.length).toBeGreaterThanOrEqual(PIPELINE_ASSETS.length);
  expect(normalizePipelineAsset(bossAsset())).toEqual(bossAsset());
  expect(() => normalizePipelineAsset({ ...bossAsset(), sheetPath: './assets/redundant.png' })).toThrow();
});

it('binds each kraken role to required clips, semantic markers and full-canvas sockets', () => {
  const assets = (['water', 'land', 'tentacle', 'egg'] as const).map(role => {
    const required = KRAKEN_ASSET_REQUIREMENTS[role];
    return normalizePipelineAsset(bossAsset({ id: KRAKEN_BOSS_DEFAULTS.assets[role], textureKey: `kraken_${role}`,
      sockets: Object.fromEntries(required.sockets.map(s => [s, [.5, .5]])),
      clips: Object.entries(required.clips).map(([name, markers]) => ({ name, frames: [1, 2, 3, 4, 5, 6], frameRate: 10, loop: false,
        markers: Object.fromEntries(markers.map((m, i) => [m, i])) })),
    })) as PipelineBossAsset;
  });
  expect(() => validateKrakenAssetBindings(KRAKEN_BOSS_DEFAULTS, assets)).not.toThrow();
  const egg = assets.find(a => a.id === KRAKEN_BOSS_DEFAULTS.assets.egg)!;
  delete egg.clips.find(c => c.name === 'hatch')!.markers!.spawn;
  expect(() => validateKrakenAssetBindings(KRAKEN_BOSS_DEFAULTS, assets)).toThrow('hatch');
});

it('keeps world-z and resolves release sockets by clip marker and source frame, never rest pose', () => {
  const asset = bossAsset({ clips: [{ name: 'egg-throw', frames: [2, 1], frameRate: 10, loop: false,
    markers: { 'release-1': 0 } }], sockets: { egg1: [.5, .5] } });
  asset.socketFrames![2].egg1 = { x: .2, y: .8, z: -7 };
  const normalized = normalizePipelineAsset(asset) as PipelineBossAsset;
  expect(pipelineEggReleaseSocket(normalized, 1)).toEqual({ x: .2, y: .8, z: -7 });
  expect(() => pipelineEggReleaseSocket(normalized, 0)).toThrow();
  expect(() => pipelineEggReleaseSocket(normalized, 2)).toThrow();
  for (const mutate of [
    (a: PipelineBossAsset) => { a.socketFrames!.pop(); },
    (a: PipelineBossAsset) => { a.socketFrames![1].egg1.z = Infinity; },
    (a: PipelineBossAsset) => { a.socketFrames![1].egg1.x = 2; },
    (a: PipelineBossAsset) => { delete a.socketFrames![1].egg1; },
    (a: PipelineBossAsset) => { a.socketFrames![0].egg1.x = .1; },
  ]) {
    const invalid = structuredClone(asset); mutate(invalid);
    expect(() => normalizePipelineAsset(invalid)).toThrow();
  }
});

it('rejects duplicate texture identities, invalid pass/page ownership and inconsistent budgets', () => {
  const a = bossAsset();
  expect(() => normalizePipelineAssets([a, { ...a, id: 'land' }])).toThrow('texture');
  const cases = [bossAsset(), bossAsset(), bossAsset(), bossAsset(), bossAsset()];
  cases[0].atlases.elevation.idle.frameNames = ['other/0000'];
  cases[1].atlases.color.idle.pages[0].gpuBytesRGBA8++;
  cases[2].budget.totals.total++;
  cases[3].runtimeBudgetMB = .00001;
  cases[4].atlases.color.idle.pages[0].frameNames = ['missing'];
  for (const asset of cases) expect(() => normalizePipelineAsset(asset)).toThrow();
});

it('rejects preview URLs, stale source size, unknown clip markers and missing sockets', () => {
  const a = bossAsset(); a.atlases.color.idle.pages[0].image = '/art/poc/run/image.png';
  expect(() => normalizePipelineAsset(a)).toThrow();
  expect(() => normalizePipelineAsset({ ...bossAsset(), targetSize: 32 })).toThrow('displayed');
  const b = bossAsset(); b.clips[0].markers = { spawn: b.clips[0].frames.length };
  expect(() => normalizePipelineAsset(b)).toThrow();
  expect(() => normalizePipelineAsset({ ...bossAsset(), sockets: undefined })).toThrow();
});
