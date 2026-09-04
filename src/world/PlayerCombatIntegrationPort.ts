import type { Ak47DirectEnemyHitImpact, CombatDamageKind } from '../systems/CombatSystem';
import type { RemoteControlSource } from '../systems/CoopDefenseItemRuntimeSystem';
import type { SlimeDeathBurst } from '../systems/SlimeTrailSystem';
import type { ActiveBurnSource } from '../systems/CombatSystem';
import type { Ak47BehaviorPort } from '../loadout/Ak47BehaviorPort';
import type { NegevBehaviorPort as NegevBehaviorPortContract } from '../loadout/NegevBehaviorPort';
import type {
  WeaponKillReactionOutcome,
  WeaponReactionPort,
} from '../loadout/WeaponReactionPort';
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

/** Conditional item-derived combat/movement values and item-local combat reactions. */
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
  rollDirectPrimaryHitEffects(
    attackerId: string,
    enemyId: string,
    nowMs?: number,
  ): { slowFraction: number; slowDurationMs: number };
  rollCulling(attackerId: string, remainingHp: number, maxHp: number, isBoss: boolean): boolean;
  handlePlayerDamageTaken(
    playerId: string,
    attackerId: string | undefined,
    hpLost: number,
    armorLost: number,
    damageKind: CombatDamageKind,
    nowMs?: number,
  ): { adrenalineGain: number; reflectedDamage: number; reflectTargetId?: string };
  removeEnemy(enemyId: string): void;
}

export type PlayerCombatAk47Port = Pick<
  Ak47BehaviorPort,
  'registerProjectileHit' | 'resolveProjectile' | 'resetPlayer'
>;

export interface PlayerCombatAk47StrategicTargetPort {
  handleDirectAk47EnemyHit(
    projectile: TrackedProjectile,
    enemyId: string,
    nowMs: number,
  ): Ak47DirectEnemyHitImpact | null;
}

export type PlayerCombatNegevPort = Pick<NegevBehaviorPortContract, 'registerKill'>;
export type PlayerCombatWeaponReactionPort = Pick<WeaponReactionPort, 'registerKill'> & {
  registerKill(outcome: WeaponKillReactionOutcome): void;
};
export type PlayerCombatSustainedWeaponPort = Pick<
  SustainedWeaponBehaviorPort,
  'setTeslaDomeSystem' | 'setEnergyShieldSystem'
>;

export interface PlayerCombatUtilityPort {
  beginUtilityCooldown(playerId: string, utilityId: string, nowMs: number): void;
}

export interface PlayerCombatSlimeTrailPort {
  getEnemyMovementFactor(enemyId: string, nowMs?: number): number;
  handleEnemyDeath(enemyId: string, x: number, y: number, nowMs?: number): SlimeDeathBurst | null;
}

export interface PlayerCombatFlamethrowerPort {
  handleNaturalFlameExpiry(projectile: TrackedProjectile, x: number, y: number, nowMs?: number): void;
  handleEnemyDeath(x: number, y: number, burnSources: readonly ActiveBurnSource[], nowMs?: number): void;
  handlePlayerDeath(playerId: string, x: number, y: number): void;
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
  readonly ak47StrategicTarget: PlayerCombatAk47StrategicTargetPort | null;
  readonly negev: PlayerCombatNegevPort | null;
  readonly weaponReaction: PlayerCombatWeaponReactionPort;
  readonly sustainedWeapon: PlayerCombatSustainedWeaponPort;
  readonly slimeTrail: PlayerCombatSlimeTrailPort | null;
  readonly flamethrower: PlayerCombatFlamethrowerPort | null;
}
