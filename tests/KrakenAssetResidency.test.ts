import { describe, expect, it, vi } from 'vitest';
import { createKrakenResidencyPort, KrakenAssetResidency, type KrakenAssetRole, type KrakenPreparedPage, type KrakenResidencyPort } from '../src/effects/kraken/KrakenAssetResidency';
import type { PipelineBossAsset } from '../src/config/pipelineAssetContracts';
import { KrakenMeshCache } from '../src/effects/kraken/KrakenMeshCache';
import { genericEnemyImageKeys, getWalkingSheetForStaticTexture } from '../src/animations/BadgerAnimations';
vi.mock('phaser', () => ({}));

it('uses bounds without downloads on Low, upgrades to meshes, and isolates boss lifetimes', async () => {
  const asset = fixture().water;
  const positions = new Uint16Array([0,0,0,65535,0,0,0,65535,65535]), indices = new Uint16Array([0,1,2]);
  const record = async (file: string, bytes: Uint16Array) => ({ file, bytes: bytes.byteLength,
    sha256: [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2,'0')).join('') });
  asset.shadowMesh = { version: 1, encoding: 'u16-world-xyz-per-pose-v1', frames: [{ vertexCount: 3, triangleCount: 1,
    bounds: { min: [0,0,0], max: [10,20,30] }, positions: await record('p.bin', positions), indices: await record('i.bin', indices) }] };
  const pending: { signal: AbortSignal; reject: (reason: Error) => void }[] = [], diagnostic = vi.fn();
  let calls = 0;
  vi.stubGlobal('fetch', vi.fn((url: string, options: { signal: AbortSignal }) => {
    if (++calls <= 2) return new Promise((_resolve, reject) => pending.push({ signal: options.signal, reject }));
    return Promise.resolve(new Response(url.startsWith('p.bin') ? positions.buffer : indices.buffer));
  }));
  const cache = new KrakenMeshCache(diagnostic);
  try {
    expect(cache.get(asset, 0, true)?.bounds).toEqual({ min: [0,0,0], max: [10,20,30] });
    expect(calls).toBe(0); expect(cache.bytes).toBe(0);
    expect(cache.get(asset, 0)).toBeUndefined(); cache.clear();
    expect(pending.every(p => p.signal.aborted)).toBe(true); expect(cache.bytes).toBe(0);
    expect(cache.get(asset, 0)).toBeUndefined();
    await vi.waitFor(() => expect(cache.bytes).toBe(42));
    const mesh = cache.get(asset, 0)!; expect([...mesh.positions]).toEqual([0,0,0,10,0,0,0,20,30]);
    expect(cache.get(asset, 0, true)?.positions.length).toBe(0);
    expect(cache.get(asset, 0)).toBe(mesh);
    pending.forEach(p => p.reject(new Error('late abort')));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(cache.get(asset, 0)).toBe(mesh); expect(calls).toBe(4); expect(diagnostic).not.toHaveBeenCalled();
    cache.clear(); expect(cache.bytes).toBe(0);
    cache.destroy(); cache.clear(); expect(cache.get(asset, 0)).toBeUndefined();
  } finally { cache.destroy(); vi.unstubAllGlobals(); }
});

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
  it('prefetches only landing essentials, then loads attacks after exit and releases water at grip', async () => {
    const h = harness(); await h.residency.setPhase('water').settled;
    expect([...h.textures].some(k => k.startsWith('kraken_land'))).toBe(false);
    const start = h.events.length;
    await h.residency.setPhase('water', { prefetchLand: true }).settled;
    const loaded = [...new Set(h.events.slice(start).filter(k => k.startsWith('add:kraken_land')).map(k => k.split(':')[3]))];
    expect(loaded).toEqual(['__rest', 'ashore']);
    expect(h.residency.acquirePose('land', 'slam', 0, vi.fn())?.pose.fallback).toBe(true);
    await h.residency.setPhase('ashore').settled;
    expect(h.residency.acquirePose('land', 'slam', 0, vi.fn())?.pose.fallback).toBe(false);
    await h.residency.setPhase('ashore', { waterBody: false }).settled;
    expect([...h.textures].some(k => k.startsWith('kraken_water'))).toBe(false);
    expect(h.residency.acquirePose('land', 'death', 0, vi.fn())?.pose.fallback).toBe(false);
    h.residency.detach(); expect(h.textures.size).toBe(0);
  });
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
    for (const clip of ['__rest', 'idle', 'move']) expect([...h.textures].some(k => k.startsWith('kraken_water') && k.includes(`:${clip}:`))).toBe(true);
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

it('leases emission with color/height atomically and falls back when a material page fails', async () => {
  const assets = fixture();
  for (const asset of Object.values(assets)) {
    asset.elevationPass.encoding = 'linear-unorm8-z-oct-normal-v1';
    asset.materialPass = { version: 1, color: 'srgb-albedo-baked-cavity-v1', normal: 'linear-unorm8-z-oct-normal-v1',
      emission: 'linear-rgb-unorm8-scaled-v1', worldPxPerBU: 40, emissionRange: 8, exposure: 1, tint: [1,1,1], saturation: 1 };
    asset.shadowMesh = { version: 1, encoding: 'u16-world-xyz-per-pose-v1', frames: asset.socketFrames!.map((_, i) => ({
      vertexCount: 3, triangleCount: 1, bounds: { min: [0,0,0], max: [1,1,1] },
      positions: { file: `./assets/${asset.id}/${i}-p.bin`, sha256: 'a'.repeat(64), bytes: 18 },
      indices: { file: `./assets/${asset.id}/${i}-i.bin`, sha256: 'b'.repeat(64), bytes: 6 },
    })) };
    asset.atlases.emission = structuredClone(asset.atlases.color);
    let total = 0;
    for (const [name, atlas] of Object.entries(asset.atlases.emission)) {
      for (const page of atlas.pages) { page.image = page.image.replace('/color/', '/emission/'); page.json = page.json.replace('/color/', '/emission/'); }
      const bytes = atlas.pages.reduce((sum,p) => sum + p.gpuBytesRGBA8, 0);
      asset.budget.clips[name].emission = bytes; asset.budget.clips[name].total += bytes; total += bytes;
    }
    asset.budget.totals.emission = total; asset.budget.totals.total += total;
  }
  const removed: string[] = [];
  const port: KrakenResidencyPort = { prepare: async page => {
    if (page.image.includes('/land/emission/death')) throw Error('Emission unavailable');
    return { register() {}, dispose() {} };
  }, remove: key => { removed.push(key); }, diagnose: vi.fn() };
  const residency = new KrakenAssetResidency(assets, port, { waterBudgetMiB: 1, landBudgetMiB: 1, peakBudgetMiB: 1, additionalGpuBytes: () => 0 });
  await residency.setPhase('land').settled;
  const lease = residency.acquirePose('land', 'death', 0, vi.fn())!;
  expect(lease.pose.fallback).toBe(true); expect(lease.pose.emissionKey).toContain(':emission:');
  expect(lease.pose.emissionFrame).toBe(lease.pose.frame);
  residency.setPhase('dead');
  expect(residency.residentBytes).toBe(assets.land.budget.clips.__rest.total);
  lease.release(); expect(residency.residentBytes).toBe(0); expect(removed.some(k => k.includes(':emission:'))).toBe(true);
  residency.detach();
});
