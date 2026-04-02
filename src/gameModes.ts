import type { GameMode } from './types';

export const CAPTURE_THE_BEER_MODE: GameMode = 'capture_the_beer';

export function isTeamGameMode(mode: GameMode): boolean {
  return mode === 'team_deathmatch' || mode === CAPTURE_THE_BEER_MODE;
}

export function usesExpandedArena(mode: GameMode): boolean {
  return mode === CAPTURE_THE_BEER_MODE;
}

export function usesDynamicCamera(mode: GameMode): boolean {
  return mode === CAPTURE_THE_BEER_MODE;
}

export function getGameModeLabel(mode: GameMode): string {
  if (mode === 'team_deathmatch') return 'Team Deathmatch';
  if (mode === CAPTURE_THE_BEER_MODE) return 'Capture the Beer';
  return 'Deathmatch';
}