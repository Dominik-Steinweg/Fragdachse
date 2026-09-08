import { describe, expect, it } from 'vitest';
import { createGrenadeFragments } from '../../src/systems/GrenadeFragmentRules';
import { computeRadialDamage } from '../../src/utils/radialDamage';
import { createMulberry32Prng } from '../../src/debug/coopDefenseBalance/HeadlessStaticTargetWorld';
import { deriveBenchmarkSeeds } from '../../src/debug/coopDefenseBalance/benchmarkSeeds';
import { fullHeProfile, resolvedHe, heEffect, heRequest } from '../HeGrenadeTestHelper';
import type { DamageGrenadeEffect } from '../../src/types';

describe('HE progression balance envelopes', () => {
  it('keeps every progression stage valid and separates stored burst damage from sustained regeneration', () => {
    const levels = Object.entries(fullHeProfile.upgrades);
    let previousDamage = 0;
    for (let unlocked = 0; unlocked <= levels.length; unlocked++) {
      const config = resolvedHe({ upgrades: Object.fromEntries(levels.slice(0, unlocked)) });
      const cluster = (config.clusterCount ?? 0) * (config.clusterDamageFactor ?? 0);
      const demolition = config.fragmentation!.demolition;
      const extra = demolition.count * (demolition.damageFactors[(config.demolitionLevel ?? 0) - 1] ?? 0);
      const maximum = config.aoeDamage * (1 + cluster + extra);
      expect(maximum).toBeGreaterThanOrEqual(previousDamage);
      previousDamage = maximum;
      expect(Number.isFinite(maximum / config.cooldown * 1000)).toBe(true);
      expect(config.charges!.burstLockoutMs).toBeLessThan(config.cooldown);
      expect(config.charges!.maxCharges * maximum).toBeGreaterThanOrEqual(maximum);
    }
  });

  it.each([17, 311, 8191])('bounds spatial damage below the theoretical all-fragments maximum (seed %i)', seed => {
    const effect = heEffect();
    const random = createMulberry32Prng(deriveBenchmarkSeeds(seed).weaponSeed);
    const origin = { x: 0, y: 0, direction: 0, speed: effect.throwSpeed!, provenance: heRequest().provenance };
    const shards = [
      ...createGrenadeFragments(effect, origin, 'cluster', random),
      ...createGrenadeFragments(effect, origin, 'demolition', random),
    ];
    const maximum = effect.damage + shards.reduce((sum, s) => sum + (s.interaction.grenadeEffect as DamageGrenadeEffect).damage, 0);
    let observedMaximum = 0;
    for (let x = -effect.radius; x <= effect.radius * 1.5; x += effect.radius / 20) {
      for (let y = -effect.radius; y <= effect.radius; y += effect.radius / 20) {
        let actual = Math.hypot(x, y) > effect.radius ? 0 : computeRadialDamage(Math.hypot(x, y), effect.radius, effect.damage, effect.damageFalloff);
        for (const shard of shards) {
          const payload = shard.interaction.grenadeEffect as DamageGrenadeEffect;
          const distance = shard.flight.speed * shard.flight.fuseTimeMs! / 1000;
          const dx = x - Math.cos(shard.origin.angle) * distance;
          const dy = y - Math.sin(shard.origin.angle) * distance;
          const separation = Math.hypot(dx, dy);
          if (separation <= payload.radius) actual += computeRadialDamage(separation, payload.radius, payload.damage, payload.damageFalloff);
        }
        expect(actual).toBeLessThanOrEqual(maximum);
        observedMaximum = Math.max(observedMaximum, actual);
      }
    }
    expect(observedMaximum).toBeGreaterThanOrEqual(effect.damage);
    expect(observedMaximum).toBeLessThan(maximum);
  });
});
