import type { CoopDefenseDynamicTimeOfDayConfig } from '../../config/coopDefenseMapAuthoring';
import type { DawnPhaseId, DawnSchedule } from '../../config/dawn/dawnContent';

/**
 * Die einzige Quelle fuer die Gameplay-Phase einer Dawn-Runde.
 *
 * Phase und Uhrzeit folgen rein aus Zeitplan und Activity-Zeit. Die Tageszeit-Engine bekommt
 * daraus ihre gewoehnlichen Transitionen; Gameplay liest die Phase hier und nie aus der
 * dargestellten Uhrzeit.
 */
export interface DawnPhaseState {
  readonly phase: DawnPhaseId;
  readonly phaseStartMs: number;
  readonly phaseEndMs: number;
  /** Erreicht das Rundenende (Morgengrauen vorbei). */
  readonly finished: boolean;
}

export function resolveDawnPhase(schedule: DawnSchedule, elapsedMs: number): DawnPhaseState {
  const clamped = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
  const phases = schedule.phases;
  let index = 0;
  while (index + 1 < phases.length && phases[index + 1].startMs <= clamped) index += 1;
  return {
    phase: phases[index].id,
    phaseStartMs: phases[index].startMs,
    phaseEndMs: index + 1 < phases.length ? phases[index + 1].startMs : schedule.durationMs,
    finished: clamped >= schedule.durationMs,
  };
}

export function getDawnPhaseStartMs(schedule: DawnSchedule, phase: DawnPhaseId): number {
  const entry = schedule.phases.find(({ id }) => id === phase);
  if (!entry) throw new Error(`[DawnPhase] Schedule ${schedule.id} has no phase ${phase}`);
  return entry.startMs;
}

/** Startuhrzeit der Runde; die World-Uhr beginnt hier. */
export function getDawnStartClock(schedule: DawnSchedule): string {
  return schedule.phases[0].clock;
}

/**
 * Tageszeit-Transitionen aus dem Zeitplan: Jede Phase laeuft vom eigenen Startwert zur Uhrzeit
 * der naechsten Phase (bzw. `endClock`). Die Engine interpoliert vorwaerts ueber Mitternacht.
 */
export function toDawnDynamicTimeOfDay(schedule: DawnSchedule): CoopDefenseDynamicTimeOfDayConfig {
  return {
    transitions: schedule.phases.map((phase, index) => {
      const next = schedule.phases[index + 1];
      const endMs = next?.startMs ?? schedule.durationMs;
      return {
        start: { type: 'time', atMs: phase.startMs },
        targetTimeOfDay: next?.clock ?? schedule.endClock,
        durationMs: endMs - phase.startMs,
      };
    }),
  };
}
