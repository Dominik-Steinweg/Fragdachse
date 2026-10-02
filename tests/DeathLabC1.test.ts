import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 }, Math: {
  Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
  Linear: (a: number, b: number, t: number) => a + (b - a) * t,
} }));
import { CombatGoreGpuRenderer } from '../src/effects/CombatGoreGpuRenderer';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { makeFakeGpuVfxScene } from './fakeGpuVfxScene';
import { DEATH_TUNING_DEFAULTS, resolveDeathTuning } from '../src/effects/gpu/DeathTuning';
import { sampleDeathMorphBlend } from '../src/effects/gpu/DeathMorphFrames';
import { buildGpuVfxAtlas, GPU_VFX_ATLAS_KEY, GPU_VFX_DEATH_MORPH_FRAME_IDS, getGpuVfxFrame } from '../src/effects/gpu/GpuVfxAtlas';
import { GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { DeathPlayback } from '../src/dev/deathLab/Playback';
import { frameTimes } from '../src/dev/deathLab/Export';

// Captured before C1 edits (7a859a9a). Hashes cover serialized IEEE-754 spawn values,
// field order and every main/micro/glow spec, not just the final count or visible approximation.
const BEFORE_C1 = [
  '05189bdac04d3b274eea3ebfc10ca385a1fa8aa3d88e2727843af9082d766f62',
  '98d8c1839994fd89c59a8d47f293c2ef899f65fbf51dcf915ac675ac6bd26420',
  'a93e6cb33c196ca783786ef86b0171fe1daa883f52e163eec0486d62b9c5feb7',
  'e85712aefaca7ec6abbd2616d81e6fe4f2fdfc66eb743f723de8a2f080a654fc',
  '7e1aecbd6fecc3ec034372b5487db38bd26756c4d0fb62cc3974a242fe96db67',
  '095dd5896bb4955249409a06360394c7ab5485ecf7101a7cf558080b23177d51',
  'f422a37947046f80d70983352f95f930cbf930ff395d1466c12f504ac837ce61',
  'e247e546416b9cc647a5bce32f778e2d0162b5f318ed8c022bc92bbe92e24336',
];
function spawnBytes(value: unknown): Buffer {
  const canonical = (v: unknown): unknown => typeof v === 'number'
    ? { float64: Buffer.from(new Float64Array([v]).buffer).toString('hex') }
    : Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, field]) => [k, canonical(field)])) : v;
  return Buffer.from(JSON.stringify(canonical(value)));
}

function captureDefaults(player: boolean, size: number, seed: number) {
  resetGpuVfxAtlasForTests();
  const scene = makeFakeGpuVfxScene();
  scene.textures.createCanvas('death-lab-fixture', 32, 32);
  const gpu = new GpuVfxSystem(scene as never);
  const renderer = new CombatGoreGpuRenderer(scene as never, (width, height) => ({
    getContext: () => ({ clearRect() {}, drawImage() {}, getImageData: () => {
      const data = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = (i / 4) % 256; data[i + 1] = 80; data[i + 2] = 130;
        data[i + 3] = i % 20 === 0 ? 0 : 255;
      }
      return { data };
    } }),
  }) as unknown as HTMLCanvasElement);
  renderer.registerGpuVfx(gpu);
  const specs: unknown[] = [];
  vi.spyOn(gpu, 'spawn').mockImplementation(spec => { specs.push(structuredClone(spec)); return true; });
  const play = () => renderer.playDeath({ type: 'death', targetId: 'fixture', x: 320, y: 240,
    textureKey: 'death-lab-fixture', frame: '__BASE', displayWidth: size, displayHeight: size,
    rotation: 0.7, tint: 0xddeeff, targetColor: 0x65abcf, dirX: 0.6, dirY: -0.8, seed }, player);
  return { specs, renderer, gpu, play, scene };
}

describe('death lab: pre-C1 default spawn bytes', () => {
  it.each([false, true].flatMap(player => [22, 32, 48, 96].map(size => ({ player, size }))))(
    '$player / $size', ({ player, size }) => {
      const { specs, play, renderer, gpu } = captureDefaults(player, size, 0x12345678);
      play();
      const expected = BEFORE_C1[(player ? 4 : 0) + [22, 32, 48, 96].indexOf(size)];
      const original = structuredClone(specs), bytes = spawnBytes(original);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(expected);
      specs.length = 0; gpu.releaseAll(); renderer.setDeathTuning(DEATH_TUNING_DEFAULTS); play();
      expect(specs).toEqual(original);
      expect(spawnBytes(specs)).toEqual(bytes);
      specs.length = 0; gpu.releaseAll(); renderer.setDeathTuning({ mainHitImpulse: 0 });
      renderer.setDeathTuning(null); play();
      expect(spawnBytes(specs)).toEqual(bytes);
      renderer.destroy(); gpu.destroy();
    });
});

