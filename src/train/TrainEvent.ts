import { TRAIN } from './TrainConfig';

/**
 * Aufgelöster Rhythmus des Zug-Events einer Runde.
 *
 * Der Zug ist ein kleines Umgebungs-Event der Map, kein Encounter und kein Teil des
 * Rundentimers: Ankündigung und Wiedereinfahrt hängen ausschließlich an diesen Werten
 * und am autoritativen `TrainEventConfig.spawnAt`, nie an `roundEndTime`.
 */
export interface TrainEventPlan {
  readonly firstArrivalDelayMs: number;
  readonly repeatAfterExitMs: number;
}

export function getClassicTrainEventPlan(): TrainEventPlan {
  return {
    firstArrivalDelayMs: TRAIN.DEFAULT_FIRST_ARRIVAL_MS,
    repeatAfterExitMs: TRAIN.DEFAULT_REPEAT_AFTER_EXIT_MS,
  };
}

/** Zeitpunkt der nächsten klassischen Einfahrt nach dem Verlassen der Arena. */
export function getNextClassicTrainArrivalAt(exitedAt: number, plan: TrainEventPlan): number {
  return exitedAt + plan.repeatAfterExitMs;
}

/**
 * Verbleibende Sekunden bis zur nächsten Einfahrt, aufgerundet.
 * null = keine Ankündigung (der Zug ist bereits unterwegs oder fährt nicht mehr ein).
 */
export function getTrainArrivalCountdownSecs(spawnAt: number, synchronizedNow: number): number | null {
  const remainingMs = spawnAt - synchronizedNow;
  if (remainingMs <= 0) return null;
  return Math.ceil(remainingMs / 1000);
}

/** HUD-Ankündigung der nächsten Einfahrt; unter einer Minute bewusst als reine Sekundenzahl. */
export function formatTrainArrivalLabel(arrivalSecs: number): string {
  const secs = Math.max(0, Math.ceil(arrivalSecs));
  if (secs < 60) return `RB 54 · ANKUNFT in ${secs}s`;
  const minutes = Math.floor(secs / 60);
  const seconds = secs % 60;
  return `RB 54 · ANKUNFT in ${minutes}:${seconds.toString().padStart(2, '0')}`;
}
