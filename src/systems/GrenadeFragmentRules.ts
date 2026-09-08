import type { DamageGrenadeEffect } from '../types';
import type { ProjectileProvenance, ProjectileSpawnRequest } from '../projectile/ProjectileSpawnRequest';

export interface GrenadeFragmentOrigin {
  readonly x: number;
  readonly y: number;
  readonly direction: number;
  readonly speed: number;
  readonly provenance: ProjectileProvenance;
}

export function isGrenadeFragment(effect: { readonly type: string; readonly role?: string } | undefined): boolean {
  return effect?.type === 'damage' && (effect.role === 'cluster' || effect.role === 'demolition');
}

/** Produces resolved child requests. Randomness is supplied by the authoritative caller only. */
export function createGrenadeFragments(
  effect: DamageGrenadeEffect,
  origin: GrenadeFragmentOrigin,
  role: 'cluster' | 'demolition',
  random: () => number,
): ProjectileSpawnRequest[] {
  const config = effect.fragmentation;
  if (!config || isGrenadeFragment(effect)) return [];
  const demolition = role === 'demolition';
  const damageFactor = demolition
    ? config.demolition.damageFactors[(effect.demolitionLevel ?? 0) - 1] ?? 0
    : effect.clusterDamageFactor ?? 0;
  const count = demolition ? config.demolition.count : Math.max(0, Math.floor(effect.clusterCount ?? 0));
  if (damageFactor <= 0 || count === 0) return [];
  const radiusFactor = demolition ? config.demolition.radiusFactor : effect.clusterRadiusFactor ?? 0;
  const fuseRange = demolition ? config.demolition.fuseMs : config.fuseMs;
  const speedFraction = Math.min(1, Math.max(0, origin.speed / Math.max(1, effect.throwSpeed ?? origin.speed)));
  const halfAngle = (config.stationaryHalfAngleDeg
    + (config.movingHalfAngleDeg - config.stationaryHalfAngleDeg) * speedFraction) * Math.PI / 180;
  const shortCount = Math.round(count * config.shortFraction);
  const requests: ProjectileSpawnRequest[] = [];
  // Stratified times guarantee a stagger even with a fixed/repeating random source.
  for (let i = 0; i < count; i++) {
    const fuse = sample(fuseRange, (i + random()) / count);
    const distanceRange = demolition ? config.demolition.distance : i < shortCount ? config.shortDistance : config.longDistance;
    const bias = demolition ? 0 : speedFraction * config.speedDistanceBias;
    const distance = effect.radius * sample(distanceRange, bias + (1 - bias) * random());
    const angle = origin.direction + (random() * 2 - 1) * (demolition ? Math.PI : halfAngle);
    const payload: DamageGrenadeEffect = {
      type: 'damage', role, radius: effect.radius * radiusFactor, damage: effect.damage * damageFactor,
      damageFalloff: effect.damageFalloff ? { ...effect.damageFalloff, minDamage: effect.damageFalloff.minDamage * damageFactor } : undefined,
      allowTeamDamage: effect.allowTeamDamage, rockDamageMult: effect.rockDamageMult,
      trainDamageMult: effect.trainDamageMult, baseDamageMult: effect.baseDamageMult,
      visualStyle: demolition ? 'he_demolition_shard' : 'he_cluster_shard',
    };
    requests.push({
      origin: { x: origin.x, y: origin.y, angle },
      provenance: origin.provenance,
      flight: {
        speed: distance / Math.max(0.001, fuse / 1000), size: demolition ? config.demolition.projectileSize : config.projectileSize,
        lifetimeMs: fuse, fuseTimeMs: fuse, maxBounces: 3, isGrenade: true, collisionMode: 'sweep',
        drag: { bounceFrictionMultiplier: 0.6 },
      },
      interaction: { grenadeEffect: payload },
      presentation: { color: demolition ? 0xffce75 : 0xff8a38, style: 'grenade',
        grenadePreset: demolition ? 'he_demolition_shard' : 'he_cluster_shard' },
    });
  }
  return requests;
}

function sample(range: readonly number[], fraction: number): number {
  return range[0] + (range[1] - range[0]) * Math.max(0, Math.min(1, fraction));
}
