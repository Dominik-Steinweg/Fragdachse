import type { GamePhase, RoundParticipationState } from '../../types';
import type { RoundState } from '../../network/NetworkBridge';
import type { ActivityDescriptor } from '../../world/ActivityDescriptor';
import type { WorldDescriptor } from '../../world/WorldDescriptor';

export interface ArenaTransitionReadiness {
  readonly phase: GamePhase;
  readonly worldDescriptor: WorldDescriptor | null;
  readonly activityDescriptor: ActivityDescriptor | null;
  readonly roundState: RoundState | null;
  readonly arenaStartTime: number;
  readonly participation: RoundParticipationState | null;
}

/**
 * Determines whether the local World build may proceed for the currently observed transition.
 *
 * ARENA requires the complete match snapshot. A World without Activity remains valid only
 * outside ARENA, for example while the authored LobbyWorld is running.
 */
export function isArenaTransitionReady(state: ArenaTransitionReadiness): boolean {
  const {
    phase,
    worldDescriptor,
    activityDescriptor,
    roundState,
    arenaStartTime,
    participation,
  } = state;

  if (!worldDescriptor) return false;
  if (phase === 'ARENA') {
    return activityDescriptor !== null
      && activityDescriptor.worldRevision === worldDescriptor.worldRevision
      && roundState?.status === 'active'
      && roundState.roundStartTime === arenaStartTime
      && participation !== null
      && participation.roundRevision === activityDescriptor.activityRevision;
  }

  if (activityDescriptor === null) return true;
  return roundState?.status === 'active'
    && roundState.roundStartTime === arenaStartTime
    && participation !== null
    && participation.roundRevision === activityDescriptor.activityRevision;
}
