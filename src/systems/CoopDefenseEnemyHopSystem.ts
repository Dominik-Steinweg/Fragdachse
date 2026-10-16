import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyHopConfig, type CoopDefenseEnemyLandingShockConfig } from '../config/coopDefenseEnemies';
import type { CombatActorStatePort, CombatGeometryPort } from '../combat/CombatCapabilities';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager, EnemyMovementOverride, EnemySpecialMovementSource } from '../entities/EnemyManager';
import { enemyHopPhaseAt, type EnemyHopJump, type EnemyHopPhase } from './EnemyHopState';
import { selectHopLanding } from './enemyHopLanding';
import { restHealCapacity, restHealClusterValue, selectRestHealLinks, type RestHealBody } from './enemyRestHeal';

interface Point { readonly x: number; readonly y: number }

/** Route view of one body: where it steers and how expensive the route is from a point. */
export interface EnemyHopSteering {
  readonly point: Point;
  readonly originCost: number | null;
  readonly costAt: (x: number, y: number) => number | null;
}

/** Read-only attack decision of the attack owner: a target in reach (aim) or a committed windup. */
export interface EnemyHopCombatIntent { readonly aimAngle: number; readonly committed?: boolean }

export interface EnemyHopPorts {
  readonly enemies: Pick<EnemyManager, 'getAllEnemies' | 'applyHealing'>;
  readonly combat: Pick<CombatActorStatePort, 'isStunned'> & Pick<CombatGeometryPort, 'hasClearLineOfFire'>;
  /** Steering of hostile bodies from their intent, of allies from necromancy; null holds the body in place. */
  readonly readSteering: (enemy: EnemyEntity) => EnemyHopSteering | null;
  readonly isFree: (x: number, y: number, radius: number) => boolean;
  readonly canMove: (fromX: number, fromY: number, toX: number, toY: number, radius: number) => boolean;
  readonly combatIntent: (enemy: EnemyEntity, nowMs: number) => EnemyHopCombatIntent | null;
  /** Bodies a hostile landing may shock (players); allies never shock. */
  readonly shockTargets: (enemy: EnemyEntity) => readonly Point[];
  readonly landingShock?: (enemy: EnemyEntity, x: number, y: number, shock: CoopDefenseEnemyLandingShockConfig, nowMs: number) => void;
}

interface HopperState {
  readonly enemy: EnemyEntity;
  revision: number;
  jump: EnemyHopJump | null;
  links: readonly string[];
  /** Phase seen in the previous step; transitions run once. */
  phase: EnemyHopPhase;
  restAt: number;
  nextTickAt: number;
  restHadLinks: boolean;
  retryAt: number;
  lockoutUntil: number;
  hops: number;
  stalledHops: number;
  forceProgress: boolean;
  originCost: number | null;
  positionRevision: number;
  lastX: number;
  lastY: number;
  lastMovedAt: number;
  retimedAt: number;
}

/** Below this residual distance a flight counts as having reached its landing point. */
const ARRIVAL_EPSILON_PX = 3;
/** A body further behind its timeline than this republishes a stretched flight. */
const RETIME_LAG_PX = 8;
const RETIME_INTERVAL_MS = 100;
const RETIME_END_GUARD_MS = 34;
/** A flight without movement for this long ends where the body is. */
const STALL_MS = 120;
/** A flight lasting this many times its plan is aborted (frozen in a time bubble, wedged). */
const MAX_FLIGHT_STRETCH = 4;
/** A shock only fires if the body landed this close (share of the shock radius) to the announced point. */
const SHOCK_LANDING_TOLERANCE = 0.5;
/** Landing decisions per host frame; further hoppers wait one frame. */
const MAX_DECISIONS_PER_FRAME = 4;
/** Heal ticks caught up in one frame at most (long frames, tab switches). */
const MAX_TICKS_PER_FRAME = 10;
const NOMINAL_FRAME_S = 1 / 60;
/** Two hops without route progress force the next one to advance. */
const STALLED_HOPS_BEFORE_FORCE = 2;

/**
 * Activity-owned host decisions of hopping enemies (the Quacksalber toad): when to jump, where to
 * land and whom to heal while resting. Hopping, resting and healing share one owner because the
 * rest length depends on the heal links and the landing choice on the heal rule.
 */
export class CoopDefenseEnemyHopSystem implements EnemySpecialMovementSource {
  private readonly states = new Map<string, HopperState>();

  constructor(private readonly ports: EnemyHopPorts) {}

