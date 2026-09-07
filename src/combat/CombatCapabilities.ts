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
import type { HitscanShotRequest, MeleeSwingRequest } from '../loadout/WeaponFireExecutor';

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
  applySlow(request: {
    readonly target: CombatTargetRef;
    readonly source: CombatSource;
    readonly factor: number;
    readonly durationMs: number;
    readonly nowMs: number;
  }): boolean;
  getMovementFactor(target: CombatTargetRef, nowMs: number): number;
  prune(nowMs: number): void;
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
