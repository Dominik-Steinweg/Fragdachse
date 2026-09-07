import type { CombatTargetRef } from '../combat/CombatScope';
import { isSameCombatTargetInstance } from '../combat/CombatScope';

export interface PlayerLifeRuntimeOptions {
  readonly readLife: (playerId: string) => { target: CombatTargetRef; alive: boolean } | null;
  readonly canRespawn: (playerId: string) => boolean;
  /** Preparation must capture the actor and spawn before the Activity budget is consumed. */
  readonly prepareActor: (playerId: string) => { isCurrent(): boolean; activate(): void; publish?(): void } | null;
  readonly consumeRespawn: (playerId: string) => boolean;
  readonly commitVitals: (target: CombatTargetRef) => boolean;
  readonly resetLifeResources: (playerId: string) => void;
  readonly publishRespawn?: (playerId: string) => void;
}

/** One World's pending Player life transitions. No browser timers and no Activity budget owner. */
export class PlayerLifeRuntime {
  private readonly pending = new Map<string, { target: CombatTargetRef; dueMs: number; policy: number }>();
  private readonly committing = new Set<string>();
  private policy = 0;
  private active = true;

  constructor(private readonly options: PlayerLifeRuntimeOptions) {}

  schedule(target: CombatTargetRef, dueMs: number): void {
    if (!this.active || !Number.isFinite(dueMs)) return;
    const id = String(target.id);
    const previous = this.pending.get(id);
    if (previous && isSameCombatTargetInstance(previous.target, target)) return;
    this.pending.set(id, { target, dueMs, policy: this.policy });
  }

  advance(nowMs: number): void {
    if (!this.active || !Number.isFinite(nowMs)) return;
    for (const [id, pending] of [...this.pending]) {
      if (pending.dueMs <= nowMs) this.commit(id, pending.target, pending.policy);
    }
  }

  reconnect(playerId: string): boolean {
    const life = this.options.readLife(playerId);
    return life && !life.alive ? this.commit(playerId, life.target, this.policy) : false;
  }

  removePlayer(playerId: string): void { this.pending.delete(playerId); }
  invalidatePolicy(): void { this.policy += 1; this.pending.clear(); }
  destroy(): void { this.active = false; this.invalidatePolicy(); }

  private commit(id: string, target: CombatTargetRef, policy: number): boolean {
    const current = (): boolean => {
      const life = this.options.readLife(id);
      return this.active && policy === this.policy && !!life && !life.alive
        && isSameCombatTargetInstance(life.target, target);
    };
    if (this.committing.has(id) || !current()) { this.pending.delete(id); return false; }
    if (!this.options.canRespawn(id)) return false;
    const actor = this.options.prepareActor(id);
    if (!actor || !current() || !actor.isCurrent()) return false;
    this.committing.add(id);
    try {
      if (!this.options.consumeRespawn(id)) return false;
      // A reentrant Activity/World teardown invalidates all remaining work, including activation.
      if (!current() || !actor.isCurrent()) return false;
      if (!this.options.commitVitals(target)) throw new Error('Validated Player respawn commit failed');
      this.pending.delete(id);
      actor.activate();
      const nextLife = this.options.readLife(id)?.target;
      const stillCommitted = () => {
        const life = this.options.readLife(id);
        return this.active && policy === this.policy && !!life?.alive && !!nextLife
          && isSameCombatTargetInstance(life.target, nextLife);
      };
      if (stillCommitted()) this.options.resetLifeResources(id);
      if (stillCommitted()) actor.publish?.();
      if (stillCommitted()) this.options.publishRespawn?.(id);
      return true;
    } finally { this.committing.delete(id); }
  }
}
