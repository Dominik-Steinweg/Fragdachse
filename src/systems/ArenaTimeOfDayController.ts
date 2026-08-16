import type { CoopDefenseDynamicTimeOfDayConfig } from '../config/coopDefenseMaps';
import {
  MINUTES_PER_DAY,
  normalizeTimeOfDay,
  parseTimeOfDay,
} from '../effects/TimeOfDay';

export interface ArenaTimeOfDaySignals {
  /** Einmalig replizierter absoluter Zeitpunkt des tatsaechlich erfolgreichen Boss-Spawns. */
  readonly bossSpawnedAtMs?: number | null;
  /** Replizierter Zustand: 0 ohne Boss, danach die hoechste aktive Bossphase. */
  readonly bossPhase?: number;
}

export interface ArenaTimeOfDaySample {
  readonly minutes: number;
  readonly automaticMinutes: number;
  /** Genau einmal nach dem Erreichen eines gescripteten Zielzustands. */
  readonly transitionCompleted: boolean;
}

interface ScheduledTransition {
  readonly index: number;
  readonly startAtMs: number;
  readonly requiresBossSpawn: boolean;
  readonly targetMinutes: number;
  readonly durationMs: number;
}

interface BossPhaseTransition {
  readonly index: number;
  readonly phase: number;
  readonly targetMinutes: number;
}

export interface ArenaTimeOfDayControllerOptions {
  readonly startMinutes: number;
  readonly roundStartTime: number;
  readonly dynamic?: CoopDefenseDynamicTimeOfDayConfig;
  readonly bossSpawnAtMs?: number;
}

/**
 * Zentrale, Phaser-freie Arena-Uhr.
 *
 * Kontinuierliche Zeit und zeitlich gescriptete Transitionen werden bei jeder Abfrage aus
 * `roundStartTime` und dem injizierten synchronisierten Jetzt rekonstruiert. Es wird kein
 * `deltaMs` akkumuliert; Host, Clients und Late Joiner landen deshalb beim selben Timestamp auf
 * demselben Wert. Der erfolgreiche Boss-Spawn liefert einmalig einen reliable Zeitanker; damit
 * rekonstruieren auch Clients und Late Joiner denselben Verlauf. Bossphasen sind replizierte
 * Zustaende und wechseln deshalb sofort auf ihr authored Ziel, statt pro Client einen lokalen
 * Tween zu starten.
 */
export class ArenaTimeOfDayController {
  private readonly startMinutes: number;
  private readonly roundStartTime: number;
  private readonly minutesPerSecond: number;
  private readonly scheduledTransitions: readonly ScheduledTransition[];
  private readonly bossPhaseTransitions: readonly BossPhaseTransition[];
  private readonly reportedCompletions = new Set<number>();
  private debugOverrideMinutes: number | null = null;
  private automaticMinutes: number;
  private currentMinutes: number;

  constructor(options: ArenaTimeOfDayControllerOptions) {
    this.startMinutes = normalizeTimeOfDay(options.startMinutes);
    this.roundStartTime = Number.isFinite(options.roundStartTime) ? options.roundStartTime : 0;
    this.minutesPerSecond = options.dynamic?.minutesPerSecond ?? 0;
    this.automaticMinutes = this.startMinutes;
    this.currentMinutes = this.startMinutes;

    const scheduled: ScheduledTransition[] = [];
    const bossPhases: BossPhaseTransition[] = [];
    for (const [index, transition] of (options.dynamic?.transitions ?? []).entries()) {
      const targetMinutes = parseTimeOfDay(transition.targetTimeOfDay);
      if (targetMinutes === null) continue;
      if (transition.start.type === 'boss-phase') {
        bossPhases.push({ index, phase: transition.start.phase, targetMinutes });
        continue;
      }
      const startAtMs = transition.start.type === 'boss-spawn'
        ? options.bossSpawnAtMs
        : transition.start.atMs;
      if (startAtMs === undefined) continue;
      scheduled.push({
        index,
        startAtMs,
        requiresBossSpawn: transition.start.type === 'boss-spawn',
        targetMinutes,
        durationMs: transition.durationMs,
      });
    }
    this.scheduledTransitions = scheduled.sort((left, right) => left.startAtMs - right.startAtMs);
    this.bossPhaseTransitions = bossPhases.sort((left, right) => left.phase - right.phase);
  }

