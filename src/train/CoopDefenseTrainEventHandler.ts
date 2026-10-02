import type { ResolvedCoopDefenseMapEventConfig } from '../config/coopDefenseMaps';
import type {
  CoopDefenseMapEventCycleFinished,
  CoopDefenseMapEventHandler,
} from '../systems/CoopDefenseMapEventDirector';
import type { CombatTrainSegmentPort } from '../combat/CombatCapabilities';
import type { TrainManager, TrainDevPassOptions } from './TrainManager';
import type { TrainEventConfig } from '../types';

/**
 * Die Trainevent-Replikation, die der authored Zug braucht.
 *
 * Der Handler ist ein reines Regelobjekt und kennt das Netzwerksubstrat nicht; der World-Owner des
 * Zuges reicht seinen eigenen `trainEvents`-Port weiter.
 */
export interface TrainEventReplicationPort {
  readonly publish: (event: TrainEventConfig) => void;
  readonly clear: () => void;
}

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
  private devPass = false;
  private devState: 'idle' | 'running' | 'parked' | 'exited' | 'reset' = 'idle';
  private devStartCount = 0;
  private devSimulatedMs = 0;
  private devStartReason: string | null = null;

  getDevPassStatus() {
    return { state: this.devPass && this.trainManager.isDestroyed() ? 'destroyed' as const : this.devState,
      startCount: this.devStartCount, simulatedMs: this.devSimulatedMs, lastStartReason: this.devStartReason };
  }
  private readonly initialDirection: 1 | -1;
  private nextDirection: 1 | -1;
  private roundTimeMs = 0;
  private onCycleFinished: ((completion: CoopDefenseMapEventCycleFinished) => void) | null = null;

  constructor(
    private readonly trainManager: TrainManager,
    private readonly combatSystem: CombatTrainSegmentPort,
    initialDirection: 1 | -1,
    private readonly trainEvents: TrainEventReplicationPort,
  ) {
    this.initialDirection = initialDirection;
    this.nextDirection = initialDirection;
    trainManager.setExitedCallback(() => {
      const finished = this.scheduled;
      if (!finished || !this.trainSpawned) return;

      const wasDevPass = this.devPass;
      if (wasDevPass) this.devState = 'exited';
      this.devPass = false;
      this.trainSpawned = false;
      this.scheduled = null;
      this.trainEvents.clear();
      this.nextDirection = finished.direction === 1 ? -1 : 1;
      trainManager.prepareReentry(this.nextDirection);
      const completedAtMs = this.roundTimeMs;
      if (!wasDevPass) this.onCycleFinished?.({
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
    this.trainEvents.publish({
      trackX: this.trainManager.getTrackX(),
      direction: this.nextDirection,
      spawnAt,
    });
    return true;
  }

  hostUpdate(deltaMs: number, countdownActive: boolean, roundTimeMs: number): void {
    if (countdownActive || this.devPass) return;
    this.roundTimeMs = roundTimeMs;
    if (!this.scheduled) return;
    if (!this.trainSpawned && Date.now() >= this.scheduled.spawnAt) {
      this.trainManager.spawn();
      this.trainSpawned = true;
      this.combatSystem.setTrainSegments(this.trainManager.getSegObjects());
    }
    if (this.trainSpawned) this.trainManager.update(deltaMs);
  }

  /** Isolated dev host: immediate pass, owned by scenario delta rather than the map clock. */
  startDevPass(reason = 'train', options?: TrainDevPassOptions): void {
    this.devPass = true;
    this.devState = 'running';
    this.devStartCount++;
    this.devSimulatedMs = 0;
    this.devStartReason = reason;
    this.trainSpawned = true;
    this.nextDirection = this.initialDirection;
    this.roundTimeMs = 0;
    const spawnAt = Date.now();
    this.scheduled = { eventId: 'dev-scenario-train', occurrence: 1,
      spawnAt, direction: this.initialDirection };
    this.trainManager.prepareReentry(this.initialDirection);
    this.trainManager.spawn();
    if (options) this.trainManager.configureDevPass(options);
    this.devState = this.trainManager.getCurrentSpeed() === 0 ? 'parked' : 'running';
    this.combatSystem.setTrainSegments(this.trainManager.getSegObjects());
    this.trainEvents.publish({ trackX: this.trainManager.getTrackX(),
      direction: this.initialDirection, spawnAt });
  }

  updateDevPass(deltaMs: number): void {
    if (!this.devPass) return;
    const delta = Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;
    this.devSimulatedMs += delta;
    this.trainManager.update(delta);
  }

  reset(): void {
    this.devState = 'reset';
    this.devPass = false;
    this.scheduled = null;
    this.trainSpawned = false;
    this.roundTimeMs = 0;
    this.nextDirection = this.initialDirection;
    this.trainEvents.clear();
    this.trainManager.setExitedCallback(() => undefined);
  }

  setCycleFinishedCallback(
    callback: ((completion: CoopDefenseMapEventCycleFinished) => void) | null,
  ): void {
    this.onCycleFinished = callback;
  }
}
