import { describe, expect, it, vi } from 'vitest';
import { createKrakenResidencyPort, KrakenAssetResidency, type KrakenAssetRole, type KrakenPreparedPage, type KrakenResidencyPort } from '../src/effects/kraken/KrakenAssetResidency';
import type { PipelineBossAsset } from '../src/config/pipelineAssetContracts';
import { genericEnemyImageKeys, getWalkingSheetForStaticTexture } from '../src/animations/BadgerAnimations';
vi.mock('phaser', () => ({}));

function fixture() {
  const names = {
    water: ['idle', 'move', 'intro-rise', 'ink-spit', 'egg-throw', 'dive', 'surface'],
    land: ['idle', 'move', 'ashore', 'ink-spit', 'slam', 'egg-throw', 'death'],
    tentacle: ['rise', 'hover', 'slam', 'retract'], egg: ['idle', 'hatch'],
  };
  return Object.fromEntries(Object.entries(names).map(([role, clips]) => {
    const asset: PipelineBossAsset = {
      id: role, category: ['water', 'land'].includes(role) ? 'enemy' : 'boss-part', gameIds: [],
      runtimeContract: 'boss', revision: 'fixture', variant: 'standard', textureKey: `kraken_${role}`,
      targetSize: 8, displayScale: 2, sourceSize: 16, forward: 'north', pivot: [.5, .5], idleFrame: 0,
      clips: clips.map((name, i) => ({ name, frames: [i + 1], frameRate: 10, loop: false })),
      sockets: { tip: [.5, .5] }, socketFrames: Array.from({ length: clips.length + 1 }, (_, z) => ({ tip: { x: .5, y: .5, z } })),
      runtimeBudgetMB: 1, elevation: { min: -2, max: 8, scale: .5 },
      elevationPass: { encoding: 'linear-unorm8-world-z', min: -2, max: 8, scale: .5, waterline: 0,
        alpha: 'beauty-coverage', colorSpace: 'non-color', premultiplied: false },
      atlases: { color: {}, elevation: {} }, budget: { clips: {}, totals: { color: 0, elevation: 0, total: 0 } },
    };
    for (const c of [{ name: '__rest', frames: [0] }, ...asset.clips]) {
      const bytes = asset.budget.clips[c.name] = { color: 0, elevation: 0, total: 0 };
      for (const pass of ['color', 'elevation'] as const) {
        const size = pass === 'color' ? 16 : 8, frameNames = [`${c.name}/0000`];
        bytes[pass] = size * size * 4;
        asset.atlases[pass][c.name] = { sourceSize: size, logicalSourceSize: 16, pivot: [.5, .5],
          sourceFrames: c.frames, frameNames, pages: [{ image: `./assets/${role}/${pass}/${c.name}.png`,
            json: `./assets/${role}/${pass}/${c.name}.json`, sha256: 'a'.repeat(64), jsonSha256: 'b'.repeat(64),
            width: size, height: size, gpuBytesRGBA8: bytes[pass], frameNames }] };
      }
      bytes.total = bytes.color + bytes.elevation;
      for (const key of ['color', 'elevation', 'total'] as const) asset.budget.totals[key] += bytes[key];
    }
    return [role, asset];
  })) as Record<KrakenAssetRole, PipelineBossAsset>;
}
function harness(options = {}) {
  const events: string[] = [], textures = new Set<string>();
  const prepared = (): KrakenPreparedPage => ({ register: key => { events.push(`add:${key}`); textures.add(key); }, dispose: vi.fn() });
  const port: KrakenResidencyPort = {
    prepare: vi.fn(async () => prepared()),
    remove: key => { events.push(`remove:${key}`); textures.delete(key); }, diagnose: vi.fn(),
  };
  const residency = new KrakenAssetResidency(fixture(), port, { waterBudgetMiB: 1, landBudgetMiB: 1,
    peakBudgetMiB: 2, additionalGpuBytes: () => 0, ...options });
  return { residency, port, events, textures, prepared };
}

