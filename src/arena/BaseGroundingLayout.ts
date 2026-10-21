import { CELL_SIZE } from '../config';
import type { BaseVisualCell } from '../entities/BaseVisuals';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { BaseGroundingAsset } from './BaseGroundingConfig';

export interface BaseGroundingPlacement {
  readonly cellIndex: number;
  readonly kind: 'cluster' | 'pebble';
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
/** Nests stay well apart; the ground between them is the procedural apron (BaseGroundingField). */
const CLUSTER_SPACING = CELL_SIZE * 2.6;
/** Share of the spaced candidates that actually carry a nest. */
const CLUSTER_CHANCE = 0.6;

/** Coordinate-local variation: independent of entity IDs, faction, cell order and peer RNG. */
function sample(x: number, y: number, salt: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(salt + 1, 1274126177);
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

interface EdgeCandidate {
  readonly cellIndex: number;
  readonly cell: BaseVisualCell;
  readonly side: number;
  readonly along: number;
  readonly x: number;
  readonly y: number;
  readonly priority: number;
}

/** Choose separated nests, rather than outlining every tile. Buckets keep selection bounded. */
function selectClusters(candidates: readonly EdgeCandidate[]): Set<EdgeCandidate> {
  const selected = new Set<EdgeCandidate>();
  const buckets = new Map<string, EdgeCandidate[]>();
  const ordered = [...candidates].sort((a, b) => b.priority - a.priority
    || a.cell.gridY - b.cell.gridY || a.cell.gridX - b.cell.gridX || a.side - b.side);
  for (const candidate of ordered) {
    const bx = Math.floor(candidate.x / CLUSTER_SPACING);
    const by = Math.floor(candidate.y / CLUSTER_SPACING);
    let overlaps = false;
    for (let dy = -1; dy <= 1 && !overlaps; dy++) {
      for (let dx = -1; dx <= 1 && !overlaps; dx++) {
        for (const other of buckets.get(`${bx + dx},${by + dy}`) ?? []) {
          if (Math.hypot(candidate.x - other.x, candidate.y - other.y) < CLUSTER_SPACING) {
            overlaps = true;
            break;
          }
        }
      }
    }
    if (overlaps) continue;
    selected.add(candidate);
    const key = `${bx},${by}`;
    const bucket = buckets.get(key) ?? [];
    bucket.push(candidate);
    buckets.set(key, bucket);
  }
  return selected;
}

/**
 * Sparse stone nests on exposed edges, favouring corners: one group of stones and one or two
 * loose pebbles further out. The ground around them is the procedural apron
 * (BaseGroundingField). Nothing here changes collision geometry.
 */
export function buildBaseGroundingLayout(
  cells: readonly BaseVisualCell[],
  metrics: Pick<WorldMetrics, 'offsetX' | 'offsetY'>,
): BaseGroundingPlacement[] {
  const occupied = new Set(cells.map((cell) => `${cell.gridX},${cell.gridY}`));
  const has = (x: number, y: number) => occupied.has(`${x},${y}`);
  const candidates: EdgeCandidate[] = [];
  cells.forEach((cell, cellIndex) => {
    DIRECTIONS.forEach((normal, side) => {
      if (has(cell.gridX + normal.x, cell.gridY + normal.y)) return;
      const next = DIRECTIONS[(side + 1) % 4];
      const previous = DIRECTIONS[(side + 3) % 4];
      const nextOpen = !has(cell.gridX + next.x, cell.gridY + next.y);
      const previousOpen = !has(cell.gridX + previous.x, cell.gridY + previous.y);
      // In this tangent basis the next clockwise corner is the positive end of the edge.
      const cornerBias = nextOpen !== previousOpen ? (nextOpen ? 8 : -8) : 0;
      const along = cornerBias + (sample(cell.gridX, cell.gridY, side * 16) - 0.5) * 8;
      candidates.push({
        cellIndex, cell, side, along,
        x: (cell.gridX + 0.5) * CELL_SIZE + normal.x * (CELL_SIZE / 2 + 2) - normal.y * along,
        y: (cell.gridY + 0.5) * CELL_SIZE + normal.y * (CELL_SIZE / 2 + 2) + normal.x * along,
        priority: sample(cell.gridX, cell.gridY, side * 16 + 1) + (nextOpen || previousOpen ? 0.3 : 0),
      });
    });
  });

  const result: BaseGroundingPlacement[] = [];
  for (const candidate of selectClusters(candidates)) {
    const { cell, cellIndex, side } = candidate;
    const normal = DIRECTIONS[side];
    const random = (salt: number) => sample(cell.gridX, cell.gridY, side * 16 + salt);
    if (random(2) > CLUSTER_CHANCE) continue;
    const cx = metrics.offsetX + (cell.gridX + 0.5) * CELL_SIZE;
    const cy = metrics.offsetY + (cell.gridY + 0.5) * CELL_SIZE;
    const atEdge = (outward: number, along: number) => ({
      x: cx + normal.x * (CELL_SIZE / 2 + outward) - normal.y * along,
      y: cy + normal.y * (CELL_SIZE / 2 + outward) + normal.x * along,
    });
    const size = 17 + random(9) * 8;
    result.push({
      cellIndex, kind: 'cluster', asset: random(8) < 0.5 ? 'corner-a' : 'corner-b',
      ...atEdge(1 + random(5) * 4, candidate.along), width: size * (1.15 + random(10) * 0.2), height: size,
      rotation: normal.rotation + (random(6) - 0.5) * 0.9, alpha: 0.92,
    });
    // Size and opacity decrease outward: one or two isolated pebbles.
    const pebbles = random(11) < 0.5 ? 1 : 2;
    for (let tier = 0; tier < pebbles; tier++) {
      const pebble = tier === 0 ? 4 + random(12) * 2 : 2.5 + random(13) * 1.5;
      result.push({
        cellIndex, kind: 'pebble', asset: 'pebble-a',
        ...atEdge(size * 0.55 + 3 + tier * 5, candidate.along + (random(14 + tier) - 0.5) * 16),
        width: pebble, height: pebble, rotation: normal.rotation + random(16 + tier) * Math.PI,
        alpha: tier === 0 ? 0.85 : 0.7,
      });
    }
  }
  return result;
}
