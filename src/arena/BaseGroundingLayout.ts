import { CELL_SIZE } from '../config';
import type { BaseVisualCell } from '../entities/BaseVisuals';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { BaseGroundingAsset } from './BaseGroundingConfig';

export interface BaseGroundingPlacement {
  readonly cellIndex: number;
  readonly asset: BaseGroundingAsset;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly alpha: number;
}

const DIRECTIONS = [
  { x: 0, y: -1, rotation: Math.PI },
  { x: 1, y: 0, rotation: -Math.PI / 2 },
  { x: 0, y: 1, rotation: 0 },
  { x: -1, y: 0, rotation: Math.PI / 2 },
] as const;
const EDGES = ['edge-a', 'edge-b', 'edge-c'] as const;

/** Coordinate-local variation: independent of entity IDs, faction, cell order and peer RNG. */
function sample(x: number, y: number, salt: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt + 1, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

/** Static, bounded decoration of the exposed footprint only; never collision geometry. */
export function buildBaseGroundingLayout(
  cells: readonly BaseVisualCell[],
  metrics: Pick<WorldMetrics, 'offsetX' | 'offsetY'>,
): BaseGroundingPlacement[] {
  const occupied = new Set(cells.map((cell) => `${cell.gridX},${cell.gridY}`));
  const has = (x: number, y: number) => occupied.has(`${x},${y}`);
  const result: BaseGroundingPlacement[] = [];
  cells.forEach((cell, cellIndex) => {
    const cx = metrics.offsetX + (cell.gridX + 0.5) * CELL_SIZE;
    const cy = metrics.offsetY + (cell.gridY + 0.5) * CELL_SIZE;
    DIRECTIONS.forEach((normal, side) => {
      if (has(cell.gridX + normal.x, cell.gridY + normal.y)) return;
      const random = (salt: number) => sample(cell.gridX, cell.gridY, side * 8 + salt);
      const tangent = (random(0) - 0.5) * 2;
      const x = cx + normal.x * (CELL_SIZE / 2 + 6) - normal.y * tangent;
      const y = cy + normal.y * (CELL_SIZE / 2 + 6) + normal.x * tangent;
      result.push({
        cellIndex, asset: EDGES[Math.floor(random(1) * EDGES.length)], x, y,
        width: CELL_SIZE * (1.38 + random(2) * 0.24),
        height: CELL_SIZE * (0.54 + random(3) * 0.08),
        rotation: normal.rotation, alpha: 0.94 + random(4) * 0.06,
      });
      // Readable stone fragments break up the fine-grained fringe at normal camera scale.
      if (sample(cell.gridX, cell.gridY, 40 + side) < 0.6) {
        const size = 16 + random(4) * 4;
        const along = (random(5) - 0.5) * 14;
        result.push({
          cellIndex, asset: random(3) < 0.5 ? 'corner-a' : 'corner-b',
          x: x - normal.y * along, y: y + normal.x * along,
          width: size, height: size, rotation: normal.rotation, alpha: 1,
        });
      }
      // Sparse secondary grit, still hugging the wall rather than filling a passage.
      if (random(5) < 0.32) {
        result.push({
          cellIndex, asset: 'scatter',
          x: x + normal.x * 2, y: y + normal.y * 2,
          width: 22, height: 16, rotation: normal.rotation, alpha: 0.6,
        });
      }
      const next = DIRECTIONS[(side + 1) % DIRECTIONS.length];
      if (has(cell.gridX + next.x, cell.gridY + next.y)
        || has(cell.gridX + normal.x + next.x, cell.gridY + normal.y + next.y)
        || random(6) > 0.65) return;
      const size = 22 + random(7) * 4;
      result.push({
        cellIndex, asset: random(3) < 0.5 ? 'corner-a' : 'corner-b',
        x: cx + (normal.x + next.x) * (CELL_SIZE / 2 + 1),
        y: cy + (normal.y + next.y) * (CELL_SIZE / 2 + 1),
        width: size, height: size, rotation: normal.rotation, alpha: 1,
      });
    });
  });
  return result;
}
