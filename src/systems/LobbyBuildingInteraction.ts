import { CELL_SIZE } from '../config';
import { LOBBY_BUILDING_INTERACTION_RADIUS_CELLS, LOBBY_MENU_ENTRANCES, type LobbyMenu } from '../config/authoring/lobbyBuildings';
import { t } from '../i18n';
import { worldCellCenter, type WorldMetrics } from '../world/WorldMetrics';
import type { WorldInteractionCandidate } from './WorldInteractionCandidate';

export function lobbyBuildingCandidates(metrics: WorldMetrics, worldRevision: number): WorldInteractionCandidate[] {
  return LOBBY_MENU_ENTRANCES.map(entrance => ({
    kind: 'lobby-menu', key: `lobby-menu:${entrance.menu}`, menu: entrance.menu,
    ...worldCellCenter(metrics, entrance.gridX, entrance.gridY), worldRevision,
    radius: LOBBY_BUILDING_INTERACTION_RADIUS_CELLS * CELL_SIZE,
    label: t(`ui.lobbyBuilding.open.${entrance.menu}`),
  }));
}

/** Personal UI access, independent of host-authoritative World actions. */
export function lobbyMenuDenial(menu: LobbyMenu, state: {
  coop: boolean; ready: boolean; host: boolean; itemsUnlocked: boolean; baseUnlocked: boolean; dawnUnlocked: boolean;
}): string | null {
  if (!state.coop) return t('ui.lobbyBuilding.coopOnly');
  if (state.ready) return t('ui.lobbyBuilding.unready');
  if (menu === 'base' && !state.host) return t('ui.base.hostOnly');
  if (menu === 'base' && !state.baseUnlocked) return t('ui.lobbyBuilding.baseLocked');
  if (menu === 'items' && !state.itemsUnlocked) return t('ui.lobbyBuilding.itemsLocked');
  if (menu === 'merchant' && !state.dawnUnlocked) return t('ui.dawn.locked');
  return null;
}
