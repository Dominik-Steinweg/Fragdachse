import type { CoopDefenseMapObjective } from '../config/coopDefenseMaps';
import type { GameMode, TeamId } from '../types';
import { COOP_DEFENSE_MODE, CAPTURE_THE_BEER_MODE } from '../gameModes';
import { getLocale, t, translate } from './index';

export function getLocalizedGameModeLabel(mode: GameMode): string {
  if (mode === 'team_deathmatch') return t('gameMode.teamDeathmatch');
  if (mode === CAPTURE_THE_BEER_MODE) return t('gameMode.captureTheBeer');
  if (mode === COOP_DEFENSE_MODE) return t('gameMode.coopDefense');
  return t('gameMode.deathmatch');
}

export function getLocalizedTeamLabel(teamId: TeamId, mode: GameMode): string {
  if (mode === COOP_DEFENSE_MODE && teamId === 'blue') return t('ui.score.teamFragdachse');
  return teamId === 'blue' ? t('ui.score.teamBlueFull') : t('ui.score.teamRedFull');
}

export function getLocalizedMapObjectiveLabel(
  objective: CoopDefenseMapObjective,
  locale = getLocale(),
): string {
  return translate(locale, `map.objective.${objective}`);
}
