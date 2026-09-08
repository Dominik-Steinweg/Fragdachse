import { describe, expect, it } from 'vitest';
import { createGrenadeFragments } from '../src/systems/GrenadeFragmentRules';
import { heEffect, heRequest } from './HeGrenadeTestHelper';
import type { DamageGrenadeEffect } from '../src/types';

const origin = { x: 12, y: 18, speed: 0, direction: Math.PI / 2, provenance: heRequest().provenance };

describe('HE fragment flight and inheritance', () => {
  it('partitions short/long flights, staggers fuses and preserves the complete damage source', () => {
    const effect = heEffect();
    const config = effect.fragmentation!;
    const children = createGrenadeFragments(effect, origin, 'cluster', () => 0.5);
    expect(children).toHaveLength(effect.clusterCount!);
    const shortCount = Math.round(children.length * config.shortFraction);
    let previousFuse = -1;
    children.forEach((child, index) => {
      const fuse = child.flight.fuseTimeMs!;
      expect(fuse).toBeGreaterThan(previousFuse);
      expect(fuse).toBeGreaterThanOrEqual(config.fuseMs[0]);
      expect(fuse).toBeLessThanOrEqual(config.fuseMs[1]);
      previousFuse = fuse;
      const range = index < shortCount ? config.shortDistance : config.longDistance;
      const distance = child.flight.speed * fuse / 1000 / effect.radius;
      expect(distance).toBeGreaterThanOrEqual(range[0]);
      expect(distance).toBeLessThanOrEqual(range[1]);
      expect(child.provenance).toEqual(origin.provenance);
      const payload = child.interaction.grenadeEffect as DamageGrenadeEffect;
      expect(payload.damage).toBeCloseTo(effect.damage * effect.clusterDamageFactor!);
      expect(payload.damageFalloff!.minDamage).toBeCloseTo(effect.damageFalloff!.minDamage * effect.clusterDamageFactor!);
      expect(payload.radius).toBeCloseTo(effect.radius * effect.clusterRadiusFactor!);
      expect(payload.baseDamageMult).toBe(effect.baseDamageMult);
      expect(payload.rockDamageMult).toBe(effect.rockDamageMult);
      expect(payload.impactFuse).toBeUndefined();
      expect(createGrenadeFragments(payload, origin, 'cluster', () => 0.5)).toEqual([]);
      expect(createGrenadeFragments(payload, origin, 'demolition', () => 0.5)).toEqual([]);
    });
  });

  it('narrows the forward fan and biases travel toward the far end at higher speed', () => {
    const effect = heEffect();
    const stationary = createGrenadeFragments(effect, origin, 'cluster', () => 0.9);
    const fast = createGrenadeFragments(effect, { ...origin, speed: effect.throwSpeed! }, 'cluster', () => 0.9);
    for (let i = 0; i < stationary.length; i++) {
      expect(Math.abs(fast[i].origin.angle - origin.direction)).toBeLessThan(Math.abs(stationary[i].origin.angle - origin.direction));
      expect(fast[i].flight.speed).toBeGreaterThan(stationary[i].flight.speed);
    }
  });

  it.each([1, 2, 3])('uses the nonlinear demolition table at level %i with its own radius and fuse', level => {
    const effect = heEffect({ demolitionLevel: level });
    const config = effect.fragmentation!.demolition;
    const shards = createGrenadeFragments(effect, origin, 'demolition', () => 0.5);
    expect(shards).toHaveLength(config.count);
    for (const shard of shards) {
      const payload = shard.interaction.grenadeEffect as DamageGrenadeEffect;
      expect(payload.damage).toBeCloseTo(effect.damage * config.damageFactors[level - 1]);
      expect(payload.radius).toBeCloseTo(effect.radius * config.radiusFactor);
      expect(shard.flight.fuseTimeMs).toBeGreaterThanOrEqual(config.fuseMs[0]);
      expect(shard.flight.fuseTimeMs).toBeLessThanOrEqual(config.fuseMs[1]);
      expect(shard.presentation.grenadePreset).toBe('he_demolition_shard');
    }
  });
});
