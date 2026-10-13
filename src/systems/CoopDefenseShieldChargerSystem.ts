import { VOID_PALETTE } from '../config';
import { getCoopDefenseEnemyConfig, type CoopDefenseEnemyShieldChargerConfig } from '../config/coopDefenseEnemies';
import type { CombatActorStatePort, CombatGeometryPort } from '../combat/CombatCapabilities';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager, EnemySpecialMovementSource } from '../entities/EnemyManager';
import type { EnemyFrontalShieldPort, EnemyFrontalShieldState } from './enemyFrontalShield';
import type { ShieldChargeLane, ShieldChargePhase } from './ShieldChargeState';

interface Point { readonly x: number; readonly y: number }
/** A body the charge can strike: player, decoy or (for allies) a hostile enemy. */
export interface ShieldChargeContactTarget { readonly id: string; readonly x: number; readonly y: number; readonly radius: number }

export interface ShieldChargerPorts {
  readonly enemies: Pick<EnemyManager, 'getAllEnemies'>;
  readonly combat: Pick<CombatGeometryPort, 'hasClearLineOfFire'> & Pick<CombatActorStatePort, 'isStunned'>;
  /** Position of the enemy's bound target from the shared intent binding; null without a valid target. */
  readonly readTarget: (enemy: EnemyEntity) => Point | null;
  /** Bodies this charger may strike right now (faction rules applied by the caller). */
  readonly contactTargets: (enemy: EnemyEntity) => readonly ShieldChargeContactTarget[];
  /** Free travel along a lane for a body of `radius` (world geometry, water, arena edge, train). */
  readonly laneClearance: (x: number, y: number, angle: number, length: number, radius: number) => number;
  /** Shield-aware melee contact; returns false when a shield blocked it. */
  readonly strike: (targetId: string, chargerId: string, damage: number, sourceX: number, sourceY: number, nowMs: number) => boolean;
  readonly knockback: (targetId: string, vx: number, vy: number, durationMs: number, sourceId: string) => void;
}

interface ChargerState {
  readonly enemy: EnemyEntity;
  phase: ShieldChargePhase;
  lane: ShieldChargeLane | null;
  revision: number;
  cooldownUntil: number;
  lockoutUntil: number;
  /** Bodies struck during the current run: at most one hit per target and charge. */
  readonly struck: Set<string>;
  lastX: number;
  lastY: number;
}

// A clear void glow hugging the modelled tower shield (reach ~15 px): blocking is core gameplay, so the
// raised shield must read at a glance; the prop gives the form.
const HOSTILE_SHIELD_RIM = { color: VOID_PALETTE.primary, alpha: 0.34, thickness: 2.2, radius: 17, anchorDistance: 0 } as const;
const ALLIED_SHIELD_RIM = { color: 0x8affcf, alpha: 0.12, thickness: 1.4, radius: 17, anchorDistance: 0 } as const;
/** Below this residual distance a run counts as having reached its planned end point. */
const ARRIVAL_EPSILON_PX = 3;
/** Pull back onto the lane centre line (1/s); no invisible lateral steering beyond drift repair. */
const LANE_CORRECTION_PER_S = 10;
/** Host frames are ~16.7 ms; the last step is shortened so the body stops at the end point. */
const NOMINAL_FRAME_S = 1 / 60;

/**
 * Activity-owned host decisions of the Schild-Anstürmer: frontal shield while approaching, a
 * telegraphed straight charge with a host-fixed lane, and a recovery window. Facing is rate
 * limited by the enemy itself (`turnRateDegPerSec`); this system only freezes or drives it.
 */
export class CoopDefenseShieldChargerSystem implements EnemySpecialMovementSource, EnemyFrontalShieldPort {
  private readonly states = new Map<string, ChargerState>();
  private nowMs = 0;

  constructor(private readonly ports: ShieldChargerPorts) {}

