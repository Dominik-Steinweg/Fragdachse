import * as Phaser from 'phaser';
import {
  VOID_FIRE_COLOR,
} from '../config';
import {
  getCoopDefenseEnemyConfig,
  type CoopDefenseVoidHunterBossConfig,
} from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { EnemyManager } from '../entities/EnemyManager';
import type { PlayerManager } from '../entities/PlayerManager';
import { ULTIMATE_CONFIGS, type GaussUltimateConfig } from '../loadout/LoadoutConfig';
import type { PowerUpSystem } from '../powerups/PowerUpSystem';
import type { SyncedNukeStrike } from '../types';
import type { ArmageddonSystem } from './ArmageddonSystem';
import type { CombatSystem } from './CombatSystem';
import type { CoopDefenseEnemyBurrowSystem } from './CoopDefenseEnemyBurrowSystem';
import type { FireChunkBurstPort } from './FlamethrowerUpgradeSystem';
import type { EnemyAiTargetCatalog, EnemyAiTargetRef } from './EnemyAiTargetCatalog';
import { resolveCoopDefenseWorldMetrics, type WorldMetrics } from '../world/WorldMetrics';
import type { AutomatedWeaponExecution } from '../world/AutomatedWeaponExecutionAdapter';

interface GaussChargeState {
  readonly targetRef: EnemyAiTargetRef;
  readonly startedAt: number;
  readonly endsAt: number;
  nextAimUpdateAt: number;
  lastAimUpdateAt: number;
  desiredAngle: number;
  actualAngle: number;
}

interface VoidHunterState {
  readonly spawnAt: number;
  phaseTwo: boolean;
  phaseTransitionEndsAt: number;
  emergeAt: number;
  nextGaussAt: number;
  gauss: GaussChargeState | null;
  armageddonActiveUntil: number;
  nextArmageddonAt: number;
  armageddonPending: boolean;
}

const VOID_HUNTER_GAUSS: GaussUltimateConfig = (() => {
  const config = ULTIMATE_CONFIGS.VOID_HUNTER_GAUSS;
  if (config.type !== 'gauss') throw new Error('VOID_HUNTER_GAUSS muss ein Gauss-Ultimate sein');
  return config;
})();

export interface VoidHunterTargetPoint {
  readonly x: number;
  readonly y: number;
}

/** Arithmetischer Mittelpunkt, einmalig berechnet und auf die spielbare Arena begrenzt. */
export function computeVoidHunterNukeTarget(
  livingPlayerPositions: readonly VoidHunterTargetPoint[],
  fallback: VoidHunterTargetPoint,
  worldMetrics: WorldMetrics = resolveCoopDefenseWorldMetrics(undefined, undefined),
): VoidHunterTargetPoint {
  const source = livingPlayerPositions.length > 0
    ? {
      x: livingPlayerPositions.reduce((sum, point) => sum + point.x, 0) / livingPlayerPositions.length,
      y: livingPlayerPositions.reduce((sum, point) => sum + point.y, 0) / livingPlayerPositions.length,
    }
    : fallback;
  return {
    x: Phaser.Math.Clamp(source.x, worldMetrics.offsetX, worldMetrics.maxX),
    y: Phaser.Math.Clamp(source.y, worldMetrics.offsetY, worldMetrics.maxY),
  };
}

/**
 * Host-autoritärer Ablauf des Leerenjägers. Navigation und normale Waffen bleiben in den
 * allgemeinen Coop-Systemen; nur die phasengebundene Orchestrierung lebt hier.
 */
export class CoopDefenseVoidHunterSystem {
  private readonly states = new Map<string, VoidHunterState>();
  private readonly reachedPhases = new Set<number>();

  constructor(
    private readonly enemyManager: EnemyManager,
    private readonly playerManager: PlayerManager,
    private readonly combatSystem: CombatSystem,
    private readonly weaponExecution: AutomatedWeaponExecution,
    private readonly powerUpSystem: PowerUpSystem,
    private readonly armageddonSystem: ArmageddonSystem,
    private readonly burrowSystem: CoopDefenseEnemyBurrowSystem,
    private readonly fireChunks: FireChunkBurstPort,
    private readonly targetCatalog: EnemyAiTargetCatalog | null = null,
    private readonly onPhaseReached?: (phase: number) => void,
    private readonly worldMetrics: WorldMetrics = resolveCoopDefenseWorldMetrics(undefined, undefined),
  ) {}

