import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 } }));
import { createDeathGrainBaker } from '../src/effects/gpu/DeathMorphFrames';
import { C1_DEATH_TUNING, DEATH_TUNING_DEFAULTS as T, deathFragmentOpacity, resolveDeathTuning } from '../src/effects/gpu/DeathTuning';
import { deathFollowCenter } from '../src/dev/deathLab/Follow';
import { INITIAL_SETTINGS, resolveSettings } from '../src/dev/deathLab/State';
import { DeathLabApi } from '../src/dev/deathLab/api';
import { DeathPlayback } from '../src/dev/deathLab/Playback';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { buildGpuVfxAtlas, getGpuVfxFrame, GPU_VFX_ATLAS_KEY, GPU_VFX_DEATH_MORPH_FRAME_IDS, packGpuVfxAtlas, resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { ensureDeathMorphTextures, TEX_DEATH_MORPH_FRAGMENTED, TEX_DEATH_MORPH_HAZE } from '../src/effects/gpu/GpuVfxSourceTextures';
import { makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function source(dx = 0) {
  const pixels = new Uint8ClampedArray(48 * 48 * 4);
  for (let y = 15; y < 30; y++) for (let x = 15 + dx; x < 30 + dx; x++) {
    if (x > 20 + dx && x < 24 + dx && y < 22) continue;
    pixels[(y * 48 + x) * 4 + 3] = 210;
  }
  return pixels;
}
function mass(p: Uint8ClampedArray) { let sum = 0; for (let i = 3; i < p.length; i += 4) sum += p[i] / 255; return sum; }
function centroid(p: Uint8ClampedArray) {
  let x = 0, y = 0; for (let i = 0; i < 48 * 48; i++) { x += (i % 48 + 0.5) * p[i * 4 + 3] / 255; y += (Math.floor(i / 48) + 0.5) * p[i * 4 + 3] / 255; }
  return { x: x / mass(p), y: y / mass(p) };
}
function sample(bake: ReturnType<typeof createDeathGrainBaker>, t: number) { const out = new Uint8ClampedArray(48 * 48 * 4); bake(out, t); return out; }

describe('C2 linked material', () => {
  it('uses the linked bake by default in the real atlas and does not sample the unrelated C1 haze motif', () => {
    resetGpuVfxAtlasForTests(); const scene = makeFakeGpuVfxScene(); ensureDeathMorphTextures(scene as never);
    const src = source();
    vi.spyOn(scene.textures.get(TEX_DEATH_MORPH_FRAGMENTED).context, 'getImageData').mockReturnValue({ data: src });
    const oldHaze = vi.spyOn(scene.textures.get(TEX_DEATH_MORPH_HAZE).context, 'getImageData');
    const size = packGpuVfxAtlas().size, atlas = scene.textures.createCanvas(GPU_VFX_ATLAS_KEY, size, size);
    const frames = new Map<string, Uint8ClampedArray>();
    vi.spyOn(atlas.context, 'putImageData').mockImplementation((image, x, y) => { frames.set(`${x},${y}`, image.data.slice()); });
    buildGpuVfxAtlas(scene as never);
    const index = Math.ceil(T.hazeAt * 127), frame = getGpuVfxFrame(GPU_VFX_DEATH_MORPH_FRAME_IDS[index]);
    expect(frames.get(`${frame.cutX},${frame.cutY}`)).toEqual(sample(createDeathGrainBaker(src), index / 127));
    expect(oldHaze).not.toHaveBeenCalled();
  });
  it('starts at the exact fragment alpha and never borrows RGB from transparent or dark source texels', () => {
    const src = source(), bake = createDeathGrainBaker(src);
    const first = sample(bake, T.fragmentedAt);
    for (let i = 0; i < src.length; i += 4) { expect(first[i + 3]).toBe(src[i + 3]); expect([...first.slice(i, i + 3)]).toEqual([255, 255, 255]); }
    expect(mass(sample(bake, 1))).toBe(0);
    expect(sample(bake, T.dustAt)).toEqual(sample(bake, T.dustAt));
    expect(mass(sample(createDeathGrainBaker(new Uint8ClampedArray(src.length)), T.hazeAt))).toBe(0);
  });
  it('preserves coverage through erosion, then loses mass monotonically instead of growing new haze lobes', () => {
    const src = source(), bake = createDeathGrainBaker(src), initial = mass(src);
    let previous = sample(bake, T.fragmentedAt);
    for (let t = T.fragmentedAt + 1 / 127; t <= T.fineDustAt; t += 1 / 127) {
      const next = sample(bake, t);
      expect(mass(next)).toBeGreaterThan(initial * 0.48);
      expect(Math.abs(mass(next) - mass(previous))).toBeLessThan(initial * 0.1);
      previous = next;
    }
    const dust = mass(sample(bake, T.dustAt)), fine = mass(sample(bake, T.fineDustAt)), haze = mass(sample(bake, T.hazeAt));
    expect(fine).toBeLessThanOrEqual(dust * 1.02); expect(haze).toBeLessThan(fine);
    const start = centroid(src);
    for (const time of [T.dustAt, T.fineDustAt, T.hazeAt, T.vaporAt]) {
      const c = centroid(sample(bake, time)); expect(Math.hypot(c.x - start.x, c.y - start.y)).toBeLessThan(T.grainDriftPx);
    }
  });
  it('derives every haze grain from its source footprint and retains that relationship after shifting the source', () => {
    for (const dx of [0, 6]) {
      const src = source(dx), haze = sample(createDeathGrainBaker(src), T.hazeAt);
      expect(Math.abs(centroid(haze).x - centroid(src).x)).toBeLessThan(T.grainDriftPx);
      for (let y = 0; y < 48; y++) for (let x = 0; x < 48; x++) {
        if (x < 15 + dx - 12 || x > 30 + dx + 12 || y < 3 || y > 42) expect(haze[(y * 48 + x) * 4 + 3]).toBe(0);
      }
    }
  });
  it('reduces dark plate coverage without changing RGB, particle count or RNG, and allows the C1 reference', () => {
    expect(deathFragmentOpacity(0x151515, T)).toBeLessThan(0.1);
    expect(deathFragmentOpacity(0xeeeeee, T)).toBe(1);
    expect(deathFragmentOpacity(0x15e020, T)).toBe(1);
    for (const color of [0, 0x151515, 0xffffff]) expect(deathFragmentOpacity(color, C1_DEATH_TUNING)).toBe(1);
    expect(T.microLifetimeMinMs).toBeGreaterThan(T.durationMs * T.dustAt * T.morphDesyncMaxScale);
    for (const values of [{ legacyMorph: 2 }, { grainRadiusPx: 0 }, { dissolveWindowMs: 0 }, { dustBodyAlpha: 1.1 }, { hazeGrowth: 10 }, { darkFragmentCutoff: 0 }, { microAlpha: NaN }]) expect(() => resolveDeathTuning(values)).toThrow();
  });
});

describe('C2 lab', () => {
  it('observes only accepted GPU members and can detach without changing production spawns', () => {
    resetGpuVfxAtlasForTests(); const scene = makeFakeGpuVfxScene(); const gpu = new GpuVfxSystem(scene as never);
    const observer = vi.fn(); gpu.setPreviewSpawnObserver(observer);
    const spec = gpu.createSpec(GpuVfxEffectId.DeathFragment); spec.lifeMs = 100;
    gpu.setPreviewEffects(new Set()); expect(gpu.spawn(spec, -1, 0)).toBe(false);
    expect(observer).not.toHaveBeenCalled();
    gpu.setPreviewEffects(null); expect(gpu.spawn(spec, -1, 0)).toBe(true);
    expect(observer).toHaveBeenCalledTimes(1);
    gpu.setPreviewSpawnObserver(null); expect(gpu.spawn(spec, -1, 0)).toBe(true);
    expect(observer).toHaveBeenCalledTimes(1); gpu.destroy();
  });
  it('samples the same mass-weighted camera path on seek, playback, rewind and after all members expire', () => {
    const samples = [{ x: 0, y: 0, vx: 100, vy: -50, lifeMs: 1000, alphaStart: 1, scaleStart: 1, stretchStart: 1 }];
    expect(deathFollowCenter(samples, 0)).toEqual({ x: 0, y: 0 });
    expect(deathFollowCenter(samples, 500)).toEqual({ x: 50, y: -25 });
    expect(deathFollowCenter(samples, 1500)).toEqual({ x: 100, y: -50 });
    expect(deathFollowCenter(samples, 500)).toEqual({ x: 50, y: -25 });
    expect(deathFollowCenter([], 500)).toEqual({ x: 0, y: 0 });
    expect(resolveSettings({ follow: true }, INITIAL_SETTINGS).follow).toBe(true);
    expect(() => resolveSettings({ follow: 'true' }, INITIAL_SETTINGS)).toThrow();
  });
  it('loads C1 and restores C2 through the same validated API without rebaking on seek', async () => {
    const scene = { settings: structuredClone(INITIAL_SETTINGS), tuning: T,
      playback: new DeathPlayback({ reset() {}, spawn() {}, advance() {}, sample() {} }),
      applyTuning: vi.fn(values => { scene.tuning = values; }) };
    const api = new DeathLabApi(scene as never, Promise.resolve({}));
    await api.run({ action: 'tuning', preset: 'c1' }); expect(scene.tuning).toEqual(C1_DEATH_TUNING);
    await api.run({ action: 'seek', timeMs: 550 }); expect(scene.applyTuning).toHaveBeenCalledTimes(1);
    await expect(api.run({ action: 'tuning', preset: 'c1', values: {} })).rejects.toThrow();
    await api.run({ action: 'tuning', reset: true }); expect(scene.tuning).toEqual(T);
    api.dispose();
  });
});
