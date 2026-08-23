import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../config';
import type {
  CoopDefenseMapMissionBarrierOpenTrigger,
  ResolvedCoopDefenseMapMissionProgressConfig,
} from '../config/coopDefenseMaps';
import type {
  CoopDefenseMissionDefenseOutcome,
  CoopDefenseMissionProgressPresentationState,
  CoopDefenseSecondaryObjectiveState,
} from '../types';

export interface CoopDefenseMissionPlayerSample {
  readonly playerId: string;
  readonly x: number;
  readonly y: number;
  /** Nur hostautoritativ berechtigte Round-Participants duerfen Fortschritt ausloesen. */
  readonly eligible: boolean;
}

export interface CoopDefenseMissionProgressSystemOptions {
  readonly roundRevision: number;
  readonly getDefenseObjectiveState: (objectiveId: string) => CoopDefenseSecondaryObjectiveState | null;
  readonly isEncounterCleared?: (encounterId: string) => boolean;
  /** Reliable snapshot seam; wird nur bei semantischen Aenderungen aufgerufen. */
  readonly onPresentationChanged?: (state: CoopDefenseMissionProgressPresentationState) => void;
}

interface PlayerPosition {
  readonly x: number;
  readonly y: number;
}

interface ResolvedDefenseState {
  readonly outcome: CoopDefenseMissionDefenseOutcome;
  readonly resolvedAtRoundMs: number;
}

/**
 * Hostautoritativer, Phaser-freier Fortschritt entlang einer authored Checkpoint-Reihenfolge.
 * Verteidigungsregeln bleiben beim Hold-Secondary-Objective; dieses System besitzt nur die
 * Routensperre und liest dessen terminalen Zustand ueber eine semantische Callback-Grenze.
 */
export class CoopDefenseMissionProgressSystem {
  private elapsedRoundMs = 0;
  private missionRevision = 0;
  private nextCheckpointIndex = 0;
  private respawnCheckpointId: string | null = null;
  private routeLockDefenseId: string | null = null;
  private routeComplete = false;
  private readonly activatedAtRoundMs = new Map<string, number>();
  private readonly resolvedDefenses = new Map<string, ResolvedDefenseState>();
  private readonly barrierOpen = new Map<string, boolean>();
  private readonly previousPositions = new Map<string, PlayerPosition>();
  private readonly suppressNextSample = new Set<string>();

  constructor(
    private readonly config: ResolvedCoopDefenseMapMissionProgressConfig,
    private readonly options: CoopDefenseMissionProgressSystemOptions,
  ) {
    for (const barrier of config.barriers) this.barrierOpen.set(barrier.id, false);
  }

  hostUpdate(
    deltaMs: number,
    countdownActive: boolean,
    samples: readonly CoopDefenseMissionPlayerSample[],
  ): void {
    if (!countdownActive) {
      this.elapsedRoundMs += Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    }

    let changed = this.resolveDefenses();
    if (changed) this.routeLockDefenseId = this.findCurrentRouteLock();

    const eligibleIds = new Set<string>();
    for (const sample of samples) {
      if (!sample.eligible || !Number.isFinite(sample.x) || !Number.isFinite(sample.y)) continue;
      eligibleIds.add(sample.playerId);
      const previous = this.previousPositions.get(sample.playerId);
      this.previousPositions.set(sample.playerId, { x: sample.x, y: sample.y });
      if (this.suppressNextSample.delete(sample.playerId)) continue;
      if (countdownActive || this.routeLockDefenseId !== null || this.routeComplete) continue;
      if (this.activateCrossedCheckpoints(previous ?? sample, sample)) {
        changed = true;
      }
    }
    for (const playerId of this.previousPositions.keys()) {
      if (!eligibleIds.has(playerId)) this.previousPositions.delete(playerId);
    }

    if (this.refreshBarriers()) changed = true;
    if (this.refreshRouteComplete()) changed = true;
    if (changed) this.publishSemanticChange();
  }

