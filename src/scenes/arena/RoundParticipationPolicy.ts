import type { RoundParticipationState, RoundPlayerRole } from '../../types';

function uniqueSorted(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))].sort();
}

function cloneState(state: RoundParticipationState): RoundParticipationState {
  return {
    roundStartTime: state.roundStartTime,
    roundRevision: state.roundRevision,
    participantIds: [...state.participantIds],
    spectatorIds: [...state.spectatorIds],
  };
}

/** Erzeugt den unveraenderten Teilnehmer-Snapshot fuer eine neue Runde. */
export function createRoundParticipationState(
  roundStartTime: number,
  participantIds: readonly string[],
  roundRevision = roundStartTime,
): RoundParticipationState {
  return {
    roundStartTime,
    roundRevision,
    participantIds: uniqueSorted(participantIds),
    spectatorIds: [],
  };
}

/** Markiert einen nachtraeglich beigetretenen Spieler als Spectator. */
export function markRoundLateJoiner(
  state: RoundParticipationState,
  playerId: string,
): RoundParticipationState {
  const next = cloneState(state);
  if (!next.participantIds.includes(playerId) && !next.spectatorIds.includes(playerId)) {
    next.spectatorIds.push(playerId);
    next.spectatorIds.sort();
  }
  return next;
}

/** Schaltet einen aktiven Teilnehmer dauerhaft fuer die laufende Runde auf Spectator. */
export function enterRoundSpectator(
  state: RoundParticipationState,
  playerId: string,
): RoundParticipationState {
  const next = cloneState(state);
  if (!next.spectatorIds.includes(playerId)) {
    next.spectatorIds.push(playerId);
    next.spectatorIds.sort();
  }
  return next;
}

export function getRoundPlayerRole(
  state: RoundParticipationState | null | undefined,
  playerId: string,
): RoundPlayerRole {
  if (!state) return 'spectator';
  if (!state.participantIds.includes(playerId)) return 'spectator';
  return state.spectatorIds.includes(playerId) ? 'spectator' : 'participant';
}

export function isRoundParticipant(
  state: RoundParticipationState | null | undefined,
  playerId: string,
): boolean {
  return getRoundPlayerRole(state, playerId) === 'participant';
}

/** Rollen-Gate fuer Spawn und Respawn; das authored Respawn-Budget liegt bewusst darueber. */
export function canRoundPlayerSpawnOrRespawn(
  state: RoundParticipationState | null | undefined,
  playerId: string,
): boolean {
  return isRoundParticipant(state, playerId);
}

/** Ergebnis-/XP-/Freischaltungsberechtigung ist identisch mit der aktiven Teilnehmerrolle. */
export function canRoundPlayerReceiveRewards(
  state: RoundParticipationState | null | undefined,
  playerId: string,
): boolean {
  return isRoundParticipant(state, playerId);
}

/**
 * Verbundene Spieler, die in dieser Runde aktiv teilnehmen. Gemeinsame Quelle fuer die
 * Ergebnisberechtigung und fuer die host-lokale Startbedingung der Runde.
 */
export function getActiveRoundParticipantIds(
  state: RoundParticipationState | null | undefined,
  connectedIds: readonly string[],
): string[] {
  if (!state) return [];
  const connected = new Set(connectedIds);
  return state.participantIds.filter((id) => connected.has(id) && isRoundParticipant(state, id));
}

/** Ergebnis-/XP-/Freischaltungsberechtigung ist identisch mit der aktiven Teilnahme. */
export function getRoundResultEligibleIds(
  state: RoundParticipationState | null | undefined,
  connectedIds: readonly string[],
): string[] {
  return getActiveRoundParticipantIds(state, connectedIds);
}
