import { bridge } from '../network/bridge';
import type { ResolvedCoopDefenseMapEventConfig } from '../config/coopDefenseMaps';
import type { CoopDefenseMapEventHandler } from '../systems/CoopDefenseMapEventDirector';
import type { CombatSystem } from '../systems/CombatSystem';
import type { TrainManager } from './TrainManager';

interface ScheduledTrainOccurrence {
  readonly eventId: string;
  readonly occurrence: number;
  readonly spawnAt: number;
  readonly direction: 1 | -1;
}

/** Adapter zwischen der gemeinsamen Event-Schicht und dem bestehenden TrainManager. */
export class CoopDefenseTrainEventHandler implements CoopDefenseMapEventHandler {
  readonly type = 'train' as const;

  private scheduled: ScheduledTrainOccurrence | null = null;
  private trainSpawned = false;
  private readonly initialDirection: 1 | -1;
  private nextDirection: 1 | -1;
  private onCycleFinished: ((eventId: string, occurrence: number, exitedAtMs: number) => void) | null = null;

  constructor(
    private readonly trainManager: TrainManager,
    private readonly combatSystem: CombatSystem,
    initialDirection: 1 | -1,
    private readonly getActiveRoundTimeMs: () => number,
  ) {
    this.initialDirection = initialDirection;
    this.nextDirection = initialDirection;
    trainManager.setExitedCallback(() => {
      const finished = this.scheduled;
      if (!finished || !this.trainSpawned) return;

      this.trainSpawned = false;
      this.scheduled = null;
      bridge.clearTrainEvent();
      this.nextDirection = finished.direction === 1 ? -1 : 1;
      trainManager.prepareReentry(this.nextDirection);
      this.onCycleFinished?.(finished.eventId, finished.occurrence, this.getActiveRoundTimeMs());
    });
  }

  schedule(event: ResolvedCoopDefenseMapEventConfig, occurrence: number, actionAtMs: number): void {
    const direction = this.nextDirection;
    const spawnAt = bridge.getArenaStartTime() + Math.max(0, Math.floor(actionAtMs));
    if (
      this.scheduled?.eventId === event.id
      && this.scheduled.occurrence === occurrence
      && this.scheduled.spawnAt === spawnAt
    ) return;

    this.scheduled = {
      eventId: event.id,
      occurrence,
      spawnAt,
      direction,
    };
    this.trainSpawned = false;
    bridge.publishTrainEvent({
      trackX: this.trainManager.getTrackX(),
      direction,
      spawnAt,
    });
  }

  hostUpdate(deltaMs: number, countdownActive: boolean): void {
    if (countdownActive || !this.scheduled) return;
    if (!this.trainSpawned && Date.now() >= this.scheduled.spawnAt) {
      this.trainManager.spawn();
      this.trainSpawned = true;
      this.combatSystem.setTrainSegments(this.trainManager.getSegObjects());
    }
    if (this.trainSpawned) this.trainManager.update(deltaMs);
  }

  reset(): void {
    this.scheduled = null;
    this.trainSpawned = false;
    this.nextDirection = this.initialDirection;
    bridge.clearTrainEvent();
    this.trainManager.setExitedCallback(() => undefined);
  }

  setCycleFinishedCallback(
    callback: ((eventId: string, occurrence: number, exitedAtMs: number) => void) | null,
  ): void {
    this.onCycleFinished = callback;
  }
}
