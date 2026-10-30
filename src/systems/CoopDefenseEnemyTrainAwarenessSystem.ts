import type { CoopDefenseEnemyTrainAwarenessConfig } from '../config/coopDefenseEnemies';
import { getCoopDefenseEnemyConfig } from '../config/coopDefenseEnemies';
import type { EnemyEntity } from '../entities/EnemyEntity';
import type { TrainEventConfig } from '../types';
import { TRAIN } from '../train/TrainConfig';
export interface TrainAwarenessSource {
  readonly isDestroyed: () => boolean;
  readonly getTrackX: () => number;
  readonly getCrossingHazardWindowAt: (
    worldY: number,
    actorRadius: number,
    now: number,
    spawnAt: number,
  ) => { readonly startsAt: number; readonly endsAt: number } | null;
  readonly getNearestAttackPoint: (
    fromX: number,
    fromY: number,
  ) => { readonly x: number; readonly y: number; readonly distance: number } | null;
}

type TrainAwarenessMode = 'normal' | 'approaching' | 'waiting' | 'crossing' | 'escaping';

/** A crossing or escape that has not moved the body sideways this long is pinned by geometry. */
const PINNED_AFTER_MS = 700;
/** Sideways progress that counts as moving across the track. */
const PINNED_PROGRESS_PX = 6;

interface EnemyTrainAwarenessState {
  mode: TrainAwarenessMode;
  crossingDirection?: -1 | 1;
  /** Where and when the current crossing/escape last made sideways progress. */
  progressX?: number;
  progressAt?: number;
  pinned?: boolean;
}

export interface EnemyTrainMovementDecision {
  readonly vx: number;
  readonly vy: number;
  readonly override: boolean;
}

/**
 * Gegner, die sich statt zu warten unter den Gleisen durchgraben können.
 * Liefert true, solange das Einbuddeln deshalb aktiv ist.
 */
export interface TrainCrossingBurrowSource {
  requestTrainCrossingBurrow(enemyId: string, now: number): boolean;
}

/**
 * Vorausschauende, pro Gegnerart konfigurierbare Gleis- und Zug-KI.
 *
 * Alle Quermanöver steuern ausschließlich die X-Achse: Gefahr und Räumzeit hängen allein davon ab,
 * wie schnell der Gegner den Gleisbereich seitlich verlässt. Die Y-Komponente der Wegfindung wird
 * deshalb unverändert durchgereicht. Sie zu nullen wäre auf offenem Feld unauffällig, sperrt den
 * Gegner aber in einem von Felsen gesäumten Gleisabschnitt fest: Er drückt dann seitlich gegen
 * den Stein und darf nicht mehr längs des Gleises ausweichen.
 */
export class CoopDefenseEnemyTrainAwarenessSystem {
  private readonly states = new Map<string, EnemyTrainAwarenessState>();
  private burrowSource: TrainCrossingBurrowSource | null = null;

  constructor(
    private readonly getTrainManager: () => TrainAwarenessSource | null,
    private readonly getTrainEvent: () => TrainEventConfig | undefined,
    private readonly getEffectiveMoveSpeed: (enemy: EnemyEntity, now: number) => number,
  ) {}

