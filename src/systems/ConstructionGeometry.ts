import { getCoopDefenseConstructionDefinition } from '../config/coopDefenseConstructions';
import { CELL_SIZE } from '../config';
import type { SyncedPlaceableRock } from '../types';
import type { WorldMetrics } from '../world/WorldMetrics';

const SINGLE_CELL = Object.freeze([{ dx: 0, dy: 0 }]);
export type ConstructionGeometrySource = Pick<SyncedPlaceableRock, 'constructionId' | 'gridX' | 'gridY'>;

/** Catalog-derived geometry shared by placement, replication, physics and presentation. */
export function getConstructionFootprint(source: Pick<SyncedPlaceableRock, 'constructionId'>) {
  return source.constructionId ? getCoopDefenseConstructionDefinition(source.constructionId).footprint : SINGLE_CELL;
}

export function getConstructionCells(source: ConstructionGeometrySource) {
  return getConstructionFootprint(source).map(({ dx, dy }) => ({ gridX: source.gridX + dx, gridY: source.gridY + dy }));
}

export function getConstructionBounds(source: ConstructionGeometrySource, metrics: Pick<WorldMetrics, 'offsetX' | 'offsetY'>) {
  const cells = getConstructionCells(source);
  const left = metrics.offsetX + Math.min(...cells.map(c => c.gridX)) * CELL_SIZE;
  const top = metrics.offsetY + Math.min(...cells.map(c => c.gridY)) * CELL_SIZE;
  const right = metrics.offsetX + (Math.max(...cells.map(c => c.gridX)) + 1) * CELL_SIZE;
  const bottom = metrics.offsetY + (Math.max(...cells.map(c => c.gridY)) + 1) * CELL_SIZE;
  return { left, top, right, bottom, width: right - left, height: bottom - top,
    x: (left + right) / 2, y: (top + bottom) / 2 };
}

export function nearestConstructionPoint(bounds: { left: number; top: number; right: number; bottom: number }, x: number, y: number) {
  const px = Math.max(bounds.left, Math.min(bounds.right, x));
  const py = Math.max(bounds.top, Math.min(bounds.bottom, y));
  return { x: px, y: py, distance: Math.hypot(px - x, py - y) };
}
