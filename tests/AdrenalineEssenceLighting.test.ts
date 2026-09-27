import { describe, expect, it, vi } from 'vitest';
import { AdrenalineEssenceLighting, type EssenceLightFrame, type EssenceLightSource } from '../src/adrenalineEssence/AdrenalineEssenceLighting';
import { ADRENALINE_ESSENCE_LIGHTING as CONFIG } from '../src/effects/LightingConfig';
import type { GraphicsQuality } from '../src/graphics/GraphicsQuality';

const view = { x: 0, y: 0, width: 1024, height: 768 };
const source = (id: string, x: number, y: number, value = 1, alpha = 1): EssenceLightSource => ({ id, x, y, value, alpha });

function fixture() {
  const owned = new Map<object, EssenceLightFrame>();
  const lighting = {
    setEssenceLights: vi.fn((owner: object, frame: EssenceLightFrame | null) => {
      if (frame) owned.set(owner, frame);
      else owned.delete(owner);
    }),
  };
  const helper = new AdrenalineEssenceLighting(lighting);
  return { helper, lighting, owned, frame: () => owned.get(helper)! };
}

describe('essence arena light aggregation', () => {
  it('weights actual ground/flight poses and reuses the frame and light storage for stationary sources', () => {
    const { helper, lighting, frame } = fixture();
    const unit = CONFIG.bucketSizePx / 8;
    const sources = [source('ground', unit, unit * 2), source('flight', unit * 3, unit * 4, 3)];
    helper.update(sources, 'high', view);
    expect(frame().lightCount).toBe(1);
    const firstFrame = frame(), firstLight = frame().lights[0];
    expect(firstLight).toMatchObject({ x: unit * 2.5, y: unit * 3.5 });
    helper.update(sources, 'high', view);
    expect(lighting.setEssenceLights).toHaveBeenCalledTimes(2);
    expect(frame()).toBe(firstFrame);
    expect(frame().lights[0]).toBe(firstLight);
    helper.update([sources[0], source('flight', unit * 5, unit * 4, 3)], 'high', view);
    expect(frame().lights[0].x).toBe(unit * 4);
  });

  it.each<GraphicsQuality>(['high', 'medium', 'low'])('keeps every visible occupied cell lit on %s, including while sources move', quality => {
    const { helper, frame, owned } = fixture();
    const sources = Array.from({ length: 200 }, (_, index) =>
      source(String(index), (index % 20) * CONFIG.bucketSizePx, Math.floor(index / 20) * CONFIG.bucketSizePx));
    for (let tick = 0; tick < 20; tick++) {
      const moving = sources.map(pose => ({ ...pose, x: pose.x + tick, y: pose.y + tick }));
      helper.update(moving, quality, view);
      expect(frame().lightCount).toBe(sources.length);
      for (const pose of moving) expect(frame().sampleLightAmount(pose.x, pose.y)).toBeGreaterThan(0);
    }
    helper.update([], quality, view);
    expect(owned.size).toBe(0);
  });

  it('bounds dense piles by occupied cells and lights even low-value pearls away from the weighted centre', () => {
    const { helper, frame } = fixture();
    const edge = CONFIG.bucketSizePx - 1;
    const pile = Array.from({ length: 1000 }, (_, i) => source(String(i), 0, 0, 100));
    const corner = source('corner', edge, edge, 0.01);
    helper.update([...pile, corner], 'high', view);
    expect(frame().lightCount).toBe(1);
    const light = frame().lights[0];
    expect(light.intensity).toBeLessThanOrEqual(CONFIG.maxIntensity);
    expect(Math.hypot(corner.x - light.x, corner.y - light.y)).toBeLessThan(light.radiusPx);
    expect(light.radiusPx).toBeLessThanOrEqual(Math.SQRT2 * CONFIG.bucketSizePx + CONFIG.maxRadiusPx);
    const expected = (1 - Math.hypot(corner.x - light.x, corner.y - light.y) / light.radiusPx) ** 2 * light.intensity;
    expect(frame().sampleLightAmount(corner.x, corner.y)).toBeCloseTo(expected);
    expect(expected).toBeGreaterThan(0);
    expect(frame().sampleLightAmount(10000, 10000)).toBe(0);
  });

  it('culls invisible/invalid and distant poses while keeping lights overlapping the viewport edge', () => {
    const { helper, frame, owned } = fixture();
    helper.update([
      source('hidden', 50, 50, 1, 0), source('invalid', NaN, 50),
      source('distant', 10000, 10000), source('empty', 50, 50, 0),
    ], 'high', view);
    expect(owned.size).toBe(0);
    helper.update([source('edge', -CONFIG.minRadiusPx / 2, 0), source('bright', 50, 50, 1_000_000)], 'high', view);
    expect(frame().lightCount).toBe(2);
    for (let i = 0; i < frame().lightCount; i++) {
      expect(frame().lights[i].radiusPx).toBeLessThanOrEqual(CONFIG.maxRadiusPx);
      expect(frame().lights[i].intensity).toBeLessThanOrEqual(CONFIG.maxIntensity);
    }
    expect(frame().sampleLightAmount(0, 0)).toBeGreaterThan(0);
  });

  it('keeps fading subnormal rewards and huge finite sources at finite light positions', () => {
    const { helper, frame } = fixture();
    helper.update([source('tiny', 25, 35, Number.MIN_VALUE, 0.5)], 'high', null);
    expect(frame().lights[0]).toMatchObject({ x: 25, y: 35 });
    helper.update([
      source('large-a', 100, 110, Number.MAX_VALUE),
      source('large-b', 120, 120, Number.MAX_VALUE),
      source('distant-finite', Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE),
    ], 'high', null);
    for (let i = 0; i < frame().lightCount; i++) {
      const light = frame().lights[i];
      for (const value of [light.x, light.y, light.radiusPx, light.intensity]) expect(Number.isFinite(value)).toBe(true);
      expect(Number.isFinite(frame().sampleLightAmount(light.x, light.y))).toBe(true);
    }
    expect(frame().lights[0]).toMatchObject({ x: 110, y: 115 });
  });

  it('uses source fading directly and clears borrowed data on visibility loss, without resurrecting destroyed owners', () => {
    const { helper, frame, owned } = fixture();
    helper.update([source('ground', 40, 40)], 'high', view);
    const full = frame().lights[0].intensity;
    helper.update([source('ground', 40, 40, 1, 0.25)], 'low', view);
    expect(frame().lights[0].intensity).toBeLessThan(full * 0.5);
    const borrowed = frame();
    helper.clear();
    expect(owned.size).toBe(0);
    expect(borrowed.lightCount).toBe(0);
    expect(borrowed.sampleLightAmount(40, 40)).toBe(0);
    helper.update([source('ground', 40, 40)], 'low', view);
    helper.destroy();
    helper.update([source('ground', 40, 40)], 'high', view);
    expect(owned.size).toBe(0);
  });

  it('keeps overlapping presentation owners independent during teardown', () => {
    const { helper, owned, lighting } = fixture();
    const next = new AdrenalineEssenceLighting(lighting);
    helper.update([source('old', 40, 40)], 'high', view);
    next.update([source('new', 40, 40)], 'high', view);
    expect(owned.size).toBe(2);
    helper.destroy();
    expect(owned.size).toBe(1);
    next.destroy();
    expect(owned.size).toBe(0);
  });
});
