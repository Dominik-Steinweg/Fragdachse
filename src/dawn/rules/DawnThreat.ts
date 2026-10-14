import { DAWN_MAX_THREAT } from '../contracts/DawnPlans';

/**
 * Threat ist keine eigene gespeicherte Groesse: Jede Expansion hebt ihn um genau eine Stufe.
 * Threat 1 entspricht dem Kampagnenende ohne Expansion.
 */
export function resolveDawnThreat(expansionLevel: number): number {
  const level = Number.isSafeInteger(expansionLevel) ? expansionLevel : 0;
  return Math.min(DAWN_MAX_THREAT, Math.max(1, 1 + level));
}
