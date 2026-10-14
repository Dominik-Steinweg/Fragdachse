import { describe, expect, it } from 'vitest';
import { DAWN_SITE_HIT_FLASH_COOLDOWN_MS, DAWN_SITE_HIT_FLASH_MS, DAWN_SITE_LIGHT, resolveDawnSiteDecals, resolveDawnSiteLights, resolveDawnSitePropHitFlash, resolveDawnSitePropVisual } from '../src/arena/DawnSitePropModel';
import type { CoopDefenseSecondaryObjectiveState } from '../src/types';
import { DAWN_M3_ASSET_KEYS, DAWN_WRECK_VARIANTS } from '../src/dawn/contracts/DawnContentIds';
import { DAWN_DECAL_NAMES, DAWN_PIPELINE_ASSETS } from '../src/assets/DawnAssets';

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

  it('sweeps one beacon cone per revolution only while the extractor is active', () => {
    const lights = (state: CoopDefenseSecondaryObjectiveState, time: number) =>
      resolveDawnSiteLights('extractor', 1, state, false, time);
    const period = DAWN_SITE_LIGHT.beaconPeriodMs;
    const [warm, beacon] = lights('active', 0);
    expect(lights('active', 0).map(light => light.id)).toEqual(['warm', 'beacon']);
    expect(warm.radiusPx).toBeGreaterThan(lights('dormant', 0)[0].radiusPx);
    expect(warm.emissionAlpha).toBeGreaterThan(0);
    // The steady pool does not pulse against the sweep; only the cone turns, clockwise in screen space.
    expect(lights('active', period / 3)[0]).toEqual(warm);
    expect(beacon.angle).toBe(0);
    expect(lights('active', period / 4)[1].angle).toBeCloseTo(Math.PI / 2, 6);
    expect(lights('active', period)[1]).toEqual(beacon);
    expect(lights('active', -period / 4)[1].angle).toBeCloseTo(Math.PI * 1.5, 6);
    for (const state of ['completed', 'failed', 'dormant'] as const) {
      expect(lights(state, 0).map(light => light.id)).toEqual(['warm']);
      expect(lights(state, 0)).toEqual(lights(state, period / 2));
    }
    expect(lights('completed', 0)[0].emissionAlpha).toBeGreaterThan(0);
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

  it('flashes on damage and pulses under sustained damage instead of holding the flash', () => {
    const first = resolveDawnSitePropHitFlash(undefined, 100, 1000);
    const hit = resolveDawnSitePropHitFlash(first, 90, 1010);
    expect(hit).toMatchObject({ active: true, untilMs: 1010 + DAWN_SITE_HIT_FLASH_MS });
    // A hit during the flash does not extend it; the flash ends on time.
    const during = resolveDawnSitePropHitFlash(hit, 80, 1010 + DAWN_SITE_HIT_FLASH_MS / 2);
    expect(during.untilMs).toBe(hit.untilMs);
    const off = resolveDawnSitePropHitFlash(during, 80, hit.untilMs);
    expect(off.active).toBe(false);
    // Hits inside the quiet time stay dark; the next flash comes after it.
    expect(resolveDawnSitePropHitFlash(off, 70, hit.untilMs + DAWN_SITE_HIT_FLASH_COOLDOWN_MS - 1).active).toBe(false);
    expect(resolveDawnSitePropHitFlash(off, 70, hit.untilMs + DAWN_SITE_HIT_FLASH_COOLDOWN_MS).active).toBe(true);
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

  it('projects the M3 archetypes from rest to active to resolved, lighting only nest and capsule', () => {
    expect(resolveDawnSitePropVisual('brood-nest', 2, undefined, false)).toEqual({ textureKey: DAWN_M3_ASSET_KEYS.broodNest, animationKey: null });
    expect(resolveDawnSitePropVisual('brood-nest', 2, 'active', false)?.animationKey).toBe('construction_dawn_broodnest_sheet_idle');
    expect(resolveDawnSitePropVisual('brood-nest', 2, 'completed', false)).toBeNull();
    expect(resolveDawnSitePropVisual('supply', 1, 'completed', false)?.textureKey).toBe(DAWN_M3_ASSET_KEYS.supplyCapsule);
    expect(resolveDawnSitePropVisual('scavenger', 3, 'active', false)?.textureKey).toBe(DAWN_M3_ASSET_KEYS.scavengerCamp(3));
    expect(resolveDawnSitePropVisual('scrap-heaps', 3, 'active', false)?.textureKey).toBe(DAWN_M3_ASSET_KEYS.scrapHeap(3));
    for (const archetype of ['scrap-heaps', 'scavenger']) {
      expect(resolveDawnSitePropVisual(archetype, 3, 'completed', false)).toBeNull();
      expect(resolveDawnSiteLights(archetype, 3, 'active', false, 0)).toEqual([]);
    }
    expect(resolveDawnSiteLights('brood-nest', 1, 'active', false, 0)[0].radiusPx)
      .toBeGreaterThan(resolveDawnSiteLights('brood-nest', 1, undefined, false, 0)[0].radiusPx);
    for (const key of [DAWN_M3_ASSET_KEYS.broodNest, DAWN_M3_ASSET_KEYS.supplyCapsule, DAWN_M3_ASSET_KEYS.supplyCrate,
      DAWN_M3_ASSET_KEYS.supplyCrateCarried, DAWN_M3_ASSET_KEYS.scrapHeap(1), DAWN_M3_ASSET_KEYS.scavengerCamp(2)]) {
      expect(DAWN_PIPELINE_ASSETS.some(asset => asset.textureKey === key), key).toBe(true);
    }
  });
});

describe('Dawn site ground decals', () => {
  it('lays deterministic, archetype-specific decals and points supply drag marks toward the base', () => {
    for (const archetype of ['wreck', 'extractor', 'brood-nest', 'supply', 'scrap-heaps', 'scavenger']) {
      const decals = resolveDawnSiteDecals(archetype, 'nw-far', 0);
      expect(decals.length, archetype).toBeGreaterThan(0);
      expect(resolveDawnSiteDecals(archetype, 'nw-far', 0)).toEqual(decals);
      for (const decal of decals) expect(DAWN_DECAL_NAMES).toContain(decal.name);
    }
    expect(resolveDawnSiteDecals('extractor', 'a', 0)[0].name).toBe('drill-disturbance-03');
    expect(resolveDawnSiteDecals('brood-nest', 'a', 0)[0].name).toBe('organic-stain-01');
    expect(resolveDawnSiteDecals('scrap-heaps', 'a', 0)[0].name).toBe('rust-flakes-01');
    const [drag] = resolveDawnSiteDecals('supply', 'a', Math.PI / 2);
    expect(drag).toMatchObject({ name: 'drag-marks-01', rotation: Math.PI / 2 });
    expect(drag.offsetY).toBeGreaterThan(0);
    expect(['scorch-01', 'scorch-03']).toContain(resolveDawnSiteDecals('wreck', 'a', 0)[0].name);
    expect(resolveDawnSiteDecals('unknown', 'a', 0)).toEqual([]);
  });
});
