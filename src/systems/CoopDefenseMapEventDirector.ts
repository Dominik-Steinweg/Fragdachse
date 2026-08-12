import type {
  CoopDefenseMapEventStart,
  ResolvedCoopDefenseMapEventConfig,
} from '../config/coopDefenseMaps';
import type {
  CoopDefenseMapEventLifecycleState,
  CoopDefenseMapEventPresentationState,
  CoopDefenseMapEventType,
} from '../types';

/**
 * Kleine Adaptergrenze: Fachsysteme planen/aktualisieren ihre Mechanik selbst.
 *
 * `actionAtMs` und `roundTimeMs` stammen beide aus der Rundenuhr des Directors. Handler duerfen
 * die beiden Werte niemals gegen `Date.now()` pruefen: Die Rundenuhr summiert Frame-Deltas und
 * haelt waehrend Countdown, Tab-Wechsel oder Frame-Stalls an, waehrend die Wanduhr weiterlaeuft.
 * Ein Vergleich ueber beide Uhren wuerde die authored Warnzeit still verkuerzen und den Fachablauf
 * vor dem Lifecycle des Directors starten. Wanduhr-Zeitstempel bleiben nur dort erlaubt, wo ein
 * Fachsystem seine eigene, relative Dauer misst (FireSystem-Ablauf, Airstrike-Vorwarnzeit) oder wo
 * ein absoluter Zeitstempel repliziert wird.
 */
export interface CoopDefenseMapEventHandler {
  readonly type: CoopDefenseMapEventType;
  schedule(
    event: ResolvedCoopDefenseMapEventConfig,
    occurrence: number,
    actionAtMs: number,
    roundTimeMs: number,
  ): void | boolean;
  hostUpdate(deltaMs: number, countdownActive: boolean, roundTimeMs: number): void;
  reset(): void;
  setCycleFinishedCallback(
    callback: ((completion: CoopDefenseMapEventCycleFinished) => void) | null,
  ): void;
}

/** Ergebnis eines fachlich abgeschlossenen Event-Zyklus. Der Handler entscheidet nicht Ã¼ber Map-Trigger. */
export interface CoopDefenseMapEventCycleFinished {
  readonly eventId: string;
  readonly occurrence: number;
  /** Autoritative Rundenzeit des tatsÃ¤chlichen Fachabschlusses. */
  readonly completedAtMs: number;
  /** Gesetzt: nÃ¤chster authored Zyklus; fehlt: endgÃ¼ltig completed. */
  readonly nextActionAtMs?: number;
}

interface MapEventRuntimeState {
  readonly config: ResolvedCoopDefenseMapEventConfig;
  state: CoopDefenseMapEventLifecycleState;
  occurrence: number;
  stateChangedAtMs: number;
  nextActionAtMs: number | null;
}

export interface CoopDefenseMapEventDirectorOptions {
  /** Semantische Abfragen aus anderen Round-Systemen, nie deren interne Zustände. */
  readonly isTriggerSatisfied?: (start: CoopDefenseMapEventStart) => boolean;
}

/**
 * Host-autoritärer Orchestrator fuer authored Map-Events.
 *
 * Der Director kennt nur Trigger, Zeitplan, Lifecycle und Presentation. Bewegung, Schaden,
 * Kollision und Rendering bleiben im registrierten Fachhandler.
 */
export class CoopDefenseMapEventDirector {
  private elapsedMs = 0;
  private presentationStateCache: CoopDefenseMapEventPresentationState | null = null;
  private presentationStateDirty = true;
  private readonly runtimes: MapEventRuntimeState[];
  private readonly handlers = new Map<CoopDefenseMapEventType, CoopDefenseMapEventHandler>();
  private readonly isTriggerSatisfied: ((start: CoopDefenseMapEventStart) => boolean) | null;

  constructor(
    events: readonly ResolvedCoopDefenseMapEventConfig[],
    handlers: readonly CoopDefenseMapEventHandler[],
    options: CoopDefenseMapEventDirectorOptions = {},
  ) {
    this.isTriggerSatisfied = options.isTriggerSatisfied ?? null;
    this.runtimes = events.map((config) => ({
      config,
      state: 'dormant',
      occurrence: 0,
      stateChangedAtMs: 0,
      nextActionAtMs: null,
    }));

    for (const handler of handlers) {
      if (this.handlers.has(handler.type)) {
        throw new Error(`[CoopDefenseMapEventDirector] Duplicate handler type: ${handler.type}`);
      }
      this.handlers.set(handler.type, handler);
      handler.setCycleFinishedCallback((completion) => {
        this.handleCycleFinished(completion);
      });
    }
  }