describe('Kraken phase residency', () => {
  it('matches independently packed color/elevation pages by frame ownership, not page index', async () => {
    const assets = fixture(), asset = assets.land;
    asset.clips.find(c => c.name === 'idle')!.frames = [1, 2];
    for (const pass of ['color', 'elevation'] as const) {
      const atlas = asset.atlases[pass].idle;
      atlas.frameNames = ['idle/0000', 'idle/0001']; atlas.sourceFrames = [1, 2];
      if (pass === 'color') {
        atlas.pages.push({ ...atlas.pages[0], image: './assets/land/color/idle-2.png', json: './assets/land/color/idle-2.json', frameNames: ['idle/0001'] });
        const bytes = atlas.pages[1].gpuBytesRGBA8;
        asset.budget.clips.idle.color += bytes; asset.budget.clips.idle.total += bytes;
        asset.budget.totals.color += bytes; asset.budget.totals.total += bytes;
      } else atlas.pages[0].frameNames = [...atlas.frameNames];
    }
    const h = harness(), residency = new KrakenAssetResidency(assets, h.port, { waterBudgetMiB: 1,
      landBudgetMiB: 1, peakBudgetMiB: 2, additionalGpuBytes: () => 0 });
    await residency.setPhase('land').settled;
    const pose = residency.acquirePose('land', 'idle', 1, vi.fn())!.pose;
    expect(pose).toMatchObject({ frame: 'idle/0001', elevationFrame: 'idle/0001', sourceFrame: 2, fallback: false });
    expect(pose.key).toMatch(/:color:1$/); expect(pose.elevationKey).toMatch(/:elevation:0$/);
    residency.detach();
  });

  it('loads current-phase rests first on late join, pairs named passes and preserves full canvas/sockets', async () => {
    const h = harness(), work = h.residency.setPhase('land');
    expect(await work.ready).toBe(true);
    const fallback = h.residency.acquirePose('land', 'death', 0, vi.fn())!;
    expect(fallback.pose).toMatchObject({ fallback: true, frame: '__rest/0000', elevationFrame: '__rest/0000',
      displaySize: 16, sourceSize: 16, sockets: { tip: { x: .5, y: .5, z: 0 } } });
    fallback.release();
    await work.settled;
    expect(h.events.some(e => /kraken_water|kraken_tentacle/.test(e))).toBe(false);
    const lease = h.residency.acquirePose('land', 'death', 0, vi.fn())!;
    expect(lease.pose).toMatchObject({ frame: 'death/0000', elevationFrame: 'death/0000', fallback: false,
      sourceFrame: 7, sockets: { tip: { x: .5, y: .5, z: 7 } } });
    expect(h.textures.has(lease.pose.elevationKey)).toBe(true);
    h.residency.detach(); expect(h.textures.size).toBe(0);
  });

  it('shares atlases across parts, retains leased transition pages, and releases consumers before textures', async () => {
    const h = harness(); await h.residency.setPhase('intro').settled;
    const cleanup = vi.fn(() => h.events.push('filter-removed'));
    const a = h.residency.acquirePose('tentacle', 'slam', 0, cleanup)!;
    const b = h.residency.acquirePose('tentacle', 'slam', 0, cleanup)!;
    expect(a.pose.key).toBe(b.pose.key);
    h.residency.ownDependent(() => h.events.push('intro-animation-removed'));
    await h.residency.setPhase('water').settled;
    expect([...h.textures].some(k => k.includes('intro-rise'))).toBe(false);
    expect(h.events.indexOf('intro-animation-removed')).toBeLessThan(h.events.findIndex(e => e.startsWith('remove:') && e.includes('intro-rise')));
    expect([...h.textures].some(k => k.includes(':move:'))).toBe(false);
    await h.residency.setPhase('ashore').settled;
    a.release(); expect(h.textures.has(a.pose.key)).toBe(true);
    b.release(); expect(h.textures.has(a.pose.key)).toBe(false);
    expect(h.events.lastIndexOf('filter-removed')).toBeLessThan(h.events.indexOf(`remove:${a.pose.key}`));
    await h.residency.setPhase('land', { activeEggs: false }).settled;
    expect([...h.textures].every(k => k.startsWith('kraken_land') && !k.includes(':ashore:'))).toBe(true);
    h.residency.ownDependent(() => h.events.push('animation-removed'));
    h.residency.detach(); h.residency.detach();
    expect(h.textures.size).toBe(0);
    expect(h.events.indexOf('animation-removed')).toBeLessThan(h.events.lastIndexOf(`remove:${[...h.events].reverse().find(e => e.startsWith('add:'))!.slice(4)}`));
  });

  it('deduplicates in-flight work and disposes late success without registration after detach', async () => {
    const h = harness(), pending: ((page: KrakenPreparedPage) => void)[] = [];
    h.port.prepare = vi.fn(() => new Promise(resolve => pending.push(resolve)));
    const first = h.residency.setPhase('water'), second = h.residency.setPhase('water');
    expect(h.port.prepare).toHaveBeenCalledTimes(2);
    const late = pending.map(() => h.prepared());
    h.residency.detach();
    expect(await second.ready).toBe(false); // cancellation settles even when the transport ignores its signal
    pending.forEach((resolve, i) => resolve(late[i]));
    await Promise.all([first.settled, second.settled]);
    expect(await second.ready).toBe(false);
    expect(h.events).toEqual([]);
    expect(late.every(p => vi.mocked(p.dispose).mock.calls.length === 1)).toBe(true);
    expect(h.residency.reservedBytes).toBe(0);
  });

  it('cancels superseded phase loads without disturbing current phase textures', async () => {
    const h = harness(), pending: ((page: KrakenPreparedPage) => void)[] = [];
    h.port.prepare = vi.fn(() => new Promise(resolve => pending.push(resolve)));
    const old = h.residency.setPhase('intro');
    h.port.prepare = vi.fn(async () => h.prepared());
    await h.residency.setPhase('land').settled;
    pending.forEach(resolve => resolve(h.prepared())); await old.settled;
    expect(h.events.some(e => e.includes('kraken_water'))).toBe(false);
    expect(h.port.diagnose).not.toHaveBeenCalled();
    h.residency.detach();
  });

  it('ignores transport errors that arrive after detach', async () => {
    const h = harness(), rejectors: ((error: Error) => void)[] = [];
    h.port.prepare = vi.fn(() => new Promise((_resolve, reject) => rejectors.push(reject)));
    const work = h.residency.setPhase('intro'); h.residency.detach();
    rejectors.forEach(reject => reject(new Error('late HTTP failure')));
    await work.settled;
    expect(await work.ready).toBe(false);
    expect(h.events).toEqual([]); expect(h.port.diagnose).not.toHaveBeenCalled();
  });

  it('rolls back a failed pass, diagnoses it visibly, retries, and falls back under GPU pressure', async () => {
    const h = harness(); let fail = true;
    h.port.prepare = vi.fn(async page => {
      if (fail && page.image.includes('/elevation/')) throw new Error('HTTP 503');
      return h.prepared();
    });
    const failed = h.residency.setPhase('water'); await failed.settled;
    expect(await failed.ready).toBe(false); expect(h.textures.size).toBe(0);
    expect(h.port.diagnose).toHaveBeenCalledWith(expect.objectContaining({ message: 'HTTP 503' }));
    fail = false; await h.residency.setPhase('water').settled;
    expect(h.residency.acquirePose('water', 'idle', 0, vi.fn())?.pose.fallback).toBe(false);
    h.residency.detach();
    const limited = harness({ waterBudgetMiB: 3 * 1280 / 1024 / 1024 });
    await limited.residency.setPhase('water', { prefetchLand: true }).settled;
    expect(limited.residency.reservedBytes).toBe(3 * 1280);
    expect(limited.residency.acquirePose('water', 'ink-spit', 0, vi.fn())?.pose.fallback).toBe(true);
    expect(limited.port.diagnose).toHaveBeenCalled(); limited.residency.detach();
  });
});

