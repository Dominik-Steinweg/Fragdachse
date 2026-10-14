import type { WorldBaseDefinition } from './WorldDefinition';
import { LOBBY_MERCHANT } from './lobbyMerchant';

export type LobbyMenu = 'upgrades' | 'base' | 'items' | 'merchant';

/** Fixed 4x3 collision footprints; the transparent sprites occupy a 4x4 canvas. */
export const LOBBY_BUILDINGS = [
  { id: 'lobby-workshop', menu: 'upgrades', gridX: 43, gridY: 8, textureKey: 'construction_dawn_lobby_workshop', nameKey: 'ui.lobbyBuilding.workshop', entrance: { gridX: 42, gridY: 9 } },
  { id: 'lobby-yard', menu: 'base', gridX: 19, gridY: 29, textureKey: 'construction_dawn_lobby_yard', nameKey: 'ui.lobbyBuilding.yard', entrance: { gridX: 20.5, gridY: 28 } },
  { id: 'lobby-armory', menu: 'items', gridX: 43, gridY: 27, textureKey: 'construction_dawn_lobby_armory', nameKey: 'ui.lobbyBuilding.armory', entrance: { gridX: 42, gridY: 28 } },
] as const;

export const LOBBY_BUILDING_BASES: WorldBaseDefinition[] = LOBBY_BUILDINGS.map(building => ({
  id: building.id, surface: 'none', faction: 'friendly', role: 'outpost', hpMax: 1,
  anchor: { kind: 'grid', gridX: building.gridX, gridY: building.gridY },
  shape: { kind: 'rectangle', widthCells: 4, heightCells: 3 },
}));

export const LOBBY_MENU_ENTRANCES = [
  ...LOBBY_BUILDINGS.map(building => ({ menu: building.menu, ...building.entrance })),
  { menu: 'merchant', gridX: LOBBY_MERCHANT.dealer.gridX, gridY: LOBBY_MERCHANT.dealer.gridY },
] as const;

export const LOBBY_BUILDING_INTERACTION_RADIUS_CELLS = 2.5;

/** Small roof-edge lanterns; the shared world sky controls daylight extinction. */
export const LOBBY_BUILDING_LANTERN = {
  offsetX: -20, offsetY: -12, radiusPx: 128, intensity: 0.9, color: 0xffc477,
} as const;

/** Keep the canvas, approaches and opaque tree crowns clear in authored terrain. */
export const LOBBY_BUILDING_CLEAR_AREAS = LOBBY_BUILDINGS.map(building => ({
  minX: building.gridX - 2, maxX: building.gridX + 5,
  minY: building.gridY - 2, maxY: building.gridY + 4,
}));