  hostUpdate(deltaMs: number, countdownActive: boolean): void {
    if (countdownActive) return;
    this.elapsedMs += Number.isFinite(deltaMs) ? Math.max(0, deltaMs) : 0;

    for (const runtime of this.runtimes) {
      if (runtime.state === 'dormant' && this.isStartSatisfied(runtime.config.start)) {
        this.scheduleOccurrence(runtime, 1, this.elapsedMs + (runtime.config.delayMs ?? 0));
      }
      if (runtime.state === 'scheduled' || runtime.state === 'waiting-repeat') {
        if (runtime.nextActionAtMs !== null && this.elapsedMs >= runtime.nextActionAtMs) {
          runtime.state = 'active';
          runtime.stateChangedAtMs = runtime.nextActionAtMs;
          runtime.nextActionAtMs = null;
          this.presentationStateDirty = true;
        }
      }
    }

    for (const handler of this.handlers.values()) handler.hostUpdate(deltaMs, false, this.elapsedMs);
  }

  reset(): void {
    this.elapsedMs = 0;
    for (const handler of this.handlers.values()) {
      handler.reset();
      handler.setCycleFinishedCallback(null);
    }
    for (const runtime of this.runtimes) {
      runtime.state = 'dormant';
      runtime.occurrence = 0;
      runtime.stateChangedAtMs = 0;
      runtime.nextActionAtMs = null;
    }
    this.presentationStateDirty = true;
  }

  getElapsedMs(): number {
    return this.elapsedMs;
  }

  /** Semantischer Completion-Zustand fÃ¼r `after-event`; keine Fachsystem-SonderfÃ¤lle. */
  isEventCompleted(eventId: string): boolean {
    return this.runtimes.some((runtime) => runtime.config.id === eventId && runtime.state === 'completed');
  }

  getPresentationState(): CoopDefenseMapEventPresentationState | null {
    if (this.runtimes.length === 0) return null;
    if (!this.presentationStateDirty && this.presentationStateCache !== null) {
      return this.presentationStateCache;
    }
    this.presentationStateCache = this.runtimes.map((runtime) => ({
      eventId: runtime.config.id,
      eventType: runtime.config.type,
      state: runtime.state,
      occurrence: runtime.occurrence,
      stateChangedAtMs: runtime.stateChangedAtMs,
      ...(runtime.nextActionAtMs === null ? {} : { nextActionAtMs: runtime.nextActionAtMs }),
    }));
    this.presentationStateDirty = false;
    return this.presentationStateCache;
  }

  private scheduleOccurrence(
    runtime: MapEventRuntimeState,
    occurrence: number,
    actionAtMs: number,
  ): void {
    const handler = this.handlers.get(runtime.config.type);
    // Fail-closed: ein Event ohne Fachhandler bleibt dormant und wirkt nicht.
    if (!handler) return;

    if (handler.schedule(runtime.config, occurrence, actionAtMs, this.elapsedMs) === false) return;
    runtime.occurrence = occurrence;
    runtime.state = occurrence === 1 ? 'scheduled' : 'waiting-repeat';
    runtime.stateChangedAtMs = this.elapsedMs;
    // Ein Zyklus wird nie in die Vergangenheit geplant: `nextActionAtMs < stateChangedAtMs` waere
    // fuer den replizierten Snapshot unplausibel und wuerde ihn clientseitig komplett verwerfen.
    runtime.nextActionAtMs = Math.max(actionAtMs, this.elapsedMs);
    this.presentationStateDirty = true;
  }

  private handleCycleFinished(completion: CoopDefenseMapEventCycleFinished): void {
    const runtime = this.runtimes.find((candidate) => candidate.config.id === completion.eventId);
    if (!runtime || runtime.occurrence !== completion.occurrence) return;
    // Regulaer meldet nur ein aktiver Zyklus seinen Abschluss. Ein noch angekuendigter Zyklus wird
    // hier bewusst mitgenommen statt verworfen: Sonst bliebe das Event dauerhaft in `scheduled`
    // haengen, obwohl der Fachhandler seinen Durchlauf bereits geloescht hat -- und jede
    // `after-event`-Kette darauf wartete fuer immer.
    if (runtime.state !== 'active' && runtime.state !== 'scheduled' && runtime.state !== 'waiting-repeat') return;
    const completedAtMs = Math.max(0, Math.floor(completion.completedAtMs));
    if (completion.nextActionAtMs === undefined) {
      runtime.state = 'completed';
      runtime.stateChangedAtMs = completedAtMs;
      runtime.nextActionAtMs = null;
      this.presentationStateDirty = true;
      return;
    }
    const nextActionAtMs = Math.max(completedAtMs, Math.floor(completion.nextActionAtMs));
    this.scheduleOccurrence(runtime, runtime.occurrence + 1, nextActionAtMs);
  }

  private isStartSatisfied(start: CoopDefenseMapEventStart): boolean {
    if (start.type === 'time') return this.elapsedMs >= start.atMs;
    return this.isTriggerSatisfied?.(start) === true;
  }
}
