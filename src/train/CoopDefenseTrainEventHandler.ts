import { bridge } from '../network/bridge';
import type { ResolvedCoopDefenseMapEventConfig } from '../config/coopDefenseMaps';
import type {
  CoopDefenseMapEventCycleFinished,
  CoopDefenseMapEventHandler,
} from '../systems/CoopDefenseMapEventDirector';
import type { CombatSystem } from '../systems/CombatSystem';
import type { TrainManager } from './TrainManager';

interface ScheduledTrainOccurrence {
  readonly eventId: string;
  readonly occurrence: number;
  /** Wanduhr-Zeitpunkt der Einfahrt; identisch mit dem replizierten `TrainEventConfig.spawnAt`. */
  readonly spawnAt: number;
  readonly direction: 1 | -1;
  readonly repeatAfterExitMs?: number;
}

/** Adapter zwischen der gemeinsamen Event-Schicht und dem bestehenden TrainManager. */
export class CoopDefenseTrainEventHandler implements CoopDefenseMapEventHandler {
  readonly type = 'train' as const;

  private scheduled: ScheduledTrainOccurrence | null = null;
  private trainSpawned = false;
  private readonly initialDirection: 1 | -1;
  private nextDirection: 1 | -1;
  private roundTimeMs = 0;
  private onCycleFinished: ((completion: CoopDefenseMapEventCycleFinished) => void) | null = null;

  constructor(
    private readonly trainManager: TrainManager,
    private readonly combatSystem: CombatSystem,
    initialDirection: 1 | -1,
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
      const completedAtMs = this.roundTimeMs;
      this.onCycleFinished?.({
        eventId: finished.eventId,
        occurrence: finished.occurrence,
        completedAtMs,
        ...(finished.repeatAfterExitMs === undefined
          ? {}
          : { nextActionAtMs: completedAtMs + finished.repeatAfterExitMs }),
      });
    });
  }

  schedule(
    event: ResolvedCoopDefenseMapEventConfig,
    occurrence: number,
    actionAtMs: number,
    roundTimeMs: number,
  ): boolean {
    if (event.type !== 'train') return false;
    // Several train events may be authored over time, but the physical track owns one
    // train slot. Never replace an already planned or active occurrence.
    if (this.scheduled !== null || this.trainSpawned) return false;
    this.roundTimeMs = roundTimeMs;
    // `spawnAt` ist der eine autoritative Wanduhr-Zeitpunkt, den HUD-Countdown und Gegner-KI
    // lesen. Er entsteht aus der *verbleibenden* Wartezeit der Rundenuhr, nicht aus einem
    // absoluten Offset zum Rundenstart: So bleiben Countdown und tatsaechliche Einfahrt auch dann
    // deckungsgleich, wenn die Rundenuhr zuvor hinter der Wanduhr zurueckgeblieben ist.
    const spawnAt = Date.now() + Math.max(0, Math.floor(actionAtMs) - Math.floor(roundTimeMs));

    this.scheduled = {
      eventId: event.id,
      occurrence,
      spawnAt,
      direction: this.nextDirection,
      ...(event.repeatAfterExitMs === undefined ? {} : { repeatAfterExitMs: event.repeatAfterExitMs }),
    };
    this.trainSpawned = false;
    bridge.publishTrainEvent({
      trackX: this.trainManager.getTrackX(),
      direction: this.nextDirection,
      spawnAt,
    });
    return true;
  }

  hostUpdate(deltaMs: number, countdownActive: boolean, roundTimeMs: number): void {
    if (countdownActive) return;
    this.roundTimeMs = roundTimeMs;
    if (!this.scheduled) return;
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
    this.roundTimeMs = 0;
    this.nextDirection = this.initialDirection;
    bridge.clearTrainEvent();
    this.trainManager.setExitedCallback(() => undefined);
  }

  setCycleFinishedCallback(
    callback: ((completion: CoopDefenseMapEventCycleFinished) => void) | null,
  ): void {
    this.onCycleFinished = callback;
  }
}
