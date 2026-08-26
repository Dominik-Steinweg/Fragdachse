import type { ActivityDefinition } from './ActivityDefinition';
import type { WorldDefinition } from './WorldDefinition';

/**
 * Authored Paarung aus World und optionaler Activity.
 *
 * `activity: null` ist ein gueltiger, ausdruecklich vorgesehener Zustand – eine Welt ohne
 * Mission. Sie braucht dafuer weder ein Pseudo-Objective noch einen Dummy-Timer.
 */
export interface AuthoredScenario {
  readonly world: WorldDefinition;
  readonly activity: ActivityDefinition | null;
}

/** True, solange in dieser World ueberhaupt eine Activity authoriert ist. */
export function hasAuthoredActivity(scenario: AuthoredScenario): boolean {
  return scenario.activity !== null;
}
