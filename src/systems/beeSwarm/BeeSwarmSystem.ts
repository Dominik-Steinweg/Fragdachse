import type { CombatSource } from '../../combat/CombatScope';
import type { ReactivePropSwarmEffect } from '../../config/reactiveProps/reactivePropKinds';

/**
 * Host simulation of bee swarms released by reactive hives. Pure: no Phaser, no combat core.
 * One swarm is one agent (centre, velocity, target); the individual bees are presentation and
 * derived deterministically on every peer from the replicated swarm state.
 */
export type BeeSwarmPhase = 'hunting' | 'dispersed' | 'returning';

/** Wire order of the phases; part of the protocol. */
export const BEE_SWARM_PHASE_CODES: Readonly<Record<BeeSwarmPhase, number>> = Object.freeze({ hunting: 0, dispersed: 1, returning: 2 });

export interface BeeSwarmTarget {
  /** Stable for one target instance (life, generation). */
  readonly key: string;
  readonly kind: 'player' | 'enemy';
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface BeeSwarmRelease {
  readonly hiveIndex: number;
  readonly x: number;
  readonly y: number;
  /** Host time of the release (scheduled, not the frame time). */
  readonly at: number;
  readonly source: CombatSource;
  readonly config: ReactivePropSwarmEffect;
  /** Presentation hint: the swarm belongs to the hostile side. */
  readonly hostile: boolean;
}

export interface BeeSwarmState<T extends BeeSwarmTarget = BeeSwarmTarget> {
  readonly id: number;
  readonly hiveIndex: number;
  readonly hiveX: number;
  readonly hiveY: number;
  readonly releasedAt: number;
  readonly source: CombatSource;
  readonly config: ReactivePropSwarmEffect;
  readonly hostile: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: BeeSwarmPhase;
  phaseStartedAt: number;
  target: T | null;
  targetSince: number;
  stingsOnTarget: number;
  nextStingAt: number;
  /** Last time a valid target was in reach; idle swarms go home after the grace period. */
  lastEngagedAt: number;
  nextScanAt: number;
  stingSequence: number;
  /** Targets that just had their turn, with the time until they count as fresh again. */
  readonly rested: Map<string, number>;
}

export interface BeeSwarmPorts<T extends BeeSwarmTarget = BeeSwarmTarget> {
  /** Candidate targets of the current frame (positions included). */
  targets(): readonly T[];
  /** Revalidates a held target instance and returns its current position, or null. */
  readTarget(key: string): T | null;
  /** Relationship of the swarm's captured source to the target; never the trigger itself. */
  canTarget(swarm: BeeSwarmState<T>, target: T): boolean;
  /** Fire on the ground at the swarm (ground fire, burning cells). */
  isBurning(x: number, y: number, radius: number): boolean;
  sting(swarm: BeeSwarmState<T>, target: T, at: number): void;
}

const STEP_MS = 25;
const SCAN_MS = 100;
/** A target that had its turn waits this long before the swarm returns to it. */
const REST_MS = 2600;
const HOME_REACH_PX = 10;
const MAX_SWARMS = 32;

export class BeeSwarmSystem<T extends BeeSwarmTarget = BeeSwarmTarget> {
  private readonly swarms: BeeSwarmState<T>[] = [];
  private nextId = 1;
  private clock: number | null = null;

  constructor(private readonly ports: BeeSwarmPorts<T>) {}

  /** A hive released its bees; a stale swarm of the same hive is replaced. */
  release(release: BeeSwarmRelease): BeeSwarmState<T> {
    const stale = this.swarms.findIndex(swarm => swarm.hiveIndex === release.hiveIndex);
    if (stale >= 0) this.swarms.splice(stale, 1);
    if (this.swarms.length >= MAX_SWARMS) this.swarms.shift();
    const swarm: BeeSwarmState<T> = {
      id: this.nextId++, hiveIndex: release.hiveIndex, hiveX: release.x, hiveY: release.y,
      releasedAt: release.at, source: release.source, config: release.config, hostile: release.hostile,
      x: release.x, y: release.y, vx: 0, vy: 0, phase: 'hunting', phaseStartedAt: release.at,
      target: null, targetSince: release.at, stingsOnTarget: 0, nextStingAt: release.at,
      lastEngagedAt: release.at, nextScanAt: release.at, stingSequence: 0, rested: new Map(),
    };
    this.swarms.push(swarm);
    return swarm;
  }

