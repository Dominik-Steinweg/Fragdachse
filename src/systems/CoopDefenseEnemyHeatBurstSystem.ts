import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyHeatBurstConfig } from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyDeathInfo, EnemyMovementOverride, EnemySpecialMovementSource } from '../entities/EnemyManager';
import { enemyHeatAt, enemyHeatBurstPhaseAt, type EnemyHeatBurstPhase } from './EnemyHeatBurstState';
import { heatChargeMs, heatFirstSlotAtOrAfter, heatFizzleRadius, heatSlotJitterMs, heatSlotTime,
  heatSpeedFactor } from './enemyHeatBurstRules';

interface Point { readonly x: number; readonly y: number }

/**
 * Distance of a point beyond every player's view (0 inside one), with the bands of the AI detail
 * tiers. The heat cycle reads this geometry itself; it never reads the detail tier.
 */
export interface EnemyViewProximity {
  viewGap(x: number, y: number): number;
  readonly nearMarginPx: number;
  readonly farMarginPx: number;
}

export interface EnemyHeatBurstPorts {
  readonly enemies: { getAllEnemies(): readonly EnemyEntity[] };
  /** Next steering point of the body's ordinary route, or null (the warning run then keeps its heading). */
  readonly steeringPoint: (enemy: EnemyEntity) => Point | null;
  /** Crowd- and geometry-aware locomotion towards a point, facing `aimAngle`. */
  readonly moveNormally: (enemy: EnemyEntity, point: Point, speed: number, aimAngle: number) => { vx: number; vy: number; blocked: boolean };
  /** A hostile body within `radius` of an allied burster. */
  readonly hasHostileWithin: (enemy: EnemyEntity, radius: number) => boolean;
  /** The train-awareness owner currently moves the body off the track. */
  readonly isEvadingTrain?: (enemyId: string) => boolean;
  /** Area hit, fire chunks and effect of a burst at the body's position. */
  readonly burst: (enemy: EnemyEntity, x: number, y: number, config: CoopDefenseEnemyHeatBurstConfig, cycle: number, now: number) => void;
  /** Harmless pop of a body killed with heat in it. */
  readonly fizzle: (death: EnemyDeathInfo, radius: number) => void;
}

interface HeatState {
  readonly enemy: EnemyEntity;
  readonly chargeMs: number;
  revision: number;
  cycle: number;
  ventFromAt: number;
  chargeStartAt: number;
  fullAt: number;
  telegraphAt: number;
  burstAt: number;
  /** Booked grid slot of the pending burst (host only). */
  slot: number | null;
  /** Some player can see the body (hysteresis over the view bands). */
  seen: boolean;
  positionRevision: number;
  nextBookingCheckAt: number;
  /** Heading of the warning run; null outside it. */
  heading: number | null;
  headingAt: number;
}

/** A booked warning reaches clients before it starts. */
const BOOKING_LEAD_MS = 200;
/** Host frames missed by more than this skip no warning: the body announces its burst again. */
const LATE_BURST_MS = 250;
/** Allies re-check their trigger this often while holding. */
const BOOKING_RECHECK_MS = 150;
/** Grid slots searched for a free one before the body simply waits for the next check. */
const MAX_SLOT_SEARCH = 64;
/** The warning run steers at a point this far ahead along its heading. */
const RUN_PROBE_PX = 48;

/**
 * Host decisions of heat-burst enemies (the Demon Badger): charge while running (the speed rises),
 * hold at full heat until a burst slot is free, announce the burst with a warning that travels with
 * the running body, burst around it and cool down. Bursts sit on a shared grid; two bodies close to
 * each other never share a slot, so a pack bursts one after another in spawn order. A full body
 * nobody can see holds its heat. Each transition is published as a replicated EnemyHeatBurstState.
 */
export class CoopDefenseEnemyHeatBurstSystem implements EnemySpecialMovementSource {
  private readonly states = new Map<string, HeatState>();
  private lastNow = 0;

  constructor(private readonly ports: EnemyHeatBurstPorts) {}

