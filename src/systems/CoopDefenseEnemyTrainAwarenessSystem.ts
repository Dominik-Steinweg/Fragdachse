import type { CoopDefenseEnemyTrainAwarenessConfig } from '../config/coopDefenseEnemies';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { TrainEventConfig } from '../types';
import { TRAIN } from '../train/TrainConfig';
import type { TrainManager } from '../train/TrainManager';

type TrainAwarenessMode = 'normal' | 'approaching' | 'waiting' | 'crossing' | 'escaping';

interface EnemyTrainAwarenessState {
  mode: TrainAwarenessMode;
  crossingDirection?: -1 | 1;
}

export interface EnemyTrainMovementDecision {
  readonly vx: number;
  readonly vy: number;
  readonly override: boolean;
}

/** Vorausschauende, pro Gegnerart konfigurierbare Gleis- und Zug-KI. */
export class CoopDefenseEnemyTrainAwarenessSystem {
  private readonly states = new Map<string, EnemyTrainAwarenessState>();

  constructor(
    private readonly getTrainManager: () => TrainManager | null,
    private readonly getTrainEvent: () => TrainEventConfig | undefined,
    private readonly getEffectiveMoveSpeed: (enemy: EnemyEntity, now: number) => number,
  ) {}

  resolveMovement(
    enemy: EnemyEntity,
    intendedVx: number,
    intendedVy: number,
    now: number,
  ): EnemyTrainMovementDecision {
    const config = getCoopDefenseEnemyConfig(enemy.kind).trainAwareness;
    const train = this.getTrainManager();
    const trainEvent = this.getTrainEvent();
    if (!config || !train || !trainEvent || train.isDestroyed()) {
      this.states.delete(enemy.id);
      return { vx: intendedVx, vy: intendedVy, override: false };
    }

    const radius = enemy.getCollisionRadius();
    const safeOffset = TRAIN.VISUAL_WIDTH * 0.5 + radius + config.safetyDistancePx;
    const trackX = train.getTrackX();
    const leftSafeX = trackX - safeOffset;
    const rightSafeX = trackX + safeOffset;
    const x = enemy.sprite.x;
    const movementSpeed = enemy.getMoveSpeed();
    const effectiveSpeed = Math.max(1, this.getEffectiveMoveSpeed(enemy, now));
    const hazard = train.getCrossingHazardWindowAt(enemy.sprite.y, radius, now, trainEvent.spawnAt);
    if (!hazard) {
      this.states.delete(enemy.id);
      return { vx: intendedVx, vy: intendedVy, override: false };
    }

    const state = this.states.get(enemy.id) ?? { mode: 'normal' as const };
    this.states.set(enemy.id, state);

    if (x <= leftSafeX) {
      if (state.crossingDirection === -1) this.resetState(state);
      if (intendedVx <= 0) {
        this.resetState(state);
        return { vx: intendedVx, vy: intendedVy, override: false };
      }
      return this.resolveBeforeCrossing(
        state, config, x, leftSafeX, rightSafeX, 1, movementSpeed, effectiveSpeed,
        hazard.startsAt, hazard.endsAt, now,
        intendedVx, intendedVy,
      );
    }

    if (x >= rightSafeX) {
      if (state.crossingDirection === 1) this.resetState(state);
      if (intendedVx >= 0) {
        this.resetState(state);
        return { vx: intendedVx, vy: intendedVy, override: false };
      }
      return this.resolveBeforeCrossing(
        state, config, x, rightSafeX, leftSafeX, -1, movementSpeed, effectiveSpeed,
        hazard.startsAt, hazard.endsAt, now,
        intendedVx, intendedVy,
      );
    }

    const intendedDirection = state.crossingDirection
      ?? (Math.abs(intendedVx) > 0.01 ? (intendedVx > 0 ? 1 : -1) : (x < trackX ? 1 : -1));
    const intendedExitX = intendedDirection === 1 ? rightSafeX : leftSafeX;
    const remainingCrossingMs = Math.abs(intendedExitX - x) / effectiveSpeed * 1000;
    if (this.canClearBeforeHazard(config, remainingCrossingMs, hazard.startsAt, hazard.endsAt, now)) {
      state.mode = 'crossing';
      state.crossingDirection = intendedDirection;
      return { vx: intendedDirection * movementSpeed, vy: 0, override: true };
    }

    const leftDistance = Math.abs(x - leftSafeX);
    const rightDistance = Math.abs(rightSafeX - x);
    const escapeDirection: -1 | 1 = leftDistance <= rightDistance ? -1 : 1;
    state.mode = 'escaping';
    state.crossingDirection = escapeDirection;
    return { vx: escapeDirection * movementSpeed, vy: 0, override: true };
  }

  blocksRegularAttacks(enemyId: string): boolean {
    const mode = this.states.get(enemyId)?.mode;
    return mode === 'crossing' || mode === 'escaping';
  }

  getTrainAttackTarget(enemy: EnemyEntity): { x: number; y: number; distance: number } | null {
    if (this.states.get(enemy.id)?.mode !== 'waiting') return null;
    return this.getTrainManager()?.getNearestAttackPoint(enemy.sprite.x, enemy.sprite.y) ?? null;
  }

  clear(): void {
    this.states.clear();
  }

  private resolveBeforeCrossing(
    state: EnemyTrainAwarenessState,
    config: CoopDefenseEnemyTrainAwarenessConfig,
    x: number,
    entryX: number,
    exitX: number,
    direction: -1 | 1,
    movementSpeed: number,
    effectiveSpeed: number,
    hazardStartsAt: number,
    hazardEndsAt: number,
    now: number,
    intendedVx: number,
    intendedVy: number,
  ): EnemyTrainMovementDecision {
    const crossingMs = Math.abs(exitX - entryX) / effectiveSpeed * 1000;
    const canCross = this.canClearBeforeHazard(config, crossingMs, hazardStartsAt, hazardEndsAt, now);
    const distanceToEntry = Math.abs(entryX - x);

    if (canCross && distanceToEntry <= 3) {
      state.mode = 'crossing';
      state.crossingDirection = direction;
      return { vx: direction * movementSpeed, vy: 0, override: true };
    }
    if (canCross) {
      this.resetState(state);
      return { vx: intendedVx, vy: intendedVy, override: false };
    }

    state.crossingDirection = undefined;
    const approachCaptureDistance = Math.max(8, config.safetyDistancePx);
    if (distanceToEntry > approachCaptureDistance) {
      state.mode = 'normal';
      return { vx: intendedVx, vy: intendedVy, override: false };
    }
    if (distanceToEntry <= 1) {
      state.mode = 'waiting';
      return { vx: 0, vy: 0, override: true };
    }

    state.mode = 'approaching';
    return {
      vx: direction * Math.min(movementSpeed, distanceToEntry * 8),
      vy: 0,
      override: true,
    };
  }

  private canClearBeforeHazard(
    config: CoopDefenseEnemyTrainAwarenessConfig,
    travelMs: number,
    hazardStartsAt: number,
    hazardEndsAt: number,
    now: number,
  ): boolean {
    const margin = config.timeSafetyMarginMs;
    return now > hazardEndsAt + margin
      || now + travelMs + margin < hazardStartsAt;
  }

  private resetState(state: EnemyTrainAwarenessState): void {
    state.mode = 'normal';
    state.crossingDirection = undefined;
  }
}