  /** Fixed substeps, so the outcome does not depend on the frame size. */
  update(now: number): void {
    if (this.clock === null || now < this.clock) this.clock = now;
    while (this.clock + STEP_MS <= now) {
      this.clock += STEP_MS;
      this.step(this.clock, STEP_MS / 1000);
    }
  }

  /** A committed radial explosion: hunting swarms it overlaps scatter. */
  observeExplosion(x: number, y: number, radius: number, now: number): void {
    for (const swarm of this.swarms) {
      if (swarm.phase !== 'hunting') continue;
      if (Math.hypot(swarm.x - x, swarm.y - y) <= radius + swarm.config.swarmRadiusPx) this.enter(swarm, 'dispersed', now);
    }
  }

  getSwarms(): readonly BeeSwarmState<T>[] { return this.swarms; }

  /** Activity ended: targets of the old Activity are gone, the bees fly home. */
  invalidateActivity(now: number): void {
    for (const swarm of this.swarms) {
      swarm.target = null;
      swarm.rested.clear();
      if (swarm.phase === 'hunting') this.enter(swarm, 'returning', now);
    }
  }

  clear(): void {
    this.swarms.length = 0;
    this.clock = null;
  }

  private step(now: number, dt: number): void {
    for (let i = this.swarms.length - 1; i >= 0; i--) {
      const swarm = this.swarms[i];
      if (now < swarm.releasedAt) continue;
      if (swarm.phase === 'hunting') this.hunt(swarm, now, dt);
      else if (swarm.phase === 'dispersed') this.drift(swarm, now, dt);
      else if (this.flyHome(swarm, now, dt)) this.swarms.splice(i, 1);
    }
  }

  private hunt(swarm: BeeSwarmState<T>, now: number, dt: number): void {
    const c = swarm.config;
    if (now >= swarm.releasedAt + c.durationMs) { this.enter(swarm, 'returning', now); return; }
    this.refreshTarget(swarm, now);
    if (swarm.phase !== 'hunting') return;
    const target = swarm.target;
    if (target) {
      this.steer(swarm, target.x, target.y, c.speedPxPerSec, dt);
      const reach = c.swarmRadiusPx * .5 + target.radius + c.stingReachPx;
      if (Math.hypot(target.x - swarm.x, target.y - swarm.y) <= reach) {
        swarm.lastEngagedAt = now;
        if (now >= swarm.nextStingAt) {
          this.ports.sting(swarm, target, now);
          swarm.stingsOnTarget++;
          swarm.stingSequence++;
          swarm.nextStingAt = now + c.stingIntervalMs;
        }
      } else {
        swarm.lastEngagedAt = now;
      }
    } else {
      // No target: circle the hive, then give up after the grace period.
      this.steer(swarm, swarm.hiveX, swarm.hiveY, c.speedPxPerSec * .5, dt);
      if (now - swarm.lastEngagedAt >= c.idleGraceMs) this.enter(swarm, 'returning', now);
    }
    this.leash(swarm);
  }