  hostUpdate(now: number, views: EnemyViewProximity | null): void {
    this.lastNow = now;
    const live = new Set<string>();
    for (const enemy of this.ports.enemies.getAllEnemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind).heatBurst;
      if (!config || !enemy.sprite.active || enemy.getHp() <= 0) continue;
      live.add(enemy.id);
      let state = this.states.get(enemy.id);
      if (!state || state.enemy !== enemy) state = this.createState(enemy, config, now, views);
      this.step(state, config, now, views);
      enemy.setAbilitySpeedFactor(heatSpeedFactor(enemyHeatAt(enemy.getHeatBurstState(), now), config));
    }
    for (const [id, state] of this.states) {
      if (live.has(id)) continue;
      state.enemy.setAbilitySpeedFactor(1);
      this.states.delete(id);
    }
  }

  /** Through its warning a hostile body keeps running at full heat but turns only at the authored rate. */
  getMovementOverride(enemy: EnemyEntity, now: number): EnemyMovementOverride | null {
    const state = this.states.get(enemy.id);
    if (!state || state.enemy !== enemy) return null;
    if (enemy.faction !== 'hostile' || state.burstAt === 0 || now < state.telegraphAt || now >= state.burstAt
      || this.ports.isEvadingTrain?.(enemy.id)) {
      state.heading = null;
      return null;
    }
    const config = getCoopDefenseEnemyConfig(enemy.kind).heatBurst!;
    const x = enemy.sprite.x, y = enemy.sprite.y;
    const elapsedS = state.heading === null ? 0 : Math.max(0, Math.min(0.1, (now - state.headingAt) / 1000));
    let heading = state.heading ?? runHeading(enemy);
    const point = this.ports.steeringPoint(enemy);
    if (point && Math.hypot(point.x - x, point.y - y) > 1) {
      heading = turnToward(heading, Math.atan2(point.y - y, point.x - x), config.telegraphTurnRateDegPerSec * Math.PI / 180 * elapsedS);
    }
    state.heading = heading;
    state.headingAt = now;
    const moved = this.ports.moveNormally(enemy, { x: x + Math.cos(heading) * RUN_PROBE_PX, y: y + Math.sin(heading) * RUN_PROBE_PX },
      enemy.getMoveSpeed(), heading);
    return moved.blocked ? { vx: 0, vy: 0, aimAngle: heading } : { vx: moved.vx, vy: moved.vy, aimAngle: heading };
  }

  /** A warning body runs on instead of stopping to bite or spit. */
  blocksRegularAttacks(enemyId: string): boolean {
    const state = this.states.get(enemyId);
    return !!state && state.enemy.faction === 'hostile' && state.burstAt > 0
      && this.lastNow >= state.telegraphAt && this.lastNow < state.burstAt;
  }

  /** A killed body with heat in it fizzles (no damage); its booked slot is released. */
  handleKilled(death: EnemyDeathInfo, now: number): void {
    const state = this.states.get(death.id);
    if (!state) return;
    this.states.delete(death.id);
    const config = getCoopDefenseEnemyConfig(state.enemy.kind).heatBurst;
    const radius = config ? heatFizzleRadius(enemyHeatAt(state.enemy.getHeatBurstState(), now), config) : null;
    if (radius !== null) this.ports.fizzle(death, radius);
  }

  getDevStatus(enemyId: string, now: number): { phase: EnemyHeatBurstPhase; heat: number; slot: number | null } | null {
    const state = this.states.get(enemyId);
    if (!state) return null;
    const published = state.enemy.getHeatBurstState();
    return { phase: enemyHeatBurstPhaseAt(published, now), heat: enemyHeatAt(published, now), slot: state.slot };
  }

  clear(): void {
    for (const state of this.states.values()) state.enemy.setAbilitySpeedFactor(1);
    this.states.clear();
  }

  private createState(enemy: EnemyEntity, config: CoopDefenseEnemyHeatBurstConfig, now: number, views: EnemyViewProximity | null): HeatState {
    const chargeMs = heatChargeMs(enemy.id, config);
    // Cascade by arrival: a body comes to full heat at least one step after every body already near it.
    let fullAt = now + config.initialDelayMs + chargeMs;
    for (const other of this.states.values()) {
      if (this.isNeighbour(other, enemy, config)) fullAt = Math.max(fullAt, other.fullAt + config.cascade.stepMs);
    }
    const state: HeatState = { enemy, chargeMs, revision: enemy.getHeatBurstState().revision, cycle: 0,
      ventFromAt: 0, chargeStartAt: fullAt - chargeMs, fullAt, telegraphAt: 0, burstAt: 0, slot: null,
      seen: views ? views.viewGap(enemy.sprite.x, enemy.sprite.y) < views.farMarginPx : true,
      positionRevision: enemy.positionRevision, nextBookingCheckAt: 0, heading: null, headingAt: now };
    this.states.set(enemy.id, state);
    this.publish(state);
    return state;
  }

  private step(state: HeatState, config: CoopDefenseEnemyHeatBurstConfig, now: number, views: EnemyViewProximity | null): void {
    const enemy = state.enemy, moved = state.positionRevision !== enemy.positionRevision;
    state.positionRevision = enemy.positionRevision;
    if (views) {
      const gap = views.viewGap(enemy.sprite.x, enemy.sprite.y);
      if (moved) state.seen = gap < views.farMarginPx;
      else if (state.seen && gap >= views.farMarginPx) state.seen = false;
      else if (!state.seen && gap <= views.nearMarginPx) state.seen = true;
    } else state.seen = true;

    if (state.burstAt > 0) {
      const warning = now >= state.telegraphAt;
      // A teleported or long-delayed warning restarts in full at the body's current place.
      if ((warning && moved && now < state.burstAt) || now > state.burstAt + LATE_BURST_MS) {
        this.book(state, config, now, now);
        return;
      }
      if (now >= state.burstAt) { this.burst(state, config, now); return; }
      if (!warning && !this.mayBurst(state, config)) {
        state.slot = null; state.telegraphAt = 0; state.burstAt = 0;
        this.publish(state);
      }
      return;
    }
    if (now < state.fullAt - BOOKING_LEAD_MS || now < state.nextBookingCheckAt) return;
    state.nextBookingCheckAt = now + BOOKING_RECHECK_MS;
    if (this.mayBurst(state, config)) this.book(state, config, now, null);
  }

  /** Bursts need a watched, surfaced body; an ally also needs a hostile in reach. */
  private mayBurst(state: HeatState, config: CoopDefenseEnemyHeatBurstConfig): boolean {
    const enemy = state.enemy;
    if (!state.seen || enemy.isBurrowed()) return false;
    return enemy.faction !== 'allied' || this.ports.hasHostileWithin(enemy, config.alliedTriggerRadiusPx);
  }

  /** Book the first free grid slot (or, with `warningAt`, restart the warning there without a slot search). */
  private book(state: HeatState, config: CoopDefenseEnemyHeatBurstConfig, now: number, warningAt: number | null): void {
    if (warningAt !== null) {
      state.slot = null;
      state.telegraphAt = Math.max(state.fullAt, Math.round(warningAt));
      state.burstAt = state.telegraphAt + config.telegraphMs;
      this.publish(state);
      return;
    }
    const jitter = heatSlotJitterMs(state.enemy.id, state.cycle, config);
    const earliest = Math.max(state.fullAt, now + BOOKING_LEAD_MS) + config.telegraphMs;
    let slot = heatFirstSlotAtOrAfter(earliest, jitter, config);
    let found = false;
    for (let tries = 0; tries < MAX_SLOT_SEARCH; tries++, slot++) {
      if (!this.isSlotTaken(state, slot, config)) { found = true; break; }
    }
    if (!found) return;
    state.slot = slot;
    state.burstAt = Math.round(heatSlotTime(slot, jitter, config));
    state.telegraphAt = Math.max(state.fullAt, state.burstAt - config.telegraphMs);
    this.publish(state);
  }

  private isSlotTaken(state: HeatState, slot: number, config: CoopDefenseEnemyHeatBurstConfig): boolean {
    let count = 0;
    for (const other of this.states.values()) {
      if (other === state || other.slot !== slot) continue;
      if (this.isNeighbour(other, state.enemy, config)) return true;
      if (++count >= config.cascade.maxPerSlot) return true;
    }
    return false;
  }

  private burst(state: HeatState, config: CoopDefenseEnemyHeatBurstConfig, now: number): void {
    const enemy = state.enemy;
    this.ports.burst(enemy, enemy.sprite.x, enemy.sprite.y, config, state.cycle, now);
    if (this.states.get(enemy.id) !== state) return;
    state.cycle += 1;
    state.slot = null;
    state.ventFromAt = Math.round(now);
    state.chargeStartAt = state.ventFromAt + config.ventMs;
    state.fullAt = state.chargeStartAt + state.chargeMs;
    state.telegraphAt = 0;
    state.burstAt = 0;
    state.heading = null;
    this.publish(state);
  }

  private isNeighbour(other: HeatState, enemy: EnemyEntity, config: CoopDefenseEnemyHeatBurstConfig): boolean {
    const radius = config.cascade.neighbourRadiusPx;
    const dx = other.enemy.sprite.x - enemy.sprite.x, dy = other.enemy.sprite.y - enemy.sprite.y;
    return dx * dx + dy * dy <= radius * radius;
  }

  private publish(state: HeatState): void {
    state.revision = Math.max(state.revision, state.enemy.getHeatBurstState().revision) + 1;
    state.enemy.applyHeatBurstState({ revision: state.revision, ventFromAt: Math.round(state.ventFromAt),
      chargeStartAt: Math.round(state.chargeStartAt), fullAt: Math.round(state.fullAt),
      telegraphAt: Math.round(state.telegraphAt), burstAt: Math.round(state.burstAt) });
  }
}

/** Direction the body runs in: its current velocity, else its facing. */
function runHeading(enemy: EnemyEntity): number {
  const velocity = enemy.getDesiredVelocity();
  return Math.hypot(velocity.vx, velocity.vy) > 1 ? Math.atan2(velocity.vy, velocity.vx) : enemy.getAimAngle();
}

function turnToward(current: number, desired: number, maxStep: number): number {
  const delta = Math.atan2(Math.sin(desired - current), Math.cos(desired - current));
  return current + Math.max(-maxStep, Math.min(maxStep, delta));
}
