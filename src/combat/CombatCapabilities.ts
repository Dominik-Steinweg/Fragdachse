import type {
  CombatDamageMutationOutcome,
  CombatDamagePort,
  CombatSupportMutationOutcome,
  CombatSupportPort,
  CombatTargetStateSnapshot,
  TargetDamageAppliedOutcome,
  TargetDamageMutationPort,
  TargetDamageTerminalOutcome,
  TargetMutationNoEffect,
  TargetMutationOutcome,
  TargetSupportAppliedOutcome,
  TargetSupportMutationPort,
} from './CombatMutation';
import type { CombatSource, CombatTargetRef } from './CombatScope';
import type { ActiveBurnSource } from './rules/BurnStateMachine';
import type { HitscanShotRequest, MeleeSwingRequest } from '../loadout/WeaponFireExecutor';
import type {
  BurnOrigin,
  CombatDamageKind,
  CombatDamageTargetType,
  GroundFireVisualStyle,
  LoadoutSlot,
  ProjectileExplosionConfig,
  RadialDamageFalloffConfig,
  ShieldBlockCategory,
} from '../types';

// CF-READ
export interface CombatVitalsReadPort {
  readVitals(target: CombatTargetRef): CombatTargetStateSnapshot | null;
}

export interface CombatOutcomeReadPort {
  readOutcome(outcomeId: string): TargetMutationOutcome | null;
}

// CF-QUERY
export interface CombatTargetSnapshot {
  readonly target: CombatTargetRef;
  readonly state: CombatTargetStateSnapshot;
  readonly position?: { readonly x: number; readonly y: number };
}

export interface CombatTargetReadPort {
  resolveTarget(target: CombatTargetRef): CombatTargetSnapshot | null;
}

export interface CombatRelationshipResult {
  readonly relationship: 'self' | 'ally' | 'enemy' | 'neutral';
  readonly canDamage: boolean;
  readonly canSupport: boolean;
}

export interface CombatRelationshipReadPort {
  resolveRelationship(source: CombatSource, target: CombatTargetRef): CombatRelationshipResult;
}

export interface CombatLineQueryPort {
  queryLine(request: {
    readonly kind: 'line-of-sight' | 'line-of-fire';
    readonly start: { readonly x: number; readonly y: number };
    readonly end: { readonly x: number; readonly y: number };
    readonly width?: number;
  }): { readonly blocked: boolean; readonly distance: number };
}

/**
 * Legacy-facing slices used by world-owned mechanics while their authored payloads are
 * normalized at the existing Combat boundary.  These are grouped by semantic responsibility;
 * consumers must not depend on the concrete WorldCombatCore implementation.
 */
export interface CombatActorStatePort {
  isStunned?(id: string, now: number): boolean;
  isAlive(id: string): boolean;
  isBurrowed(id: string): boolean;
}

export interface CombatRelationshipQueryPort {
  canDamageTarget(attackerId: string | undefined, targetId: string, allowTeamDamage?: boolean): boolean;
}

export interface CombatGeometryPort {
  hasLineOfSight(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    skipRockIndex?: number,
    sourceCarrierBaseId?: string,
    clearanceRadius?: number,
    purpose?: import('../systems/ObstacleRules').ObstacleQueryPurpose,
  ): boolean;
  hasClearLineOfFire(
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    options?: {
      readonly purpose?: import('../systems/ObstacleRules').ObstacleQueryPurpose;
      readonly skipRockIndex?: number;
      readonly sourceCarrierBaseId?: string;
      readonly clearanceRadius?: number;
    },
  ): boolean;
}

/** Explicit legacy damage facts used by migrated world/activity consumers. */
export interface CombatDamageApplicationOptions {
  readonly basis?: import('./CombatMutation').CombatDamageBasis;
  readonly allowTeamDamage?: boolean;
  readonly allowCritical?: boolean;
  readonly sourceSlot?: LoadoutSlot;
  readonly damageKind?: CombatDamageKind;
  readonly source?: CombatSource;
  readonly skipLifeLeech?: boolean;
}

/** Explicit radial-effect modifiers used by migrated world/activity consumers. */
export interface CombatAoeDamageOptions {
  readonly category?: ShieldBlockCategory;
  readonly allowTeamDamage?: boolean;
  readonly sourceId?: string;
  readonly sourceSlot?: LoadoutSlot;
  readonly baseDamageMult?: number;
  readonly enemySlowFraction?: number;
  readonly enemySlowDurationMs?: number;
  readonly killSource?: {
    readonly shotgunLightningGeneration?: number;
  };
}

