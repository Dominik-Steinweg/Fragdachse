import { combatTargetInstanceKey, type CombatTargetRef } from '../combat/CombatScope';

export interface SyncedCombatStun { readonly target: CombatTargetRef; readonly expiresAt: number }

/** World-owned hard control, independent of slows and hit stagger. */
export class CombatStunStatusSystem {
  private readonly states = new Map<string, SyncedCombatStun>();
  apply(target: CombatTargetRef, durationMs: number, now: number): void {
    if (!Number.isFinite(durationMs) || durationMs <= 0 || !Number.isFinite(now)) return;
    const key = combatTargetInstanceKey(target);
    this.states.set(key, { target, expiresAt: Math.max(this.states.get(key)?.expiresAt ?? 0, now + durationMs) });
  }
  isStunned(target: CombatTargetRef, now: number): boolean {
    return now < (this.states.get(combatTargetInstanceKey(target))?.expiresAt ?? 0);
  }
  prune(now: number, valid: (target: CombatTargetRef) => boolean): void {
    for (const [key, s] of this.states) if (s.expiresAt <= now || !valid(s.target)) this.states.delete(key);
  }
  snapshot(now: number, valid: (target: CombatTargetRef) => boolean): SyncedCombatStun[] {
    return [...this.states.values()].filter(s => s.expiresAt > now && valid(s.target));
  }
  clear(): void { this.states.clear(); }
}
