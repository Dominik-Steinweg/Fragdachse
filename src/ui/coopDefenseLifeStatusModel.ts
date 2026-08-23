import type { CoopDefenseMapObjective } from '../config/coopDefenseMaps';
import type { CoopDefenseSurvivalPlayerState } from '../types';
import { t } from '../i18n';

export interface CoopDefenseLifeStatusInput {
  readonly objective: CoopDefenseMapObjective | null;
  /** Nur `survive` fuehrt ein persoenliches Respawn-Budget. */
  readonly survival: CoopDefenseSurvivalPlayerState | null;
  /** `advance`: ein Checkpoint mit `setRespawn` ist bereits autoritativ aktiviert. */
  readonly missionRespawnActive: boolean;
  readonly alive: boolean;
  /** Ergebnis der bestehenden Respawn-Policy; Vorstoss kennt keine eigene Zaehlung. */
  readonly canRespawn: boolean;
}

export interface CoopDefenseLifeStatusViewModel {
  readonly text: string;
  readonly color: string;
}

/**
 * Phaser-freie Kurzanzeige neben dem Rundentimer.
 *
 * Survival zeigt sein Respawn-Budget, Vorstoss bewusst keinen Lebenszaehler: dort erklaert die
 * Zeile nur waehrend eines respawnfaehigen Todes, wo der Spieler zurueckkehrt. Ohne aktiven
 * Missions-Respawn-Checkpoint bleibt sie leer, weil dann der normale Spawn-Fallback greift.
 */
export function buildCoopDefenseLifeStatusViewModel(
  input: CoopDefenseLifeStatusInput,
): CoopDefenseLifeStatusViewModel | null {
  if (input.objective === 'survive') {
    const survival = input.survival;
    if (!survival) return null;
    if (survival.eliminated) return { text: 'AUSGESCHIEDEN', color: '#ff5555' };
    if (survival.alive && survival.remainingRespawns === 0) return { text: 'LETZTES LEBEN', color: '#ffb347' };
    return { text: `RESPAWNS: ${survival.remainingRespawns}`, color: '#ffd166' };
  }

  if (input.objective === 'advance') {
    if (input.alive || !input.canRespawn || !input.missionRespawnActive) return null;
    return { text: t('ui.lifeStatus.missionRespawn'), color: '#ffd166' };
  }

  return null;
}
