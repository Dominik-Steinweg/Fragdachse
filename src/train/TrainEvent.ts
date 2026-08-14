import { TRAIN } from './TrainConfig';
import { translate } from '../i18n';
import type { Locale } from '../i18n/types';

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
export function formatTrainArrivalLabel(arrivalSecs: number, locale: Locale = 'de'): string {
  const secs = Math.max(0, Math.ceil(arrivalSecs));
  const time = secs < 60
    ? `${secs}s`
    : `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
  return translate(locale, 'ui.train.arrival', { time });
}
