import { getCoopDefenseEnemyConfig, resolveFirestarterAim, type CoopDefenseEnemyFirestarterConfig } from '../config/coopDefenseEnemies';
import { VOID_PALETTE } from '../config';
import type { CombatActorStatePort, CombatGeometryPort } from '../combat/CombatCapabilities';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager, EnemySpecialMovementSource } from '../entities/EnemyManager';
import { findWeaponConfig, type WeaponConfig } from '../loadout/LoadoutConfig';
import type { ProjectileDetonableReadPort } from '../projectile/ProjectileGameplayPort';
import type { AutomatedWeaponExecution } from '../world/AutomatedWeaponExecutionAdapter';
import type { EnemyAiTargetCatalog } from './EnemyAiTargetCatalog';
import { resolveEnemyWeaponFirePayloads } from './AlliedEnemyEffects';
import { RechargeableCharges } from './RechargeableCharges';
import type { EnemyDodgeRequestPort } from './CoopDefenseEnemyDodgeSystem';
import { FirestarterPositioning, findFirestarterCombo, hasFirestarterDirectLine } from './firestarterPositioning';

interface Point { readonly x: number; readonly y: number }
interface FirestarterState {
  readonly enemy: EnemyEntity;
  readonly charges: RechargeableCharges;
  readonly positioning: FirestarterPositioning;
  lance: { readonly target: Point; readonly startedAt: number; readonly endsAt: number; readonly commitAt: number } | null;
  lanceReadyAt: number;
  ballReadyAt: number;
  lastAttack: 'ball' | 'lance' | null;
  lastAttackAt: number;
  actedAt: number;
  committed: boolean;
}

/** Activity-owned host decisions. Weapons, detonation and fire retain their shared owners. */
export class CoopDefenseFirestarterSystem implements EnemySpecialMovementSource {
  private readonly states = new Map<string, FirestarterState>();
  private nowMs = 0;

  constructor(
    private readonly enemies: Pick<EnemyManager, 'getAllEnemies'>,
    private readonly combat: Pick<CombatGeometryPort, 'hasClearLineOfFire'> & Pick<CombatActorStatePort, 'isStunned'>,
    private readonly weapons: AutomatedWeaponExecution,
    private readonly projectiles: ProjectileDetonableReadPort,
    private readonly targets: Pick<EnemyAiTargetCatalog, 'getCandidates' | 'getPosition'>,
    private readonly dodge?: EnemyDodgeRequestPort,
  ) {}

  hostUpdate(nowMs: number): void {
    this.nowMs = nowMs;
    const live = new Set<string>();
    for (const enemy of this.enemies.getAllEnemies()) {
      const config = getCoopDefenseEnemyConfig(enemy.kind).firestarter;
      // Gate 1: conversion cancels any pending hostile attack, and allies keep their regular bite.
      if (!config || enemy.faction !== 'hostile' || !enemy.sprite.active || enemy.getHp() <= 0) continue;
      live.add(enemy.id);
      let state = this.states.get(enemy.id);
      if (!state || state.enemy !== enemy) {
        state = { enemy, positioning: new FirestarterPositioning(), charges: new RechargeableCharges({ ...config.charges, rechargeMode: 'restart-on-consume' }, nowMs),
          lance: null, lanceReadyAt: nowMs, ballReadyAt: nowMs, lastAttack: null, lastAttackAt: -Infinity,
          actedAt: -Infinity, committed: false };
        this.states.set(enemy.id, state);
      }
      state.charges.getAvailableCharges(nowMs);
      if (state.actedAt === nowMs) continue;
      state.committed = false;
      if (this.combat.isStunned?.(enemy.id, nowMs) || enemy.isBurrowed()) {
        this.cancelLance(state);
        continue;
      }
      if (state.lance) {
        state.committed = nowMs >= state.lance.commitAt;
        this.present(state, nowMs);
        if (nowMs < state.lance.endsAt) continue;
        const target = state.lance.target;
        this.cancelLance(state);
        // Geometry can change during the telegraph; the real weapon trace resolves new blockers.
        if (this.fire(enemy, config, findWeaponConfig(config.lanceWeaponId)!, target)) {
          state.lastAttack = 'lance'; state.lastAttackAt = nowMs;
        }
        state.lanceReadyAt = nowMs + config.lance.cooldownMs;
        state.actedAt = nowMs;
        continue;
      }
      if (enemy.isAttackMovementPaused(nowMs)) continue;
      const players = this.targets.getCandidates('players').flatMap(target => {
        const point = this.targets.getPosition(target, enemy.sprite.x, enemy.sprite.y);
        return point ? [point] : [];
      }).sort((a, b) => distance(enemy.sprite, a) - distance(enemy.sprite, b));
      if (!players.length) continue;
      // A queued or active step finishes before choosing a new offensive world point.
      if (this.dodge && (this.dodge.isDodging(enemy.id)
        || state.positioning.tryReposition(enemy, players, config, this.projectiles, this.combat, this.dodge, nowMs))) continue;
      if (nowMs >= state.lanceReadyAt && this.crossGapReady(state, 'lance', config, nowMs)) {
        const target = this.findCombo(enemy, config, players)
          ?? players.find(point => distance(enemy.sprite, point) <= config.lance.rangePx
            && hasFirestarterDirectLine(enemy.id, enemy.sprite, point, config, this.projectiles, this.combat));
        if (target) {
          state.lance = { target: { ...target }, startedAt: nowMs, endsAt: nowMs + config.lance.telegraphMs,
            commitAt: nowMs + config.lance.telegraphMs - config.lance.commitMs };
          state.committed = config.lance.commitMs === config.lance.telegraphMs;
          state.actedAt = nowMs;
          this.present(state, nowMs);
          continue;
        }
      }
      if (nowMs < state.ballReadyAt || !this.crossGapReady(state, 'ball', config, nowMs) || !state.charges.canConsume(nowMs)) continue;
      const ball = findWeaponConfig(config.fireballWeaponId)!;
      // A ball is a body: tight cover that passes a hairline still eats it, so test its own corridor.
      const clearance = (ball.fire.type === 'projectile' ? ball.fire.projectileSize : 0) / 2;
      const target = players.find(point => distance(enemy.sprite, point) <= ball.range && this.hasLine(enemy, config, point, clearance));
      if (!target || !this.fire(enemy, config, ball, target)) continue;
      state.charges.consume(nowMs);
      state.ballReadyAt = nowMs + config.fireballIntervalMs;
      state.lastAttack = 'ball'; state.lastAttackAt = nowMs; state.actedAt = nowMs;
    }
    for (const [id, state] of this.states) if (!live.has(id)) { this.cancelLance(state); this.states.delete(id); }
  }

