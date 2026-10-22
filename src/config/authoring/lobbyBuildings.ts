import { CELL_SIZE } from '../../config';
import {
  structureBounds,
  structureOccupancyCells,
  translateStructureRects,
  type StructureBounds,
  type StructureOutlineDefinition,
  type StructureRect,
} from '../../arena/StructureOutline';
import type { WorldBaseDefinition } from './WorldDefinition';
import outlines from './lobbyStructureOutlines.json';

export type LobbyMenu = 'upgrades' | 'base' | 'items' | 'merchant';

interface LobbyStructureOutlineEntry extends StructureOutlineDefinition {
  readonly id: string;
  /** Bumped whenever the outline changes. */
  readonly revision: number;
  /** Hash of the `solid.png` the outline was derived from; `null` marks a handwritten placeholder. */
  readonly sourceSha256: string | null;
}

const OUTLINES = outlines as readonly LobbyStructureOutlineEntry[];

/**
 * The four menu structures east of the spawn, outside the persistent base reserve, each about
 * 5x4 cells with walkable ground all around. Collision, fog and focus follow the authored outline
 * in `lobbyStructureOutlines.json`; the shape is that outline's cell occupancy. Art and outline come
 * from the same Blender export (`src/assets/manifests/lobby-structures.json`).
 */
export const LOBBY_BUILDINGS = [
  { id: 'lobby-merchant-stall', menu: 'merchant', gridX: 53, gridY: 8, nameKey: 'ui.dawn.dealerName' },
  { id: 'lobby-workshop', menu: 'upgrades', gridX: 44, gridY: 8, nameKey: 'ui.lobbyBuilding.workshop' },
  { id: 'lobby-yard', menu: 'base', gridX: 53, gridY: 27, nameKey: 'ui.lobbyBuilding.yard' },
  { id: 'lobby-armory', menu: 'items', gridX: 44, gridY: 27, nameKey: 'ui.lobbyBuilding.armory' },
] as const;

export type LobbyBuilding = typeof LOBBY_BUILDINGS[number];

/** Outline local to the building's grid origin. */
export function lobbyBuildingOutline(building: Pick<LobbyBuilding, 'id'>): StructureOutlineDefinition {
  const entry = OUTLINES.find(candidate => candidate.id === building.id);
  if (!entry) throw new Error(`Lobby structure ${building.id} has no outline`);
  return { stepPx: entry.stepPx, rects: entry.rects };
}

/** World-pixel outline of a lobby structure: the rects its collision bodies resolve to as well. */
export function lobbyBuildingWorldRects(origin: { readonly offsetX: number; readonly offsetY: number },
  building: Pick<LobbyBuilding, 'id' | 'gridX' | 'gridY'>): StructureRect[] {
  return translateStructureRects(lobbyBuildingOutline(building).rects,
    origin.offsetX + building.gridX * CELL_SIZE, origin.offsetY + building.gridY * CELL_SIZE);
}

/** Outline bounds in cells of the World grid, inclusive. */
export function lobbyBuildingCellBounds(building: LobbyBuilding): { minX: number; maxX: number; minY: number; maxY: number } {
  const bounds: StructureBounds = structureBounds(lobbyBuildingOutline(building).rects);
  return {
    minX: building.gridX + Math.floor(bounds.left / CELL_SIZE),
    maxX: building.gridX + Math.ceil(bounds.right / CELL_SIZE) - 1,
    minY: building.gridY + Math.floor(bounds.top / CELL_SIZE),
    maxY: building.gridY + Math.ceil(bounds.bottom / CELL_SIZE) - 1,
  };
}

export const LOBBY_BUILDING_BASES: WorldBaseDefinition[] = LOBBY_BUILDINGS.map(building => {
  const structure = lobbyBuildingOutline(building);
  return {
    id: building.id, surface: 'none', faction: 'friendly', role: 'outpost',
    // World structures without an Activity are invulnerable and have no health bar.
    hpMax: 1,
    anchor: { kind: 'grid', gridX: building.gridX, gridY: building.gridY },
    shape: { kind: 'cells', cells: structureOccupancyCells(structure.rects) },
    structure,
  };
});

/** Shift reach, measured from the nearest wall point: every side of a structure is an entrance. */
export const LOBBY_BUILDING_INTERACTION_RANGE_PX = 56;

/** Walkable ground kept free around every structure, so each side can be approached. */
export const LOBBY_BUILDING_RING_CELLS = 2;

/** Landscape clearance beyond the outline: the walkable ring plus the apron and roof shadow edge. */
const LOBBY_BUILDING_CLEAR_MARGIN_CELLS = LOBBY_BUILDING_RING_CELLS + 1;

/** Small roof-edge lanterns; the shared world sky controls daylight extinction. */
export const LOBBY_BUILDING_LANTERN = {
  offsetX: -20, offsetY: -12, radiusPx: 128, intensity: 0.9, color: 0xffc477,
} as const;

/** Keep the outline, its approaches and opaque tree crowns clear in authored terrain. */
export const LOBBY_BUILDING_CLEAR_AREAS = LOBBY_BUILDINGS.map(building => {
  const cells = lobbyBuildingCellBounds(building);
  return {
    minX: cells.minX - LOBBY_BUILDING_CLEAR_MARGIN_CELLS, maxX: cells.maxX + LOBBY_BUILDING_CLEAR_MARGIN_CELLS,
    minY: cells.minY - LOBBY_BUILDING_CLEAR_MARGIN_CELLS, maxY: cells.maxY + LOBBY_BUILDING_CLEAR_MARGIN_CELLS,
  };
});
