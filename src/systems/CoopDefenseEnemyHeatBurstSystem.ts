import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyHeatBurstConfig } from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyDeathInfo, EnemyMovementOverride, EnemySpecialMovementSource } from '../entities/EnemyManager';
import type { EnemySalvoHooks } from './CoopDefenseEnemyAttackSystem';
import { enemyHeatBurstPhaseAt, type EnemyHeatBurstPhase } from './EnemyHeatBurstState';
import { heatFizzleRadius, heatSalvoPauseMs, heatStageSpeedFactor } from './enemyHeatBurstRules';

export interface EnemyHeatBurstPorts {
  readonly enemies: { getAllEnemies(): readonly EnemyEntity[] };
  /** The train-awareness owner currently moves the body off the track. */
  readonly isEvadingTrain?: (enemyId: string) => boolean;
  /** Area hit, fire chunks and effect of a burst at the body's position. */
  readonly burst: (enemy: EnemyEntity, x: number, y: number, config: CoopDefenseEnemyHeatBurstConfig, now: number) => void;
  /** The body died in its own burst: it leaves without a kill reward, death effect or corpse. */
  readonly removeWithoutKill: (enemy: EnemyEntity) => void;
  /** Harmless pop of a body killed with heat in it. */
  readonly fizzle: (death: EnemyDeathInfo, radius: number) => void;
}

interface HeatState {
  readonly enemy: EnemyEntity;
  revision: number;
  stage: number;
  stageAt: number;
  telegraphAt: number;
  burstAt: number;
  /** The warning was already restarted once (a teleported body or a long host stall). */
  restarted: boolean;
  positionRevision: number;
  lastX: number;
  lastY: number;
  /** Facing the body holds through its meltdown (its last target). */
  heading: number;
}

/** A warning reaches clients before it starts, even with a short last pause. */
const BOOKING_LEAD_MS = 200;
/** Host frames missed by more than this skip no warning: the body announces its burst again. */
const LATE_BURST_MS = 250;
/** A discontinuous move farther than this (portal, translocator) restarts a running warning once. */
const TELEPORT_PX = 48;

/**
 * Host decisions of heat-burst enemies (the Demon Badger). Every salvo the body spits adds a heat
 * stage it keeps until it dies: it runs faster and its next salvo comes sooner (one pause for all its
 * salvo weapons, spread per body so a pack drifts apart). Its last salvo starts the meltdown: the body
 * stands facing its target, the warning follows after the last pause, and the burst kills the body
 * without a kill reward. Killed before, it fizzles. Each transition is published as a replicated
 * EnemyHeatBurstState.
 */
export class CoopDefenseEnemyHeatBurstSystem implements EnemySpecialMovementSource, EnemySalvoHooks {
  private readonly states = new Map<string, HeatState>();
  private lastNow = 0;

  constructor(private readonly ports: EnemyHeatBurstPorts) {}

