import type { ActivityDefinition } from './ActivityDefinition';
import type { WorldDefinition } from './WorldDefinition';

/**
 * Authored Paarung aus World und optionaler Activity.
 *
 * `activity: null` ist ein gueltiger, ausdruecklich vorgesehener Zustand – eine Welt ohne
 * Mission. Sie braucht dafuer weder ein Pseudo-Objective noch einen Dummy-Timer.
 *
 * Eine vorhandene Activity gehoert immer zu genau dieser World. Die Paarung wird deshalb ueber
 * {@link createAuthoredScenario} gebildet, nicht als beliebiges Objektliteral: sonst koennte ein
 * Aufrufer die Haelften zweier Welten kombinieren, und der Fehler faellt erst weit spaeter auf.
 */
export interface AuthoredScenario {
  readonly world: WorldDefinition;
  readonly activity: ActivityDefinition | null;
}

/** True, solange die Activity in genau dieser World stattfindet. */
export function isActivityOfWorldDefinition(
  activity: ActivityDefinition,
  world: WorldDefinition,
): boolean {
  return activity.worldDefinitionId === world.id;
}

/**
 * Bildet die Paarung und weist eine Activity ab, die zu einer anderen World gehoert. Das ist die
 * Authoring-Entsprechung zu `isActivityOfWorld()` auf der Replikationsebene.
 */
export function createAuthoredScenario(
  world: WorldDefinition,
  activity: ActivityDefinition | null,
): AuthoredScenario {
  if (activity && !isActivityOfWorldDefinition(activity, world)) {
    throw new Error(
      `[AuthoredScenario] Activity ${activity.id} belongs to world ${activity.worldDefinitionId}, not ${world.id}`,
    );
  }
  return { world, activity };
}

/** True, solange in dieser World ueberhaupt eine Activity authoriert ist. */
export function hasAuthoredActivity(scenario: AuthoredScenario): boolean {
  return scenario.activity !== null;
}
