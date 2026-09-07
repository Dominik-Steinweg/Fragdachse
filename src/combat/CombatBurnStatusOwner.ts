import { BURN_TICK_INTERVAL_MS } from '../config';
import type { BurnOrigin, GroundFireVisualStyle } from '../types';
import type { CombatBurnPort, CombatBurnRequest } from './CombatCapabilities';
import { combatTargetInstanceKey, type CombatSource, type CombatTargetRef } from './CombatScope';
import {
  BurnStateMachine,
  type ActiveBurnSource,
  type DueBurnContribution,
} from './rules/BurnStateMachine';

export interface CombatBurnMetadata {
  readonly stackKey?: string;
  readonly origin?: BurnOrigin;
  readonly visualStyle?: GroundFireVisualStyle;
}

export interface DueCombatBurnContribution extends DueBurnContribution {
  readonly target: CombatTargetRef;
  readonly source: CombatSource;
  /** Recheck immediately before mutation: an earlier contribution may detach this source. */
  readonly isSourceValid: () => boolean;
}

function sourceActorId(source: CombatSource): string {
  return source.actor?.id !== undefined
    ? String(source.actor.id)
    : String(source.gameplaySource.id);
}

interface BurnSourceFacts {
  readonly source: CombatSource;
  readonly stackKey: string;
}

/** Equal authored stacks can share buckets only when all retained provenance agrees. */
function sourceFactsKey(stackKey: string, source: CombatSource): string {
  return JSON.stringify([
    stackKey,
    source.gameplaySource.kind, source.gameplaySource.id,
    source.actor?.kind, source.actor?.id,
    source.attribution.kind, source.attribution.id,
    source.allegiance.ownerId, source.allegiance.factionId, source.allegiance.allowTeamDamage,
    source.authoredSourceId, source.sourceSlot, source.origin,
    source.lineage?.parentEffectId, source.lineage?.parentProjectileId,
    source.lineage?.reflected, source.lineage?.plasmaSwarmChild,
    source.lineage?.plasmaSwarmOriginEnemyId,
    source.correlation?.executionId, source.correlation?.projectileId, source.correlation?.shotId,
  ]);
}

/**
 * Canonical World-local writer for Combatant Burn state. The established state machine remains
 * the only stacking/tick rules engine; this owner adds concrete target identity and retained
 * source facts around it.
 */
export class CombatBurnStatusOwner implements CombatBurnPort {
  private readonly machine = new BurnStateMachine();
  private readonly targets = new Map<string, CombatTargetRef>();
  private readonly sources = new Map<string, Map<string, BurnSourceFacts>>();
  private readonly sourceDetachGenerations = new Map<string, number>();
  private generation = 0;

  applyBurn(request: CombatBurnRequest, metadata: CombatBurnMetadata = {}): boolean {
    if ((request.target.kind !== 'player' && request.target.kind !== 'enemy')
      || request.tickIntervalMs !== BURN_TICK_INTERVAL_MS
      || !Number.isFinite(request.nowMs)) return false;

    const targetKey = combatTargetInstanceKey(request.target);
    const attackerId = sourceActorId(request.source);
    const stackKey = metadata.stackKey
      ?? request.source.authoredSourceId
      ?? `${request.source.gameplaySource.kind}:${request.source.gameplaySource.id}`;
    const sourceId = request.source.authoredSourceId ?? stackKey;
    const factsKey = sourceFactsKey(stackKey, request.source);
    const applied = this.machine.applyHit({
      targetId: targetKey,
      attackerId,
      durationMs: request.durationMs,
      damagePerTick: request.damagePerTick,
      sourceKey: factsKey,
      sourceId,
      origin: metadata.origin,
      visualStyle: metadata.visualStyle,
      now: request.nowMs,
    });
    if (!applied) return false;
    this.targets.set(targetKey, request.target);
    let targetSources = this.sources.get(targetKey);
    if (!targetSources) {
      targetSources = new Map();
      this.sources.set(targetKey, targetSources);
    }
    if (!targetSources.has(factsKey)) {
      targetSources.set(factsKey, { source: request.source, stackKey });
    }
    return true;
  }

  advance(
    nowMs: number,
    isTargetEligible: (target: CombatTargetRef) => boolean,
  ): readonly DueCombatBurnContribution[] {
    if (!Number.isFinite(nowMs)) return [];
    const due = this.machine.advanceTo(nowMs, (targetKey) => {
      const target = this.targets.get(targetKey);
      return Boolean(target && isTargetEligible(target));
    });
    const resolved: DueCombatBurnContribution[] = [];
    for (const contribution of due) {
      const target = this.targets.get(contribution.targetId);
      const facts = this.sources.get(contribution.targetId)?.get(contribution.sourceKey);
      if (!target || !facts) continue;
      const generation = this.generation;
      const sourceGeneration = this.sourceDetachGenerations.get(contribution.attackerId) ?? 0;
      resolved.push(Object.freeze({
        ...contribution, sourceKey: facts.stackKey, target, source: facts.source,
        isSourceValid: () => generation === this.generation
          && sourceGeneration === (this.sourceDetachGenerations.get(contribution.attackerId) ?? 0),
      }));
    }
    this.pruneIndexes();
    return resolved;
  }

  getVisualState(
    target: CombatTargetRef,
    nowMs: number,
  ): { stackCount: number; visualStyle: GroundFireVisualStyle } {
    return this.machine.getVisualState(combatTargetInstanceKey(target), nowMs);
  }

  getActiveSources(target: CombatTargetRef, nowMs: number): ActiveBurnSource[] {
    const targetKey = combatTargetInstanceKey(target);
    return this.machine.getActiveSources(targetKey, nowMs).map((source) => ({
      ...source,
      sourceKey: this.sources.get(targetKey)!.get(source.sourceKey)!.stackKey,
    }));
  }

  clearBurn(target: CombatTargetRef): void {
    const targetKey = combatTargetInstanceKey(target);
    this.machine.clearTarget(targetKey);
    this.targets.delete(targetKey);
    this.sources.delete(targetKey);
  }

  /** Final source detach only. A source death intentionally does not call this operation. */
  clearSource(actorId: string): void {
    // Numeric actor/target generations may be reused; final detach cancels even issued ticks.
    this.sourceDetachGenerations.set(actorId, (this.sourceDetachGenerations.get(actorId) ?? 0) + 1);
    this.machine.clearByAttacker(actorId);
    this.pruneIndexes();
  }

  destroy(): void {
    this.generation += 1;
    this.sourceDetachGenerations.clear();
    this.machine.reset();
    this.targets.clear();
    this.sources.clear();
  }

  private pruneIndexes(): void {
    for (const [targetKey] of this.targets) {
      if (!this.machine.hasTarget(targetKey)) {
        this.targets.delete(targetKey);
        this.sources.delete(targetKey);
        continue;
      }
      for (const [key, facts] of this.sources.get(targetKey)!) {
        if (!this.machine.hasSource(targetKey, sourceActorId(facts.source), key)) {
          this.sources.get(targetKey)!.delete(key);
        }
      }
    }
  }
}