  setBurrowSource(source: TrainCrossingBurrowSource | null): void {
    this.burrowSource = source;
  }

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
        enemy, state, config, x, leftSafeX, rightSafeX, 1, movementSpeed, effectiveSpeed,
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
        enemy, state, config, x, rightSafeX, leftSafeX, -1, movementSpeed, effectiveSpeed,
        hazard.startsAt, hazard.endsAt, now,
        intendedVx, intendedVy,
      );
    }

    const intendedDirection = state.crossingDirection
      ?? (Math.abs(intendedVx) > 0.01 ? (intendedVx > 0 ? 1 : -1) : (x < trackX ? 1 : -1));
    const intendedExitX = intendedDirection === 1 ? rightSafeX : leftSafeX;
    const remainingCrossingMs = Math.abs(intendedExitX - x) / effectiveSpeed * 1000;
    if (this.canClearBeforeHazard(config, remainingCrossingMs, hazard.startsAt, hazard.endsAt, now)) {
      return this.steer(state, 'crossing', intendedDirection, x, now, movementSpeed, intendedVx, intendedVy);
    }

    // Bereits zwischen den Gleisen und zu langsam zum Räumen: abtauchen schlägt Zurückrennen.
    if (this.tryBurrowThroughTracks(enemy, now)) {
      this.resetState(state);
      return { vx: intendedVx, vy: intendedVy, override: false };
    }

    const leftDistance = Math.abs(x - leftSafeX);
    const rightDistance = Math.abs(rightSafeX - x);
    const escapeDirection: -1 | 1 = leftDistance <= rightDistance ? -1 : 1;
    return this.steer(state, 'escaping', escapeDirection, x, now, movementSpeed, intendedVx, intendedVy);
  }

  blocksRegularAttacks(enemyId: string): boolean {
    const state = this.states.get(enemyId);
    return (state?.mode === 'crossing' || state?.mode === 'escaping') && !state.pinned;
  }

  getTrainAttackTarget(enemy: EnemyEntity): { x: number; y: number; distance: number } | null {
    if (this.states.get(enemy.id)?.mode !== 'waiting') return null;
    return this.getTrainManager()?.getNearestAttackPoint(enemy.sprite.x, enemy.sprite.y) ?? null;
  }

  clear(): void {
    this.states.clear();
  }

  /**
   * Fordert bei grabfähigen Gegnern das Einbuddeln an. Unter der Erde ist der Zug ungefährlich,
   * der Gegner darf also unverändert weiterlaufen.
   */
  private tryBurrowThroughTracks(enemy: EnemyEntity, now: number): boolean {
    return this.burrowSource?.requestTrainCrossingBurrow(enemy.id, now) ?? false;
  }

  private resolveBeforeCrossing(
    enemy: EnemyEntity,
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
      return this.steer(state, 'crossing', direction, x, now, movementSpeed, intendedVx, intendedVy);
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

    // Statt vor den Gleisen zu warten, graben sich grabfähige Gegner einfach darunter durch.
    if (this.tryBurrowThroughTracks(enemy, now)) {
      this.resetState(state);
      return { vx: intendedVx, vy: intendedVy, override: false };
    }
    if (distanceToEntry <= 1) {
      state.mode = 'waiting';
      return { vx: 0, vy: 0, override: true };
    }

    state.mode = 'approaching';
    return {
      vx: direction * Math.min(movementSpeed, distanceToEntry * 8),
      vy: intendedVy,
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

  /**
   * Drives a crossing or escape sideways. Rocks or a base beside the track can hold the body in
   * place; once it is pinned, it follows its own route again and may attack, so it can break
   * through the obstacle instead of pushing against it with its weapons locked.
   */
  private steer(state: EnemyTrainAwarenessState, mode: 'crossing' | 'escaping', direction: -1 | 1, x: number,
    now: number, movementSpeed: number, intendedVx: number, intendedVy: number): EnemyTrainMovementDecision {
    if (state.mode !== mode || state.crossingDirection !== direction || state.progressX === undefined
      || state.progressAt === undefined || Math.abs(x - state.progressX) >= PINNED_PROGRESS_PX) {
      state.progressX = x;
      state.progressAt = now;
    }
    state.mode = mode;
    state.crossingDirection = direction;
    state.pinned = now - state.progressAt >= PINNED_AFTER_MS;
    return state.pinned
      ? { vx: intendedVx, vy: intendedVy, override: false }
      : { vx: direction * movementSpeed, vy: intendedVy, override: true };
  }

  private resetState(state: EnemyTrainAwarenessState): void {
    state.mode = 'normal';
    state.crossingDirection = undefined;
    state.progressX = undefined;
    state.progressAt = undefined;
    state.pinned = false;
  }
}
