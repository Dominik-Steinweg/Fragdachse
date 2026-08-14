import type { GameMode } from './types';

export const CAPTURE_THE_BEER_MODE: GameMode = 'capture_the_beer';
export const COOP_DEFENSE_MODE: GameMode = 'coop_defense';

const MIN_PLAYERS_BY_MODE: Record<GameMode, number> = {
  deathmatch: 2,
  team_deathmatch: 2,
  capture_the_beer: 2,
  [COOP_DEFENSE_MODE]: 1,
};

export function isTeamGameMode(mode: GameMode): boolean {
  return mode === 'team_deathmatch' || mode === CAPTURE_THE_BEER_MODE || mode === COOP_DEFENSE_MODE;
}

export function isCoopDefenseMode(mode: GameMode): boolean {
  return mode === COOP_DEFENSE_MODE;
}

/** True wenn der Modus zwei gegnerische Teams hat, die der Spieler in der Lobby wählen kann. */
export function hasTeamSelection(mode: GameMode): boolean {
  return mode === 'team_deathmatch' || mode === CAPTURE_THE_BEER_MODE;
}

/** True wenn die Spielerfarbe durch die Teamfarbe überschrieben wird. */
export function usesTeamColors(mode: GameMode): boolean {
  return mode === 'team_deathmatch' || mode === CAPTURE_THE_BEER_MODE;
}

export function usesExpandedArena(mode: GameMode): boolean {
  return mode === CAPTURE_THE_BEER_MODE;
}

export function usesDynamicCamera(mode: GameMode): boolean {
  return mode === CAPTURE_THE_BEER_MODE;
}

export function getMinPlayersForMode(mode: GameMode): number {
  return MIN_PLAYERS_BY_MODE[mode];
}
