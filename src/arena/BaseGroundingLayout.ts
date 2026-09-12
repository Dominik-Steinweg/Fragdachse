import { CELL_SIZE } from '../config';
import type { BaseVisualCell } from '../entities/BaseVisuals';
import type { WorldMetrics } from '../world/WorldMetrics';
import type { BaseGroundingAsset } from './BaseGroundingConfig';

export interface BaseGroundingPlacement {
  readonly cellIndex: number;
  readonly kind: 'soil' | 'gravel' | 'cluster' | 'pebble';
  readonly asset: BaseGroundingAsset;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
  readonly alpha: number;
  readonly tint?: number;
}

const DIRECTIONS = [
  { x: 0, y: -1, rotation: Math.PI },
  { x: 1, y: 0, rotation: -Math.PI / 2 },
  { x: 0, y: 1, rotation: 0 },
  { x: -1, y: 0, rotation: Math.PI / 2 },
] as const;
const CLUSTER_SPACING = CELL_SIZE * 1.35;
const GRAVEL_VARIANTS = ['edge-a', 'edge-b', 'edge-c'] as const;

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

/** Static ground layers follow exposed edges; nothing here changes collision geometry. */
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
      const cornerBias = nextOpen !== previousOpen ? (nextOpen ? 5 : -5) : 0;
      const along = cornerBias + (sample(cell.gridX, cell.gridY, side * 16) - 0.5) * 5;
      candidates.push({
        cellIndex, cell, side, along,
        x: (cell.gridX + 0.5) * CELL_SIZE + normal.x * (CELL_SIZE / 2 + 2) - normal.y * along,
        y: (cell.gridY + 0.5) * CELL_SIZE + normal.y * (CELL_SIZE / 2 + 2) + normal.x * along,
        priority: sample(cell.gridX, cell.gridY, side * 16 + 1) + (nextOpen || previousOpen ? 0.22 : 0),
      });
    });
  });

  const clusters = selectClusters(candidates);
  const result: BaseGroundingPlacement[] = [];
  for (const candidate of candidates) {
    const { cell, cellIndex, side } = candidate;
    const normal = DIRECTIONS[side];
    const random = (salt: number) => sample(cell.gridX, cell.gridY, side * 16 + salt);
    const isCluster = clusters.has(candidate);
    const cx = metrics.offsetX + (cell.gridX + 0.5) * CELL_SIZE;
    const cy = metrics.offsetY + (cell.gridY + 0.5) * CELL_SIZE;
    const atEdge = (outward: number, along: number) => ({
      x: cx + normal.x * (CELL_SIZE / 2 + outward) - normal.y * along,
      y: cy + normal.y * (CELL_SIZE / 2 + outward) + normal.x * along,
    });

    // A darker compacted core remains visible on pale gravel; generated alpha softens its edge.
    if (isCluster || random(2) > 0.28) {
      result.push({
        cellIndex, kind: 'soil', asset: random(3) < 0.5 ? 'soil-a' : 'soil-b',
        ...atEdge(1, (random(4) - 0.5) * 5),
        width: 46 + random(5) * 8, height: 27 + random(6) * 3,
        rotation: normal.rotation, alpha: isCluster ? 0.88 : 0.56 + random(7) * 0.14,
        tint: 0xb49a7c,
      });
    }

    // The old granular textures now form discrete deposits, never a strip on every edge.
    if (isCluster || random(2) < 0.24) {
      result.push({
        cellIndex, kind: 'gravel', asset: GRAVEL_VARIANTS[Math.floor(random(3) * GRAVEL_VARIANTS.length)],
        ...atEdge(isCluster ? 4 : 5, candidate.along),
        width: isCluster ? 36 + random(5) * 8 : 23 + random(5) * 6,
        height: isCluster ? 16 + random(6) * 4 : 10 + random(6) * 3,
        rotation: normal.rotation, alpha: isCluster ? 0.86 : 0.66,
      });
    }
    if (!isCluster) continue;

    // Pale fine aggregate makes a broken transition between the compact soil and loose stones.
    result.push({
      cellIndex, kind: 'gravel', asset: 'scatter',
      ...atEdge(8, candidate.along - (random(4) - 0.5) * 7),
      width: 24 + random(7) * 5, height: 13 + random(6) * 3,
      rotation: normal.rotation, alpha: 0.52, tint: 0xc6b294,
    });

    result.push({
      cellIndex, kind: 'cluster', asset: random(8) < 0.5 ? 'corner-a' : 'corner-b',
      ...atEdge(2, candidate.along), width: 28 + random(9) * 6, height: 21 + random(10) * 5,
      rotation: normal.rotation, alpha: 0.94,
    });
    // Size and opacity decrease outward: one medium stone, then one isolated small pebble.
    for (let tier = 0; tier < 2; tier++) {
      const size = tier === 0 ? 5 + random(11) * 2 : 2.5 + random(12) * 1.5;
      result.push({
        cellIndex, kind: 'pebble', asset: 'pebble-a',
        ...atEdge(tier === 0 ? 8 : 13, candidate.along + (random(13 + tier) - 0.5) * 13),
        width: size, height: size, rotation: normal.rotation + random(15) * Math.PI,
        alpha: tier === 0 ? 0.85 : 0.65,
      });
    }
  }
  return result;
}