it('excludes boss bodies and eggs from generic enemy image and walking-sheet projections', () => {
  expect(genericEnemyImageKeys([{ imageKey: 'ordinary' }, { imageKey: 'ordinary' },
    { imageKey: 'water', krakenBoss: {} }, { imageKey: 'egg', krakenEgg: {} }])).toEqual(['ordinary']);
  expect(getWalkingSheetForStaticTexture('kraken_water')).toBeNull();
});

it('verifies fetched hashes and never removes a foreign texture on registration collision', async () => {
  const page = fixture().land.atlases.color.__rest.pages[0];
  const imageBytes = new Uint8Array([1, 2, 3]), jsonBytes = new TextEncoder().encode(JSON.stringify({ frames: { '__rest/0000': {} } }));
  const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))]
    .map(byte => byte.toString(16).padStart(2, '0')).join('');
  page.sha256 = await digest(imageBytes); page.jsonSha256 = await digest(jsonBytes);
  const textures = new Set(['foreign']);
  const scene = { textures: { exists: (key: string) => textures.has(key), remove: (key: string) => textures.delete(key),
    addAtlas: (key: string) => { textures.add(key); return { has: () => true }; } } };
  class DecodedImage {
    naturalWidth = page.width; naturalHeight = page.height;
    onload: (() => void) | null = null; onerror: (() => void) | null = null;
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal('Image', DecodedImage);
  vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(url.includes('.png?') ? imageBytes : jsonBytes)));
  try {
    const port = createKrakenResidencyPort(scene as never, vi.fn());
    const prepared = await port.prepare(page, new AbortController().signal);
    expect(() => prepared.register('foreign')).toThrow('collision');
    port.remove('foreign'); expect(textures.has('foreign')).toBe(true);
    prepared.register('owned'); port.remove('owned'); expect(textures.has('owned')).toBe(false);
    prepared.dispose();
    await expect(port.prepare({ ...page, sha256: '0'.repeat(64) }, new AbortController().signal)).rejects.toThrow('hash mismatch');
  } finally { vi.unstubAllGlobals(); }
});
