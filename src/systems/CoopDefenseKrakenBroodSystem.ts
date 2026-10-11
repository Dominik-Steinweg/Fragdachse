import type { BossTargetRef } from '../combat/CombatPartContact';
import { combatTargetInstanceKey, isSameCombatTargetInstance } from '../combat/CombatScope';
import type { KrakenBossConfig } from '../config/krakenBoss';
import type { KrakenBroodPort, KrakenEggLandEffect, KrakenEggLandingRequest, KrakenEggState } from './KrakenState';

type Point = { readonly x: number; readonly y: number };
export interface KrakenBroodDependencies {
  isBossAlive(boss: BossTargetRef): boolean;
  /** Must materialize at this exact point, without dry projection or unchecked jitter. */
  spawnEgg(kind: string, point: Point, originId: string): { id: string; generation: number } | null;
  readEgg(id: string, generation: number): (Point & { alive: boolean }) | null;
  /** Hide its combat body after commit; retain its Enemy pose until the hatch clip ends. */
  retireEgg(id: string, generation: number): void;
  removeEgg(id: string, generation: number): void;
  landingFree(point: Point, radius: number): boolean;
  /** Uses the CHILD profile. Occupancy/pending may retry; invalid terrain may not. */
  reserveChild(kind: string, point: Point): { status: 'valid'; reservationId: string } | { status: 'pending' | 'blocked' | 'invalid' };
  spawnChild(kind: string, point: Point, originId: string, reservationId: string): void;
  releaseChild(reservationId: string): void;
  /** Semantic cancellation with no terminal grenade reaction. */
  cancelFlights(projectileIds: readonly number[]): void;
  random(): number;
}
interface PendingEgg { effect: KrakenEggLandEffect; projectileId?: number; }
interface LiveEgg { boss: BossTargetRef; state: KrakenEggState; retryAt: number; deadline: number; attempted: boolean; entityRemoved: boolean; }

/** Activity-owned brood timeline. Enemy entities alone own egg HP/life. */
export class CoopDefenseKrakenBroodSystem implements KrakenBroodPort {
  private readonly pending = new Map<string, PendingEgg>();
  private readonly eggs = new Map<string, LiveEgg>();
  private readonly closedBosses = new Set<string>();
  private readonly consumed = new Set<string>();
  constructor(private readonly config: KrakenBossConfig['eggs'], private readonly deps: KrakenBroodDependencies) {}

  reserveEgg(effect: KrakenEggLandEffect): boolean {
    const key = this.key(effect), owner = combatTargetInstanceKey(effect.boss);
    if (effect.broodTableId !== this.config.broodTable.id || this.closedBosses.has(owner)
      || !this.deps.isBossAlive(effect.boss) || this.pending.has(key) || this.consumed.has(key)) return false;
    const count = [...this.pending.values()].filter(p => isSameCombatTargetInstance(p.effect.boss, effect.boss)).length
      + [...this.eggs.values()].filter(e => isSameCombatTargetInstance(e.boss, effect.boss) && e.state.status !== 'terminal').length;
    if (count >= this.config.maxPendingAndLive) return false;
    this.pending.set(key, { effect: structuredClone(effect) });
    return true;
  }

  released(effect: KrakenEggLandEffect, projectileId: number | null): void {
    const key = this.key(effect), pending = this.pending.get(key);
    if (!pending) { if (projectileId !== null) this.deps.cancelFlights([projectileId]); return; }
    if (projectileId === null) { this.pending.delete(key); this.consumed.add(key); }
    else pending.projectileId = projectileId;
  }

  cancelEgg(effect: KrakenEggLandEffect): void {
    const key = this.key(effect), pending = this.pending.get(key);
    this.pending.delete(key); this.consumed.add(key);
    if (pending?.projectileId !== undefined) this.deps.cancelFlights([pending.projectileId]);
  }

