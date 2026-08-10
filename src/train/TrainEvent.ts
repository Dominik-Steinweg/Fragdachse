import type { CoopDefenseMapConfig } from '../config/coopDefenseMaps';
import { TRAIN } from './TrainConfig';

/**
 * Aufgelöster Rhythmus des Zug-Events einer Runde.
 *
 * Der Zug ist ein kleines Umgebungs-Event der Map, kein Encounter und kein Teil des
 * Rundentimers: Ankündigung und Wiedereinfahrt hängen ausschließlich an diesen Werten
 * und am autoritativen `TrainEventConfig.spawnAt`, nie an `roundEndTime`.
 */
export interface TrainEventPlan {
  /** Verzögerung der ersten Einfahrt gegenüber dem Rundenstart, in ms. */
  readonly firstArrivalDelayMs: number;
  /** Pause zwischen Verlassen der Arena und nächster Einfahrt; null = einmalige Einfahrt. */
  readonly repeatAfterExitMs: number | null;
}

/**
 * Liefert den Zugrhythmus der Runde oder null, wenn auf dieser Map kein Zug fährt.
 *
 * Modi ohne Coop-Defense-Map-Konfiguration (Deathmatch, Team-Deathmatch, Capture the Beer)
 * behalten den klassischen Rhythmus aus {@link TRAIN}; Coop-Defense-Maps entscheiden über
 * ihr `train`-Feld – Gleise allein reichen dort nicht mehr.
 */
export function resolveTrainEventPlan(
  mapConfig: CoopDefenseMapConfig | null | undefined,
): TrainEventPlan | null {
  if (!mapConfig) {
    return {
      firstArrivalDelayMs: TRAIN.DEFAULT_FIRST_ARRIVAL_MS,
      repeatAfterExitMs: TRAIN.DEFAULT_REPEAT_AFTER_EXIT_MS,
    };
  }

  const train = mapConfig.train;
  if (!train) return null;

  switch (train.firstArrival.type) {
    case 'time':
      return {
        firstArrivalDelayMs: train.firstArrival.atMs,
        repeatAfterExitMs: train.repeatAfterExitMs ?? null,
      };
  }
}

/** Zeitpunkt der nächsten Einfahrt nach dem Verlassen der Arena; null = keine weitere. */
export function getNextTrainArrivalAt(exitedAt: number, plan: TrainEventPlan): number | null {
  if (plan.repeatAfterExitMs === null) return null;
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
