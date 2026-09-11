import type { RockHpRegistry } from '../arena/RockHpRegistry';
import type { BaseManager } from '../entities/BaseManager';
import type { PlacementSystem } from '../systems/PlacementSystem';
import type {
  CombatDamageMutationOutcome,
  CombatResolvedDamage,
  CombatSupportMutationOutcome,
  TargetDamageMutationRequest,
  TargetSupportMutationRequest,
  TargetMutationRejected,
} from '../combat/CombatMutation';
import { freezeTargetMutationOutcome } from '../combat/CombatMutation';
import type { CombatScope, CombatSource, CombatTargetRef } from '../combat/CombatScope';
import { combatTargetInstanceKey, isSameCombatScope } from '../combat/CombatScope';
import type { WorldTargetMutationPort } from '../combat/CombatCapabilities';
import type { ConstructionWorldRuntime } from './ConstructionWorldRuntime';
import type { WorldIntegrityMutationResult, WorldIntegrityState, WorldObjectKind } from './WorldIntegrityMutation';
import type { WorldRemovalCause } from './WorldIntegrityMutation';
import type { SyncedPlaceableRock } from '../types';
import type { WorldMetrics } from './WorldMetrics';
import { worldCellCenter } from './WorldMetrics';
import type { WorldRockRuntime } from './WorldRockRuntime';
import type { WorldTrainRuntime } from './WorldTrainRuntime';
import type { WorldScopedBinding } from './WorldRuntime';
import type { CombatDamageKind, LoadoutSlot } from '../types';

export interface WorldObjectMutationRuntimeOptions {
  readonly captureSource?: (actorId: string, sourceId: string, origin: CombatDamageKind) => CombatSource;
  readonly canDamageStructure?: (source: CombatSource, ownerId?: string, faction?: 'friendly' | 'hostile') => boolean;
  readonly scope: CombatScope;
  readonly metrics: WorldMetrics;
  readonly rockRegistry: RockHpRegistry;
  readonly rockRuntime: WorldRockRuntime;
  readonly placement: PlacementSystem;
  readonly construction: ConstructionWorldRuntime;
  readonly bases: BaseManager | null;
  readonly train: WorldTrainRuntime | null;
  readonly onDestroy?: (runtime: WorldObjectMutationRuntime) => void;
}

export interface WorldDamageUnitCandidate {
  readonly kind: WorldObjectKind;
  readonly id: string | number;
  readonly damage: CombatResolvedDamage;
}

interface PreparedWorldDamage {
  readonly target: CombatTargetRef;
  readonly damage: CombatResolvedDamage;
}

/**
 * Narrow cross-domain dispatcher. HP remains at each target owner; this class supplies identity,
 * alias dedupe and immutable Combat receipts around those atomic owner commits.
 */
export class WorldObjectMutationRuntime implements WorldTargetMutationPort, WorldScopedBinding {
  private outcomeSequence = 0;
  private destroyed = false;
  private readonly damageObservers = new Set<(outcome: CombatDamageMutationOutcome, position: { x: number; y: number }) => void>();

  observeDamageCommitted(observer: (outcome: CombatDamageMutationOutcome, position: { x: number; y: number }) => void): () => void {
    this.damageObservers.add(observer);
    return () => { this.damageObservers.delete(observer); };
  }

