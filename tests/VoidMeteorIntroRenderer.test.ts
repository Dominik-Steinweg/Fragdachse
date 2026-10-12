import { beforeEach, describe, expect, it, vi } from 'vitest';

const batch = vi.hoisted(() => ({ begin: vi.fn(), add: vi.fn(), flush: vi.fn(), clear: vi.fn(), destroy: vi.fn(), setAlpha: vi.fn() }));
const plasmaInstances = vi.hoisted(() => [] as { sync: ReturnType<typeof vi.fn>; clear: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[]);
const trail = vi.hoisted(() => ({ start: vi.fn(), sync: vi.fn(), clear: vi.fn(), destroy: vi.fn() }));
vi.mock('phaser', () => ({ BlendModes: { ADD: 1 } }));
vi.mock('../src/config', () => ({ GAME_WIDTH: 1920, GAME_HEIGHT: 1080, ARENA_OFFSET_X: 0, ARENA_OFFSET_Y: 0, ARENA_MAX_X: 3072, ARENA_MAX_Y: 1504, DEPTH: { DECALS: 5 }, DEPTH_LIGHTING: 19.5, VOID_PALETTE: { primary: 1, bright: 2 } }));
vi.mock('../src/effects/gpu/MeteorGpuLayer', () => ({ MeteorGpuLayer: class { constructor() { return batch; } } }));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: vi.fn() }));
vi.mock('../src/effects/FlameShared', () => ({ ensureFlameTextures: vi.fn(), TEX_FLAME_EMBER: 'flame' }));
vi.mock('../src/effects/VoidIntroTextures', () => ({ ensureVoidIntroTextures: vi.fn(), VOID_INTRO_GLOW_TEXTURE: 'glow', VOID_INTRO_RING_TEXTURE: 'ring' }));
vi.mock('../src/effects/gpu/VoidMeteorPlasmaLayer', () => ({ VoidMeteorPlasmaLayer: class {
  constructor() { const instance = { sync: vi.fn(), clear: vi.fn(), destroy: vi.fn() }; plasmaInstances.push(instance); return instance; }
} }));
vi.mock('../src/effects/VoidMeteorParticleTrail', () => ({ VoidMeteorParticleTrail: class { constructor() { return trail; } } }));

import { VOID_METEOR_INTRO as preset, type BossIntroState } from '../src/config/bossIntros';
import { getCameraFocusOverride } from '../src/graphics/cameraFocusOverride';
import { VoidMeteorIntroRenderer } from '../src/effects/VoidMeteorIntroRenderer';

const state: BossIntroState = { preset: 'void-meteor', x: 120, y: 340, startedAtMs: 10_000, seed: 42 };
function fixture() {
  const images: Record<string, ReturnType<typeof vi.fn>>[] = [];
  const imagesByTexture = new Map<string, Record<string, ReturnType<typeof vi.fn>>[]>();
  const scene = { cameras: { main: { width: 1440, height: 810 } }, scale: { width: 1440, height: 810 }, textures: {}, add: { image: (_x: number, _y: number, texture: string) => {
    const image: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const method of ['setVisible', 'setDepth', 'setBlendMode', 'setPosition', 'setDisplaySize', 'setTint', 'setAlpha', 'setScale', 'setRotation', 'destroy']) {
      image[method] = vi.fn(() => image);
    }
    images.push(image);
    const family = imagesByTexture.get(texture) ?? [];
    family.push(image);
    imagesByTexture.set(texture, family);
    return image;
  } } };
  const lighting = { setGroundGlowLights: vi.fn(), releaseLight: vi.fn(), setLight: vi.fn() };
  const feedback = { request: vi.fn(), release: vi.fn() };
  const distortion = { submit: vi.fn(), release: vi.fn() };
  const audio = { playSound: vi.fn() };
  const impact = vi.fn();
  const renderer = new VoidMeteorIntroRenderer(scene as never, lighting as never);
  renderer.registerGpuVfx({} as never);
  renderer.setCameraFeedback(feedback as never);
  renderer.setDistortionComposer(distortion as never);
  renderer.setAudioSystem(audio as never);
  renderer.setImpactCallback(impact);
  return { renderer, scene, images, imagesByTexture, lighting, feedback, distortion, audio, impact, plasma: plasmaInstances.at(-1)! };
}