describe('death lab tuning and clocks', () => {
  it('keeps morph defaults identical and validates changes before application', () => {
    for (let i = 0; i < 128; i++) expect(sampleDeathMorphBlend(i / 127, DEATH_TUNING_DEFAULTS)).toEqual(sampleDeathMorphBlend(i / 127));
    expect(sampleDeathMorphBlend(0.4, resolveDeathTuning({ dustAt: 0.42 }))).not.toEqual(sampleDeathMorphBlend(0.4));
    for (const patch of [{ dustAt: 0.2 }, { alpha: NaN }, { alpha: 2 }, { durationMs: 0 },
      { morphDesyncMaxScale: 0.9 }, { chunkSizePx: 8 }, { typo: 1 }, { maxChunksPerEffect: 100 }]) {
      expect(() => resolveDeathTuning(patch)).toThrow();
    }
    expect(resolveDeathTuning({})).toEqual(DEATH_TUNING_DEFAULTS);
  });
  it('rebakes only on explicit apply, keeping frame identities and atlas geometry', () => {
    resetGpuVfxAtlasForTests(); const scene = makeFakeGpuVfxScene();
    buildGpuVfxAtlas(scene as never);
    const atlas = scene.textures.get(GPU_VFX_ATLAS_KEY), refreshed = atlas.refreshed;
    const frames = GPU_VFX_DEATH_MORPH_FRAME_IDS.map(getGpuVfxFrame);
    buildGpuVfxAtlas(scene as never);
    expect(atlas.refreshed).toBe(refreshed);
    buildGpuVfxAtlas(scene as never, resolveDeathTuning({ dustAt: 0.42 }));
    expect(atlas.refreshed).toBe(refreshed + 1);
    GPU_VFX_DEATH_MORPH_FRAME_IDS.forEach((id, i) => expect(getGpuVfxFrame(id)).toBe(frames[i]));
  });
  it('advances GPU and pool together, releases before backward reset and preserves the normal clock', () => {
    resetGpuVfxAtlasForTests(); const scene = makeFakeGpuVfxScene(); const gpu = new GpuVfxSystem(scene as never);
    gpu.update(10); expect(scene.layers.every(l => l.timeElapsed === 0)).toBe(true);
    expect(() => gpu.resetPresentationTime()).toThrow();
    gpu.setManualPresentationTime(true); gpu.resetPresentationTime();
    expect(scene.layers.every(l => (l as unknown as { timePaused: boolean }).timePaused)).toBe(true);
    const spec = gpu.createSpec(GpuVfxEffectId.DeathFragment); spec.lifeMs = 100;
    gpu.spawn(spec, -1, gpu.now()); gpu.update(99);
    expect(scene.layers.every(l => l.timeElapsed === 99)).toBe(true);
    expect(gpu.buildReport().lanes.find(l => l.label === 'gore-normal')!.active).toBe(1);
    gpu.update(1); expect(gpu.buildReport().lanes.find(l => l.label === 'gore-normal')!.active).toBe(0);
    gpu.resetPresentationTime(); expect(gpu.now()).toBe(0);
    expect(scene.layers.every(l => l.timeElapsed === 0)).toBe(true);
    expect(() => gpu.update(-1)).toThrow(); expect(() => gpu.update(NaN)).toThrow();
    gpu.setPreviewEffects(new Set([GpuVfxEffectId.DeathGlow]));
    expect(gpu.spawn(spec, -1, 0)).toBe(false);
    gpu.setPreviewEffects(null); expect(gpu.spawn(spec, -1, 0)).toBe(true);
    gpu.destroy(); expect(scene.layers.every(l => l.destroyed)).toBe(true);
  });
  it('resets quality carry on replay, making sequential seeks reproduce the same material', () => {
    const { gpu, play, specs, renderer } = captureDefaults(true, 48, 123);
    vi.spyOn(gpu.quality, 'getFactor').mockReturnValue(0.65);
    const first = () => { specs.length = 0; gpu.releaseAll(); play(); return spawnBytes(specs); };
    const initial = first(); play(); play(); expect(first()).toEqual(initial);
    renderer.destroy(); gpu.destroy();
  });
  it('replays before every seek and uses one time for sampling and expiry', () => {
    const events: unknown[] = [];
    const playback = new DeathPlayback({ reset: () => events.push('reset'), spawn: () => events.push('spawn'),
      advance: dt => events.push(['advance', dt]), sample: t => events.push(['sample', t]) });
    playback.seek(900); playback.seek(250);
    expect(events).toEqual(['reset', 'spawn', ['advance', 900], ['sample', 900], 'reset', 'spawn', ['advance', 250], ['sample', 250]]);
    playback.tick(100); expect(playback.timeMs).toBe(250);
    playback.playing = true; playback.speed = 0.25; playback.tick(100); expect(playback.timeMs).toBe(275);
    playback.tick(10000); expect(playback.timeMs).toBe(1500); expect(playback.playing).toBe(false);
    expect(frameTimes()).toHaveLength(60); expect(frameTimes().at(-1)).toBe(1475);
    expect(() => frameTimes(100, 25)).toThrow(); expect(() => frameTimes(1.5, 25)).toThrow();
  });
});
