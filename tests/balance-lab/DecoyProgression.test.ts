import { describe, expect, it } from 'vitest';
import { fullDecoyLevels, resolvedDecoy } from '../DecoyTestHelper';
import { computeRadialDamage } from '../../src/utils/radialDamage';

describe('Decoy approved tuning progression', () => {
  it('resolves every purchased level and both offensive branches from authored data', () => {
    const base = resolvedDecoy({});
    expect(base).toMatchObject({ cooldown: 12000, decoyLifetimeMs: 6000, stealthDurationMs: 6000 });
    for (let level = 1; level <= 3; level++) {
      const cfg = resolvedDecoy(Object.fromEntries(Object.keys(fullDecoyLevels).map(id =>
        [id, id === 'unlock_decoy' || id === 'decoy_explosive_dummy' ? 1 : level])));
      expect(cfg.refundRadius).toBe(level * 100); expect(cfg.refundPerEnemyMs).toBe(1000);
      expect(cfg.lureRadius).toBe(level * 100);
      expect(cfg.stealthMoveSpeedBonus).toBeCloseTo(level * 0.1);
      expect(cfg.stealthAdrenalineRegenBonus).toBeCloseTo(level * 0.1);
      expect(cfg.stealthHpRegenPerSecond).toBe(level * 5);
      expect(cfg.fireTrailDurationMs).toBe(level * 2000);
      expect(cfg.fireChunkBurst).toMatchObject({ count: level * 3, searchRadius: 96, flightMs: 320,
        durationMs: 2000, burnDurationMs: 2000, burnDamagePerTick: 0.25, visualStyle: 'normal' });
      expect(cfg).toMatchObject({ explosionRadius: 150, explosionDamage: 100, explosionMinDamage: 25, explosionKnockback: 500 });
      expect([0, 75, 150].map(distance => computeRadialDamage(distance, cfg.explosionRadius!, cfg.explosionDamage!,
        { minDamage: cfg.explosionMinDamage! }))).toEqual([100, 62.5, 25]);
    }
  });
});
