import { LOBBY_BUILDINGS, LOBBY_BUILDING_INTERACTION_RANGE_PX, lobbyBuildingWorldRects,
  type LobbyBuilding, type LobbyMenu } from '../config/authoring/lobbyBuildings';
import { nearestStructurePoint, structureBounds } from '../arena/StructureOutline';
import { t } from '../i18n';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { WorldInteractionCandidate } from './WorldInteractionCandidate';

export interface LobbyMenuAccessState {
  coop: boolean; ready: boolean; itemsUnlocked: boolean; baseUnlocked: boolean; dawnUnlocked: boolean;
}
export type LobbyMenuDenialCode = 'coop' | 'ready' | 'locked';

/**
 * Every side is an entrance: the approach point is the outline point nearest to the player, so
 * selection measures the reach from the wall. The focus frames the whole outline.
 */
export function lobbyBuildingCandidates(metrics: WorldMetrics, worldRevision: number, player: { x: number; y: number },
  blockedFor: (menu: LobbyMenu) => string | undefined = () => undefined,
  buildings: readonly LobbyBuilding[] = LOBBY_BUILDINGS): WorldInteractionCandidate[] {
  return buildings.map(building => {
    const rects = lobbyBuildingWorldRects(metrics, building);
    const point = nearestStructurePoint(rects, player.x, player.y);
    return {
      kind: 'lobby-menu', key: `lobby-menu:${building.menu}`, menu: building.menu,
      x: point.x, y: point.y, worldRevision, radius: LOBBY_BUILDING_INTERACTION_RANGE_PX,
      label: t('ui.lobbyBuilding.open'), subject: t(building.nameKey), blocked: blockedFor(building.menu),
      footprint: structureBounds(rects),
    };
  });
}

/** Personal UI access, independent of host-authoritative World actions. */
export function lobbyMenuDenialCode(menu: LobbyMenu, state: LobbyMenuAccessState): LobbyMenuDenialCode | null {
  if (!state.coop) return 'coop';
  if (state.ready) return 'ready';
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
