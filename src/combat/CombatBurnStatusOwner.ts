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
}

function sourceActorId(source: CombatSource): string {
  return source.actor?.id !== undefined
    ? String(source.actor.id)
    : String(source.gameplaySource.id);
}

function sourceFactsKey(targetKey: string, attackerId: string, stackKey: string): string {
  return `${targetKey}\u001e${attackerId}\u001e${stackKey}`;
}

/**
 * Canonical World-local writer for Combatant Burn state. The established state machine remains
 * the only stacking/tick rules engine; this owner adds concrete target identity and retained
 * source facts around it.
 */
export class CombatBurnStatusOwner implements CombatBurnPort {
  private readonly machine = new BurnStateMachine();
  private readonly targets = new Map<string, CombatTargetRef>();
  private readonly sources = new Map<string, CombatSource>();

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
    const applied = this.machine.applyHit({
      targetId: targetKey,
      attackerId,
      durationMs: request.durationMs,
      damagePerTick: request.damagePerTick,
      sourceKey: stackKey,
      sourceId,
      origin: metadata.origin,
      visualStyle: metadata.visualStyle,
      now: request.nowMs,
    });
    if (!applied) return false;
    this.targets.set(targetKey, request.target);
    const factsKey = sourceFactsKey(targetKey, attackerId, stackKey);
    if (!this.sources.has(factsKey)) this.sources.set(factsKey, request.source);
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
      const source = this.sources.get(sourceFactsKey(
        contribution.targetId,
        contribution.attackerId,
        contribution.sourceKey,
      ));
      if (!target || !source) continue;
      resolved.push(Object.freeze({ ...contribution, target, source }));
    }
    this.pruneIndexes(nowMs);
    return resolved;
  }

  getVisualState(
    target: CombatTargetRef,
    nowMs: number,
  ): { stackCount: number; visualStyle: GroundFireVisualStyle } {
    return this.machine.getVisualState(combatTargetInstanceKey(target), nowMs);
  }

  getActiveSources(target: CombatTargetRef, nowMs: number): ActiveBurnSource[] {
    return this.machine.getActiveSources(combatTargetInstanceKey(target), nowMs);
  }

  clearBurn(target: CombatTargetRef): void {
    const targetKey = combatTargetInstanceKey(target);
    this.machine.clearTarget(targetKey);
    this.targets.delete(targetKey);
    for (const key of this.sources.keys()) {
      if (key.startsWith(`${targetKey}\u001e`)) this.sources.delete(key);
    }
  }

  /** Final source detach only. A source death intentionally does not call this operation. */
  clearSource(actorId: string): void {
    this.machine.clearByAttacker(actorId);
    for (const [key, source] of this.sources) {
      if (sourceActorId(source) === actorId) this.sources.delete(key);
    }
    this.pruneIndexes();
  }

  destroy(): void {
    this.machine.reset();
    this.targets.clear();
    this.sources.clear();
  }

  private pruneIndexes(nowMs?: number): void {
    for (const [targetKey] of this.targets) {
      const active = nowMs === undefined
        ? this.machine.hasTarget(targetKey)
        : this.machine.getStackCount(targetKey, nowMs) > 0;
      if (active) continue;
      this.targets.delete(targetKey);
      for (const key of this.sources.keys()) {
        if (key.startsWith(`${targetKey}\u001e`)) this.sources.delete(key);
      }
    }
  }
}
