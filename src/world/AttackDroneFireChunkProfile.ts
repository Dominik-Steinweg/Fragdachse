import { ATTACK_DRONE_RULES as R } from '../config/attackDrone';
import type { ProjectileExplosionConfig } from '../types';
import type { PlayerCombatIntegrationPort } from './PlayerCombatIntegrationPort';

type FireChunkConfig = Parameters<NonNullable<PlayerCombatIntegrationPort['fireChunks']>['hostCreateFireChunkBurst']>[3];

/** Shared drone/bomber payload; each bomb owns its seed and independent burn source key. */
export function attackDroneFireChunkProfile(
  bombKey: string, count: number, multiplier: number, explosion: ProjectileExplosionConfig,
  source: { readonly fire: string; readonly chunk: string }, suppressExplosionBroadcast = false,
): FireChunkConfig {
  let randomSeed = 2166136261;
  for (const char of bombKey) randomSeed = Math.imul(randomSeed ^ char.charCodeAt(0), 16777619);
  return {
    randomSeed, count, searchRadius: R.chunkRadius, flightMs: R.chunkFlightMs,
    requireLineOfSight: true, igniteCenter: false, durationMs: R.groundDurationMs,
    burnDurationMs: R.burnDurationMs, burnDamagePerTick: R.burnDamagePerTick * multiplier,
    sourceId: source.fire, damageTarget: 'enemies', baseDamageMult: 0,
    landingExplosion: { ...explosion, radius: R.chunkExplosionRadius,
      maxDamage: R.chunkMaxDamage * multiplier, minDamage: R.chunkMinDamage * multiplier,
      audioSourceId: source.chunk, visualStyle: 'rocket', suppressExplosionBroadcast },
  };
}
