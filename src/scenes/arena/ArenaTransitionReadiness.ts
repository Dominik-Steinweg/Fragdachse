import type { GamePhase, RoundParticipationState } from '../../types';
import type { RoundState } from '../../network/NetworkBridge';
import type { ActivityDescriptor } from '../../world/ActivityDescriptor';
import type { WorldDescriptor } from '../../world/WorldDescriptor';
import {
  readWorldParticipation,
  type WorldParticipationState,
} from '../../world/WorldParticipation';

export interface ArenaTransitionReadiness {
  readonly phase: GamePhase;
  readonly worldDescriptor: WorldDescriptor | null;
  readonly activityDescriptor: ActivityDescriptor | null;
  readonly roundState: RoundState | null;
  readonly arenaStartTime: number;
  readonly participation: RoundParticipationState | null;
  readonly worldParticipationState: WorldParticipationState | null;
  readonly localPlayerId: string;
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
    worldParticipationState,
    localPlayerId,
  } = state;

  if (!worldDescriptor) return false;
  if (phase === 'ARENA') {
    return activityDescriptor !== null
      && activityDescriptor.worldRevision === worldDescriptor.worldRevision
      && roundState?.status === 'active'
      && roundState.roundStartTime === arenaStartTime
      && participation !== null
      && participation.roundRevision === activityDescriptor.activityRevision
      && isLocalWorldParticipationReady(
        worldParticipationState,
        worldDescriptor.worldRevision,
        participation,
        localPlayerId,
      );
  }

  if (activityDescriptor === null) return true;
  return roundState?.status === 'active'
    && roundState.roundStartTime === arenaStartTime
    && participation !== null
    && participation.roundRevision === activityDescriptor.activityRevision;
}

/**
 * Checks that the locally relevant World participation has converged with the accepted round
 * snapshot before the World build chooses its presentation surfaces.
 */
function isLocalWorldParticipationReady(
  worldParticipationState: WorldParticipationState | null,
  worldRevision: number,
  roundParticipation: RoundParticipationState,
  localPlayerId: string,
): boolean {
  if (!worldParticipationState || worldParticipationState.worldRevision !== worldRevision) return false;

  const localParticipation = readWorldParticipation(worldParticipationState, localPlayerId);
  const isRoundSpectator = roundParticipation.spectatorIds.includes(localPlayerId);
  const isRoundParticipant = roundParticipation.participantIds.includes(localPlayerId)
    && !isRoundSpectator;

  if (isRoundParticipant) {
    return localParticipation === 'joining' || localParticipation === 'interactive';
  }
  if (isRoundSpectator) return localParticipation === 'observer';

  // A player absent from both round lists is not meant to enter this Activity World.
  return localParticipation === 'none';
}
