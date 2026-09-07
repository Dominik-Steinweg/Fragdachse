import { describe, expect, it, vi } from 'vitest';
import { AdrenalineEssenceLighting, type EssenceLightSource } from '../src/adrenalineEssence/AdrenalineEssenceLighting';
import { ADRENALINE_ESSENCE_LIGHTING as CONFIG } from '../src/effects/LightingConfig';
import type { GraphicsQuality } from '../src/graphics/GraphicsQuality';

const view = { x: 0, y: 0, width: 1024, height: 768 };
const source = (id: string, x: number, y: number, value = 1, alpha = 1): EssenceLightSource => ({ id, x, y, value, alpha });

function fixture() {
  // Keep fading keys alive, so budget assertions also detect trails left by moving sources.
  const owned = new Map<string, { x: number; y: number; fading: boolean }>();
  const lighting = {
    setLight: vi.fn((key: string, _preset: string, x: number, y: number, _overrides?: unknown) => {
      owned.set(key, { x, y, fading: false });
    }),
    releaseLight: vi.fn((key: string, options?: { immediate?: boolean }) => {
      if (options?.immediate) owned.delete(key);
      else if (owned.has(key)) owned.get(key)!.fading = true;
    }),
  };
  return { helper: new AdrenalineEssenceLighting(lighting), lighting, owned };
}

describe('essence arena light aggregation', () => {
  it('weights actual ground/flight poses in a shared bucket and refreshes stationary sources every frame', () => {
    const { helper, lighting } = fixture();
    const sources = [source('ground', 10, 20), source('flight', 30, 40, 3)];
    helper.update(sources, 'high', view);
    expect(lighting.setLight).toHaveBeenCalledTimes(1);
    expect(lighting.setLight.mock.calls[0]).toEqual([
      expect.any(String), 'adrenalineEssence', 25, 35,
      expect.objectContaining({ occludes: false, radiusPx: expect.any(Number), intensity: expect.any(Number) }),
    ]);
    helper.update(sources, 'high', view);
    expect(lighting.setLight).toHaveBeenCalledTimes(2);
    expect(lighting.setLight.mock.calls[1][0]).toBe(lighting.setLight.mock.calls[0][0]);
    helper.update([sources[0], source('flight', 50, 40, 3)], 'high', view);
    expect(lighting.setLight.mock.lastCall?.[2]).toBe(40);
  });

  it.each<GraphicsQuality>(['high', 'medium', 'low'])('bounds active and fading lights on %s while sources cross buckets', quality => {
    const { helper, owned } = fixture();
    for (let frame = 0; frame < 60; frame += 1) {
      const sources = Array.from({ length: 80 }, (_, index) => source(String(index), index * 75 + frame * 70, frame * 70));
      helper.update(sources, quality, null);
      expect(owned.size).toBeLessThanOrEqual(CONFIG.maxLights[quality]);
    }
    helper.update([], quality, null);
    expect([...owned.values()].every(light => light.fading)).toBe(true);
    helper.clear();
    expect(owned.size).toBe(0);
  });

  it('prefers on-screen then nearby sources, with stable tie-breaking independent of input order', () => {
    const { helper, owned } = fixture();
    const sources = Array.from({ length: 20 }, (_, index) => source(String(index), index * 68 + 4, 350));
    helper.update(sources, 'low', view);
    const first = [...owned.entries()].filter(([, light]) => !light.fading);
    expect(first).toHaveLength(CONFIG.maxLights.low);
    for (const [, light] of first) expect(Math.abs(light.x - view.width / 2)).toBeLessThan(160);
    helper.update([...sources].reverse(), 'low', view);
    expect([...owned.entries()].filter(([, light]) => !light.fading)).toEqual(first);
  });

  it('reduces the budget immediately, and clears lights already fading before a visibility change', () => {
    const { helper, owned, lighting } = fixture();
    const sources = Array.from({ length: 20 }, (_, index) => source(String(index), index * 80, 50));
    helper.update(sources, 'high', null);
    expect(owned.size).toBe(CONFIG.maxLights.high);
    helper.update(sources, 'low', null);
    expect(owned.size).toBe(CONFIG.maxLights.low);
    helper.update([], 'low', null);
    expect(lighting.releaseLight.mock.calls.some(call => call[1] === undefined)).toBe(true);
    helper.clear();
    expect(owned.size).toBe(0);
    helper.update(sources, 'low', null);
    helper.destroy();
    helper.update(sources, 'low', null);
    expect(owned.size).toBe(0);
  });

  it('does not turn invisible/invalid or distant poses into lights and bounds aggregated strength', () => {
    const { helper, lighting } = fixture();
    helper.update([
      source('hidden', 50, 50, 1, 0), source('invalid', NaN, 50),
      source('distant', 10000, 10000), source('empty', 50, 50, 0),
    ], 'high', view);
    expect(lighting.setLight).not.toHaveBeenCalled();
    helper.update([source('bright', 50, 50, 1_000_000)], 'high', view);
    const overrides = lighting.setLight.mock.lastCall?.[4] as { radiusPx: number; intensity: number };
    expect(overrides.radiusPx).toBeLessThanOrEqual(CONFIG.maxRadiusPx);
    expect(overrides.intensity).toBeLessThanOrEqual(CONFIG.maxIntensity);
  });

  it('keeps fading subnormal rewards and huge finite sources at finite light positions', () => {
    const { helper, lighting } = fixture();
    helper.update([source('tiny', 25, 35, Number.MIN_VALUE, 0.5)], 'high', null);
    expect(lighting.setLight.mock.lastCall?.slice(2, 4)).toEqual([25, 35]);
    helper.update([
      source('large-a', 100, 110, Number.MAX_VALUE),
      source('large-b', 120, 120, Number.MAX_VALUE),
      source('distant-finite', Number.MAX_VALUE, Number.MAX_VALUE, Number.MAX_VALUE),
    ], 'high', null);
    for (const call of lighting.setLight.mock.calls) {
      const overrides = call[4] as { radiusPx: number; intensity: number };
      for (const value of [call[2], call[3], overrides.radiusPx, overrides.intensity]) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
    expect(lighting.setLight.mock.calls.some(call => call[2] === 110 && call[3] === 115)).toBe(true);
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
