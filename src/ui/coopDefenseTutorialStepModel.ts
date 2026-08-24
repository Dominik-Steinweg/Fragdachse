import type { ResolvedCoopDefenseMapTutorialStepConfig } from '../config/coopDefenseMaps';

/**
 * Hostseitig aktivierter Checkpoint aus dem replizierten Missions-Presentation-State.
 * Die Zeit ist die gemeinsame Rundenuhr des Hosts, nicht die lokale Phaser-Uhr.
 */
export interface CoopDefenseTutorialStepActivation {
  readonly checkpointId: string;
  readonly activatedAtRoundMs: number;
}

/**
 * Ermittelt den gemeinsamen Tutorial-Hinweis fuer alle Clients.
 *
 * Die Checkpoint-Aktivierung ist bereits Teil des hostautoritativen Missionszustands. Dieses
 * Modell liest nur diesen replizierten Zustand und entscheidet daraus die Darstellung; es
 * besitzt keine Gameplay-Autoritaet und wertet keine lokale Spielerposition aus. Die authored
 * Reihenfolge bleibt die Tie-Break-Reihenfolge, falls mehrere Aktivierungen zeitgleich vorliegen.
 */
export function getVisibleCoopDefenseTutorialStepId(
  steps: readonly ResolvedCoopDefenseMapTutorialStepConfig[],
  activatedCheckpoints: readonly CoopDefenseTutorialStepActivation[],
  roundElapsedMs: number,
): string | null {
  let visibleStep: ResolvedCoopDefenseMapTutorialStepConfig | null = null;
  let visibleActivatedAtRoundMs = -1;

  for (const step of steps) {
    const activation = activatedCheckpoints.find(({ checkpointId }) => checkpointId === step.checkpointId);
    if (!activation) continue;

    const activeUntilRoundMs = activation.activatedAtRoundMs + step.durationMs;
    if (roundElapsedMs < activation.activatedAtRoundMs || roundElapsedMs >= activeUntilRoundMs) continue;

    if (activation.activatedAtRoundMs >= visibleActivatedAtRoundMs) {
      visibleStep = step;
      visibleActivatedAtRoundMs = activation.activatedAtRoundMs;
    }
  }

  return visibleStep?.id ?? null;
}
