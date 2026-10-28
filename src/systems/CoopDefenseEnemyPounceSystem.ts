import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyLandingImpactConfig, type CoopDefenseEnemyPounceConfig } from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyMovementOverride, EnemySpecialMovementSource } from '../entities/EnemyManager';
import type { EnemyAiTargetRef } from './EnemyAiTargetCatalog';
import { beginEnemyFlightTracking, enemyFlightVelocity, stepEnemyFlight, type EnemyFlightLine } from './enemyFlight';
import { enemyPouncePhaseAt, type EnemyPounce, type EnemyPouncePhase, type EnemyPounceTargetRef } from './EnemyPounceState';
import { boundingGaitFactor, createPounceTargetTrack, pounceAirMs, pounceUnitHash, predictPounceLanding,
  trackPounceTarget, type PounceTargetTrack } from './enemyPounceRules';

interface Point { readonly x: number; readonly y: number }

/** A hunted body: identity for the replicated telegraph plus its live position. */
export interface EnemyPounceTarget {
  readonly ref: EnemyPounceTargetRef;
  readonly x: number;
  readonly y: number;
  readonly radius: number;
}

export interface EnemyPouncePorts {
  readonly enemies: { getHostileEnemies(): readonly EnemyEntity[] };
  readonly isStunned: (enemyId: string, now: number) => boolean;
  /** The body's bound target right now: a decoy lure first, then an intent player; null otherwise. */
  readonly readTarget: (enemy: EnemyEntity) => EnemyPounceTarget | null;
  /** Live re-resolve of a committed target; null once it is gone. */
  readonly resolveTarget: (enemy: EnemyEntity, ref: EnemyPounceTargetRef) => EnemyPounceTarget | null;
  /** Line of sight from the body within `range`, smoke included. */
  readonly canSee: (enemy: EnemyEntity, target: EnemyPounceTarget, range: number) => boolean;
  /** Free travel along a lane for a body of `radius` (world geometry, water, arena edge). */
  readonly laneClearance: (x: number, y: number, angle: number, length: number, radius: number) => number;
  readonly isFree: (x: number, y: number, radius: number) => boolean;
  /** True while the attack owner holds the body for a bite (windup or attack pause). */
  readonly isBiting: (enemy: EnemyEntity, now: number) => boolean;
  /** Next steering point of the body's ordinary route, or null. */
  readonly steeringPoint: (enemy: EnemyEntity) => Point | null;
  /** Crowd- and geometry-aware locomotion towards a steering point, facing `aimAngle`. */
  readonly moveNormally: (enemy: EnemyEntity, point: Point, speed: number, aimAngle: number) => { vx: number; vy: number; blocked: boolean };
  /** Area hit at the announced landing point. */
  readonly impact: (enemy: EnemyEntity, x: number, y: number, impact: CoopDefenseEnemyLandingImpactConfig, now: number) => void;
  /** The committed target, e.g. so a decoy knows it lured this body. */
  readonly onCommit?: (enemy: EnemyEntity, ref: EnemyPounceTargetRef) => void;
}

interface PouncerState {
  readonly enemy: EnemyEntity;
  revision: number;
  pounce: EnemyPounce | null;
  /** Nominal air time of the locked flight (host only; the replicated timeline may be stretched). */
  airMs: number;
  /** The body left the ground and has not come down yet (a slowed flight outlives its timeline). */
  flying: boolean;
  /** Phase seen in the previous step; transitions run once. */
  phase: EnemyPouncePhase;
  /** Earliest next aim: spawn grace, cooldown or cancel lockout. */
  readyAt: number;
  nextScanAt: number;
  pounces: number;
  positionRevision: number;
  track: PounceTargetTrack | null;
  // Flight tracker (stall detection, re-time cadence).
  lastX: number;
  lastY: number;
  lastMovedAt: number;
  retimedAt: number;
  // Side-cuts.
  nextCutAt: number;
  cutUntil: number;
  cutOffset: number;
  cuts: number;
}

/** Aim decisions per host frame; further bodies wait one frame. */
const MAX_DECISIONS_PER_FRAME = 4;
/** Sight on an aimed target is kept up to this multiple of the pounce range. */
const AIM_SIGHT_FACTOR = 1.2;
/** A landing point on blocked ground steps back towards the body this far per try. */
const LANDING_STEP_BACK_PX = 14;
const LANDING_STEP_BACK_TRIES = 4;
/** Side-cuts probe this far ahead along the cut direction. */
const CUT_PROBE_PX = 48;
/** Retry delay when a side-cut was due but not possible. */
const CUT_RETRY_MS = 300;

