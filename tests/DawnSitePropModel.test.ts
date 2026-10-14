import { describe, expect, it } from 'vitest';
import { DAWN_SITE_HIT_FLASH_MS, DAWN_SITE_LIGHT, resolveDawnSiteLights, resolveDawnSitePropHitFlash, resolveDawnSitePropVisual } from '../src/arena/DawnSitePropModel';
import type { CoopDefenseSecondaryObjectiveState } from '../src/types';
import { DAWN_M3_ASSET_KEYS, DAWN_WRECK_VARIANTS } from '../src/dawn/contracts/DawnContentIds';
import { DAWN_PIPELINE_ASSETS } from '../src/assets/DawnAssets';

const states: readonly (CoopDefenseSecondaryObjectiveState | undefined)[] = [undefined, 'dormant', 'active', 'completed', 'failed'];

describe('Dawn site lighting projection', () => {
  it('keeps dormant and failed extractor silhouettes lit with their warning lamp off', () => {
    for (const state of [undefined, 'dormant', 'failed'] as const) {
      const lights = resolveDawnSiteLights('extractor', 1, state, false, 0);
      expect(lights[0].intensity).toBeGreaterThan(0);
      expect(lights[0].emissionAlpha).toBe(0);
      expect(resolveDawnSiteLights('extractor', 1, state, false, 350)).toEqual(lights);
    }
  });

  it('pulses only the active extractor smoothly and keeps its trough above dormant light', () => {
    const sample = (state: CoopDefenseSecondaryObjectiveState, time: number) =>
      resolveDawnSiteLights('extractor', 1, state, false, time)[0];
    const period = DAWN_SITE_LIGHT.pulsePeriodMs;
    const trough = sample('active', 0), peak = sample('active', period / 2);
    expect(trough.intensity).toBeGreaterThan(sample('dormant', 0).intensity);
    expect(trough.radiusPx).toBeGreaterThan(sample('dormant', 0).radiusPx);
    expect(peak.intensity).toBeGreaterThan(trough.intensity);
    expect(peak.emissionAlpha).toBeGreaterThan(trough.emissionAlpha);
    expect(trough.emissionAlpha).toBeGreaterThan(0);
    expect(sample('active', period)).toEqual(trough);
    expect(sample('active', 1).intensity).toBeCloseTo(trough.intensity, 4);
    expect(sample('completed', 0)).toEqual(sample('completed', period / 2));
    expect(sample('completed', 0).emissionAlpha).toBeGreaterThan(0);
  });

  it('adds a smaller cyan source only to rare wrecks, independent of activation', () => {
    for (const tier of [1, 2, 3]) {
      const lights = resolveDawnSiteLights('wreck', tier, undefined, false, 0);
      expect(resolveDawnSiteLights('wreck', tier, 'active', false, 123)).toEqual(lights);
      expect(lights.map(light => light.id)).toEqual(tier === 3 ? ['warm', 'tech'] : ['warm']);
      if (tier === 3) {
        expect(lights[1].color).not.toBe(lights[0].color);
        expect(lights[1].radiusPx).toBeLessThan(lights[0].radiusPx);
        expect(lights[1].intensity).toBeLessThan(lights[0].intensity);
      }
    }
  });

  it('never lights removed, salvaged or unknown props', () => {
    for (const state of states) for (const archetype of ['wreck', 'extractor']) {
      expect(resolveDawnSiteLights(archetype, 3, state, true, 100)).toEqual([]);
    }
    expect(resolveDawnSiteLights('wreck', 3, 'completed', false, 100)).toEqual([]);
    expect(resolveDawnSiteLights('wreck', 4, undefined, false, 100)).toEqual([]);
    expect(resolveDawnSiteLights('unknown', 1, undefined, false, 100)).toEqual([]);
  });
});

