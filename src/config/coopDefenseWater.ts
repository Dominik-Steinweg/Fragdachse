import type { CoopBaseAnchor, CoopBaseShape, CoopDefenseMapAuthoringConfig, CoopDefenseMapConfig } from './coopDefenseMapAuthoring';
import { isCellInsidePersistentBaseReservation } from '../persistentBase/PersistentBaseZone';
import type { WaterCell } from '../types';

/** Water leaves one free cell around ordinary bases, including outposts and spawn points. */
const BASE_WATER_CLEARANCE_CELLS = 1;
/** The persistent core retains its previous water clearance in addition to its reservation. */
const PERSISTENT_CORE_WATER_CLEARANCE_CELLS = 5;

type WaterAuthoring = Pick<CoopDefenseMapConfig,
  'water' | 'bases' | 'persistentBase' | 'rockWalls' | 'missionProgress' | 'trackMode' | 'trackPosition'>
  & Pick<CoopDefenseMapAuthoringConfig, 'waterAreas'>;

/** Shared by authoring validation (including editor saves) and deterministic generation. */
export function normalizeCoopDefenseWater(config: WaterAuthoring, cols: number, rows: number): WaterCell[] | undefined {
  const { water: cells, waterAreas: areas, bases, persistentBase, rockWalls: walls, missionProgress: mission } = config;
  const tracks = config.trackMode === 'none' ? undefined : config.trackPosition;
  if (cells === undefined && areas === undefined) return undefined;
  if (cells !== undefined && !Array.isArray(cells)) throw new Error('[coopDefenseMaps] Water must be an array');
  if (areas !== undefined && !Array.isArray(areas)) throw new Error('[coopDefenseMaps] Water areas must be an array');
  const baseRegions = bases.map(base => {
    const { width, height } = getBaseShapeDimensions(base.shape);
    const origin = getBaseOriginForArena(base.anchor, width, height, cols, rows);
    // Match runtime base placement; the editor separately rejects bases requiring clamping.
    const x = Math.max(0, Math.min(origin.gridX, cols - width));
    const y = Math.max(0, Math.min(origin.gridY, rows - height));
    const offsets = base.shape.kind === 'rectangle'
      ? Array.from({ length: width * height }, (_, i) => ({ gridX: i % width, gridY: Math.floor(i / width) }))
      : base.shape.cells;
    const footprint = offsets.map(cell => ({ gridX: x + cell.gridX, gridY: y + cell.gridY }))
      .filter(cell => cell.gridX >= 0 && cell.gridX < cols && cell.gridY >= 0 && cell.gridY < rows);
    const clearance = base.id === persistentBase?.baseId ? PERSISTENT_CORE_WATER_CLEARANCE_CELLS : BASE_WATER_CLEARANCE_CELLS;
    return {
      id: base.id,
      minX: (footprint.length ? Math.min(...footprint.map(cell => cell.gridX)) : 0) - clearance,
      maxX: (footprint.length ? Math.max(...footprint.map(cell => cell.gridX)) : 0) + clearance,
      minY: (footprint.length ? Math.min(...footprint.map(cell => cell.gridY)) : 0) - clearance,
      maxY: (footprint.length ? Math.max(...footprint.map(cell => cell.gridY)) : 0) + clearance,
    };
  });
  const blocked = new Set<string>();
  for (const wall of walls ?? []) for (let y = wall.gridY; y < wall.gridY + wall.heightCells; y++)
    for (let x = wall.gridX; x < wall.gridX + wall.widthCells; x++) blocked.add(x + '_' + y);
  for (const barrier of mission?.barriers ?? []) for (const cell of barrier.cells) blocked.add(cell.gridX + '_' + cell.gridY);
  for (const checkpoint of [...(mission?.checkpoints ?? []), ...(mission?.startArea ? [mission.startArea] : [])]) {
    const radius = checkpoint.radiusCells ?? 1;
    for (let y = Math.max(0, Math.ceil(checkpoint.gridY - radius)); y <= Math.min(rows - 1, Math.floor(checkpoint.gridY + radius)); y++)
      for (let x = Math.max(0, Math.ceil(checkpoint.gridX - radius)); x <= Math.min(cols - 1, Math.floor(checkpoint.gridX + radius)); x++)
        if ((x - checkpoint.gridX) ** 2 + (y - checkpoint.gridY) ** 2 <= radius ** 2) blocked.add(x + '_' + y);
  }
  const validateCell = (gridX: number, gridY: number): void => {
    const key = gridX + '_' + gridY;
    const base = baseRegions.find(region => gridX >= region.minX && gridX <= region.maxX && gridY >= region.minY && gridY <= region.maxY);
    if (base) throw new Error(`[coopDefenseMaps] Water overlaps authored structure or base clearance (${base.id}): ${key}`);
    if (persistentBase && isCellInsidePersistentBaseReservation(gridX, gridY, persistentBase.anchor))
      throw new Error(`[coopDefenseMaps] Water overlaps persistent base reservation (${persistentBase.baseId}): ${key}`);
    if (blocked.has(key)) throw new Error('[coopDefenseMaps] Water overlaps authored structure: ' + key);
    if (typeof tracks === 'object' && (gridX === tracks.gridX || gridX === tracks.gridX + 1))
      throw new Error('[coopDefenseMaps] Water overlaps authored railway: ' + key);
  };
  const seen = new Set<string>();
  const result = (cells ?? []).map(cell => {
    if (!cell || !Number.isInteger(cell.gridX) || !Number.isInteger(cell.gridY)
      || cell.gridX < 0 || cell.gridY < 0 || cell.gridX >= cols || cell.gridY >= rows)
      throw new Error('[coopDefenseMaps] Water cell outside arena or non-integer');
    const key = cell.gridX + '_' + cell.gridY;
    if (seen.has(key)) throw new Error('[coopDefenseMaps] Duplicate water cell: ' + key);
    validateCell(cell.gridX, cell.gridY);
    seen.add(key);
    return { gridX: cell.gridX, gridY: cell.gridY };
  });
  for (const area of areas ?? []) {
    if (!area || ![area.gridX, area.gridY, area.widthCells, area.heightCells].every(Number.isSafeInteger)
      || area.gridX < 0 || area.gridY < 0 || area.widthCells <= 0 || area.heightCells <= 0
      || area.gridX + area.widthCells > cols || area.gridY + area.heightCells > rows) {
      throw new Error('[coopDefenseMaps] Invalid water area: expected an in-bounds rectangle with positive integer dimensions');
    }
    for (let y = area.gridY; y < area.gridY + area.heightCells; y++) {
      for (let x = area.gridX; x < area.gridX + area.widthCells; x++) {
        const key = x + '_' + y;
        validateCell(x, y);
        if (seen.has(key)) continue;
        seen.add(key);
        result.push({ gridX: x, gridY: y });
      }
    }
  }
  // Canonical order makes equivalent area unions independent of rectangle order.
  return areas === undefined ? result : result.sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
}

function getBaseShapeDimensions(shape: CoopBaseShape): { width: number; height: number } {
  if (shape.kind === 'rectangle') return { width: Math.max(1, shape.widthCells), height: Math.max(1, shape.heightCells) };
  let width = 1;
  let height = 1;
  for (const cell of shape.cells) {
    width = Math.max(width, cell.gridX + 1);
    height = Math.max(height, cell.gridY + 1);
  }
  return { width, height };
}

function getBaseOriginForArena(anchor: CoopBaseAnchor, width: number, height: number, cols: number, rows: number) {
  switch (anchor.kind) {
    case 'right-center':
      return { gridX: cols - width - Math.max(0, anchor.edgeInsetCells), gridY: Math.floor((rows - height) / 2) };
    case 'left-center':
      return { gridX: Math.max(0, anchor.edgeInsetCells), gridY: Math.floor((rows - height) / 2) };
    case 'center-offset':
      return { gridX: Math.floor((cols - width) / 2) + anchor.dxCells, gridY: Math.floor((rows - height) / 2) + anchor.dyCells };
    case 'grid':
      return { gridX: anchor.gridX, gridY: anchor.gridY };
  }
}
