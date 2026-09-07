import type { CombatMovementStatusPort } from '../combat/CombatCapabilities';
import { combatTargetInstanceKey, type CombatTargetRef } from '../combat/CombatScope';
import { mergeEnemySlow, type EnemySlowState } from '../utils/enemySlow';

interface StoredEnemySlow {
  readonly target: CombatTargetRef;
  readonly state: EnemySlowState;
}

/** The single World-local writer for general target-bound Enemy movement slow. */
export class EnemyMovementStatusSystem implements CombatMovementStatusPort {
  private readonly states = new Map<string, StoredEnemySlow>();

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

  prune(nowMs: number): void {
    for (const [key, entry] of this.states) {
      if (nowMs >= entry.state.expiresAt) this.states.delete(key);
    }
  }

  clearMovementStatus(target: CombatTargetRef): void {
    this.states.delete(combatTargetInstanceKey(target));
  }

  clearTargetId(enemyId: string): void {
    for (const [key, entry] of this.states) {
      if (entry.target.kind === 'enemy' && entry.target.id === enemyId) this.states.delete(key);
    }
  }

  clear(): void {
    this.states.clear();
  }
}