  landEgg(request: KrakenEggLandingRequest): 'incubating' | 'broken' | 'stale' {
    const { effect } = request, key = this.key(effect), pending = this.pending.get(key);
    if (!pending || this.consumed.has(key) || !isSameCombatTargetInstance(pending.effect.boss, effect.boss)
      || pending.projectileId !== undefined && pending.projectileId !== request.projectileId
      || pending.effect.castId !== effect.castId || pending.effect.originId !== effect.originId
      || effect.broodTableId !== this.config.broodTable.id) return 'stale';
    // Consume BEFORE any entity callback; a duplicate terminal event cannot hatch twice.
    this.pending.delete(key); this.consumed.add(key);
    if (this.closedBosses.has(combatTargetInstanceKey(effect.boss)) || !this.deps.isBossAlive(effect.boss)) return 'stale';
    if (![request.landedAt, request.x, request.y].every(Number.isFinite)
      || !this.deps.landingFree(request, this.config.radiusPx)) return 'broken';
    const entries = this.config.broodTable.entries, sum = entries.reduce((n, e) => n + e.weight, 0);
    let pick = Math.max(0, Math.min(1 - Number.EPSILON, this.deps.random())) * sum;
    const selected = entries.find(e => { pick -= e.weight; return pick < 0; })!;
    const egg = this.deps.spawnEgg(this.config.enemyKind, request, effect.originId);
    if (!egg) return 'broken';
    if (this.closedBosses.has(combatTargetInstanceKey(effect.boss)) || !this.deps.isBossAlive(effect.boss)) {
      this.deps.removeEgg(egg.id, egg.generation); return 'stale';
    }
    const hatchStartedAt = request.landedAt + this.config.incubationMs;
    const spawnAt = hatchStartedAt + this.config.hatchSpawnAfterMs;
    this.eggs.set(egg.id, { boss: structuredClone(effect.boss), retryAt: spawnAt, attempted: false, entityRemoved: false,
      deadline: spawnAt + this.config.spawnRetryWindowMs,
      state: { eggId: egg.id, entityGeneration: egg.generation, bossId: effect.boss.id,
        bossGeneration: effect.boss.instance.entityGeneration, castId: effect.castId, originId: effect.originId,
        broodTableId: effect.broodTableId, enemyKind: selected.enemyKind, landedAt: request.landedAt,
        hatchStartedAt, spawnAt, endsAt: hatchStartedAt + this.config.hatchDurationMs, status: 'incubating' } });
    return 'incubating';
  }

  hostUpdate(now: number): void {
    for (const p of [...this.pending.values()]) if (!this.deps.isBossAlive(p.effect.boss)) this.clearBoss(p.effect.boss);
    for (const entry of [...this.eggs.values()]) {
      const s = entry.state;
      if (!this.deps.isBossAlive(entry.boss)) { this.clearBoss(entry.boss); continue; }
      if (s.status === 'terminal') { if (now >= s.endsAt) this.remove(entry); continue; }
      const egg = this.deps.readEgg(s.eggId, s.entityGeneration);
      if (!egg?.alive) { this.eggs.delete(s.eggId); continue; }
      if (now < s.hatchStartedAt) continue;
      s.status = 'hatching';
      if (now < entry.retryAt) continue;
      // One reservation attempt per step. A hitch never creates a retry burst.
      if (entry.attempted && now > entry.deadline) { this.remove(entry); continue; }
      entry.attempted = true;
      entry.retryAt = now + this.config.spawnRetryMs;
      const reservation = this.deps.reserveChild(s.enemyKind, egg);
      if (reservation.status !== 'valid') {
        if (reservation.status === 'invalid' || now >= entry.deadline) this.remove(entry);
        else { s.spawnAt = entry.retryAt; s.endsAt = Math.max(s.endsAt, s.spawnAt + this.config.hatchDurationMs - this.config.hatchSpawnAfterMs); }
        continue;
      }
      // Death wins until the marker commits; the callback cannot recursively commit again.
      s.status = 'terminal';
      try {
        if (this.eggs.get(s.eggId) === entry && this.deps.readEgg(s.eggId, s.entityGeneration)?.alive
          && this.deps.isBossAlive(entry.boss)) {
          this.deps.retireEgg(s.eggId, s.entityGeneration);
          if (this.eggs.get(s.eggId) === entry && this.deps.isBossAlive(entry.boss)) this.deps.spawnChild(s.enemyKind, egg, s.originId, reservation.reservationId);
        }
      } finally {
        this.deps.releaseChild(reservation.reservationId);
        if (now >= s.endsAt) this.remove(entry);
      }
    }
  }

  getEggs(boss: BossTargetRef): KrakenEggState[] {
    return [...this.eggs.values()].filter(e => isSameCombatTargetInstance(e.boss, boss)).map(e => structuredClone(e.state));
  }
  clearBoss(boss: BossTargetRef): void {
    this.closedBosses.add(combatTargetInstanceKey(boss));
    const flights: number[] = [];
    for (const [key, p] of this.pending) if (isSameCombatTargetInstance(p.effect.boss, boss)) {
      this.pending.delete(key); this.consumed.add(key);
      if (p.projectileId !== undefined) flights.push(p.projectileId);
    }
    for (const entry of [...this.eggs.values()]) if (isSameCombatTargetInstance(entry.boss, boss)) this.remove(entry);
    this.deps.cancelFlights(flights);
  }
  clear(): void {
    const bosses = [...this.pending.values()].map(p => p.effect.boss).concat([...this.eggs.values()].map(e => e.boss));
    for (const boss of bosses) this.clearBoss(boss);
  }
  private remove(entry: LiveEgg): void {
    entry.state.status = 'terminal';
    if (!this.eggs.delete(entry.state.eggId)) return;
    this.removeEntity(entry);
  }
  private removeEntity(entry: LiveEgg): void {
    if (entry.entityRemoved) return;
    entry.entityRemoved = true;
    this.deps.removeEgg(entry.state.eggId, entry.state.entityGeneration);
  }
  private key(effect: KrakenEggLandEffect): string { return JSON.stringify([combatTargetInstanceKey(effect.boss), effect.eggId]); }
}