  hostUpdate(nowMs: number): void {
    this.nowMs = nowMs;
    const live = new Set<string>();
    for (const enemy of this.ports.enemies.getAllEnemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind).shieldCharger;
      if (!config || !enemy.sprite.active || enemy.getHp() <= 0) continue;
      live.add(enemy.id);
      let state = this.states.get(enemy.id);
      if (!state || state.enemy !== enemy) {
        state = { enemy, phase: 'none', lane: null, revision: enemy.getShieldChargeState().revision,
          cooldownUntil: nowMs, lockoutUntil: nowMs, struck: new Set(), lastX: enemy.sprite.x, lastY: enemy.sprite.y };
        this.states.set(enemy.id, state);
      }
      this.step(state, config, nowMs);
    }
    for (const [id, state] of this.states) if (!live.has(id)) { this.release(state); this.states.delete(id); }
  }

  blocksRegularAttacks(enemyId: string): boolean { return (this.states.get(enemyId)?.phase ?? 'none') !== 'none'; }
  blocksDodge(enemyId: string): boolean { return this.blocksRegularAttacks(enemyId); }
  /** Hit stagger must not stop a committed run. */
  isRunning(enemyId: string): boolean { return this.states.get(enemyId)?.phase === 'run'; }

  getMovementOverride(enemy: EnemyEntity): { vx: number; vy: number } | null {
    const state = this.states.get(enemy.id);
    if (!state || state.phase === 'none') return null;
    if (state.phase !== 'run' || !state.lane) return { vx: 0, vy: 0 };
    const lane = state.lane, cos = Math.cos(lane.angle), sin = Math.sin(lane.angle);
    const dx = enemy.sprite.x - lane.originX, dy = enemy.sprite.y - lane.originY;
    const along = dx * cos + dy * sin, across = -dx * sin + dy * cos;
    const speed = Math.min(this.runSpeed(enemy), Math.max(0, lane.length - along) / NOMINAL_FRAME_S);
    const correction = -across * LANE_CORRECTION_PER_S;
    return { vx: cos * speed - sin * correction, vy: sin * speed + cos * correction };
  }

  getFrontalShield(enemyId: string): EnemyFrontalShieldState | null {
    const state = this.states.get(enemyId);
    if (!state || state.phase !== 'none' || state.enemy.isBurrowed()) return null;
    const config = getCoopDefenseEnemyConfig(state.enemy.kind).shieldCharger;
    // The modelled tower shield carries the form; the arc is only a thin warm rim that flashes on blocks.
    return config ? { facing: state.enemy.getAimAngle(), arcDegrees: config.shieldArcDegrees,
      presentation: state.enemy.faction === 'allied' ? ALLIED_SHIELD_RIM : HOSTILE_SHIELD_RIM } : null;
  }

  forEachFrontalShield(visit: (enemyId: string, shield: EnemyFrontalShieldState) => void): void {
    for (const id of this.states.keys()) {
      const shield = this.getFrontalShield(id);
      if (shield) visit(id, shield);
    }
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

  private step(state: ChargerState, config: CoopDefenseEnemyShieldChargerConfig, now: number): void {
    const enemy = state.enemy;
    const stunned = this.ports.combat.isStunned?.(enemy.id, now) ?? false;
    if ((state.phase === 'windup' || state.phase === 'run') && (stunned || enemy.isBurrowed())) {
      this.cancel(state, config, now);
    } else if (state.phase === 'windup') {
      const lane = state.lane!;
      if (Math.hypot(enemy.sprite.x - lane.originX, enemy.sprite.y - lane.originY) > config.windupDisplacementCancelPx) {
        // Origin and telegraph would no longer match the body.
        this.cancel(state, config, now);
      } else if (now >= lane.runAt) {
        state.struck.clear();
        state.lastX = enemy.sprite.x; state.lastY = enemy.sprite.y;
        state.cooldownUntil = lane.runAt + config.cooldownMs;
        enemy.setKnockbackImmune(true);
        this.publish(state, 'run', lane);
      }
    } else if (state.phase === 'run') {
      this.runStep(state, config, now);
    } else if (state.phase === 'recover') {
      if (now >= state.lane!.recoverUntil) {
        this.publish(state, 'none', null);
      }
    } else if (!stunned && !enemy.isBurrowed() && now >= state.cooldownUntil && now >= state.lockoutUntil
      && !enemy.isAttackMovementPaused(now)) {
      this.tryStart(state, config, now);
    }
  }

  private tryStart(state: ChargerState, config: CoopDefenseEnemyShieldChargerConfig, now: number): void {
    const enemy = state.enemy;
    const target = this.ports.readTarget(enemy);
    if (!target) return;
    const dx = target.x - enemy.sprite.x, dy = target.y - enemy.sprite.y, distance = Math.hypot(dx, dy);
    if (distance < config.triggerMinDistancePx || distance > config.triggerMaxDistancePx) return;
    const facing = enemy.getAimAngle();
    const misalignment = Math.abs(Math.atan2(Math.sin(Math.atan2(dy, dx) - facing), Math.cos(Math.atan2(dy, dx) - facing)));
    // No instant turn at the start: the lane is the current facing, aimed closely enough.
    if (misalignment > config.alignToleranceDegrees * Math.PI / 180) return;
    const radius = enemy.getCollisionRadius();
    if (!this.ports.combat.hasClearLineOfFire(enemy.sprite.x, enemy.sprite.y, target.x, target.y,
      { purpose: 'physical', clearanceRadius: radius })) return;
    const wanted = Math.min(config.maxRunPx, distance + config.overshootPx);
    const length = Math.min(wanted, this.ports.laneClearance(enemy.sprite.x, enemy.sprite.y, facing, wanted, radius));
    // A lane that cannot even reach the target is a blocked start, not a short charge.
    if (length < distance) return;
    const runMs = length / this.runSpeed(enemy) * 1000;
    const runAt = now + config.windupMs;
    const lane: ShieldChargeLane = { originX: enemy.sprite.x, originY: enemy.sprite.y, angle: facing, length,
      halfWidth: radius, startedAt: now, runAt, runEndsAt: runAt + runMs, recoverUntil: runAt + runMs + config.recoverMs };
    enemy.stopMovement();
    this.publish(state, 'windup', lane);
  }

  private runStep(state: ChargerState, config: CoopDefenseEnemyShieldChargerConfig, now: number): void {
    const enemy = state.enemy, lane = state.lane!;
    this.strikeSwept(state, config, now);
    const cos = Math.cos(lane.angle), sin = Math.sin(lane.angle);
    const along = (enemy.sprite.x - lane.originX) * cos + (enemy.sprite.y - lane.originY) * sin;
    const moved = Math.hypot(enemy.sprite.x - state.lastX, enemy.sprite.y - state.lastY);
    state.lastX = enemy.sprite.x; state.lastY = enemy.sprite.y;
    const arrived = along >= lane.length - ARRIVAL_EPSILON_PX;
    // A body stopped by geometry the lane did not know about ends the run early, never later.
    const stalled = now > lane.runAt + 120 && moved < 0.5;
    if (!arrived && !stalled && now < lane.runEndsAt + 250) return;
    const travelled = Math.max(0, Math.min(lane.length, along));
    const ended: ShieldChargeLane = travelled < lane.length - ARRIVAL_EPSILON_PX
      ? { ...lane, length: travelled, runEndsAt: now, recoverUntil: now + config.recoverMs }
      : { ...lane, runEndsAt: Math.min(lane.runEndsAt, now), recoverUntil: Math.min(lane.runEndsAt, now) + config.recoverMs };
    enemy.setKnockbackImmune(false);
    enemy.stopMovement();
    this.publish(state, 'recover', ended);
  }

  /** Swept capsule from the last to the current position; one strike per target and charge. */
  private strikeSwept(state: ChargerState, config: CoopDefenseEnemyShieldChargerConfig, now: number): void {
    const enemy = state.enemy, lane = state.lane!;
    const ax = state.lastX, ay = state.lastY, bx = enemy.sprite.x, by = enemy.sprite.y;
    const radius = enemy.getCollisionRadius();
    for (const target of this.ports.contactTargets(enemy)) {
      if (state.struck.has(target.id)) continue;
      const closest = closestOnSegment(ax, ay, bx, by, target.x, target.y);
      if (Math.hypot(target.x - closest.x, target.y - closest.y) > radius + target.radius) continue;
      state.struck.add(target.id);
      this.ports.strike(target.id, enemy.id, config.hitDamage, closest.x, closest.y, now);
      // Pushed aside and slightly forward: the charger passes, the target is not carried along.
      let sx = target.x - closest.x, sy = target.y - closest.y;
      const side = Math.hypot(sx, sy);
      if (side < 1e-3) { sx = -Math.sin(lane.angle); sy = Math.cos(lane.angle); } else { sx /= side; sy /= side; }
      const kx = sx * 0.85 + Math.cos(lane.angle) * 0.5, ky = sy * 0.85 + Math.sin(lane.angle) * 0.5;
      const norm = Math.hypot(kx, ky) || 1;
      this.ports.knockback(target.id, kx / norm * config.hitKnockbackSpeed, ky / norm * config.hitKnockbackSpeed,
        config.hitKnockbackMs, enemy.id);
    }
  }

  private cancel(state: ChargerState, config: CoopDefenseEnemyShieldChargerConfig, now: number): void {
    const lane = state.lane;
    state.enemy.setKnockbackImmune(false);
    state.lockoutUntil = now + config.cancelLockoutMs;
    if (!lane) { this.publish(state, 'none', null); return; }
    const along = state.phase === 'run'
      ? Math.max(0, (state.enemy.sprite.x - lane.originX) * Math.cos(lane.angle) + (state.enemy.sprite.y - lane.originY) * Math.sin(lane.angle))
      : 0;
    this.publish(state, 'recover', { ...lane, length: Math.min(lane.length, along), runAt: Math.min(lane.runAt, now),
      runEndsAt: now, recoverUntil: now + config.recoverMs, startedAt: Math.min(lane.startedAt, now) });
  }

  private publish(state: ChargerState, phase: ShieldChargePhase, lane: ShieldChargeLane | null): void {
    state.phase = phase;
    state.lane = lane;
    state.revision = Math.max(state.revision, state.enemy.getShieldChargeState().revision) + 1;
    state.enemy.applyShieldChargeState({ revision: state.revision, phase, lane: phase === 'none' ? null : lane });
  }

  private release(state: ChargerState): void {
    state.enemy.setKnockbackImmune(false);
    if (state.phase !== 'none' && state.enemy.sprite.active) this.publish(state, 'none', null);
  }

  private runSpeed(enemy: EnemyEntity): number {
    return getCoopDefenseEnemyConfig(enemy.kind).shieldCharger?.runSpeedPx ?? 0;
  }
}

function closestOnSegment(ax: number, ay: number, bx: number, by: number, px: number, py: number): Point {
  const dx = bx - ax, dy = by - ay, lengthSq = dx * dx + dy * dy;
  const t = lengthSq <= 1e-9 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return { x: ax + dx * t, y: ay + dy * t };
}