/**
 * Host decisions of pouncing enemies (the Rabid Rabbit): stand and aim at a hunted player while
 * the landing zone follows the predicted path, lock the landing point, fly on the shared flight
 * core and hit the announced zone on arrival, then recover. A per-target budget keeps packs from
 * pouncing all at once. Between pounces the body runs (bounding gait, side-cuts) and bites through
 * the ordinary owners. Each transition is published as a replicated {@link EnemyPounceState}.
 */
export class CoopDefenseEnemyPounceSystem implements EnemySpecialMovementSource {
  private readonly states = new Map<string, PouncerState>();
  /** Host time of the last aim start per target, for the pack stagger. */
  private readonly lastAimAt = new Map<string, number>();
  private lastNowMs = 0;

  constructor(private readonly ports: EnemyPouncePorts) {}

  hostUpdate(now: number): void {
    this.lastNowMs = now;
    const live = new Set<string>();
    const engaged = new Map<string, number>();
    for (const state of this.states.values()) {
      const phase = this.phaseOf(state, now);
      if (state.pounce && (phase === 'aim' || phase === 'lock' || phase === 'air' || state.flying)) {
        const key = targetKey(state.pounce.target);
        engaged.set(key, (engaged.get(key) ?? 0) + 1);
      }
    }
    let decisions = 0;
    for (const enemy of this.ports.enemies.getHostileEnemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind).pounce;
      if (!config || !enemy.sprite.active || enemy.getHp() <= 0) continue;
      live.add(enemy.id);
      let state = this.states.get(enemy.id);
      if (!state || state.enemy !== enemy) {
        state = this.createState(enemy, config, now);
        this.states.set(enemy.id, state);
      }
      if (this.step(state, config, now, engaged, decisions < MAX_DECISIONS_PER_FRAME)) decisions++;
    }
    for (const [id, state] of this.states) if (!live.has(id)) { this.release(state); this.states.delete(id); }
    for (const [key, at] of this.lastAimAt) if (now - at > 10_000) this.lastAimAt.delete(key);
  }

  getMovementOverride(enemy: EnemyEntity, nowMs: number): EnemyMovementOverride | null {
    const state = this.states.get(enemy.id);
    if (!state) return null;
    const pounce = state.pounce, landing = pounce?.landing;
    const phase = this.phaseOf(state, nowMs);
    if ((state.flying || phase === 'air') && pounce && landing) {
      return { ...enemyFlightVelocity(flightLine(pounce), enemy.sprite.x, enemy.sprite.y, state.airMs),
        aimAngle: Math.atan2(landing.y - pounce.originY, landing.x - pounce.originX) };
    }
    if (phase === 'aim' || phase === 'lock') return { vx: 0, vy: 0, aimAngle: this.aimAngle(state) };
    if (phase === 'recover') return { vx: 0, vy: 0 };
    if (phase !== 'idle' || nowMs >= state.cutUntil) return null;
    return this.cutVelocity(state, nowMs);
  }

  /** Aim, lock, flight and recovery own the body; the bite waits for the run between pounces. */
  blocksRegularAttacks(enemyId: string, nowMs = this.lastNowMs): boolean {
    const state = this.states.get(enemyId);
    return !!state && (state.flying || this.phaseOf(state, nowMs) !== 'idle');
  }

  /** Hit stagger must not stop a body in flight. */
  isAirborne(enemyId: string, nowMs = this.lastNowMs): boolean {
    const state = this.states.get(enemyId);
    return !!state && (state.flying || this.phaseOf(state, nowMs) === 'air');
  }

  getCurrentTarget(enemyId: string): EnemyAiTargetRef | null {
    const state = this.states.get(enemyId);
    const phase = state ? this.phaseOf(state, this.lastNowMs) : 'idle';
    const target = state?.pounce?.target;
    return target && (phase === 'aim' || phase === 'lock' || phase === 'air') ? { kind: target.kind, id: target.id } : null;
  }

  handleKilled(death: { readonly id: string }): void {
    const state = this.states.get(death.id);
    if (state) this.release(state);
    this.states.delete(death.id);
  }

  clear(): void {
    for (const state of this.states.values()) this.release(state);
    this.states.clear();
    this.lastAimAt.clear();
  }

  private createState(enemy: EnemyEntity, config: CoopDefenseEnemyPounceConfig, now: number): PouncerState {
    const previous = enemy.getPounceState();
    return { enemy, revision: previous.revision, pounce: null, airMs: config.airMinMs, flying: false, phase: 'idle',
      readyAt: now + config.initialDelayMs, nextScanAt: now, pounces: 0, positionRevision: enemy.positionRevision, track: null,
      lastX: enemy.sprite.x, lastY: enemy.sprite.y, lastMovedAt: now, retimedAt: now,
      nextCutAt: now + cutInterval(enemy.id, 0, config), cutUntil: 0, cutOffset: 0, cuts: 0 };
  }

  private phaseOf(state: PouncerState, now: number): EnemyPouncePhase {
    return enemyPouncePhaseAt({ revision: state.revision, pounce: state.pounce }, now);
  }

  /** Returns true when an aim decision was spent this frame. */
  private step(state: PouncerState, config: CoopDefenseEnemyPounceConfig, now: number,
    engaged: Map<string, number>, mayDecide: boolean): boolean {
    const enemy = state.enemy;
    const stunned = this.ports.isStunned(enemy.id, now);
    const hidden = enemy.isBurrowed();
    const teleported = enemy.positionRevision !== state.positionRevision;
    state.positionRevision = enemy.positionRevision;
    let phase = this.phaseOf(state, now);
    let decided = false;

    if (state.flying || phase === 'air') {
      if (!state.flying) {
        state.flying = true;
        enemy.setKnockbackImmune(true);
        beginEnemyFlightTracking(state, enemy.sprite.x, enemy.sprite.y, now);
      }
      this.flightStep(state, config, now, stunned || hidden || teleported);
      phase = this.phaseOf(state, now);
    } else if (phase === 'aim' || phase === 'lock') {
      const pounce = state.pounce!;
      const displaced = Math.hypot(enemy.sprite.x - pounce.originX, enemy.sprite.y - pounce.originY) > config.cancelDisplacementPx;
      if (stunned || hidden || teleported || displaced || !enemy.isOrdinaryMovementEnabled()) {
        this.cancel(state, config, now);
      } else if (phase === 'aim') {
        const target = this.ports.resolveTarget(enemy, pounce.target);
        const distance = target ? Math.hypot(target.x - enemy.sprite.x, target.y - enemy.sprite.y) : Infinity;
        if (!target || distance < config.closeCancelPx
          || !this.ports.canSee(enemy, target, config.maxRangePx * AIM_SIGHT_FACTOR)) {
          this.cancel(state, config, now);
        } else {
          if (state.track) trackPounceTarget(state.track, target.x, target.y, now);
          enemy.faceAngle(Math.atan2(target.y - enemy.sprite.y, target.x - enemy.sprite.x));
          if (now >= pounce.lockAt) this.lock(state, config, target, now);
        }
      } else {
        enemy.faceAngle(this.aimAngle(state));
      }
      phase = this.phaseOf(state, now);
    } else if (phase === 'idle' && !stunned && !hidden) {
      if (mayDecide && now >= state.readyAt && now >= state.nextScanAt) {
        decided = true;
        state.nextScanAt = now + getCoopDefenseEnemyConfig(enemy.kind).attackScanIntervalMs;
        this.tryAim(state, config, now, engaged);
        phase = this.phaseOf(state, now);
      }
      if (phase === 'idle') this.stepSideCut(state, config, now);
    }
    if (phase !== 'idle') state.cutUntil = 0;
    state.phase = phase;
    return decided;
  }

  private tryAim(state: PouncerState, config: CoopDefenseEnemyPounceConfig, now: number, engaged: Map<string, number>): void {
    const enemy = state.enemy;
    if (enemy.isStationary() || !enemy.isOrdinaryMovementEnabled() || this.ports.isBiting(enemy, now)) return;
    const target = this.ports.readTarget(enemy);
    if (!target) return;
    const x = enemy.sprite.x, y = enemy.sprite.y, distance = Math.hypot(target.x - x, target.y - y);
    if (distance < config.minRangePx || distance > config.maxRangePx) return;
    const key = targetKey(target.ref);
    if ((engaged.get(key) ?? 0) >= config.pack.maxPerTarget || now - (this.lastAimAt.get(key) ?? -Infinity) < config.pack.staggerMs) return;
    if (!this.ports.canSee(enemy, target, config.maxRangePx)) return;
    const radius = enemy.getCollisionRadius();
    const clear = this.ports.laneClearance(x, y, Math.atan2(target.y - y, target.x - x), distance, radius);
    if (clear < distance - target.radius) return;
    engaged.set(key, (engaged.get(key) ?? 0) + 1);
    this.lastAimAt.set(key, now);
    state.track = createPounceTargetTrack(target.x, target.y, now);
    state.pounce = { target: target.ref, originX: Math.round(x), originY: Math.round(y), aimAt: now,
      lockAt: now + config.aimMs, landing: null };
    state.cutUntil = 0;
    enemy.stopMovement();
    enemy.faceAngle(Math.atan2(target.y - y, target.x - x));
    this.ports.onCommit?.(enemy, target.ref);
    this.publish(state);
  }

  /** Fix the landing point: the predicted path of the target, kept within range, reachable and on free ground. */
  private lock(state: PouncerState, config: CoopDefenseEnemyPounceConfig, target: EnemyPounceTarget, now: number): void {
    const enemy = state.enemy, pounce = state.pounce!, radius = enemy.getCollisionRadius();
    const x = pounce.originX, y = pounce.originY;
    const track = state.track;
    const predicted = predictPounceLanding(x, y, target.x, target.y, track?.vx ?? 0, track?.vy ?? 0, config.lockMs, config);
    const angle = Math.atan2(predicted.y - y, predicted.x - x);
    let length = Math.min(predicted.length, this.ports.laneClearance(x, y, angle, predicted.length, radius));
    for (let tries = 0; length >= config.minRangePx
      && !this.ports.isFree(x + Math.cos(angle) * length, y + Math.sin(angle) * length, radius); tries++) {
      if (tries >= LANDING_STEP_BACK_TRIES) { length = 0; break; }
      length -= LANDING_STEP_BACK_PX;
    }
    if (length < config.minRangePx) { this.cancel(state, config, now); return; }
    const airMs = pounceAirMs(length, config);
    const takeoffAt = Math.round(now + config.lockMs), landAt = takeoffAt + airMs;
    state.airMs = airMs;
    state.pounce = { ...pounce, landing: { x: Math.round(x + Math.cos(angle) * length), y: Math.round(y + Math.sin(angle) * length),
      takeoffAt, landAt, recoverUntil: landAt + config.recoverMs, armed: true } };
    this.publish(state);
  }

  private flightStep(state: PouncerState, config: CoopDefenseEnemyPounceConfig, now: number, interrupted: boolean): void {
    const enemy = state.enemy, pounce = state.pounce!, landing = pounce.landing!;
    const step = stepEnemyFlight(flightLine(pounce), state, enemy.sprite.x, enemy.sprite.y, now, state.airMs, interrupted);
    if (step.kind === 'arrived') {
      // Early arrival lands now; the timeline is shortened so clients do not keep the body airborne.
      if (step.early) {
        state.pounce = { ...pounce, landing: { ...landing, landAt: now, recoverUntil: now + config.recoverMs } };
        this.publish(state);
      }
      this.land(state, config, now, landing.armed);
      return;
    }
    if (step.kind === 'abort') {
      // The body comes down where it is, without an impact.
      const ax = Math.round(enemy.sprite.x), ay = Math.round(enemy.sprite.y);
      state.pounce = { ...pounce, landing: { x: ax, y: ay, takeoffAt: Math.min(landing.takeoffAt, now), landAt: now,
        recoverUntil: now + config.recoverMs, armed: false } };
      this.publish(state);
      this.land(state, config, now, false);
      return;
    }
    if (step.retime) {
      const { takeoffAt, landAt } = step.retime;
      state.pounce = { ...pounce, landing: { ...landing, takeoffAt, landAt, recoverUntil: landAt + config.recoverMs } };
      this.publish(state);
    }
  }

  private land(state: PouncerState, config: CoopDefenseEnemyPounceConfig, now: number, impact: boolean): void {
    const enemy = state.enemy, landing = state.pounce?.landing;
    state.flying = false;
    enemy.setKnockbackImmune(false);
    enemy.stopMovement();
    state.pounces++;
    state.readyAt = now + config.recoverMs + cooldownMs(enemy.id, state.pounces, config);
    if (impact && landing) this.ports.impact(enemy, landing.x, landing.y, config.impact, now);
  }

  /** Aim or lock ends without a flight: the zone disappears and a short lockout follows. */
  private cancel(state: PouncerState, config: CoopDefenseEnemyPounceConfig, now: number): void {
    state.pounce = null;
    state.track = null;
    state.readyAt = Math.max(state.readyAt, now + config.cancelLockoutMs);
    this.publish(state);
  }

  private aimAngle(state: PouncerState): number {
    const pounce = state.pounce, enemy = state.enemy;
    if (!pounce) return enemy.sprite.rotation;
    const landing = pounce.landing;
    if (landing) return Math.atan2(landing.y - pounce.originY, landing.x - pounce.originX);
    const track = state.track;
    return track ? Math.atan2(track.y - enemy.sprite.y, track.x - enemy.sprite.x) : enemy.sprite.rotation;
  }

  /** Starts a side-cut when one is due and the body runs at a target that is still far enough away. */
  private stepSideCut(state: PouncerState, config: CoopDefenseEnemyPounceConfig, now: number): void {
    const cuts = config.sideCuts, enemy = state.enemy;
    if (!cuts || now < state.nextCutAt || now < state.cutUntil) return;
    const target = this.ports.readTarget(enemy);
    const far = !!target && Math.hypot(target.x - enemy.sprite.x, target.y - enemy.sprite.y) > cuts.minTargetDistancePx;
    if (!far || enemy.isStationary() || this.ports.isBiting(enemy, now) || enemy.isAttackMovementPaused(now)) {
      state.nextCutAt = now + CUT_RETRY_MS;
      return;
    }
    state.cuts++;
    // Sides alternate from a per-body start, so a cut is followed by a cut the other way.
    const side = (pounceUnitHash(enemy.id, 0, 3) < 0.5 ? 1 : -1) * (state.cuts % 2 === 0 ? 1 : -1);
    const degrees = cuts.angleMinDeg + (cuts.angleMaxDeg - cuts.angleMinDeg) * pounceUnitHash(enemy.id, state.cuts, 5);
    state.cutOffset = side * degrees * Math.PI / 180;
    state.cutUntil = now + cuts.durationMs;
    state.nextCutAt = now + cutInterval(enemy.id, state.cuts, config);
  }

  private cutVelocity(state: PouncerState, now: number): EnemyMovementOverride | null {
    const enemy = state.enemy, config = getCoopDefenseEnemyConfig(enemy.kind).pounce;
    const steering = this.ports.steeringPoint(enemy);
    if (!config || !steering) { state.cutUntil = 0; return null; }
    const x = enemy.sprite.x, y = enemy.sprite.y;
    const angle = Math.atan2(steering.y - y, steering.x - x) + state.cutOffset;
    const speed = enemy.getMoveSpeed() * (config.gait ? boundingGaitFactor(enemy.id, now, config.gait) : 1);
    const moved = this.ports.moveNormally(enemy, { x: x + Math.cos(angle) * CUT_PROBE_PX, y: y + Math.sin(angle) * CUT_PROBE_PX },
      speed, angle);
    // A blocked side ends the cut; the ordinary route takes over again.
    if (moved.blocked) { state.cutUntil = 0; return null; }
    return { vx: moved.vx, vy: moved.vy, aimAngle: angle };
  }

  private publish(state: PouncerState): void {
    const pounce = state.pounce;
    // Whole host milliseconds keep the wire compact; rounding preserves the timeline order.
    if (pounce) {
      const landing = pounce.landing;
      state.pounce = { ...pounce, aimAt: Math.round(pounce.aimAt), lockAt: Math.round(pounce.lockAt),
        landing: landing ? { ...landing, takeoffAt: Math.round(landing.takeoffAt), landAt: Math.round(landing.landAt),
          recoverUntil: Math.round(landing.recoverUntil) } : null };
    }
    state.revision = Math.max(state.revision, state.enemy.getPounceState().revision) + 1;
    state.enemy.applyPounceState({ revision: state.revision, pounce: state.pounce });
  }

  private release(state: PouncerState): void {
    state.enemy.setKnockbackImmune(false);
    state.flying = false;
    if (!state.enemy.sprite.active || !state.pounce) return;
    state.pounce = null;
    this.publish(state);
  }
}

function targetKey(ref: EnemyPounceTargetRef): string { return `${ref.kind}:${ref.id}`; }

function flightLine(pounce: EnemyPounce): EnemyFlightLine {
  const landing = pounce.landing!;
  return { originX: pounce.originX, originY: pounce.originY, targetX: landing.x, targetY: landing.y,
    takeoffAt: landing.takeoffAt, landAt: landing.landAt };
}

function cooldownMs(enemyId: string, pounces: number, config: CoopDefenseEnemyPounceConfig): number {
  return config.cooldownMinMs + (config.cooldownMaxMs - config.cooldownMinMs) * pounceUnitHash(enemyId, pounces, 13);
}

function cutInterval(enemyId: string, cuts: number, config: CoopDefenseEnemyPounceConfig): number {
  const cut = config.sideCuts;
  return cut ? cut.intervalMinMs + (cut.intervalMaxMs - cut.intervalMinMs) * pounceUnitHash(enemyId, cuts, 17) : Infinity;
}