  hostUpdate(now: number): void {
    const active = new Set<string>();
    for (const enemy of this.enemyManager.getAllEnemies()) {
      const config = this.getConfig(enemy);
      if (!config || !enemy.sprite.active || enemy.getHp() <= 0) continue;
      active.add(enemy.id);
      const state = this.states.get(enemy.id) ?? this.createState(enemy, config, now);

      if (!state.phaseTwo && enemy.getHp() / enemy.getMaxHp() <= config.phaseTwoHpRatio) {
        this.startPhaseTwo(enemy, state, config, now);
      }

      if (state.phaseTransitionEndsAt > now) {
        enemy.stopMovement();
        enemy.setSpecialAction('phase-nuke', state.emergeAt);
        continue;
      }

      if (state.phaseTwo && state.phaseTransitionEndsAt > 0 && now >= state.emergeAt) {
        state.phaseTransitionEndsAt = 0;
        state.nextArmageddonAt = now;
      }

      if (state.gauss) {
        if (state.phaseTwo && now >= state.nextArmageddonAt) state.armageddonPending = true;
        this.updateGauss(enemy, state, config, now);
        continue;
      }

      if (state.armageddonActiveUntil > 0) {
        if (now < state.armageddonActiveUntil) {
          enemy.setSpecialAction('armageddon', state.armageddonActiveUntil);
          continue;
        }
        this.armageddonSystem.deactivate(enemy.id);
        state.armageddonActiveUntil = 0;
        state.nextArmageddonAt = now + config.armageddonCooldownMs;
        enemy.setSpecialAction('none');
      }

      if (state.phaseTwo && now >= state.nextArmageddonAt) {
        this.startArmageddon(enemy, state, config, now);
        continue;
      }

      if (now >= state.nextGaussAt && this.canStartGauss(enemy, config)) {
        this.startGauss(enemy, state, config, now);
      }
    }

    for (const [enemyId] of this.states) {
      if (active.has(enemyId)) continue;
      this.armageddonSystem.cancel(enemyId);
      this.enemyManager.getEnemy(enemyId)?.setSpecialAction('none');
      this.states.delete(enemyId);
    }
  }

  /** Wird exakt vom Nuke-Explosionscallback aufgerufen; nur hier entstehen die 50 Brandbrocken. */
  notifyNukeExploded(strike: SyncedNukeStrike, now = Date.now()): void {
    if (strike.variant !== 'void') return;
    const state = this.states.get(strike.triggeredBy);
    const enemy = this.enemyManager.getEnemy(strike.triggeredBy);
    const config = enemy ? this.getConfig(enemy) : undefined;
    if (!state || !enemy || !config) return;
    this.fireChunks.hostCreateFireChunkBurst(
      enemy.id,
      strike.x,
      strike.y,
      config.nuke.fireChunkBurst,
      `void-hunter-nuke:${strike.id}`,
      now,
    );
  }

  blocksRegularAttacks(enemyId: string): boolean {
    const state = this.states.get(enemyId);
    return Boolean(state && (state.gauss !== null || state.phaseTransitionEndsAt > 0));
  }

  /** Persistent host-side state query for map encounter triggers. */
  hasReachedPhase(phase: number): boolean {
    return this.reachedPhases.has(phase);
  }

  clear(): void {
    for (const enemyId of this.states.keys()) {
      this.armageddonSystem.cancel(enemyId);
      this.enemyManager.getEnemy(enemyId)?.setSpecialAction('none');
    }
    this.states.clear();
    this.reachedPhases.clear();
  }

  private createState(
    enemy: EnemyEntity,
    config: CoopDefenseVoidHunterBossConfig,
    now: number,
  ): VoidHunterState {
    const state: VoidHunterState = {
      spawnAt: now,
      phaseTwo: false,
      phaseTransitionEndsAt: 0,
      emergeAt: 0,
      nextGaussAt: now + config.gauss.initialDelayMs,
      gauss: null,
      armageddonActiveUntil: 0,
      nextArmageddonAt: Number.POSITIVE_INFINITY,
      armageddonPending: false,
    };
    this.states.set(enemy.id, state);
    return state;
  }

