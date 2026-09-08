import type { MolotovUtilityConfig } from './LoadoutTypes';
import type { FireGrenadeEffect } from '../types';

/** One resolved effect contract for thrown Molotovs and inherited Kamikaze Napalm. */
export function resolveMolotovFireEffect(cfg: MolotovUtilityConfig): FireGrenadeEffect {
  const burn = { durationMs: cfg.fireBurnDurationMs ?? 0, damagePerTick: cfg.fireBurnDamagePerTick ?? 0 };
  const trailDurationMs = cfg.wildfireTrailDurationMs ?? 0;
  const trailDamagePerTick = cfg.wildfireTrailDamagePerTick ?? 0;
  const wildfireEnabled = (cfg.wildfireEnabled ?? 0) > 0;
  return {
    type: 'fire', radius: cfg.fireRadius, damagePerTick: cfg.fireDamagePerTick,
    lingerDuration: cfg.fireLingerDuration, allowTeamDamage: cfg.allowTeamDamage,
    rockDamageMult: cfg.rockDamageMult, trainDamageMult: cfg.trainDamageMult,
    baseDamageMult: cfg.baseDamageMult,
    burnDurationMs: burn.durationMs, burnDamagePerTick: burn.damagePerTick,
    firewalker: wildfireEnabled && cfg.firewalkerDurationMs > 0 ? {
      durationMs: cfg.firewalkerDurationMs, trailDurationMs, trailDamagePerTick, burn,
    } : undefined,
    wildfire: wildfireEnabled ? {
      speedMultiplier: cfg.wildfirePanicSpeedMultiplier ?? 1,
      trailDurationMs, trailDamagePerTick,
      deathBurst: cfg.wildfireChunkCount > 0 ? {
        count: cfg.wildfireChunkCount, searchRadius: cfg.wildfireChunkRadius,
        flightMs: cfg.wildfireChunkFlightMs, igniteCenter: false,
        durationMs: trailDurationMs, burnDurationMs: burn.durationMs,
        burnDamagePerTick: burn.damagePerTick, sourceId: 'ground_fire.molotov_chunks',
      } : undefined,
    } : undefined,
  };
}