export interface CombatDamageEffectPort {
  applyDamage(
    targetId: string,
    amount: number,
    skipBurrowCheck?: boolean,
    attackerId?: string,
    sourceId?: string,
    visualContext?: { readonly sourceX?: number; readonly sourceY?: number; readonly dirX?: number; readonly dirY?: number },
    options?: CombatDamageApplicationOptions,
  ): TargetMutationOutcome | null;
  applyAoeDamage(
    x: number,
    y: number,
    radius: number,
    damage: number,
    ownerId: string,
    includeSelf?: boolean,
    options?: CombatAoeDamageOptions,
  ): void;
  applyExplosionDamage(
    x: number,
    y: number,
    effect: ProjectileExplosionConfig,
    ownerId: string,
    sourceSlot?: LoadoutSlot,
    sourceId?: string,
    source?: CombatSource,
  ): readonly string[];
  applyBaseDamage(baseId: string, damage: number, attackerId: string, sourceSlot?: LoadoutSlot): void;
  applyRadialHostileBaseDamage(
    x: number,
    y: number,
    radius: number,
    maxDamage: number,
    attackerId?: string,
    falloff?: RadialDamageFalloffConfig,
    sourceSlot?: LoadoutSlot,
    baseDamageMult?: number,
  ): void;
  applyBurnHit(
    targetId: string,
    attackerId: string,
    durationMs: number,
    damagePerTick: number,
    sourceKey: string,
    sourceId: string,
    origin?: BurnOrigin,
    visualStyle?: GroundFireVisualStyle,
  ): void;
}

export interface CombatPlayerSupportPort extends CombatActorStatePort {
  getHP(id: string): number;
  getMaxHp(id: string): number;
  getArmor(id: string): number;
  healToFull(id: string): number;
  heal(id: string, amount: number): number;
  addArmor(id: string, amount: number): number;
  hpRegenTick(id: string, deltaMs: number): void;
  armorRegenTick(id: string, deltaMs: number): void;
}

export interface CombatDamageModifierReadPort {
  getPlayerRuntimeDamageMultiplier(id: string, sourceSlot?: LoadoutSlot): number;
}

export interface CombatBurnReadPort {
  getActiveBurnSources(id: string, nowMs: number): readonly ActiveBurnSource[];
}

export interface CombatDamageObservationPort {
  addDamageDealtObserver(observer: (event: {
    readonly targetFaction?: 'hostile' | 'allied';
    readonly targetType: CombatDamageTargetType;
    readonly targetId: string;
    readonly attackerId: string | undefined;
    readonly damage: number;
    readonly damageKind: CombatDamageKind;
    readonly sourceSlot: LoadoutSlot | undefined;
    readonly isCritical: boolean;
  }) => void): () => void;
}

/** World-train geometry attachment; callers only clear/install the current segment view. */
export interface CombatTrainSegmentPort {
  setTrainSegments(segments: readonly { readonly x: number; readonly y: number; readonly width: number; readonly height: number }[] | null): void;
}

/** Activity consumer view for enemy behaviours and authored mission effects. */
export type CombatActivityPort =
  & CombatActorStatePort
  & CombatDamageEffectPort
  & CombatGeometryPort
  & CombatRelationshipQueryPort;

export interface CombatSafeMuzzlePort {
  resolveSafeHitscanStart(
    shooterX: number,
    shooterY: number,
    desiredMuzzleX: number,
    desiredMuzzleY: number,
    options?: import('../systems/ObstacleRules').ObstacleShotOptions,
  ): { readonly x: number; readonly y: number };
}

// CF-ATTACK
export type CombatImmediateAttackRequest =
  | {
    readonly kind: 'hitscan';
    /** Normalized execution request; host resolves the source and commits the outcome. */
    readonly payload: HitscanShotRequest;
    readonly source?: CombatSource;
    readonly origin: { readonly x: number; readonly y: number };
    readonly aim: { readonly x: number; readonly y: number };
    readonly range: number;
  }
  | {
    readonly kind: 'melee';
    /** Normalized execution request; host resolves the source and commits the outcome. */
    readonly payload: MeleeSwingRequest;
    readonly source?: CombatSource;
    readonly origin: { readonly x: number; readonly y: number };
    readonly aim: { readonly x: number; readonly y: number };
    readonly range: number;
  };