  private refreshTarget(swarm: BeeSwarmState<T>, now: number): void {
    const c = swarm.config;
    if (swarm.target) {
      const current = this.ports.readTarget(swarm.target.key);
      const turnOver = swarm.stingsOnTarget >= c.stingsPerTarget || now - swarm.targetSince >= c.maxTargetMs;
      if (!current || !this.ports.canTarget(swarm, current) || turnOver
        || Math.hypot(current.x - swarm.hiveX, current.y - swarm.hiveY) > c.leashRadiusPx) {
        if (turnOver) swarm.rested.set(swarm.target.key, now + REST_MS);
        swarm.target = null;
      } else {
        swarm.target = current;
        return;
      }
    }
    if (now < swarm.nextScanAt) return;
    swarm.nextScanAt = now + SCAN_MS;
    if (this.ports.isBurning(swarm.x, swarm.y, c.swarmRadiusPx)) { this.enter(swarm, 'dispersed', now); return; }
    let best: T | null = null, bestRested: T | null = null;
    let bestDistance = Infinity, bestRestedDistance = Infinity;
    for (const candidate of this.ports.targets()) {
      const distance = Math.hypot(candidate.x - swarm.x, candidate.y - swarm.y);
      if (distance > c.acquireRadiusPx
        || Math.hypot(candidate.x - swarm.hiveX, candidate.y - swarm.hiveY) > c.leashRadiusPx
        || !this.ports.canTarget(swarm, candidate)) continue;
      const rested = (swarm.rested.get(candidate.key) ?? -Infinity) > now;
      if (!rested && distance < bestDistance) { best = candidate; bestDistance = distance; }
      if (rested && distance < bestRestedDistance) { bestRested = candidate; bestRestedDistance = distance; }
    }
    const next = best ?? bestRested;
    if (!next) return;
    swarm.target = next;
    swarm.targetSince = now;
    swarm.stingsOnTarget = 0;
    swarm.lastEngagedAt = now;
  }

  private drift(swarm: BeeSwarmState<T>, now: number, dt: number): void {
    const damping = Math.exp(-dt * 2.4);
    swarm.vx *= damping; swarm.vy *= damping;
    swarm.x += swarm.vx * dt; swarm.y += swarm.vy * dt;
    if (now - swarm.phaseStartedAt >= swarm.config.dispersalMs) this.enter(swarm, 'returning', now);
  }

  /** True once the swarm is back inside the hive (or ran out of time on the way). */
  private flyHome(swarm: BeeSwarmState<T>, now: number, dt: number): boolean {
    this.steer(swarm, swarm.hiveX, swarm.hiveY, swarm.config.speedPxPerSec * 1.1, dt);
    return Math.hypot(swarm.hiveX - swarm.x, swarm.hiveY - swarm.y) <= HOME_REACH_PX
      || now - swarm.phaseStartedAt >= swarm.config.maxReturnMs;
  }

  /** Smooth pursuit: the swarm turns within a few hundred milliseconds, never instantly. */
  private steer(swarm: BeeSwarmState<T>, x: number, y: number, speed: number, dt: number): void {
    const dx = x - swarm.x, dy = y - swarm.y;
    const distance = Math.hypot(dx, dy);
    const want = distance > 1 ? Math.min(speed, distance / Math.max(dt, .001) * .5) : 0;
    const tx = distance > 1 ? dx / distance * want : 0, ty = distance > 1 ? dy / distance * want : 0;
    const blend = 1 - Math.exp(-dt * 7);
    swarm.vx += (tx - swarm.vx) * blend;
    swarm.vy += (ty - swarm.vy) * blend;
    swarm.x += swarm.vx * dt;
    swarm.y += swarm.vy * dt;
  }

  private leash(swarm: BeeSwarmState): void {
    const dx = swarm.x - swarm.hiveX, dy = swarm.y - swarm.hiveY;
    const distance = Math.hypot(dx, dy), max = swarm.config.leashRadiusPx;
    if (distance <= max) return;
    swarm.x = swarm.hiveX + dx / distance * max;
    swarm.y = swarm.hiveY + dy / distance * max;
  }

  private enter(swarm: BeeSwarmState<T>, phase: BeeSwarmPhase, now: number): void {
    swarm.phase = phase;
    swarm.phaseStartedAt = now;
    swarm.target = null;
    if (phase === 'dispersed') {
      // Scatter outward from wherever the swarm hung.
      const angle = (swarm.id * 2.399) % (Math.PI * 2);
      swarm.vx += Math.cos(angle) * 60;
      swarm.vy += Math.sin(angle) * 60;
    }
  }
}