  hostUpdate(nowMs: number): void {
    const live = new Set<string>();
    const sharedLinks = new Set<string>();
    for (const state of this.states.values()) for (const id of state.links) sharedLinks.add(id);
    let decisions = 0;
    let bodies: RestHealBody[] | null = null;
    const healBodies = () => bodies ??= this.ports.enemies.getAllEnemies().map(toRestHealBody);
    for (const enemy of this.ports.enemies.getAllEnemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind).hop;
      if (!config || !enemy.sprite.active || enemy.getHp() <= 0) continue;
      live.add(enemy.id);
      let state = this.states.get(enemy.id);
      if (!state || state.enemy !== enemy) {
        const previous = enemy.getHopState();
        state = { enemy, revision: previous.revision, jump: null, links: [], phase: 'rest', restAt: nowMs,
          nextTickAt: nowMs + (config.heal?.tickIntervalMs ?? 0), restHadLinks: false, retryAt: nowMs, lockoutUntil: nowMs,
          hops: 0, stalledHops: 0, forceProgress: false, originCost: null, positionRevision: enemy.positionRevision,
          lastX: enemy.sprite.x, lastY: enemy.sprite.y, lastMovedAt: nowMs, retimedAt: nowMs };
        this.states.set(enemy.id, state);
        if (previous.jump || previous.links.length) this.publish(state);
      }
      const decided = this.step(state, config, nowMs, healBodies, sharedLinks, decisions < MAX_DECISIONS_PER_FRAME);
      if (decided) decisions++;
    }
    for (const [id, state] of this.states) if (!live.has(id)) { this.release(state); this.states.delete(id); }
  }

  getMovementOverride(enemy: EnemyEntity, nowMs: number): EnemyMovementOverride | null {
    const state = this.states.get(enemy.id);
    if (!state) return null;
    const phase = this.phaseOf(state, nowMs);
    // Resting bodies only stand: allies keep routing and attacking under necromancy.
    if (phase === 'rest') return { vx: 0, vy: 0, keepsRouting: true };
    const jump = state.jump;
    if (phase !== 'air' || !jump) return { vx: 0, vy: 0 };
    const dx = jump.targetX - enemy.sprite.x, dy = jump.targetY - enemy.sprite.y, remaining = Math.hypot(dx, dy);
    if (remaining <= ARRIVAL_EPSILON_PX) return { vx: 0, vy: 0 };
    // Nominal flight speed of the authored air time; slowing (time bubble, slow status) is applied
    // by physics, and a stretched timeline only re-describes it for clients.
    const airMs = getCoopDefenseEnemyConfig(enemy.kind).hop?.airMs ?? Math.max(1, jump.landAt - jump.takeoffAt);
    const length = Math.hypot(jump.targetX - jump.originX, jump.targetY - jump.originY);
    const speed = Math.min(length / airMs * 1000, remaining / NOMINAL_FRAME_S);
    return { vx: dx / remaining * speed, vy: dy / remaining * speed };
  }

  /** Crouch, flight and landing own the body; regular attacks wait for the rest. */
  blocksRegularAttacks(enemyId: string, nowMs = this.lastNowMs): boolean {
    const state = this.states.get(enemyId);
    return !!state && this.phaseOf(state, nowMs) !== 'rest';
  }
  blocksDodge(enemyId: string): boolean { return this.blocksRegularAttacks(enemyId); }
  /** Hit stagger must not stop a body in flight. */
  isAirborne(enemyId: string, nowMs = this.lastNowMs): boolean {
    const state = this.states.get(enemyId);
    return !!state && this.phaseOf(state, nowMs) === 'air';
  }

  handleKilled(death: { readonly id: string }): void {
    const state = this.states.get(death.id);
    if (state) this.release(state);
    this.states.delete(death.id);
  }

  clear(): void {
    for (const state of this.states.values()) this.release(state);
    this.states.clear();
  }

  private lastNowMs = 0;

  private phaseOf(state: HopperState, nowMs: number): EnemyHopPhase {
    return enemyHopPhaseAt({ revision: state.revision, jump: state.jump, links: state.links }, nowMs);
  }

  /** Returns true when a landing decision was spent this frame. */
  private step(state: HopperState, config: CoopDefenseEnemyHopConfig, now: number, healBodies: () => readonly RestHealBody[],
    sharedLinks: ReadonlySet<string>, mayDecide: boolean): boolean {
    this.lastNowMs = now;
    const enemy = state.enemy;
    const stunned = this.ports.combat.isStunned?.(enemy.id, now) ?? false;
    const hidden = enemy.isBurrowed();
    const teleported = enemy.positionRevision !== state.positionRevision;
    let phase = this.phaseOf(state, now);

    if (phase === 'crouch' && (stunned || hidden || teleported
      || Math.hypot(enemy.sprite.x - state.jump!.originX, enemy.sprite.y - state.jump!.originY) > config.crouchDisplacementCancelPx)) {
      this.endJump(state, config, now, 'cancel');
      phase = 'land';
    } else if (phase === 'crouch') {
      enemy.faceAngle(Math.atan2(state.jump!.targetY - state.jump!.originY, state.jump!.targetX - state.jump!.originX));
    } else if (phase === 'air' || (phase === 'land' && state.phase === 'air')) {
      // A flight whose timeline ran out before the body arrived is still a flight (stretched below).
      if (state.phase !== 'air') {
        state.lastX = enemy.sprite.x; state.lastY = enemy.sprite.y; state.lastMovedAt = now; state.retimedAt = now;
      }
      phase = this.flightStep(state, config, now, stunned || hidden || teleported);
    }

    if (phase === 'land' && state.phase !== 'land') this.land(state, config, now);
    if (phase === 'rest' && state.phase !== 'rest') this.beginRest(state, config, now, healBodies);
    state.phase = phase;
    state.positionRevision = enemy.positionRevision;
    if (phase !== 'rest') return false;
    return this.restStep(state, config, now, stunned || hidden, healBodies, sharedLinks, mayDecide);
  }

  private restStep(state: HopperState, config: CoopDefenseEnemyHopConfig, now: number, suppressed: boolean,
    healBodies: () => readonly RestHealBody[], sharedLinks: ReadonlySet<string>, mayDecide: boolean): boolean {
    const enemy = state.enemy, heal = config.heal;
    if (suppressed) {
      // Stunned or hidden bodies drop their links (tendrils retract); the rest clock keeps running.
      if (state.links.length) { state.links = []; this.publish(state); }
      if (heal) state.nextTickAt = Math.max(state.nextTickAt, now + heal.tickIntervalMs);
    } else if (heal) {
      let ticks = 0;
      while (now >= state.nextTickAt && ticks < MAX_TICKS_PER_FRAME) {
        this.refreshLinks(state, heal, healBodies());
        for (const id of state.links) this.ports.enemies.applyHealing(id, heal.healPerTick);
        state.nextTickAt += heal.tickIntervalMs;
        ticks++;
      }
      if (now >= state.nextTickAt) state.nextTickAt = now + heal.tickIntervalMs;
    }
    if (suppressed) return false;
    const elapsed = now - state.restAt;
    const attack = this.ports.combatIntent(enemy, now);
    // The resting body faces its attack target; the attack owner fires from this stance.
    if (attack) enemy.faceAngle(attack.aimAngle);
    if (attack?.committed || enemy.isAttackMovementPaused(now)) return false;
    const capped = elapsed >= config.restMaxMs;
    if (!capped && (elapsed < config.breathMs || state.links.length > 0 || attack)) return false;
    if (!mayDecide || now < state.lockoutUntil || now < state.retryAt) return false;
    if (capped && state.restHadLinks) state.forceProgress = true;
    if (!this.startJump(state, config, now, healBodies, sharedLinks)) state.retryAt = now + config.retryMs;
    return true;
  }

  private startJump(state: HopperState, config: CoopDefenseEnemyHopConfig, now: number,
    healBodies: () => readonly RestHealBody[], sharedLinks: ReadonlySet<string>): boolean {
    const enemy = state.enemy;
    const steering = this.ports.readSteering(enemy);
    if (!steering) return false;
    const tempo = Math.max(0.25, enemy.getMoveSpeed() / Math.max(1, getCoopDefenseEnemyConfig(enemy.kind).moveSpeed));
    const heal = config.heal, bodies = heal ? healBodies() : [];
    const capacity = heal ? restHealCapacity(heal, config.restMaxMs) : 1;
    const others = new Set([...sharedLinks].filter(id => !state.links.includes(id)));
    const radius = enemy.getCollisionRadius();
    const crowd = this.ports.enemies.getAllEnemies().filter(other => other !== enemy && other.sprite.active && other.getHp() > 0);
    const landing = selectHopLanding({
      x: enemy.sprite.x, y: enemy.sprite.y, radius, steering: steering.point,
      originCost: steering.originCost, costAt: steering.costAt,
      isFree: this.ports.isFree, canMove: this.ports.canMove,
      healValue: heal ? (x, y) => restHealClusterValue({ x, y }, enemy, bodies, heal, capacity, others) / (heal.maxLinks * capacity) : () => 0,
      crowdAt: (x, y) => crowd.reduce((count, other) =>
        Math.hypot(other.sprite.x - x, other.sprite.y - y) < radius + other.getCollisionRadius() ? count + 1 : count, 0),
      distances: [config.maxHopPx * tempo, (config.minHopPx + config.maxHopPx) / 2 * tempo, config.minHopPx * 0.6 * tempo],
      fanSteps: config.fanSteps, fanHalfAngleRad: config.fanHalfAngleDeg * Math.PI / 180,
      jitter: hopJitter(enemy.id, state.hops), weights: config.weights,
      minProgressShare: config.minProgressShare, maxRegressPx: config.maxRegressPx, forceProgress: state.forceProgress,
    });
    if (!landing) return false;
    const shock = config.landingShock && enemy.faction === 'hostile'
      ? this.ports.shockTargets(enemy).some(target => Math.hypot(target.x - landing.x, target.y - landing.y) <= config.landingShock!.armRadiusPx)
      : false;
    const takeoffAt = now + config.crouchMs, landAt = takeoffAt + config.airMs;
    state.jump = { originX: Math.round(enemy.sprite.x), originY: Math.round(enemy.sprite.y), targetX: landing.x, targetY: landing.y,
      crouchAt: now, takeoffAt, landAt, settleUntil: landAt + config.landMs, shock };
    state.links = [];
    state.hops++;
    state.originCost = steering.originCost;
    enemy.stopMovement();
    enemy.faceAngle(landing.angle);
    this.publish(state);
    return true;
  }

  /** One airborne frame; returns the phase the body is in afterwards. */
  private flightStep(state: HopperState, config: CoopDefenseEnemyHopConfig, now: number, interrupted: boolean): EnemyHopPhase {
    const enemy = state.enemy, jump = state.jump!;
    enemy.setKnockbackImmune(true);
    const x = enemy.sprite.x, y = enemy.sprite.y;
    if (Math.hypot(x - state.lastX, y - state.lastY) >= 0.5) { state.lastMovedAt = now; state.lastX = x; state.lastY = y; }
    const remaining = Math.hypot(jump.targetX - x, jump.targetY - y);
    if (remaining <= ARRIVAL_EPSILON_PX) {
      // Early arrival lands now; the timeline is shortened so clients do not keep the body airborne.
      if (now < jump.landAt) {
        state.jump = { ...jump, landAt: now, settleUntil: now + config.landMs };
        this.publish(state);
      }
      return 'land';
    }
    const stalled = now - state.lastMovedAt > STALL_MS;
    const overdue = now > jump.takeoffAt + (jump.landAt - jump.takeoffAt) * MAX_FLIGHT_STRETCH
      || now > jump.takeoffAt + config.airMs * MAX_FLIGHT_STRETCH;
    if (interrupted || stalled || overdue) {
      this.endJump(state, config, now, 'abort');
      return 'land';
    }
    const length = Math.hypot(jump.targetX - jump.originX, jump.targetY - jump.originY);
    const travelled = Math.max(0, length - remaining);
    const planned = length * Math.min(1, (now - jump.takeoffAt) / Math.max(1, jump.landAt - jump.takeoffAt));
    const elapsed = Math.max(1, now - jump.takeoffAt);
    const speed = Math.max(1e-3, travelled / elapsed);
    const landAt = now + remaining / speed;
    const due = now - state.retimedAt >= RETIME_INTERVAL_MS || now >= jump.landAt;
    const lagging = planned - travelled > RETIME_LAG_PX;
    // Near the planned landing a flight that will arrive late is stretched, so clients never see it land short.
    const endingLate = now >= jump.landAt
      || (now >= jump.landAt - RETIME_END_GUARD_MS && landAt > jump.landAt + RETIME_END_GUARD_MS);
    if (due && (lagging || endingLate)) {
      // Slowed flight (time bubble, slow status): stretch the timeline around the current progress
      // so clients keep the body where it is and the arc continues without a jump.
      const progress = Math.min(0.99, travelled / Math.max(1e-6, length));
      const takeoffAt = landAt - (landAt - now) / (1 - progress);
      state.jump = { ...jump, crouchAt: Math.min(jump.crouchAt, takeoffAt), takeoffAt, landAt, settleUntil: landAt + config.landMs };
      state.retimedAt = now;
      this.publish(state);
    }
    return 'air';
  }

  /** Cancel in the crouch or abort in the air: the jump ends where the body is, unshocked. */
  private endJump(state: HopperState, config: CoopDefenseEnemyHopConfig, now: number, reason: 'cancel' | 'abort'): void {
    const enemy = state.enemy, jump = state.jump!;
    const x = Math.round(enemy.sprite.x), y = Math.round(enemy.sprite.y);
    state.jump = { ...jump, targetX: x, targetY: y, takeoffAt: Math.min(jump.takeoffAt, now), landAt: now,
      settleUntil: now + config.landMs, shock: false };
    if (reason === 'cancel') state.lockoutUntil = now + config.cancelLockoutMs;
    this.publish(state);
  }

  private land(state: HopperState, config: CoopDefenseEnemyHopConfig, now: number): void {
    const enemy = state.enemy, jump = state.jump;
    enemy.setKnockbackImmune(false);
    enemy.stopMovement();
    if (!jump) return;
    const shock = config.landingShock;
    if (jump.shock && shock && enemy.faction === 'hostile'
      && Math.hypot(enemy.sprite.x - jump.targetX, enemy.sprite.y - jump.targetY) <= shock.radiusPx * SHOCK_LANDING_TOLERANCE) {
      this.ports.landingShock?.(enemy, enemy.sprite.x, enemy.sprite.y, shock, now);
    }
    // Anti-loitering: hops that do not shorten the route eventually force an advance.
    const steering = this.ports.readSteering(enemy);
    const before = state.originCost, after = steering?.originCost ?? null;
    state.stalledHops = before !== null && after !== null && after >= before ? state.stalledHops + 1 : 0;
    state.forceProgress = state.stalledHops >= STALLED_HOPS_BEFORE_FORCE;
  }

  private beginRest(state: HopperState, config: CoopDefenseEnemyHopConfig, now: number,
    healBodies: () => readonly RestHealBody[]): void {
    state.restAt = state.jump ? Math.min(now, state.jump.settleUntil) : now;
    state.restHadLinks = false;
    const heal = config.heal;
    if (!heal) return;
    // Links appear at the start of the rest; the first tick follows one interval later, when the
    // tendrils have grown to their targets.
    state.nextTickAt = state.restAt + heal.tickIntervalMs;
    this.refreshLinks(state, heal, healBodies());
  }

  private refreshLinks(state: HopperState, heal: NonNullable<CoopDefenseEnemyHopConfig['heal']>, bodies: readonly RestHealBody[]): void {
    const enemy = state.enemy;
    const healer = toRestHealBody(enemy);
    const links = selectRestHealLinks(healer, bodies, state.links, heal, target =>
      this.ports.combat.hasClearLineOfFire(enemy.sprite.x, enemy.sprite.y, target.x, target.y, { purpose: 'support' }));
    if (links.length) state.restHadLinks = true;
    if (links.length === state.links.length && links.every((id, index) => id === state.links[index])) return;
    state.links = links;
    this.publish(state);
  }

  private publish(state: HopperState): void {
    // Whole host milliseconds keep the wire compact; rounding preserves the timeline order.
    const jump = state.jump;
    if (jump) state.jump = { ...jump, crouchAt: Math.round(jump.crouchAt), takeoffAt: Math.round(jump.takeoffAt),
      landAt: Math.round(jump.landAt), settleUntil: Math.round(jump.settleUntil) };
    state.revision = Math.max(state.revision, state.enemy.getHopState().revision) + 1;
    state.enemy.applyHopState({ revision: state.revision, jump: state.jump, links: [...state.links] });
  }

  private release(state: HopperState): void {
    state.enemy.setKnockbackImmune(false);
    if (!state.enemy.sprite.active) return;
    if (state.links.length || (state.jump && this.lastNowMs < state.jump.settleUntil)) {
      state.links = [];
      if (state.jump && this.lastNowMs < state.jump.settleUntil) {
        const now = this.lastNowMs;
        state.jump = { ...state.jump, targetX: Math.round(state.enemy.sprite.x), targetY: Math.round(state.enemy.sprite.y),
          takeoffAt: Math.min(state.jump.takeoffAt, now), landAt: Math.min(state.jump.landAt, now), settleUntil: now, shock: false };
      }
      this.publish(state);
    }
  }
}

function toRestHealBody(enemy: EnemyEntity): RestHealBody {
  return { id: enemy.id, faction: enemy.faction, x: enemy.sprite.x, y: enemy.sprite.y, hp: enemy.getHp(), maxHp: enemy.getMaxHp(),
    active: enemy.sprite.active, hidden: enemy.isBurrowed() };
}

/** Deterministic fan rotation per body and hop in [-0.5, 0.5]. */
export function hopJitter(id: string, hop: number): number {
  let hash = 2166136261 ^ hop;
  for (let i = 0; i < id.length; i++) hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  return ((hash >>> 0) % 1000) / 999 - 0.5;
}