  /** Spawn/Respawn/Teleport seam: das naechste Segment beginnt am Zielpunkt. */
  resetPlayerPosition(playerId: string, x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      this.previousPositions.delete(playerId);
      return;
    }
    this.previousPositions.set(playerId, { x, y });
    this.suppressNextSample.add(playerId);
  }

  removePlayer(playerId: string): void {
    this.previousPositions.delete(playerId);
    this.suppressNextSample.delete(playerId);
  }

  isCheckpointActivated(id: string): boolean {
    return this.activatedAtRoundMs.has(id);
  }

  isDefenseResolved(id: string): boolean {
    return this.resolvedDefenses.has(id);
  }

  getDefenseOutcome(id: string): CoopDefenseMissionDefenseOutcome | null {
    return this.resolvedDefenses.get(id)?.outcome ?? null;
  }

  getRespawnCheckpointId(): string | null {
    return this.respawnCheckpointId;
  }

  isRouteComplete(): boolean {
    return this.routeComplete;
  }

  isBarrierOpen(id: string): boolean {
    return this.barrierOpen.get(id) === true;
  }

  getPresentationState(): CoopDefenseMissionProgressPresentationState {
    return {
      roundRevision: this.options.roundRevision,
      missionRevision: this.missionRevision,
      activatedCheckpoints: this.config.checkpoints
        .filter(({ id }) => this.activatedAtRoundMs.has(id))
        .map(({ id }) => ({ checkpointId: id, activatedAtRoundMs: this.activatedAtRoundMs.get(id) ?? 0 })),
      nextCheckpointId: this.config.checkpoints[this.nextCheckpointIndex]?.id ?? null,
      respawnCheckpointId: this.respawnCheckpointId,
      routeLockDefenseId: this.routeLockDefenseId,
      resolvedDefenses: this.config.mandatoryDefenses
        .filter(({ id }) => this.resolvedDefenses.has(id))
        .map(({ id }) => ({ defenseId: id, ...(this.resolvedDefenses.get(id) as ResolvedDefenseState) })),
      barriers: this.config.barriers.map(({ id }) => ({ barrierId: id, open: this.barrierOpen.get(id) === true })),
      routeComplete: this.routeComplete,
    };
  }

  reset(): void {
    this.elapsedRoundMs = 0;
    this.missionRevision = 0;
    this.nextCheckpointIndex = 0;
    this.respawnCheckpointId = null;
    this.routeLockDefenseId = null;
    this.routeComplete = false;
    this.activatedAtRoundMs.clear();
    this.resolvedDefenses.clear();
    this.previousPositions.clear();
    this.suppressNextSample.clear();
    for (const barrier of this.config.barriers) this.barrierOpen.set(barrier.id, false);
  }

  private activateCrossedCheckpoints(from: PlayerPosition, to: PlayerPosition): boolean {
    let changed = false;
    while (this.routeLockDefenseId === null) {
      const checkpoint = this.config.checkpoints[this.nextCheckpointIndex];
      if (!checkpoint) break;
      const centerX = ARENA_OFFSET_X + (checkpoint.gridX + 0.5) * CELL_SIZE;
      const centerY = ARENA_OFFSET_Y + (checkpoint.gridY + 0.5) * CELL_SIZE;
      const radius = checkpoint.radiusCells * CELL_SIZE;
      if (!segmentTouchesCircle(from.x, from.y, to.x, to.y, centerX, centerY, radius)) break;

      this.activatedAtRoundMs.set(checkpoint.id, this.elapsedRoundMs);
      this.nextCheckpointIndex += 1;
      if (checkpoint.setRespawn) this.respawnCheckpointId = checkpoint.id;
      this.routeLockDefenseId = this.findCurrentRouteLock();
      changed = true;
      // Sobald dieser Checkpoint eine Mandatory Defense startet, endet die Auswertung dieses Ticks.
    }
    return changed;
  }

  private findCurrentRouteLock(): string | null {
    for (const defense of this.config.mandatoryDefenses) {
      if (this.activatedAtRoundMs.has(defense.checkpointId) && !this.resolvedDefenses.has(defense.id)) {
        return defense.id;
      }
    }
    return null;
  }

  private resolveDefenses(): boolean {
    let changed = false;
    for (const defense of this.config.mandatoryDefenses) {
      if (!this.activatedAtRoundMs.has(defense.checkpointId) || this.resolvedDefenses.has(defense.id)) continue;
      const objectiveState = this.options.getDefenseObjectiveState(defense.objectiveId);
      if (objectiveState !== 'completed' && objectiveState !== 'failed') continue;
      this.resolvedDefenses.set(defense.id, {
        outcome: objectiveState,
        resolvedAtRoundMs: this.elapsedRoundMs,
      });
      changed = true;
    }
    return changed;
  }

  private refreshBarriers(): boolean {
    let changed = false;
    for (const barrier of this.config.barriers) {
      if (this.barrierOpen.get(barrier.id) || !this.isBarrierTriggerSatisfied(barrier.openOn)) continue;
      this.barrierOpen.set(barrier.id, true);
      changed = true;
    }
    return changed;
  }

  private isBarrierTriggerSatisfied(trigger: CoopDefenseMapMissionBarrierOpenTrigger): boolean {
    if (trigger.type === 'after-checkpoint') return this.isCheckpointActivated(trigger.checkpointId);
    if (trigger.type === 'after-defense') return this.isDefenseResolved(trigger.defenseId);
    return this.options.isEncounterCleared?.(trigger.encounterId) === true;
  }

  private refreshRouteComplete(): boolean {
    const complete = this.nextCheckpointIndex >= this.config.checkpoints.length
      && this.config.mandatoryDefenses.every((defense) => (
        !this.isCheckpointActivated(defense.checkpointId) || this.isDefenseResolved(defense.id)
      ));
    if (complete === this.routeComplete) return false;
    this.routeComplete = complete;
    return true;
  }

  private publishSemanticChange(): void {
    this.missionRevision += 1;
    this.options.onPresentationChanged?.(this.getPresentationState());
  }
}

function segmentTouchesCircle(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  centerX: number,
  centerY: number,
  radius: number,
): boolean {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared <= 0
    ? 0
    : Math.max(0, Math.min(1, ((centerX - x1) * dx + (centerY - y1) * dy) / lengthSquared));
  const closestX = x1 + dx * t;
  const closestY = y1 + dy * t;
  const distanceX = closestX - centerX;
  const distanceY = closestY - centerY;
  return distanceX * distanceX + distanceY * distanceY <= radius * radius;
}
