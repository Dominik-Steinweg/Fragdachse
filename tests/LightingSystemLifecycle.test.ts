import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { MULTIPLY: 2, ADD: 1 },
  Textures: { FilterMode: { LINEAR: 1 } },
  Math: { Clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)) },
  GameObjects: { SpriteGPULayer: class {
    memberCount = 0;
    frame = { realWidth: 256, realHeight: 256 };
    members: object[] = [];
    constructor(_scene: unknown, _texture: unknown, public size: number) {}
    setVisible() { return this; } setBlendMode() { return this; } setName() { return this; }
    addMember(member: object) { this.members[this.memberCount++] = { ...member }; }
    resize(size: number) { this.size = size; } destroy() {}
  }, Image: class {
    setOrigin() { return this; }
    setBlendMode() { return this; }
    destroy() {}
  } },
}));

import { AdrenalineEssenceLighting } from '../src/adrenalineEssence/AdrenalineEssenceLighting';
import { LightingSystem } from '../src/effects/LightingSystem';
import { GraphicsQualityController, type GraphicsQuality } from '../src/graphics/GraphicsQuality';

function fixture(quality: GraphicsQuality = 'high') {
  const stamps = vi.fn();
  const draws = vi.fn();
  const fills = vi.fn();
  const scene = {
    time: { now: 100 },
    textures: { exists: () => true, get: () => ({}) },
    cameras: { main: { scrollX: 0, scrollY: 0 } },
    make: { graphics: () => ({ destroy() {} }) },
    add: { particles: vi.fn(), renderTexture: () => ({
      texture: { key: 'fake-lightmap', setFilter() {} },
      setOrigin() { return this; }, setDisplaySize() { return this; },
      setScrollFactor() { return this; }, setDepth() { return this; },
      setBlendMode() { return this; }, setRenderMode() { return this; },
      setVisible() { return this; }, fill: fills, draw: draws, stamp: stamps, destroy() {},
    }) },
  };
  new GraphicsQualityController(quality).attach(scene as never);
  const lighting = new LightingSystem(scene as never);
  lighting.setTimeOfDay(0);
  lighting.setActive(true);
  return { scene, lighting, stamps, draws, fills };
}

describe('keyed light lifecycle', () => {
  it.each(['high', 'medium', 'low'] as const)('batches every eye light outside the %s budget and clears the previously lit map', (quality) => {
    const { lighting, draws, fills } = fixture(quality);
    lighting.setPerformanceMetricsEnabled(true);
    // Exceed even the high-quality budget with normal lights.
    for (let i = 0; i < 250; i++) lighting.setLight(`flash:${i}`, 'muzzleFlash', 100, 100);
    const lights = Array.from({ length: 120 }, (_, i) => ({ x: 100 + i, y: 100, radiusPx: 30, intensity: .18, color: 0xbb72ff }));
    lighting.setEnemyEyeLights({ lights, lightCount: lights.length });
    lighting.update();
    expect(draws).toHaveBeenCalledTimes(1);
    expect(draws.mock.lastCall?.[0].memberCount).toBe(lights.length);
    expect(lighting.getDebugStats().enemyEyeLights).toBe(lights.length);
    expect(lighting.getPerformanceMetrics().presetCounts.enemyEyes).toBe(lights.length);
    const alpha = draws.mock.lastCall?.[0].members[0].alpha;
    lighting.setTimeOfDay(12 * 60); lighting.update();
    expect(lighting.getDebugStats().enemyEyeLights).toBe(0);
    lighting.setTimeOfDay(0); lighting.update();
    expect(draws.mock.lastCall?.[0].members[0].alpha).toBe(alpha);
    lighting.clear(); fills.mockClear(); lighting.update();
    expect(lighting.getDebugStats().enemyEyeLights).toBe(0);
    expect(fills).toHaveBeenCalledOnce();
    lighting.destroy();
  });
  it('keeps canopy falloff circular, including square bounds and distant light sources', () => {
    const { lighting } = fixture();
    const ambient = lighting.resolveCanopyTint(100, 100);
    lighting.setLight('near', 'adrenalineEssence', 100, 100, { radiusPx: 100, intensity: 1 });
    lighting.setLight('far', 'adrenalineEssence', 1000, 1000, { radiusPx: 100, intensity: 1 });
    lighting.update();
    expect(lighting.resolveCanopyTint(100, 100)).not.toBe(ambient);
    expect(lighting.resolveCanopyTint(150, 100)).not.toBe(ambient);
    for (const [x, y] of [[0, 100], [200, 100], [100, 0], [100, 200], [175, 175], [300, 300]]) {
      expect(lighting.resolveCanopyTint(x, y)).toBe(ambient);
    }
    lighting.destroy();
  });

  it('keeps normal release fading, but immediate release removes active and already fading lights', () => {
    const { scene, lighting, stamps } = fixture();
    lighting.setLight('pickup', 'adrenalineEssence', 100, 100);
    lighting.update();
    const initialAlpha = stamps.mock.lastCall?.[4].alpha as number;
    expect(initialAlpha).toBeGreaterThan(0);
    lighting.releaseLight('pickup');
    expect(lighting.getDebugStats().activeLights).toBe(1);
    scene.time.now += 10;
    lighting.update();
    expect(stamps.mock.lastCall?.[4].alpha).toBeLessThan(initialAlpha);
    lighting.releaseLight('pickup', { immediate: true });
    expect(lighting.getDebugStats()).toMatchObject({ activeLights: 0, renderedLights: 0 });
    lighting.setLight('pickup', 'adrenalineEssence', 150, 150);
    expect(lighting.getDebugStats().activeLights).toBe(1);
    lighting.releaseLight('pickup', { immediate: true });
    lighting.releaseLight('pickup', { immediate: true });
    expect(lighting.getDebugStats().activeLights).toBe(0);
  });

  it('uses the same sky attenuation and direct lightmap path for stationary essence across the day', () => {
    const { scene, lighting, stamps } = fixture();
    const helper = new AdrenalineEssenceLighting(lighting);
    const sources = [{ id: 'ground', x: 100, y: 100, value: 2, alpha: 1 }];
    helper.update(sources, 'high', null);
    lighting.update();
    expect(stamps).toHaveBeenCalledTimes(1);
    expect(stamps.mock.lastCall?.[4].alpha).toBeGreaterThan(0);
    lighting.setTimeOfDay(12 * 60);
    scene.time.now += 1000;
    helper.update(sources, 'high', null);
    lighting.update();
    expect(stamps).toHaveBeenCalledTimes(1);
    lighting.setTimeOfDay(0);
    scene.time.now += 1000;
    helper.update(sources, 'high', null);
    lighting.update();
    expect(stamps).toHaveBeenCalledTimes(2);
    expect(lighting.getDebugStats().activeLights).toBe(1);
    helper.update([], 'high', null);
    helper.clear();
    expect(lighting.getDebugStats().activeLights).toBe(0);
    helper.destroy();
    lighting.destroy();
  });
});
