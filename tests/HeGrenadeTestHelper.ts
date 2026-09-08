import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals } from '../src/utils/coopDefenseUpgrades';
import type { DamageGrenadeEffect } from '../src/types';
import type { ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';

const fullHeLevels = {
  unlock_he_grenade: 1, he_grenade_cooldown: 3, he_grenade_damage: 3,
  he_grenade_charges: 3, he_grenade_impact_fuse: 1, he_grenade_cluster: 1,
  he_grenade_cluster_mass: 3, he_grenade_demolition_cluster: 3,
};

export const fullHeProfile = { upgrades: Object.fromEntries(Object.entries(fullHeLevels).map(
  ([id, level]) => [id, { unlocked: true, level }],
)) };

export function resolvedHe(profile = fullHeProfile) {
  const config = applyCoopDefenseModifiersToUtilityConfig(UTILITY_CONFIGS.HE_GRENADE,
    getCoopDefenseResolvedEffectTotals(profile, 'dachs_nukem'));
  if (config.type !== 'explosive') throw new Error('HE fixture must be explosive');
  return config;
}

export function heEffect(overrides: Partial<DamageGrenadeEffect> = {}): DamageGrenadeEffect {
  const config = resolvedHe();
  return {
    type: 'damage', role: 'primary', damage: config.aoeDamage, radius: config.aoeRadius,
    damageFalloff: config.damageFalloff, baseDamageMult: config.baseDamageMult,
    rockDamageMult: config.rockDamageMult, trainDamageMult: config.trainDamageMult,
    impactFuse: (config.impactFuseEnabled ?? 0) > 0, demolitionLevel: config.demolitionLevel,
    clusterCount: config.clusterCount, clusterRadiusFactor: config.clusterRadiusFactor,
    clusterDamageFactor: config.clusterDamageFactor, fragmentation: config.fragmentation,
    throwSpeed: config.projectileSpeed, ...overrides,
  };
}

export function heRequest(overrides: Partial<DamageGrenadeEffect> = {}): ProjectileSpawnRequest {
  const config = resolvedHe();
  return {
    origin: { x: 0, y: 0, angle: 0 },
    provenance: { gameplaySourceId: 'p1', attributionId: 'p1', allegiance: { ownerId: 'p1' },
      weaponSourceId: 'HE_GRENADE', sourceSlot: 'utility' },
    flight: { speed: config.projectileSpeed, size: config.projectileSize, isGrenade: true,
      maxBounces: config.maxBounces, lifetimeMs: config.fuseTime, fuseTimeMs: config.fuseTime, collisionMode: 'sweep' },
    interaction: { grenadeEffect: heEffect(overrides) },
    presentation: { color: 0x6f8151, style: 'grenade', grenadePreset: 'he' },
  };
}
