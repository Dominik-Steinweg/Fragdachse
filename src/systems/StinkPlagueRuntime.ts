import { combatTargetInstanceKey, type CombatTargetRef } from '../combat/CombatScope';
import type { StinkPlagueConfig } from '../loadout/StinkPlagueConfig';

export interface PlagueTarget {
  readonly ref: CombatTargetRef;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  readonly boss: boolean;
}

export interface PlagueApplication {
  readonly ownerId: string;
  readonly config: StinkPlagueConfig;
  /** Captured source factors; target vulnerability is resolved at each damage commit. */
  readonly damageMultiplier: number;
}

interface Contribution extends PlagueApplication {
  readonly generation: 0 | 1 | 2;
  readonly expiresAt: number;
}

interface InfectedTarget {
  target: PlagueTarget;
  readonly sources: Map<string, Contribution>;
  nextTickAt: number;
  readonly tickIntervalMs: number;
}

export interface SyncedPlagueTarget {
  readonly enemyId: string;
  readonly entityGeneration: number;
  readonly expiresAt: number;
  readonly infectiousUntil: number;
}

export interface PlagueTransfer {
  readonly sequence: number;
  readonly fromX: number;
  readonly fromY: number;
  readonly toX: number;
  readonly toY: number;
  readonly createdAt: number;
}

export interface StinkPlagueSnapshot {
  readonly targets: readonly SyncedPlagueTarget[];
  readonly transfers: readonly PlagueTransfer[];
  /** Bootstrap consumes this cursor without replaying old transfer impulses. */
  readonly transferSequence: number;
}

export interface PlagueDeathContribution {
  readonly ownerId: string;
  readonly count: number;
}

export interface StinkPlaguePorts {
  readonly damage: (target: CombatTargetRef, source: PlagueApplication, tickAt: number) => void;
  readonly vulnerability: (target: CombatTargetRef, expiresAt: number | null) => void;
  readonly canReach: (from: PlagueTarget, to: PlagueTarget) => boolean;
  readonly canTransfer: (from: PlagueTarget, to: PlagueTarget) => boolean;
  readonly areAllies: (ownerId: string, attackerId: string) => boolean;
}

const TRANSFER_HISTORY_MS = 500;

/** World-owned infection authority. No renderer, transport, wall clock or entity mutation. */
export class StinkPlagueRuntime {
  private readonly infected = new Map<string, InfectedTarget>();
  private readonly movementTargets = new Map<string, PlagueTarget>();
  private transfers: PlagueTransfer[] = [];
  private transferSequence = 0;
  private nextSpreadAt = 0;
  private samplingTime: number | null = null;

  constructor(private readonly ports: StinkPlaguePorts) {}

  applyDirect(target: PlagueTarget, application: PlagueApplication, now: number): void {
    if (target.ref.kind !== 'enemy' || application.config.damagePerTick <= 0) return;
    const key = combatTargetInstanceKey(target.ref);
    let state = this.infected.get(key);
    // Finish an old application before a new one can revive its expired tick clock.
    if (state && !this.sourcesAt(state, now).length) {
      this.removeTarget(state.target.ref);
      state = undefined;
    }
    if (!state) {
      state = { target, sources: new Map(), nextTickAt: now + application.config.tickIntervalMs,
        tickIntervalMs: application.config.tickIntervalMs };
      this.infected.set(key, state);
    }
    state.target = target;
    state.sources.set(application.ownerId, { ownerId: application.ownerId,
      config: Object.freeze({ ...application.config }), damageMultiplier: application.damageMultiplier,
      generation: 0, expiresAt: now + application.config.directDurationMs });
    this.syncVulnerability(state, now);
  }

  isInfected(target: CombatTargetRef, now: number): boolean {
    const state = this.infected.get(combatTargetInstanceKey(target));
    return !!state && this.sourcesAt(state, now).length > 0;
  }

  getLifeLeech(target: CombatTargetRef, attackerId: string, now: number): number {
    const state = this.infected.get(combatTargetInstanceKey(target));
    if (!state) return 0;
    let value = 0;
    for (const source of this.sourcesAt(state, this.samplingTime ?? now, this.samplingTime !== null)) {
      if (this.ports.areAllies(source.ownerId, attackerId)) value = Math.max(value, source.config.lifeLeechFraction);
    }
    return value;
  }

  getMovementTarget(target: CombatTargetRef, now: number): PlagueTarget | null {
    const key = combatTargetInstanceKey(target);
    const state = this.infected.get(key);
    if (!state || state.target.boss || !this.sourcesAt(state, now).some(s => this.infectious(s))) return null;
    const destination = this.movementTargets.get(key);
    return destination && !this.isInfected(destination.ref, now) ? destination : null;
  }

