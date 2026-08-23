import type { CoopDefenseRespawnBudgetPlayerState } from '../types';
import { formatNumber, getLocale, t } from '../i18n';

export interface CoopDefenseLifeStatusInput {
  /** Replizierter Budgetzustand des lokalen Spielers; `null` auf Maps ohne authored Budget. */
  readonly budget: CoopDefenseRespawnBudgetPlayerState | null;
  /** Ein Checkpoint mit `setRespawn` ist bereits autoritativ aktiviert. */
  readonly missionRespawnActive: boolean;
}

export interface CoopDefenseLifeStatusViewModel {
  readonly text: string;
  readonly color: string;
}

/**
 * Phaser-freie Kurzanzeige neben dem Rundentimer.
 *
 * Jede Map mit authored Respawn-Budget zeigt dieselbe Zeile; das Map-Ziel entscheidet nur, was
 * aus dem Aufbrauchen folgt. Waehrend eines respawnfaehigen Todes erklaert die Zeile zusaetzlich,
 * wo der Spieler zurueckkehrt, sobald ein Missions-Respawn-Checkpoint aktiv ist.
 */
export function buildCoopDefenseLifeStatusViewModel(
  input: CoopDefenseLifeStatusInput,
): CoopDefenseLifeStatusViewModel | null {
  const budget = input.budget;
  if (!budget) return null;
  if (budget.eliminated) return { text: t('ui.lifeStatus.eliminated'), color: '#ff5555' };
  if (!budget.alive && budget.remainingRespawns > 0 && input.missionRespawnActive) {
    return { text: t('ui.lifeStatus.missionRespawn'), color: '#ffd166' };
  }
  if (budget.alive && budget.remainingRespawns === 0) {
    return { text: t('ui.lifeStatus.lastLife'), color: '#ffb347' };
  }
  return {
    text: t('ui.lifeStatus.respawns', {
      count: formatNumber(budget.remainingRespawns, getLocale(), { useGrouping: false }),
    }),
    color: '#ffd166',
  };
}