  private startPhaseTwo(
    enemy: EnemyEntity,
    state: VoidHunterState,
    config: CoopDefenseVoidHunterBossConfig,
    now: number,
  ): void {
    state.phaseTwo = true;
    this.reachedPhases.add(2);
    this.onPhaseReached?.(2);
    enemy.setMoveSpeedMultiplier(config.phaseTwoSpeedMultiplier);

    const positions = this.playerManager.getAllPlayers()
      .filter((player) => player.active && this.combatSystem.isAlive(player.id))
      .map((player) => ({ x: player.x, y: player.y }));
    const target = computeVoidHunterNukeTarget(positions, {
      x: enemy.sprite.x,
      y: enemy.sprite.y,
    }, this.worldMetrics);
    state.emergeAt = now + config.nuke.countdownMs + config.nuke.emergeDelayMs;
    state.phaseTransitionEndsAt = state.emergeAt;
    enemy.stopMovement();
    enemy.setSpecialAction('phase-nuke', state.emergeAt);
    this.burrowSystem.startScriptedBurrow(enemy.id, state.emergeAt);
    this.powerUpSystem.scheduleConfiguredNukeStrike(enemy.id, target.x, target.y, {
      countdownMs: config.nuke.countdownMs,
      radius: config.nuke.radiusPx,
      maxDamage: config.nuke.maxDamage,
      minDamage: config.nuke.minDamage,
      allowTeamDamage: true,
      damageTarget: 'player-side',
      damageOwnerId: `void-nuke:${enemy.id}`,
      sourceId: 'enemy.void_hunter.nuke',
      variant: 'void',
    }, now);
  }

  private canStartGauss(enemy: EnemyEntity, config: CoopDefenseVoidHunterBossConfig): boolean {
    let hasTarget = false;
    const checkTarget = (x: number, y: number): boolean => {
      const distance = Phaser.Math.Distance.Between(enemy.sprite.x, enemy.sprite.y, x, y);
      if (distance <= config.shotgunRangePx) return true;
      if (distance <= VOID_HUNTER_GAUSS.range
        && this.combatSystem.hasLineOfSight(enemy.sprite.x, enemy.sprite.y, x, y)) hasTarget = true;
      return false;
    };
    if (this.targetCatalog) {
      let tooClose = false;
      this.targetCatalog.forEachTarget('player-like', (target) => {
        const position = target.resolvePosition?.(enemy.sprite.x, enemy.sprite.y) ?? { x: target.x, y: target.y };
        if (checkTarget(position.x, position.y)) tooClose = true;
      });
      if (tooClose) return false;
    } else {
      for (const player of this.playerManager.getAllPlayers()) {
        if (!player.active || !this.combatSystem.isAlive(player.id)) continue;
        if (!this.combatSystem.canDamageTarget(enemy.id, player.id)) continue;
        if (checkTarget(player.x, player.y)) return false;
      }
    }
    for (const ally of this.enemyManager.getAllEnemies()) {
      if (ally.faction !== 'allied' || !ally.sprite.active || ally.getHp() <= 0) continue;
      if (!this.combatSystem.canDamageTarget(enemy.id, ally.id)) continue;
      if (Phaser.Math.Distance.Between(
        enemy.sprite.x,
        enemy.sprite.y,
        ally.sprite.x,
        ally.sprite.y,
      ) <= config.shotgunRangePx) return false;
    }
    return hasTarget;
  }

  private startGauss(
    enemy: EnemyEntity,
    state: VoidHunterState,
    config: CoopDefenseVoidHunterBossConfig,
    now: number,
  ): void {
    const target = this.findGaussTarget(enemy);
    if (!target) return;
    state.gauss = {
      targetRef: target.ref,
      startedAt: now,
      endsAt: now + config.gauss.chargeDurationMs,
      nextAimUpdateAt: now + config.gauss.aimUpdateIntervalMs,
      lastAimUpdateAt: now,
      desiredAngle: Phaser.Math.Angle.Between(
        enemy.sprite.x,
        enemy.sprite.y,
        target.x,
        target.y,
      ),
      actualAngle: enemy.getAimAngle(),
    };
    enemy.stopMovement();
    enemy.setSpecialAction('gauss-charge', state.gauss.endsAt, 0, state.gauss.actualAngle);
  }