  /** Called before primary contacts/damage each frame, so expiries cannot be accidentally refreshed. */
  advance(targets: readonly PlagueTarget[], now: number): void {
    const current = new Map(targets.map(t => [combatTargetInstanceKey(t.ref), t]));
    for (const [key, state] of this.infected) {
      const target = current.get(key);
      if (!target) { this.removeTarget(state.target.ref); continue; }
      state.target = target;
      while (state.nextTickAt <= now) {
        const eligible = this.sourcesAt(state, state.nextTickAt, true);
        const source = this.strongest(eligible, s => s.config.damagePerTick * s.damageMultiplier);
        if (!source) break;
        const tickAt = state.nextTickAt;
        state.nextTickAt += state.tickIntervalMs;
        // Terminal/catch-up ticks retain their status until the synchronous damage commit finishes.
        const vulnerableUntil = Math.max(0, ...eligible.filter(s => s.config.vulnerabilityEnabled > 0).map(s => s.expiresAt));
        this.ports.vulnerability(target.ref, vulnerableUntil ? Math.max(now + 1, vulnerableUntil) : null);
        this.samplingTime = tickAt;
        try { this.ports.damage(target.ref, source, tickAt); }
        finally { this.samplingTime = null; }
        // Synchronous death hooks may have removed this incarnation.
        if (this.infected.get(key) !== state) break;
      }
      if (this.infected.get(key) !== state) continue;
      for (const [ownerId, source] of state.sources) if (source.expiresAt <= now) state.sources.delete(ownerId);
      if (!state.sources.size) this.removeTarget(target.ref);
      else this.syncVulnerability(state, now);
    }
    this.transfers = this.transfers.filter(t => now - t.createdAt < TRANSFER_HISTORY_MS);
  }

  /** Two-phase transmission: all carriers read the same pre-transmission infection set. */
  spread(targets: readonly PlagueTarget[], now: number): void {
    if (now < this.nextSpreadAt) return;
    this.movementTargets.clear();
    const carriers = [...this.infected.values()].filter(s => this.sourcesAt(s, now).some(c => this.infectious(c)))
      .sort((a, b) => combatTargetInstanceKey(a.target.ref).localeCompare(combatTargetInstanceKey(b.target.ref)));
    if (!carriers.length) { this.nextSpreadAt = now; return; }
    const allSources = carriers.flatMap(s => this.sourcesAt(s, now).filter(c => this.infectious(c)));
    this.nextSpreadAt = now + Math.min(...allSources.map(s => s.config.spreadIntervalMs));
    const healthy = targets.filter(t => !this.isInfected(t.ref, now));
    if (!healthy.length) return;
    const cellSize = Math.max(...allSources.map(s => s.config.searchRadius));
    const maxRadius = Math.max(...healthy.map(t => t.radius));
    const grid = new Map<string, PlagueTarget[]>();
    for (const t of healthy) {
      const key = `${Math.floor(t.x / cellSize)}:${Math.floor(t.y / cellSize)}`;
      const bucket = grid.get(key);
      if (bucket) bucket.push(t); else grid.set(key, [t]);
    }
    const pending = new Map<string, { target: PlagueTarget; sources: Map<string, Contribution>; from: PlagueTarget }>();
    for (const carrier of carriers) {
      const from = carrier.target;
      const sources = this.sourcesAt(carrier, now).filter(c => this.infectious(c));
      const search = Math.max(...sources.map(s => s.config.searchRadius));
      const gap = Math.max(...sources.map(s => s.config.contactGap));
      const range = Math.max(search, from.radius + maxRadius + gap);
      let nearest: PlagueTarget | null = null;
      let nearestDistance = Infinity;
      for (let gy = Math.floor((from.y - range) / cellSize); gy <= Math.floor((from.y + range) / cellSize); gy++) {
        for (let gx = Math.floor((from.x - range) / cellSize); gx <= Math.floor((from.x + range) / cellSize); gx++) {
          for (const to of grid.get(`${gx}:${gy}`) ?? []) {
            const distance = Math.hypot(to.x - from.x, to.y - from.y);
            if (!from.boss && distance <= search && (distance < nearestDistance
              || (distance === nearestDistance && String(to.ref.id) < String(nearest?.ref.id))) && this.ports.canReach(from, to)) {
              nearest = to; nearestDistance = distance;
            }
            if (distance > from.radius + to.radius + gap || !this.ports.canTransfer(from, to)) continue;
            const key = combatTargetInstanceKey(to.ref);
            let next = pending.get(key);
            for (const source of sources) {
              if (distance > from.radius + to.radius + source.config.contactGap) continue;
              if (!next) pending.set(key, next = { target: to, sources: new Map(), from });
              const generation = (source.generation + 1) as 1 | 2;
              const candidate: Contribution = { ...source, generation, expiresAt: now + (generation === 1
                ? source.config.firstGenerationDurationMs : source.config.secondGenerationDurationMs) };
              const previous = next.sources.get(source.ownerId);
              if (!previous || candidate.generation < previous.generation
                || (candidate.generation === previous.generation && candidate.config.damagePerTick * candidate.damageMultiplier
                  > previous.config.damagePerTick * previous.damageMultiplier)) next.sources.set(source.ownerId, candidate);
            }
          }
        }
      }
      if (nearest) this.movementTargets.set(combatTargetInstanceKey(from.ref), nearest);
    }
    for (const [key, next] of pending) {
      const interval = Math.min(...[...next.sources.values()].map(s => s.config.tickIntervalMs));
      const state: InfectedTarget = { target: next.target, sources: next.sources, tickIntervalMs: interval, nextTickAt: now + interval };
      this.infected.set(key, state);
      this.syncVulnerability(state, now);
      this.transfers.push({ sequence: ++this.transferSequence, fromX: next.from.x, fromY: next.from.y,
        toX: next.target.x, toY: next.target.y, createdAt: now });
    }
  }