describe('Dawn site damage flash', () => {
  it('baselines first observation and ignores unchanged or repaired HP', () => {
    const first = resolveDawnSitePropHitFlash(undefined, 60, 1000);
    const unchanged = resolveDawnSitePropHitFlash(first, 60, 1010);
    const repaired = resolveDawnSitePropHitFlash(unchanged, 80, 1020);
    expect([first.active, unchanged.active, repaired.active]).toEqual([false, false, false]);
    expect(resolveDawnSitePropHitFlash(repaired, 70, 1030).active).toBe(true);
  });

  it('flashes on damage, renews from the latest hit and expires without stacking', () => {
    const first = resolveDawnSitePropHitFlash(undefined, 100, 1000);
    const hit = resolveDawnSitePropHitFlash(first, 90, 1010);
    const nextHitAt = 1010 + DAWN_SITE_HIT_FLASH_MS / 2;
    const repeated = resolveDawnSitePropHitFlash(hit, 80, nextHitAt);
    expect(hit.active).toBe(true);
    expect(repeated.active).toBe(true);
    expect(repeated.untilMs).toBe(nextHitAt + DAWN_SITE_HIT_FLASH_MS);
    const unchanged = resolveDawnSitePropHitFlash(repeated, 80, repeated.untilMs - 1);
    expect(unchanged.active).toBe(true);
    expect(unchanged.untilMs).toBe(repeated.untilMs);
    expect(resolveDawnSitePropHitFlash(unchanged, 80, repeated.untilMs).active).toBe(false);
  });

  it('clears missing state and baselines the next available structure', () => {
    const first = resolveDawnSitePropHitFlash(undefined, 100, 1000);
    const hit = resolveDawnSitePropHitFlash(first, 90, 1010);
    const missing = resolveDawnSitePropHitFlash(hit, null, 1020);
    expect(missing.active).toBe(false);
    expect(resolveDawnSitePropHitFlash(missing, 40, 1030).active).toBe(false);
  });
});

describe('Dawn site prop projection', () => {
  it.each(DAWN_WRECK_VARIANTS)('loads and projects every tier and state of %s with its lights', variant => {
    for (const tier of [1, 2, 3]) for (const state of states) {
      const textureKey = DAWN_M3_ASSET_KEYS.wreckVariant(variant, tier);
      expect(DAWN_PIPELINE_ASSETS.some(asset => asset.textureKey === textureKey)).toBe(true);
      expect(resolveDawnSitePropVisual('wreck', tier, state, false, variant)).toEqual(state === 'completed'
        ? null : { textureKey, animationKey: null });
      expect(resolveDawnSitePropVisual('wreck', tier, state, true, variant)).toBeNull();
      const lights = resolveDawnSiteLights('wreck', tier, state, false, 0, variant);
      expect(lights.map(light => light.id)).toEqual(state === 'completed' ? [] : tier === 3 ? ['warm', 'tech'] : ['warm']);
      expect(resolveDawnSiteLights('wreck', tier, state, true, 0, variant)).toEqual([]);
      expect(lights.every(light => light.intensity > 0)).toBe(true);
    }
  });

  it.each([1, 2, 3])('shows wreck tier %i until salvaged or destroyed', tier => {
    for (const state of states) {
      expect(resolveDawnSitePropVisual('wreck', tier, state, false)).toEqual(state === 'completed'
        ? null : { textureKey: `construction_dawn_wreck_t${tier}`, animationKey: null });
      expect(resolveDawnSitePropVisual('wreck', tier, state, true)).toBeNull();
    }
  });

  it.each([1, 2, 3])('projects extractor tier %i from rest to active to idle', tier => {
    for (const state of states) {
      const animated = state === 'active' || state === 'completed';
      expect(resolveDawnSitePropVisual('extractor', tier, state, false)).toEqual({
        textureKey: animated ? 'construction_dawn_extractor_sheet' : 'construction_dawn_extractor',
        animationKey: state === 'active' ? 'construction_dawn_extractor_sheet_active'
          : state === 'completed' ? 'construction_dawn_extractor_sheet_idle' : null,
      });
      expect(resolveDawnSitePropVisual('extractor', tier, state, true)).toBeNull();
    }
  });

  it('does not invent a visual for unknown art', () => {
    expect(resolveDawnSitePropVisual('unknown', 1, undefined, false)).toBeNull();
    expect(resolveDawnSitePropVisual('wreck', 4, undefined, false)).toBeNull();
    expect(resolveDawnSitePropVisual('wreck', 1, undefined, false, 'unknown')).toBeNull();
  });
});
