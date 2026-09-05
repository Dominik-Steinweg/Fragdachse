import type { SyncedActiveHudBuff } from '../types';
import type { ProjectileAk47HitContext } from '../projectile/ProjectileCombatPort';
import type { ProjectileLifecycleOutcome } from '../projectile/ProjectileGameplayPort';
import type { WeaponConfig } from './LoadoutConfig';

/** Read-only equipment boundary consumed by the world-owned AK47 behavior. */
export interface Ak47LoadoutReadPort {
  getEquippedWeaponConfig(playerId: string, slot: 'weapon2'): WeaponConfig | undefined;
}

/** Resolved AK47 shot data; mutable progression remains in the behavior owner. */
export interface Ak47ShotPreparation {
  readonly shotConfig: WeaponConfig;
  readonly fireControlSpreadMultiplier: number;
  readonly shotId: number;
  readonly fireSuperiorityShot: boolean;
}

/** Narrow command/read boundary between Loadout, Combat and the AK47 behavior owner. */
export interface Ak47BehaviorPort {
  prepareShot(playerId: string, config: WeaponConfig): Ak47ShotPreparation | null;
  commitShot(playerId: string, shotId: number, fireSuperiorityShot: boolean): void;
  registerProjectileHit(context: ProjectileAk47HitContext, nowMs: number): void;
  resolveProjectile(outcome: ProjectileLifecycleOutcome): void;
  registerStrategicTargetHit(context: ProjectileAk47HitContext, enemyId: string): boolean;
  resetPlayer(playerId: string): void;
  removePlayer(playerId: string): void;
  getHudBuffs(playerId: string, nowMs: number): readonly SyncedActiveHudBuff[];
  isFireSuperiorityActive(playerId: string): boolean;
  isFireSuperiorityAvailable(playerId: string): boolean;
  isFocusAtMaxStacks(playerId: string): boolean;
}