  /** Captures BR1 before removing the dead target; subsequent death notifications are inert. */
  consumeDeath(target: CombatTargetRef, now: number): PlagueDeathContribution | null {
    const state = this.infected.get(combatTargetInstanceKey(target));
    if (!state) return null;
    const source = this.strongest(this.sourcesAt(state, this.samplingTime ?? now, this.samplingTime !== null), s => s.config.deathChunkCount);
    this.removeTarget(target);
    return source && source.config.deathChunkCount > 0 ? { ownerId: source.ownerId, count: source.config.deathChunkCount } : null;
  }

  removeTarget(target: CombatTargetRef): void {
    const key = combatTargetInstanceKey(target);
    if (this.infected.delete(key)) this.ports.vulnerability(target, null);
    this.movementTargets.delete(key);
  }

  removeOwner(ownerId: string, now: number): void {
    for (const state of this.infected.values()) {
      state.sources.delete(ownerId);
      if (!state.sources.size) this.removeTarget(state.target.ref); else this.syncVulnerability(state, now);
    }
  }

  getSnapshot(now: number): StinkPlagueSnapshot {
    const targets: SyncedPlagueTarget[] = [];
    for (const state of this.infected.values()) {
      const sources = this.sourcesAt(state, now);
      if (!sources.length) continue;
      targets.push({ enemyId: String(state.target.ref.id), entityGeneration: state.target.ref.instance.entityGeneration,
        expiresAt: Math.max(...sources.map(s => s.expiresAt)),
        infectiousUntil: Math.max(0, ...sources.filter(s => this.infectious(s)).map(s => s.expiresAt)) });
    }
    return { targets: targets.sort((a,b) => a.enemyId.localeCompare(b.enemyId)),
      transfers: this.transfers.filter(t => now - t.createdAt < TRANSFER_HISTORY_MS), transferSequence: this.transferSequence };
  }

  clear(): void {
    for (const state of this.infected.values()) this.ports.vulnerability(state.target.ref, null);
    this.infected.clear(); this.movementTargets.clear(); this.transfers = []; this.nextSpreadAt = 0;
    // Cursor remains monotone during this World; clearing an activity cannot replay old events.
  }

  private sourcesAt(state: InfectedTarget, now: number, inclusive = false): Contribution[] {
    return [...state.sources.values()].filter(s => inclusive ? s.expiresAt >= now : s.expiresAt > now);
  }

  private infectious(source: Contribution): boolean { return source.config.pandemicEnabled > 0 && source.generation < 2; }

  private strongest(sources: readonly Contribution[], value: (source: Contribution) => number): Contribution | null {
    let best: Contribution | null = null;
    for (const source of sources) if (!best || value(source) > value(best)
      || (value(source) === value(best) && source.ownerId < best.ownerId)) best = source;
    return best;
  }

  private syncVulnerability(state: InfectedTarget, now: number): void {
    const until = Math.max(0, ...this.sourcesAt(state, now).filter(s => s.config.vulnerabilityEnabled > 0).map(s => s.expiresAt));
    this.ports.vulnerability(state.target.ref, until || null);
  }
}
