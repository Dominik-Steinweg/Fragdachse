import type { CombatMovementStatusPort } from '../combat/CombatCapabilities';
import { combatTargetInstanceKey, type CombatTargetRef } from '../combat/CombatScope';
import { mergeEnemySlow, type EnemySlowState } from '../utils/enemySlow';

interface StoredEnemySlow {
  readonly target: CombatTargetRef;
  readonly state: EnemySlowState;
}

/** The World-local writer for target-bound Enemy slow and independent hit stagger. */
export class EnemyMovementStatusSystem implements CombatMovementStatusPort {
  private readonly states = new Map<string, StoredEnemySlow>();
  private readonly hitStaggers = new Map<string, { readonly target: CombatTargetRef; readonly expiresAt: number }>();

  applyHitStagger(request: Parameters<CombatMovementStatusPort['applyHitStagger']>[0]): boolean {
    if (request.target.kind !== 'enemy'
      || !Number.isFinite(request.durationMs) || request.durationMs <= 0
      || !Number.isFinite(request.nowMs)) return false;
    // Refresh from this hit, never add to the previous duration or merge with a slow.
    this.hitStaggers.set(combatTargetInstanceKey(request.target), {
      target: request.target,
      expiresAt: request.nowMs + request.durationMs,
    });
    return true;
  }

  isHitStaggered(target: CombatTargetRef, nowMs: number): boolean {
    const state = this.hitStaggers.get(combatTargetInstanceKey(target));
    return state !== undefined && nowMs < state.expiresAt;
  }

  applySlow(request: Parameters<CombatMovementStatusPort['applySlow']>[0]): boolean {
    if (request.target.kind !== 'enemy'
      || !Number.isFinite(request.factor)
      || !Number.isFinite(request.durationMs)
      || !Number.isFinite(request.nowMs)
      || request.factor >= 1
      || request.durationMs <= 0) return false;
    const key = combatTargetInstanceKey(request.target);
    const current = this.states.get(key)?.state;
    this.states.set(key, {
      target: request.target,
      state: mergeEnemySlow(current, 1 - request.factor, request.durationMs, request.nowMs),
    });
    return true;
  }

  /** Passive read: expiry is interpreted, never physically pruned here. */
  getMovementFactor(target: CombatTargetRef, nowMs: number): number {
    const state = this.states.get(combatTargetInstanceKey(target))?.state;
    return state && nowMs < state.expiresAt ? state.movementFactor : 1;
  }

  prune(nowMs: number, isCurrentTarget?: (target: CombatTargetRef) => boolean): void {
    for (const [key, entry] of this.states) {
      if (nowMs >= entry.state.expiresAt || isCurrentTarget?.(entry.target) === false) this.states.delete(key);
    }
    for (const [key, entry] of this.hitStaggers) {
      if (nowMs >= entry.expiresAt || isCurrentTarget?.(entry.target) === false) this.hitStaggers.delete(key);
    }
  }

  clearMovementStatus(target: CombatTargetRef): void {
    this.states.delete(combatTargetInstanceKey(target));
    this.hitStaggers.delete(combatTargetInstanceKey(target));
  }

  clearTargetId(enemyId: string): void {
    for (const [key, entry] of this.states) {
      if (entry.target.kind === 'enemy' && entry.target.id === enemyId) this.states.delete(key);
    }
    for (const [key, entry] of this.hitStaggers) {
      if (entry.target.id === enemyId) this.hitStaggers.delete(key);
    }
  }

  clear(): void {
    this.states.clear();
    this.hitStaggers.clear();
  }
}
