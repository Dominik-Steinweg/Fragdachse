import type {
  CoopDefenseMapEventStart,
  ResolvedCoopDefenseMapEventConfig,
} from '../config/coopDefenseMaps';
import type {
  CoopDefenseMapEventLifecycleState,
  CoopDefenseMapEventPresentationState,
  CoopDefenseMapEventType,
} from '../types';

/** Kleine Adaptergrenze: Fachsysteme planen/aktualisieren ihre Mechanik selbst. */
export interface CoopDefenseMapEventHandler {
  readonly type: CoopDefenseMapEventType;
  schedule(
    event: ResolvedCoopDefenseMapEventConfig,
    occurrence: number,
    actionAtMs: number,
  ): void;
  hostUpdate(deltaMs: number, countdownActive: boolean): void;
  reset(): void;
  setCycleFinishedCallback(
    callback: ((eventId: string, occurrence: number, exitedAtMs: number) => void) | null,
  ): void;
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
      handler.setCycleFinishedCallback((eventId, occurrence, exitedAtMs) => {
        this.handleCycleFinished(eventId, occurrence, exitedAtMs);
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
        }
      }
    }

    for (const handler of this.handlers.values()) handler.hostUpdate(deltaMs, false);
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
  }

  getElapsedMs(): number {
    return this.elapsedMs;
  }

  getPresentationState(): CoopDefenseMapEventPresentationState | null {
    if (this.runtimes.length === 0) return null;
    return this.runtimes.map((runtime) => ({
      eventId: runtime.config.id,
      eventType: runtime.config.type,
      state: runtime.state,
      occurrence: runtime.occurrence,
      stateChangedAtMs: runtime.stateChangedAtMs,
      ...(runtime.nextActionAtMs === null ? {} : { nextActionAtMs: runtime.nextActionAtMs }),
    }));
  }

  private scheduleOccurrence(
    runtime: MapEventRuntimeState,
    occurrence: number,
    actionAtMs: number,
  ): void {
    const handler = this.handlers.get(runtime.config.type);
    // Fail-closed: ein Event ohne Fachhandler bleibt dormant und wirkt nicht.
    if (!handler) return;

    handler.schedule(runtime.config, occurrence, actionAtMs);
    runtime.occurrence = occurrence;
    runtime.state = occurrence === 1 ? 'scheduled' : 'waiting-repeat';
    runtime.stateChangedAtMs = this.elapsedMs;
    runtime.nextActionAtMs = actionAtMs;
  }

  private handleCycleFinished(eventId: string, occurrence: number, exitedAtMs: number): void {
    const runtime = this.runtimes.find((candidate) => candidate.config.id === eventId);
    if (!runtime || runtime.state !== 'active' || runtime.occurrence !== occurrence) return;
    if (runtime.config.type !== 'train') return;

    const repeatAfterExitMs = runtime.config.repeatAfterExitMs;
    const completedAtMs = Math.max(0, Math.floor(exitedAtMs));
    if (repeatAfterExitMs === undefined) {
      runtime.state = 'completed';
      runtime.stateChangedAtMs = completedAtMs;
      runtime.nextActionAtMs = null;
      return;
    }

    const nextActionAtMs = completedAtMs + repeatAfterExitMs;
    this.scheduleOccurrence(runtime, occurrence + 1, nextActionAtMs);
  }

  private isStartSatisfied(start: CoopDefenseMapEventStart): boolean {
    if (start.type === 'time') return this.elapsedMs >= start.atMs;
    return this.isTriggerSatisfied?.(start) === true;
  }
}
