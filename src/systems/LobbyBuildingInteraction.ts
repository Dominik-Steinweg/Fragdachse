import { CELL_SIZE } from '../config';
import { LOBBY_BUILDINGS, LOBBY_BUILDING_INTERACTION_RADIUS_CELLS, LOBBY_MENU_ENTRANCES,
  type LobbyMenu } from '../config/authoring/lobbyBuildings';
import { LOBBY_MERCHANT_BASE } from '../config/authoring/lobbyMerchant';
import { t } from '../i18n';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { WorldInteractionCandidate, WorldInteractionFootprint } from './WorldInteractionCandidate';

export interface LobbyMenuAccessState {
  coop: boolean; ready: boolean; host: boolean; itemsUnlocked: boolean; baseUnlocked: boolean; dawnUnlocked: boolean;
}
export type LobbyMenuDenialCode = 'coop' | 'ready' | 'host' | 'locked';

function cellRect(metrics: WorldMetrics, gridX: number, gridY: number, widthCells: number, heightCells: number): WorldInteractionFootprint {
  const left = metrics.offsetX + gridX * CELL_SIZE, top = metrics.offsetY + gridY * CELL_SIZE;
  return { left, top, right: left + widthCells * CELL_SIZE, bottom: top + heightCells * CELL_SIZE };
}

function menuFootprint(metrics: WorldMetrics, menu: LobbyMenu): WorldInteractionFootprint {
  const building = LOBBY_BUILDINGS.find(entry => entry.menu === menu);
  if (building) return cellRect(metrics, building.gridX, building.gridY, 4, 3);
  const { anchor, shape } = LOBBY_MERCHANT_BASE;
  if (anchor.kind !== 'grid' || shape.kind !== 'rectangle') throw new Error('Lobby merchant stall must be a grid rectangle');
  return cellRect(metrics, anchor.gridX, anchor.gridY, shape.widthCells, shape.heightCells);
}

function menuName(menu: LobbyMenu): string {
  const building = LOBBY_BUILDINGS.find(entry => entry.menu === menu);
  return building ? t(building.nameKey) : t('ui.dawn.dealerName');
}

/** Entrances drive selection; the building's collision rectangle is what the focus frames. */
export function lobbyBuildingCandidates(metrics: WorldMetrics, worldRevision: number,
  blockedFor: (menu: LobbyMenu) => string | undefined = () => undefined): WorldInteractionCandidate[] {
  return LOBBY_MENU_ENTRANCES.map(entrance => ({
    kind: 'lobby-menu', key: `lobby-menu:${entrance.menu}`, menu: entrance.menu,
    x: metrics.offsetX + entrance.gridX * CELL_SIZE + CELL_SIZE / 2,
    y: metrics.offsetY + entrance.gridY * CELL_SIZE + CELL_SIZE / 2, worldRevision,
    radius: LOBBY_BUILDING_INTERACTION_RADIUS_CELLS * CELL_SIZE,
    label: t('ui.lobbyBuilding.open'), subject: menuName(entrance.menu), blocked: blockedFor(entrance.menu),
    footprint: menuFootprint(metrics, entrance.menu),
  }));
}

/** Personal UI access, independent of host-authoritative World actions. */
export function lobbyMenuDenialCode(menu: LobbyMenu, state: LobbyMenuAccessState): LobbyMenuDenialCode | null {
  if (!state.coop) return 'coop';
  if (state.ready) return 'ready';
  if (menu === 'base' && !state.host) return 'host';
  if (menu === 'base' && !state.baseUnlocked) return 'locked';
  if (menu === 'items' && !state.itemsUnlocked) return 'locked';
  if (menu === 'merchant' && !state.dawnUnlocked) return 'locked';
  return null;
}

/** Full sentence for the error toast after pressing Shift or a lobby button. */
export function lobbyMenuDenial(menu: LobbyMenu, state: LobbyMenuAccessState): string | null {
  const code = lobbyMenuDenialCode(menu, state);
  if (code === 'coop') return t('ui.lobbyBuilding.coopOnly');
  if (code === 'ready') return t('ui.lobbyBuilding.unready');
  if (code === 'host') return t('ui.base.hostOnly');
  if (code === 'locked') {
    if (menu === 'base') return t('ui.lobbyBuilding.baseLocked');
    if (menu === 'items') return t('ui.lobbyBuilding.itemsLocked');
    return t('ui.dawn.locked');
  }
  return null;
}

/** Short reason for the focus plaque, shown before pressing. */
export function lobbyMenuBlockedLabel(menu: LobbyMenu, state: LobbyMenuAccessState): string | undefined {
  const code = lobbyMenuDenialCode(menu, state);
  return code ? t(`ui.lobbyBuilding.blocked.${code}`) : undefined;
}
