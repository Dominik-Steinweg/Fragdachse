import type { UtilityChargeState } from './UtilityChargeState';

interface PendingCharge {
  readonly utilityId: string;
  readonly attemptedAt: number;
  readonly lockoutMs: number;
}

/** Local presentation of reliable stock plus unacknowledged throws; never grants host resources. */
export class UtilityChargePrediction {
  private readonly states = new Map<string, UtilityChargeState>();
  private readonly pending = new Map<string, PendingCharge>();

  observe(state: UtilityChargeState): void {
    const previous = this.states.get(state.utilityId);
    if (previous && previous.revision >= state.revision) return;
    this.states.set(state.utilityId, state);
    // Utility requests and player state travel reliably in order. A later confirmed attempt
    // therefore includes all earlier successful uses of this same stock.
    if (state.lastCommittedAttemptId && this.pending.has(state.lastCommittedAttemptId)) {
      for (const [id, attempt] of this.pending) {
        if (attempt.utilityId === state.utilityId) this.pending.delete(id);
        if (id === state.lastCommittedAttemptId) break;
      }
    }
  }

  predict(utilityId: string, attemptId: string, now: number, lockoutMs: number): void {
    this.pending.set(attemptId, { utilityId, attemptedAt: now, lockoutMs });
  }

  acknowledge(attemptId: string, state?: UtilityChargeState): void {
    if (!this.pending.has(attemptId)) return;
    if (state) this.observe(state);
    this.pending.delete(attemptId);
  }

  project(utilityId: string, now: number): UtilityChargeState | null {
    const source = this.states.get(utilityId);
    if (!source) return null;
    let { availableCharges, nextChargeAt, lockoutUntil } = source;
    const advance = (time: number) => {
      if (source.rechargeIntervalMs === 0) {
        availableCharges = source.maxCharges;
        nextChargeAt = null;
      } else if (nextChargeAt !== null && time >= nextChargeAt) {
        const count = 1 + Math.floor((time - nextChargeAt) / source.rechargeIntervalMs);
        availableCharges = Math.min(source.maxCharges, availableCharges + count);
        nextChargeAt = availableCharges === source.maxCharges ? null : nextChargeAt + count * source.rechargeIntervalMs;
      }
    };
    for (const attempt of this.pending.values()) {
      if (attempt.utilityId !== utilityId) continue;
      advance(attempt.attemptedAt);
      availableCharges = Math.max(0, availableCharges - 1);
      nextChargeAt ??= attempt.attemptedAt + source.rechargeIntervalMs;
      lockoutUntil = Math.max(lockoutUntil, attempt.attemptedAt + attempt.lockoutMs);
    }
    advance(now);
    return { ...source, availableCharges, nextChargeAt, lockoutUntil };
  }

  forget(utilityId: string): void {
    this.states.delete(utilityId);
    for (const [id, attempt] of this.pending) {
      if (attempt.utilityId === utilityId) this.pending.delete(id);
    }
  }

  clear(): void {
    this.states.clear();
    this.pending.clear();
  }
}