  private updateGauss(
    enemy: EnemyEntity,
    state: VoidHunterState,
    config: CoopDefenseVoidHunterBossConfig,
    now: number,
  ): void {
    const gauss = state.gauss;
    if (!gauss) return;
    enemy.stopMovement();

    if (now >= gauss.nextAimUpdateAt) {
      const targetPosition = this.targetCatalog?.getPosition(gauss.targetRef, enemy.sprite.x, enemy.sprite.y)
        ?? (() => {
          if (gauss.targetRef.kind !== 'player') return null;
          const target = this.playerManager.getPlayer(gauss.targetRef.id);
          return target?.active && this.combatSystem.isAlive(target.id)
            ? { x: target.x, y: target.y }
            : null;
        })();
      if (targetPosition) {
        gauss.desiredAngle = Phaser.Math.Angle.Between(
          enemy.sprite.x,
          enemy.sprite.y,
          targetPosition.x,
          targetPosition.y,
        );
      } else {
        state.gauss = null;
        state.nextGaussAt = now + config.gauss.cooldownMs;
        enemy.setSpecialAction('none');
        return;
      }
      gauss.nextAimUpdateAt = now + config.gauss.aimUpdateIntervalMs;
    }

    // Das Ziel bleibt absichtlich nur im konfigurierten Takt abgetastet. Der tatsaechliche
    // Warnstreifen dreht sich jedoch in jedem Host-Update mit unveraenderter Maximalrate weiter:
    // sichtbar fluessiger, ohne zusaetzliche Zielinformation oder hoehere Genauigkeit.
    const elapsedSeconds = Math.max(0, now - gauss.lastAimUpdateAt) / 1000;
    const maxStep = Phaser.Math.DegToRad(config.gauss.maxAimTurnDegreesPerSecond) * elapsedSeconds;
    const difference = Phaser.Math.Angle.Wrap(gauss.desiredAngle - gauss.actualAngle);
    gauss.actualAngle = Phaser.Math.Angle.Wrap(
      gauss.actualAngle + Phaser.Math.Clamp(difference, -maxStep, maxStep),
    );
    gauss.lastAimUpdateAt = now;

    enemy.faceAngle(gauss.actualAngle);
    const progress = Phaser.Math.Clamp(
      (now - gauss.startedAt) / config.gauss.chargeDurationMs,
      0,
      1,
    );
    enemy.setSpecialAction('gauss-charge', gauss.endsAt, progress, gauss.actualAngle);
    if (now < gauss.endsAt) return;

    this.weaponExecution.fireGauss(VOID_HUNTER_GAUSS, {
      x: enemy.sprite.x,
      y: enemy.sprite.y,
      angle: gauss.actualAngle,
      ownerId: enemy.id,
      ownerColor: VOID_FIRE_COLOR,
    });
    state.gauss = null;
    state.nextGaussAt = now + config.gauss.cooldownMs;
    enemy.setSpecialAction('none');

    if (state.armageddonPending) {
      state.armageddonPending = false;
      this.startArmageddon(enemy, state, config, now);
    }
  }

  private startArmageddon(
    enemy: EnemyEntity,
    state: VoidHunterState,
    config: CoopDefenseVoidHunterBossConfig,
    now: number,
  ): void {
    state.armageddonActiveUntil = now + config.armageddonDurationMs;
    state.nextArmageddonAt = Number.POSITIVE_INFINITY;
    this.armageddonSystem.activate(enemy.id, config.armageddon, () => {
      const target = this.findGaussTarget(enemy);
      return target ? { x: target.x, y: target.y } : null;
    });
    enemy.setSpecialAction('armageddon', state.armageddonActiveUntil);
  }

  private findGaussTarget(enemy: EnemyEntity) {
    let best: { ref: EnemyAiTargetRef; x: number; y: number; distanceSq: number } | null = null;
    if (this.targetCatalog) {
      this.targetCatalog.forEachTarget('player-like', (target) => {
        const position = target.resolvePosition?.(enemy.sprite.x, enemy.sprite.y) ?? { x: target.x, y: target.y };
        const distanceSq = Phaser.Math.Distance.Squared(enemy.sprite.x, enemy.sprite.y, position.x, position.y);
        if (!best || distanceSq < best.distanceSq) {
          best = { ref: { kind: target.kind, id: target.id }, x: position.x, y: position.y, distanceSq };
        }
      });
      return best;
    }
    for (const player of this.playerManager.getAllPlayers()) {
      if (!player.active || !this.combatSystem.isAlive(player.id) || !this.combatSystem.canDamageTarget(enemy.id, player.id)) continue;
      const distanceSq = Phaser.Math.Distance.Squared(enemy.sprite.x, enemy.sprite.y, player.x, player.y);
      if (!best || distanceSq < best.distanceSq) {
        best = { ref: { kind: 'player', id: player.id }, x: player.x, y: player.y, distanceSq };
      }
    }
    return best;
  }

  private getConfig(enemy: EnemyEntity): CoopDefenseVoidHunterBossConfig | undefined {
    if (enemy.faction !== 'hostile') return undefined;
    return getCoopDefenseEnemyConfig(enemy.kind).voidHunterBoss;
  }
}
