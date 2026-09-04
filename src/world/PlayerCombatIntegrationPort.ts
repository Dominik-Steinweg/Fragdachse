import type { Ak47DirectEnemyHitImpact, CombatDamageKind } from '../systems/CombatSystem';
import type { RemoteControlSource } from '../systems/CoopDefenseItemRuntimeSystem';
import type { SlimeDeathBurst } from '../systems/SlimeTrailSystem';
import type { ActiveBurnSource } from '../systems/CombatSystem';
import type { Ak47BehaviorPort } from '../loadout/Ak47BehaviorPort';
import type { WeaponKillReactionOutcome } from '../loadout/WeaponReactionPort';
import type { SustainedWeaponBehaviorPort } from '../loadout/SustainedWeaponBehaviorPort';
import type { LoadoutSlot, TrackedProjectile } from '../types';
import type { WeaponConfig } from '../loadout/LoadoutConfig';
import type { CoopDefenseClassDefinition } from '../config/coopDefenseClasses';
import type { ResourceSystem } from '../systems/ResourceSystem';

/** The resource operations that the legacy CombatSystem and world effects actually require. */
export type PlayerCombatResourcePort = Pick<
  ResourceSystem,
  'getAdrenaline'
  | 'drainAdrenaline'
  | 'addAdrenaline'
  | 'refundAdrenaline'
  | 'addRage'
  | 'resetAdrenalineForSpawn'
>;

/** Equipment-derived values consumed by combat, physics and automated weapon wiring. */
export interface PlayerCombatLoadoutPort {
  getEquippedWeaponConfig(playerId: string, slot: 'weapon1' | 'weapon2'): WeaponConfig | undefined;
  getDamageMultiplier(playerId: string, nowMs?: number): number;
  getWeaponDamageMultiplier(playerId: string, slot: LoadoutSlot, nowMs?: number): number;
  getSpeedMultiplier(playerId: string, nowMs?: number): number;
  getHeldSelfPushVelocity(playerId: string, nowMs?: number): { vx: number; vy: number } | null;
}

/** Resolved player/build values consumed by combat and movement resolution. */
export interface PlayerCombatModifierPort {
  getMaxHp(playerId: string): number;
  getHpRegenPerSecond(playerId: string): number;
  getNumericStat(playerId: string, stat: string): number;
  getPercentageStat(playerId: string, stat: string): number;
  getResolvedStat(playerId: string, stat: string, baseValue: number): number;
  getClassDefinition(playerId: string): CoopDefenseClassDefinition | null;
  resolveOutgoingDamage(
    attackerId: string | undefined,
    targetId: string,
    amount: number,
    allowCritical: boolean,
    random?: () => number,
    bonusPercent?: number,
  ): { amount: number; isCritical: boolean };
}

/** Player-state checks needed by the legacy combat/physics consumers. */
export interface PlayerCombatStatePort {
  isBurrowed(playerId: string): boolean;
  isStunned(playerId: string): boolean;
  isDashBlocked(playerId: string): boolean;
  getMovementSpeedFactor(playerId: string): number;
  isWeaponBlocked(playerId: string): boolean;
}

/** Conditional item-derived combat/movement values consumed by the World combat binding. */
export interface PlayerCombatItemPort {
  getConditionalDamageReduction(playerId: string): number;
  getConditionalLifeLeechBonus(playerId: string): number;
  getBonusArmorRegenPerSecond(playerId: string, nowMs?: number): number;
  getConditionalOutgoingDamageBonus(playerId: string | undefined, sourceSlot?: LoadoutSlot, nowMs?: number): number;
  getEnemyIncomingDamageMultiplier(enemyId: string, nowMs?: number): number;
  getRunSpeedMultiplier(playerId: string, nowMs?: number): number;
  getRemoteControlDamageMultiplier(
    playerId: string,
    source: RemoteControlSource,
    sources: readonly RemoteControlSource[],
  ): number;
}

export type PlayerCombatAk47Port = Pick<
  Ak47BehaviorPort,
  'registerProjectileHit' | 'resolveProjectile' | 'resetPlayer'
>;

export type PlayerCombatSustainedWeaponPort = Pick<
  SustainedWeaponBehaviorPort,
  'setTeslaDomeSystem' | 'setEnergyShieldSystem'
>;

export interface PlayerCombatUtilityPort {
  beginUtilityCooldown(playerId: string, utilityId: string, nowMs: number): void;
}

/** Enemy movement read owned by the player item/runtime behavior. */
export interface PlayerCombatSlimeTrailPort {
  getEnemyMovementFactor(enemyId: string, nowMs?: number): number;
}

export interface PlayerCombatKillOutcome {
  readonly killerId: string;
  readonly victimId: string;
  readonly sourceId: string;
  readonly x: number;
  readonly y: number;
  readonly source?: WeaponKillReactionOutcome['source'];
}

/** Typed authoritative reactions emitted by the WorldCombatGameplayBinding. */
export interface PlayerCombatReactionPort {
  handleDirectPrimaryHit(
    attackerId: string,
    enemyId: string,
    remainingHp: number,
    maxHp: number,
    isBoss: boolean,
  ): { slowFraction: number; slowDurationMs: number; shouldCull: boolean };
  handlePlayerDamageTaken(
    playerId: string,
    attackerId: string | undefined,
    hpLost: number,
    armorLost: number,
    damageKind: CombatDamageKind,
  ): { adrenalineGain: number; reflectedDamage: number; reflectTargetId?: string };
  handleDirectAk47EnemyHit(
    projectile: TrackedProjectile,
    enemyId: string,
    nowMs: number,
  ): Ak47DirectEnemyHitImpact | null;
  handleNaturalFlameExpiry(projectile: TrackedProjectile, x: number, y: number): void;
  handleEnemyDeath(enemyId: string, x: number, y: number, burnSources: readonly ActiveBurnSource[]): SlimeDeathBurst | null;
  removeEnemy(enemyId: string): void;
  handlePlayerDeath(playerId: string, x: number, y: number): void;
  resolveProjectile(projectile: TrackedProjectile): void;
  registerKill(outcome: PlayerCombatKillOutcome): void;
}

/**
 * Consumer-oriented player-Gameplay view for the WorldCombatGameplayBinding.
 *
 * It intentionally exposes semantic slices rather than the internal player-system graph. The
 * slices are the concrete combat integration used by this world binding; they are not a general
 * gameplay context or service locator.
 */
export interface PlayerCombatIntegrationPort {
  readonly resource: PlayerCombatResourcePort;
  readonly loadout: PlayerCombatLoadoutPort;
  readonly modifier: PlayerCombatModifierPort;
  readonly state: PlayerCombatStatePort;
  readonly item: PlayerCombatItemPort;
  readonly utility: PlayerCombatUtilityPort;
  readonly ak47: PlayerCombatAk47Port | null;
  readonly sustainedWeapon: PlayerCombatSustainedWeaponPort;
  readonly slimeTrail: PlayerCombatSlimeTrailPort | null;
  readonly reactions: PlayerCombatReactionPort;
}