  isDynamic(): boolean {
    return this.minutesPerSecond !== 0
      || this.scheduledTransitions.length > 0
      || this.bossPhaseTransitions.length > 0;
  }

  getAutomaticMinutes(): number {
    return this.automaticMinutes;
  }

  getCurrentMinutes(): number {
    return this.currentMinutes;
  }

  hasDebugOverride(): boolean {
    return this.debugOverrideMinutes !== null;
  }

  setDebugOverride(minutes: number): void {
    this.debugOverrideMinutes = normalizeTimeOfDay(minutes);
    this.currentMinutes = this.debugOverrideMinutes;
  }

  clearDebugOverride(): void {
    this.debugOverrideMinutes = null;
    this.currentMinutes = this.automaticMinutes;
  }

  sample(synchronizedNowMs: number, signals: ArenaTimeOfDaySignals = {}): ArenaTimeOfDaySample {
    const nowMs = Number.isFinite(synchronizedNowMs) ? synchronizedNowMs : this.roundStartTime;
    const elapsedMs = Math.max(0, nowMs - this.roundStartTime);
    const bossSpawnedAtMs = Number.isFinite(signals.bossSpawnedAtMs)
      ? signals.bossSpawnedAtMs!
      : null;
    let transitionCompleted = false;
    let automatic = this.resolveScheduledMinutes(elapsedMs, bossSpawnedAtMs);

    for (const transition of this.scheduledTransitions) {
      const startAtMs = this.resolveTransitionStartAtMs(transition, bossSpawnedAtMs);
      if (startAtMs === null || elapsedMs < startAtMs + transition.durationMs) continue;
      if (this.reportedCompletions.has(transition.index)) continue;
      this.reportedCompletions.add(transition.index);
      transitionCompleted = true;
    }

    const bossPhase = Math.max(0, Math.floor(signals.bossPhase ?? 0));
    for (const transition of this.bossPhaseTransitions) {
      if (bossPhase < transition.phase) continue;
      automatic = transition.targetMinutes;
      if (!this.reportedCompletions.has(transition.index)) {
        this.reportedCompletions.add(transition.index);
        transitionCompleted = true;
      }
    }

    this.automaticMinutes = automatic;
    this.currentMinutes = this.debugOverrideMinutes ?? automatic;
    return {
      minutes: this.currentMinutes,
      automaticMinutes: automatic,
      transitionCompleted,
    };
  }

  private resolveScheduledMinutes(elapsedMs: number, bossSpawnedAtMs: number | null): number {
    let segmentStartMs = 0;
    let segmentStartMinutes = this.startMinutes;

    for (const transition of this.scheduledTransitions) {
      const resolvedStartAtMs = this.resolveTransitionStartAtMs(transition, bossSpawnedAtMs);
      if (resolvedStartAtMs === null) continue;
      const startAtMs = Math.max(segmentStartMs, resolvedStartAtMs);
      const sourceMinutes = normalizeTimeOfDay(
        segmentStartMinutes + (startAtMs - segmentStartMs) * this.minutesPerSecond / 1000,
      );
      if (elapsedMs < startAtMs) {
        return normalizeTimeOfDay(
          segmentStartMinutes + (elapsedMs - segmentStartMs) * this.minutesPerSecond / 1000,
        );
      }

      const endAtMs = startAtMs + transition.durationMs;
      if (elapsedMs < endAtMs) {
        return interpolateForward(
          sourceMinutes,
          transition.targetMinutes,
          smoothstep01((elapsedMs - startAtMs) / transition.durationMs),
        );
      }

      segmentStartMs = endAtMs;
      segmentStartMinutes = transition.targetMinutes;
    }

    return normalizeTimeOfDay(
      segmentStartMinutes + (elapsedMs - segmentStartMs) * this.minutesPerSecond / 1000,
    );
  }

  private resolveTransitionStartAtMs(
    transition: ScheduledTransition,
    bossSpawnedAtMs: number | null,
  ): number | null {
    if (!transition.requiresBossSpawn) return transition.startAtMs;
    if (bossSpawnedAtMs === null) return null;
    return Math.max(0, bossSpawnedAtMs - this.roundStartTime);
  }
}

function smoothstep01(value: number): number {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
}

function interpolateForward(fromMinutes: number, toMinutes: number, amount: number): number {
  const from = normalizeTimeOfDay(fromMinutes);
  const to = normalizeTimeOfDay(toMinutes);
  const distance = (to - from + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  return normalizeTimeOfDay(from + distance * amount);
}