export interface CombatImmediateAttackOutcome {
  readonly accepted: boolean;
  readonly interactions: readonly CombatDamageMutationOutcome[];
}

export interface CombatImmediateAttackPort {
  resolveImmediateAttack(request: CombatImmediateAttackRequest): CombatImmediateAttackOutcome;
}

// CF-STATUS: separate writers prevent Burn, movement and general target status from sharing state.
export interface CombatBurnRequest {
  readonly target: CombatTargetRef;
  readonly source: CombatSource;
  readonly damagePerTick: number;
  readonly tickIntervalMs: number;
  readonly durationMs: number;
  readonly nowMs: number;
}

export interface CombatBurnPort {
  applyBurn(request: CombatBurnRequest): boolean;
  clearBurn(target: CombatTargetRef): void;
}

export interface CombatMovementStatusPort {
  applyHitStagger(request: {
    readonly target: CombatTargetRef;
    readonly durationMs: number;
    readonly nowMs: number;
  }): boolean;
  isHitStaggered(target: CombatTargetRef, nowMs: number): boolean;
  applySlow(request: {
    readonly target: CombatTargetRef;
    readonly source: CombatSource;
    readonly factor: number;
    readonly durationMs: number;
    readonly nowMs: number;
  }): boolean;
  getMovementFactor(target: CombatTargetRef, nowMs: number): number;
  prune(nowMs: number, isCurrentTarget?: (target: CombatTargetRef) => boolean): void;
  clearMovementStatus(target: CombatTargetRef): void;
}

export interface CombatTargetStatusPort {
  applyVulnerability(request: {
    readonly target: CombatTargetRef;
    readonly source: CombatSource;
    readonly multiplier: number;
    readonly durationMs: number;
    readonly nowMs: number;
  }): boolean;
  getIncomingDamageMultiplier(target: CombatTargetRef, nowMs: number): number;
  clearTargetStatus(target: CombatTargetRef): void;
}

// CF-REACTION: contact, effective damage and terminal transition are distinct triggers.
export interface CombatAcceptedHit {
  readonly target: CombatTargetRef;
  readonly source: CombatSource;
  readonly outcome: TargetMutationNoEffect | TargetDamageAppliedOutcome | TargetSupportAppliedOutcome;
}

export interface CombatReactionPort {
  onAcceptedHit(hit: CombatAcceptedHit): void;
  onDamageApplied(outcome: TargetDamageAppliedOutcome): void;
  onTerminalTransition(outcome: TargetDamageTerminalOutcome): void;
}

// CF-LIFE
export interface PlayerCombatLifePort {
  attachPlayer(request: {
    readonly playerId: string;
    readonly entityGeneration: number;
  }): void;
  beginLife(request: {
    readonly playerId: string;
    readonly entityGeneration: number;
    readonly lifeRevision: number;
  }): CombatTargetRef;
  endLife(target: CombatTargetRef): void;
  detachPlayer(playerId: string, entityGeneration: number): void;
}

export interface PlayerRespawnCommitPort {
  commitRespawn(playerId: string, previousLifeRevision: number): CombatTargetRef | null;
}

// CF-FRAME
export interface CombatFramePort {
  advance(nowMs: number, deltaMs: number): void;
}

export interface CombatOutcomeProjectionPort {
  publish(outcomes: readonly TargetMutationOutcome[]): void;
}

// CF-WORLD reuses the canonical mutation contracts instead of defining parallel receipts.
export interface WorldTargetMutationPort extends TargetDamageMutationPort, TargetSupportMutationPort {}

export interface CombatWorldEffectPort {
  applyWorldEffect(request: {
    readonly kind: 'impulse' | 'field' | 'spawn';
    readonly source: CombatSource;
    readonly target?: CombatTargetRef;
    readonly payload: Readonly<Record<string, unknown>>;
  }): boolean;
}

/** Build-only cyclic bindings. This aggregate is never handed to gameplay consumers. */
export interface WorldCombatRequiredBindings {
  readonly damage: CombatDamagePort;
  readonly support: CombatSupportPort;
  readonly targetRead: CombatTargetReadPort;
  readonly relationships: CombatRelationshipReadPort;
  readonly reactions: CombatReactionPort;
}

export interface CombatBoundaryAttachment {
  detach(): void;
}
