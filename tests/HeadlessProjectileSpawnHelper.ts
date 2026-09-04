import {
  createSingleOwnerProvenance,
  type ProjectileSpawnRequest,
} from '../src/projectile/ProjectileSpawnRequest';

/** Nur die Felder, die eine Headless-Benchmark-Welt tatsächlich auswertet. */
export interface HeadlessProjectileSpawnOverrides {
  readonly speed?: number;
  readonly size?: number;
  readonly damage?: number;
  readonly lifetimeMs?: number;
  readonly adrenalinGain?: number;
  readonly weaponSourceId?: string;
  readonly burnDurationMs?: number;
  readonly burnDamagePerTick?: number;
}

/** Baut einen minimalen Spawn-Auftrag für die Headless-Benchmark-Welten. */
export function headlessProjectileSpawnRequest(
  x: number,
  y: number,
  angle: number,
  ownerId: string,
  overrides: HeadlessProjectileSpawnOverrides = {},
): ProjectileSpawnRequest {
  return {
    origin: { x, y, angle },
    flight: {
      speed: overrides.speed ?? 1000,
      size: overrides.size ?? 2,
      lifetimeMs: overrides.lifetimeMs ?? 1000,
      maxBounces: 0,
      isGrenade: false,
    },
    provenance: createSingleOwnerProvenance(ownerId, {
      weaponSourceId: overrides.weaponSourceId ?? 'test_projectile',
    }),
    interaction: {
      directHit: {
        damage: overrides.damage ?? 10,
        adrenalinGain: overrides.adrenalinGain ?? 0,
      },
      burn: {
        durationMs: overrides.burnDurationMs,
        damagePerTick: overrides.burnDamagePerTick,
      },
    },
    presentation: { color: 0xffffff },
  };
}