  /** Reproject the fixed world point after ordinary movement; no target decisions here. */
  refreshPresentation(nowMs: number): void {
    for (const state of this.states.values()) if (state.lance) this.present(state, nowMs);
  }

  blocksRegularAttacks(enemyId: string): boolean {
    const state = this.states.get(enemyId);
    return !!state && (state.lance !== null || state.actedAt === this.nowMs);
  }

  blocksDodge(enemyId: string): boolean { return this.states.get(enemyId)?.committed ?? false; }

  getMovementOverride(enemy: EnemyEntity): { vx: number; vy: number } | null {
    return this.blocksDodge(enemy.id) ? { vx: 0, vy: 0 } : null;
  }

  getChargeSnapshot(enemyId: string, nowMs: number) { return this.states.get(enemyId)?.charges.getSnapshot(nowMs) ?? null; }

  handleKilled(death: { readonly id: string }): void {
    const state = this.states.get(death.id);
    if (state) this.cancelLance(state);
    this.states.delete(death.id);
  }

  clear(): void {
    for (const state of this.states.values()) this.cancelLance(state);
    this.states.clear();
  }

  private crossGapReady(state: FirestarterState, attack: 'ball' | 'lance', config: CoopDefenseEnemyFirestarterConfig, now: number): boolean {
    return state.lastAttack === attack || now - state.lastAttackAt >= config.crossAttackGapMs;
  }

  private findCombo(enemy: EnemyEntity, config: CoopDefenseEnemyFirestarterConfig, players: readonly Point[]): Point | null {
    return findFirestarterCombo(enemy.id, enemy.sprite, players, config, this.projectiles, this.combat);
  }

  private hasLine(enemy: EnemyEntity, config: CoopDefenseEnemyFirestarterConfig, point: Point, clearanceRadius = 0): boolean {
    const aim = resolveFirestarterAim(config.muzzle, enemy.sprite.x, enemy.sprite.y, point.x, point.y);
    return this.combat.hasClearLineOfFire(aim.x, aim.y, point.x, point.y, { purpose: 'directFire', clearanceRadius });
  }

  /** Both attacks leave the lance tip; the lance and its telegraph share this aim. */
  private fire(enemy: EnemyEntity, config: CoopDefenseEnemyFirestarterConfig, weapon: WeaponConfig, target: Point): boolean {
    const aim = resolveFirestarterAim(config.muzzle, enemy.sprite.x, enemy.sprite.y, target.x, target.y);
    enemy.faceAngle(aim.angle);
    return this.weapons.fire(resolveEnemyWeaponFirePayloads(weapon, enemy.faction), {
      x: enemy.sprite.x, y: enemy.sprite.y, angle: aim.angle, targetX: target.x, targetY: target.y,
      ownerId: enemy.id, ownerColor: VOID_PALETTE.primary,
      gameplayMuzzleOrigin: { x: aim.x, y: aim.y }, visualMuzzleOrigin: { x: aim.x, y: aim.y },
    });
  }

  private present(state: FirestarterState, now: number): void {
    const lance = state.lance!;
    const muzzle = getCoopDefenseEnemyConfig(state.enemy.kind).firestarter!.muzzle;
    const angle = resolveFirestarterAim(muzzle, state.enemy.sprite.x, state.enemy.sprite.y, lance.target.x, lance.target.y).angle;
    state.enemy.faceAngle(angle);
    state.enemy.setSpecialAction('fire-lance-charge', lance.endsAt,
      Math.min(1, (now - lance.startedAt) / (lance.endsAt - lance.startedAt)), angle);
    if (state.committed) state.enemy.stopMovement();
  }

  private cancelLance(state: FirestarterState): void {
    if (state.lance) state.enemy.setSpecialAction('none');
    state.lance = null;
  }
}

function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