  constructor(private readonly options: WorldObjectMutationRuntimeOptions) {}

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.damageObservers.clear();
    this.options.onDestroy?.(this);
  }

  resolveTarget(kind: WorldObjectKind, id: string | number): CombatTargetRef | null {
    const numericId = Number(id);
    if ((kind === 'rock' || kind === 'construction') && Number.isSafeInteger(numericId) && numericId >= 0) {
      const placeable = this.options.placement.getRuntimeRock(numericId);
      if (placeable) {
        return Object.freeze({
          kind: placeable.constructionId ? 'construction' as const : 'rock' as const,
          id: numericId,
          scope: this.options.scope,
          instance: Object.freeze({ entityGeneration: 1 }),
        });
      }
      if (kind === 'construction' || !this.options.rockRegistry.readIntegrity(numericId)) return null;
      return Object.freeze({
        kind: 'rock' as const,
        id: numericId,
        scope: this.options.scope,
        instance: Object.freeze({ entityGeneration: 1 }),
      });
    }
    if (kind === 'base') {
      const base = this.options.bases?.getBase(String(id));
      if (!base) return null;
      return Object.freeze({
        kind: 'base' as const,
        id: String(id),
        scope: this.options.scope,
        instance: Object.freeze({ entityGeneration: 1 }),
      });
    }
    if (kind === 'train') {
      const generation = this.options.train?.getCurrentTargetGeneration();
      if (generation === null || generation === undefined) return null;
      return Object.freeze({
        kind: 'train' as const,
        id: 'main',
        scope: this.options.scope,
        instance: Object.freeze({ entityGeneration: generation }),
      });
    }
    return null;
  }

  /** Materializes and alias-deduplicates a complete effect unit before its first mutation. */
  prepareDamageUnit(candidates: readonly WorldDamageUnitCandidate[]): readonly PreparedWorldDamage[] {
    const prepared: PreparedWorldDamage[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      const target = this.resolveTarget(candidate.kind, candidate.id);
      if (!target) continue;
      const key = this.physicalKey(target);
      if (seen.has(key)) continue;
      seen.add(key);
      prepared.push(Object.freeze({ target, damage: candidate.damage }));
    }
    return Object.freeze(prepared);
  }

  commitDamageUnit(candidates: readonly WorldDamageUnitCandidate[], source: CombatSource): readonly CombatDamageMutationOutcome[] {
    return this.prepareDamageUnit(candidates).map(({ target, damage }) => this.commitDamage({
      outcomeId: this.nextOutcomeId('damage', target),
      target,
      source,
      damage,
    }));
  }

  applyResolvedDamage(
    kind: WorldObjectKind,
    id: string | number,
    amount: number,
    attackerId: string,
    sourceId: string,
    damageKind: CombatDamageKind = 'direct',
    sourceSlot?: LoadoutSlot,
    explicitSource?: CombatSource,
  ): CombatDamageMutationOutcome | null {
    const target = this.resolveTarget(kind, id);
    if (!target) return null;
    const captured = explicitSource ? undefined : this.options.captureSource?.(attackerId, sourceId, damageKind);
    const source = explicitSource ?? (captured ? { ...captured, sourceSlot } : undefined)
      ?? legacyWorldSource(attackerId, sourceId, damageKind, sourceSlot);
    const damage: CombatResolvedDamage = {
      amount,
      damageKind,
      basis: { kind: 'source-resolved', amount, sourceFactors: [] },
      sourceFactors: [], targetFactors: [], isCritical: false,
    };
    return this.commitDamage({ outcomeId: this.nextOutcomeId('damage', target), target, source, damage });
  }

  applyRepair(
    kind: Extract<WorldObjectKind, 'rock' | 'construction' | 'base'>,
    id: string | number,
    amount: number,
    supporterId: string,
    sourceId: string,
  ): CombatSupportMutationOutcome | null {
    const target = this.resolveTarget(kind, id);
    if (!target) return null;
    return this.commitSupport({
      outcomeId: this.nextOutcomeId('repair', target), target,
      source: legacyWorldSource(supporterId, sourceId, 'support'),
      supportKind: 'repair', amount,
    });
  }

  finalizeRemovedConstruction(
    runtime: SyncedPlaceableRock,
    cause: WorldRemovalCause,
    playDust: boolean,
  ): void {
    if (this.destroyed) return;
    this.options.construction.finalizeRemovedRuntime(runtime, cause, playDust);
  }

  commitDamage(request: TargetDamageMutationRequest): CombatDamageMutationOutcome {
    const rejected = this.validate(request.target, request.damage.amount, request.outcomeId, request.source);
    if (rejected) return rejected;
    const before = this.readState(request.target);
    const facts = this.readFacts(request.target);
    if (!before || !facts) return this.rejected(request, 'target-missing');
    const placed = request.target.kind === 'rock' || request.target.kind === 'construction'
      ? this.options.placement.getRuntimeRock(Number(request.target.id)) : undefined;
    const base = request.target.kind === 'base' ? this.options.bases?.getBase(String(request.target.id)) : undefined;
    if ((placed || base) && (placed?.ownerId === request.source.allegiance.ownerId
      || this.options.canDamageStructure?.(request.source, placed?.ownerId, base?.faction) === false)) {
      return freezeTargetMutationOutcome({ kind: 'accepted-no-effect', outcomeId: request.outcomeId,
        target: request.target, source: request.source, reason: 'immune', resultingState: toCombatState(before) });
    }
    const result = this.commitOwnerDamage(request.target, request.damage.amount, sourceActorId(request.source));
    const outcome = this.damageOutcome(request, result, facts);
    if (!this.destroyed && outcome.kind === 'damage-applied') for (const observer of this.damageObservers) {
      observer(outcome, facts.position);
      if (this.destroyed) break;
    }
    return outcome;
  }

  commitSupport(request: TargetSupportMutationRequest): CombatSupportMutationOutcome {
    const rejected = this.validate(request.target, request.amount, request.outcomeId, request.source);
    if (rejected) return rejected;
    if (request.supportKind !== 'repair') return this.rejected(request, 'not-eligible');
    const result = this.commitOwnerRepair(request.target, request.amount);
    if (result.kind === 'missing') return this.rejected(request, 'target-missing');
    if (result.kind === 'inert') return this.rejected(request, 'target-dead');
    if (result.kind === 'immune') return freezeTargetMutationOutcome({
      kind: 'accepted-no-effect', outcomeId: request.outcomeId, target: request.target,
      source: request.source, reason: 'immune', resultingState: toCombatState(result.state),
    });
    if (result.actualAmount <= 0) return freezeTargetMutationOutcome({
      kind: 'accepted-no-effect', outcomeId: request.outcomeId, target: request.target,
      source: request.source, reason: 'zero-effect', resultingState: toCombatState(result.state),
    });
    return freezeTargetMutationOutcome({
      kind: 'support-applied', outcomeId: request.outcomeId, target: request.target,
      source: request.source, supportKind: 'repair', actualAmount: result.actualAmount,
      resultingState: toCombatState(result.state), revived: false,
    });
  }

  private validate(
    target: CombatTargetRef,
    amount: number,
    outcomeId: string,
    source: CombatSource,
  ): TargetMutationRejected | null {
    if (this.destroyed) {
      return freezeTargetMutationOutcome({ kind: 'rejected', outcomeId, target, source, reason: 'stale-scope' });
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return freezeTargetMutationOutcome({ kind: 'rejected', outcomeId, target, source, reason: 'invalid-value' });
    }
    if (!isSameCombatScope(target.scope, this.options.scope)) {
      return freezeTargetMutationOutcome({ kind: 'rejected', outcomeId, target, source, reason: 'stale-scope' });
    }
    const current = this.resolveTarget(target.kind as WorldObjectKind, target.id);
    if (!current) return freezeTargetMutationOutcome({ kind: 'rejected', outcomeId, target, source, reason: 'target-missing' });
    if (combatTargetInstanceKey(current) !== combatTargetInstanceKey(target)) {
      return freezeTargetMutationOutcome({ kind: 'rejected', outcomeId, target, source, reason: 'stale-target' });
    }
    return null;
  }

  private readState(target: CombatTargetRef): WorldIntegrityState | null {
    const id = Number(target.id);
    if (target.kind === 'rock') {
      return this.options.placement.readIntegrity(id) ?? this.options.rockRegistry.readIntegrity(id);
    }
    if (target.kind === 'construction') return this.options.placement.readIntegrity(id);
    if (target.kind === 'base') {
      const base = this.options.bases?.getBase(String(target.id));
      return base ? { integrity: base.getHp(), maxIntegrity: base.getMaxHp(), destroyed: base.isDestroyed() } : null;
    }
    if (target.kind === 'train') return this.options.train?.readIntegrity() ?? null;
    return null;
  }

  private readFacts(target: CombatTargetRef) {
    const id = Number(target.id);
    if (target.kind === 'rock' || target.kind === 'construction') {
      const placed = this.options.placement.getRuntimeRock(id);
      if (placed) return {
        target, position: worldCellCenter(this.options.metrics, placed.gridX, placed.gridY),
        targetCategory: placed.kind, presentation: { ownerId: placed.ownerId },
      };
      const cell = this.options.rockRuntime ? this.options.rockRegistry.readIntegrity(id) : null;
      if (!cell) return null;
      const position = this.options.rockRuntime.getPosition(id);
      return position ? { target, position, targetCategory: 'rock' } : null;
    }
    if (target.kind === 'base') {
      const base = this.options.bases?.getBase(String(target.id));
      const spec = base?.getSpec();
      if (!base || !spec) return null;
      const first = spec.cells[0];
      return {
        target,
        position: first ? worldCellCenter(this.options.metrics, first.gridX, first.gridY) : { x: 0, y: 0 },
        targetCategory: `base:${base.faction}`,
      };
    }
    if (target.kind === 'train') {
      const positions = this.options.train?.getActiveSegmentPositions() ?? [];
      const first = positions[0];
      return first ? { target, position: first, targetCategory: 'train' } : null;
    }
    return null;
  }

  private commitOwnerDamage(target: CombatTargetRef, amount: number, attackerId: string): WorldIntegrityMutationResult {
    const id = Number(target.id);
    if (target.kind === 'construction' || (target.kind === 'rock' && this.options.placement.hasRuntimeRock(id))) {
      return this.options.construction.commitDamage(id, amount, attackerId);
    }
    if (target.kind === 'rock') return this.options.rockRuntime.commitDamage(id, amount, attackerId);
    if (target.kind === 'base') return this.options.bases?.commitDamage(String(target.id), amount) ?? { kind: 'missing' };
    if (target.kind === 'train') return this.options.train?.commitDamage(amount, attackerId) ?? { kind: 'missing' };
    return { kind: 'missing' };
  }

  private commitOwnerRepair(target: CombatTargetRef, amount: number): WorldIntegrityMutationResult {
    const id = Number(target.id);
    if (target.kind === 'construction' || (target.kind === 'rock' && this.options.placement.hasRuntimeRock(id))) {
      return this.options.construction.commitRepair(id, amount);
    }
    if (target.kind === 'rock') return this.options.rockRuntime.commitRepair(id, amount);
    if (target.kind === 'base') return this.options.bases?.commitRepair(String(target.id), amount) ?? { kind: 'missing' };
    return { kind: 'missing' };
  }

  private damageOutcome(
    request: TargetDamageMutationRequest,
    result: WorldIntegrityMutationResult,
    facts: NonNullable<ReturnType<WorldObjectMutationRuntime['readFacts']>>,
  ): CombatDamageMutationOutcome {
    if (result.kind === 'missing') return this.rejected(request, 'target-missing');
    if (result.kind === 'inert') return this.rejected(request, 'target-dead');
    if (result.kind === 'immune') return freezeTargetMutationOutcome({
      kind: 'accepted-no-effect', outcomeId: request.outcomeId, target: request.target,
      source: request.source, reason: 'immune', resultingState: toCombatState(result.state),
    });
    if (result.actualAmount <= 0) return freezeTargetMutationOutcome({
      kind: 'accepted-no-effect', outcomeId: request.outcomeId, target: request.target,
      source: request.source, reason: 'zero-effect', resultingState: toCombatState(result.state),
    });
    const common = {
      kind: 'damage-applied' as const, outcomeId: request.outcomeId, target: request.target,
      source: request.source, damage: request.damage, actualDamage: result.actualAmount,
      hpLost: 0, armorLost: 0, integrityLost: result.actualAmount,
      resultingState: toCombatState(result.state),
    };
    return freezeTargetMutationOutcome(result.transition === 'destroyed'
      ? { ...common, transition: { kind: 'destroyed' as const, facts } }
      : { ...common, transition: { kind: 'none' as const }, rescueHealing: 0 });
  }

  private rejected(
    request: Pick<TargetDamageMutationRequest, 'outcomeId' | 'target' | 'source'>,
    reason: 'target-missing' | 'target-dead' | 'not-eligible',
  ) {
    return freezeTargetMutationOutcome({
      kind: 'rejected' as const, outcomeId: request.outcomeId, target: request.target,
      source: request.source, reason,
    });
  }

  private physicalKey(target: CombatTargetRef): string {
    if ((target.kind === 'rock' || target.kind === 'construction')
      && this.options.placement.hasRuntimeRock(Number(target.id))) return `placement:${target.id}`;
    return `${target.kind}:${target.id}:${target.instance.entityGeneration}`;
  }

  private nextOutcomeId(kind: string, target: CombatTargetRef): string {
    return `world:${kind}:${this.physicalKey(target)}:${++this.outcomeSequence}`;
  }
}

function toCombatState(state: WorldIntegrityState) {
  return Object.freeze({
    kind: 'integrity' as const,
    integrity: state.integrity,
    maxIntegrity: state.maxIntegrity,
    destroyed: state.destroyed,
  });
}

function sourceActorId(source: CombatSource): string {
  return source.attribution.id;
}

function legacyWorldSource(
  actorId: string,
  authoredSourceId: string,
  origin: CombatDamageKind | 'support',
  sourceSlot?: LoadoutSlot,
): CombatSource {
  return Object.freeze({
    gameplaySource: { kind: 'player' as const, id: actorId },
    attribution: { kind: 'player' as const, id: actorId },
    allegiance: { ownerId: actorId },
    authoredSourceId,
    sourceSlot,
    origin,
  });
}
