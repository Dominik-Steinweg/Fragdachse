import { describe, expect, it } from 'vitest';
import { DAWN_SITE_HIT_FLASH_MS, resolveDawnSitePropHitFlash, resolveDawnSitePropVisual } from '../src/arena/DawnSitePropModel';
import type { CoopDefenseSecondaryObjectiveState } from '../src/types';

const states: readonly (CoopDefenseSecondaryObjectiveState | undefined)[] = [undefined, 'dormant', 'active', 'completed', 'failed'];

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
  });
});
