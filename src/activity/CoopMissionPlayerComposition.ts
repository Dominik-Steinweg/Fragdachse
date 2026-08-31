import type { CoopMissionActivityConfiguration } from './CoopMissionActivityConfig';
import { CoopMissionPlayerRuntime } from './CoopMissionPlayerRuntime';
import type { CoopMissionRuntime } from './CoopMissionRuntime';
import { CoopDefenseRespawnBudgetSystem } from '../systems/CoopDefenseRespawnBudgetSystem';
import { objectiveUsesRespawnBudget } from '../config/coopDefenseMaps';
import type { CoopDefenseRespawnBudgetState } from '../types';
import type { PlayerWorldRuntime } from '../world/PlayerWorldRuntime';

export interface CoopMissionPlayerCompositionOptions {
  readonly activity: CoopMissionActivityConfiguration;
  readonly isHost: boolean;
  readonly playerWorldRuntime: PlayerWorldRuntime | null;
  readonly getParticipantIds: () => readonly string[];
  readonly releaseMissionObjectives: (runtime: CoopMissionRuntime, playerId: string) => void;
  readonly publishRespawnBudget: (state: CoopDefenseRespawnBudgetState | null) => void;
}

/** Materializes only the Activity-owned half of the player lifecycle. */
export class CoopMissionPlayerComposition {
  constructor(private readonly options: CoopMissionPlayerCompositionOptions) {}

  materialize(runtime: CoopMissionRuntime): void {
    const definition = this.options.activity.mapConfig;
    const respawnBudget = this.options.isHost
      && objectiveUsesRespawnBudget(definition.objective)
      && definition.respawnsPerPlayer !== undefined
      ? new CoopDefenseRespawnBudgetSystem({
        respawnsPerPlayer: definition.respawnsPerPlayer,
        participantIds: this.options.getParticipantIds(),
      })
      : null;
    if (this.options.isHost && objectiveUsesRespawnBudget(definition.objective)
      && definition.respawnsPerPlayer === undefined) {
      throw new Error(`[CoopMissionPlayerComposition] Activity ${this.options.activity.definitionId} has no respawnsPerPlayer`);
    }
    const playerActivity = new CoopMissionPlayerRuntime({
      respawnBudget,
      releaseMissionObjectives: (playerId) => {
        this.options.releaseMissionObjectives(runtime, playerId);
      },
      ensureAllyFlowField: (playerId) => { runtime.ensureAllyFlowField(playerId); },
      removeAllyFlowField: (playerId) => { runtime.removeAllyFlowField(playerId); },
      publishRespawnBudget: (state) => { this.options.publishRespawnBudget(state); },
    });

    for (const playerId of this.options.playerWorldRuntime?.attachedPlayerIds() ?? []) {
      playerActivity.attach(playerId);
    }
    playerActivity.publishRespawnBudget();
    runtime.setPlayerActivity(playerActivity);
  }
}