  hostUpdate(now: number): void {
    this.lastNow = now;
    const live = new Set<string>();
    for (const enemy of this.ports.enemies.getAllEnemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind).heatBurst;
      if (!config || !enemy.sprite.active || enemy.getHp() <= 0) continue;
      live.add(enemy.id);
      const state = this.stateOf(enemy);
      enemy.setAbilitySpeedFactor(heatStageSpeedFactor(state.stage, config));
      this.step(state, config, now);
    }
    for (const [id, state] of this.states) {
      if (live.has(id)) continue;
      state.enemy.setAbilitySpeedFactor(1);
      this.states.delete(id);
    }
  }

  /**
   * A spent salvo heats the body by one stage and sets its pause. The last stage books the meltdown:
   * the warning starts after that stage's pause, so the burst comes in the rhythm the salvos set.
   */
  salvoSpent(enemy: EnemyEntity, shotsFired: number, now: number): number | null {
    const config = getCoopDefenseEnemyConfig(enemy.kind).heatBurst;
    if (!config || shotsFired <= 0 || !enemy.sprite.active || enemy.getHp() <= 0) return null;
    const state = this.stateOf(enemy);
    if (state.burstAt > 0 || state.stage >= config.stages) return null;
    const pauseMs = heatSalvoPauseMs(state.stage, enemy.id, config);
    state.stage += 1;
    state.stageAt = Math.round(now);
    if (state.stage >= config.stages) {
      state.heading = enemy.getAimAngle();
      state.telegraphAt = Math.round(now + Math.max(BOOKING_LEAD_MS, pauseMs));
      state.burstAt = state.telegraphAt + config.telegraphMs;
    }
    enemy.setAbilitySpeedFactor(heatStageSpeedFactor(state.stage, config));
    this.publish(state);
    return pauseMs;
  }

  /** From its last stage until the burst the body stands facing its target (a train still moves it off the track). */
  getMovementOverride(enemy: EnemyEntity, now: number): EnemyMovementOverride | null {
    const state = this.states.get(enemy.id);
    if (!state || state.enemy !== enemy || state.burstAt === 0 || now >= state.burstAt
      || this.ports.isEvadingTrain?.(enemy.id)) return null;
    return { vx: 0, vy: 0, aimAngle: state.heading };
  }

  /** A melting body neither bites nor spits. */
  blocksRegularAttacks(enemyId: string): boolean {
    const state = this.states.get(enemyId);
    return !!state && state.burstAt > 0 && this.lastNow < state.burstAt;
  }

  /** A killed body with heat in it fizzles (no damage). */
  handleKilled(death: EnemyDeathInfo, _now: number): void {
    const state = this.states.get(death.id);
    if (!state) return;
    this.states.delete(death.id);
    const config = getCoopDefenseEnemyConfig(state.enemy.kind).heatBurst;
    const radius = config ? heatFizzleRadius(state.stage, config) : null;
    if (radius !== null) this.ports.fizzle(death, radius);
  }

  getDevStatus(enemyId: string, now: number): { phase: EnemyHeatBurstPhase; stage: number } | null {
    const state = this.states.get(enemyId);
    if (!state) return null;
    return { phase: enemyHeatBurstPhaseAt(state.enemy.getHeatBurstState(), now), stage: state.stage };
  }

  clear(): void {
    for (const state of this.states.values()) state.enemy.setAbilitySpeedFactor(1);
    this.states.clear();
  }

  private stateOf(enemy: EnemyEntity): HeatState {
    const existing = this.states.get(enemy.id);
    if (existing && existing.enemy === enemy) return existing;
    const published = enemy.getHeatBurstState();
    const state: HeatState = { enemy, revision: published.revision, stage: published.stage, stageAt: published.stageAt,
      telegraphAt: published.telegraphAt, burstAt: published.burstAt, restarted: false,
      positionRevision: enemy.positionRevision, lastX: enemy.sprite.x, lastY: enemy.sprite.y, heading: enemy.getAimAngle() };
    this.states.set(enemy.id, state);
    return state;
  }

  private step(state: HeatState, config: CoopDefenseEnemyHeatBurstConfig, now: number): void {
    const enemy = state.enemy, moved = state.positionRevision !== enemy.positionRevision;
    const jumped = moved && Math.hypot(enemy.sprite.x - state.lastX, enemy.sprite.y - state.lastY) > TELEPORT_PX;
    state.positionRevision = enemy.positionRevision;
    state.lastX = enemy.sprite.x; state.lastY = enemy.sprite.y;
    if (state.burstAt === 0) return;
    // A teleported or long-delayed warning restarts once in full at the body's current place.
    if (!state.restarted && ((jumped && now >= state.telegraphAt && now < state.burstAt) || now > state.burstAt + LATE_BURST_MS)) {
      state.restarted = true;
      state.telegraphAt = Math.round(now);
      state.burstAt = state.telegraphAt + config.telegraphMs;
      this.publish(state);
      return;
    }
    if (now >= state.burstAt) this.burst(state, config, now);
  }

  /** The body stays registered through its burst (faction rules apply), then leaves without a kill. */
  private burst(state: HeatState, config: CoopDefenseEnemyHeatBurstConfig, now: number): void {
    const enemy = state.enemy;
    this.states.delete(enemy.id);
    this.ports.burst(enemy, enemy.sprite.x, enemy.sprite.y, config, now);
    this.ports.removeWithoutKill(enemy);
  }

  private publish(state: HeatState): void {
    state.revision = Math.max(state.revision, state.enemy.getHeatBurstState().revision) + 1;
    state.enemy.applyHeatBurstState({ revision: state.revision, stage: state.stage, stageAt: state.stageAt,
      telegraphAt: Math.round(state.telegraphAt), burstAt: Math.round(state.burstAt) });
  }
}