describe('void meteor intro presentation ownership', () => {
  beforeEach(() => vi.clearAllMocks());

  it('presents one live impact while deriving meteor progress and residue from the replicated clock', () => {
    const { renderer, impact, audio } = fixture();
    renderer.sync(state, state.startedAtMs + preset.meteorStartMs);
    // Flight belongs to the cinematic body/wake; the shared GPU layer owns only its crater.
    expect(batch.add).not.toHaveBeenCalled();
    renderer.sync(state, state.startedAtMs + preset.impactAtMs);
    renderer.sync(state, state.startedAtMs + preset.impactAtMs + 250);
    expect(impact).toHaveBeenCalledExactlyOnceWith(state.x, state.y, preset.explosionRadiusPx);
    expect(audio.playSound).toHaveBeenCalledTimes(2);
    expect(batch.add).toHaveBeenLastCalledWith(expect.objectContaining({ progress: 1, age: 0.25 }));
  });

  it('reconstructs the same GPU core and analytic wake on a flight join, then stops both emissions at impact', () => {
    const live = fixture(), joined = fixture();
    const flightTime = state.startedAtMs + (preset.meteorStartMs + preset.impactAtMs) / 2;
    live.renderer.sync(state, state.startedAtMs + preset.meteorStartMs);
    live.renderer.sync(state, flightTime);
    joined.renderer.sync(state, flightTime);
    expect(live.plasma.sync.mock.lastCall).toEqual(joined.plasma.sync.mock.lastCall);
    expect(trail.sync.mock.lastCall![4]).toBe(true);
    joined.renderer.sync(state, state.startedAtMs + preset.impactAtMs);
    expect(joined.plasma.clear).toHaveBeenCalled();
    expect(trail.sync.mock.lastCall![4]).toBe(false);
  });

  it.each([0, 50, 1_000])('reconstructs a join %sms after impact without replaying sounds or explosion', (offset) => {
    const { renderer, impact, audio } = fixture();
    renderer.sync(state, state.startedAtMs + preset.impactAtMs + offset);
    renderer.sync(state, state.startedAtMs + preset.impactAtMs + offset + 16);
    expect(impact).not.toHaveBeenCalled();
    expect(audio.playSound).not.toHaveBeenCalled();
    expect(batch.add).toHaveBeenCalled();
  });

  it('frames the map interior without changing a west-front impact anchor', () => {
    const { renderer, scene, plasma, impact, distortion } = fixture();
    renderer.sync(state, state.startedAtMs + 1_500);
    const focus = getCameraFocusOverride(scene as never)!;
    expect(focus.x - 1920 / preset.camera.zoom / 2).toBeGreaterThanOrEqual(0);
    expect(focus.y - 1080 / preset.camera.zoom / 2).toBeGreaterThanOrEqual(0);
    expect(focus.x + 1920 / preset.camera.zoom / 2).toBeLessThanOrEqual(3072);
    expect(focus.y + 1080 / preset.camera.zoom / 2).toBeLessThanOrEqual(1504);
    const [x, y] = plasma.sync.mock.lastCall!;
    expect(x).toBeGreaterThan(state.x);
    expect(y).toBeLessThan(state.y);
    expect(distortion.submit).toHaveBeenCalledWith(expect.objectContaining({ id: 'voidMeteorIntro:flightHeat' }));
    renderer.sync(state, state.startedAtMs + preset.impactAtMs);
    expect(impact).toHaveBeenCalledExactlyOnceWith(state.x, state.y, preset.explosionRadiusPx);
    expect(distortion.release).toHaveBeenCalledWith('voidMeteorIntro:flightHeat');
  });

  it('releases camera, lights, distortion and GPU state on cancellation, then destroys its images once', () => {
    const { renderer, scene, images, lighting, feedback, distortion, plasma } = fixture();
    renderer.sync(state, state.startedAtMs + preset.meteorStartMs);
    expect(getCameraFocusOverride(scene as never)).not.toBeNull();
    expect(renderer.ownsSpawnAt(state, state.startedAtMs + preset.emergeAtMs)).toBe(true);
    renderer.sync(null, state.startedAtMs + preset.emergeAtMs);
    expect(getCameraFocusOverride(scene as never)).toBeNull();
    expect(lighting.setGroundGlowLights).toHaveBeenLastCalledWith(renderer, null);
    expect(feedback.release).toHaveBeenCalled();
    expect(distortion.release).toHaveBeenCalled();
    expect(batch.clear).toHaveBeenCalledOnce();
    renderer.destroy();
    renderer.destroy();
    for (const image of images) expect(image.destroy).toHaveBeenCalledOnce();
    expect(batch.destroy).toHaveBeenCalledOnce();
    expect(plasma.destroy).toHaveBeenCalledOnce();
    expect(trail.clear).toHaveBeenCalled();
    expect(trail.destroy).toHaveBeenCalledOnce();
    expect(renderer.ownsSpawnAt(state, state.startedAtMs + preset.emergeAtMs)).toBe(false);
  });
});
