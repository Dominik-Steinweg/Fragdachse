import { CELL_SIZE } from '../../config';

/** Where a flight of blood ends up. */
export type BloodSurface = 'ground' | 'deck' | 'water' | 'rockFace' | 'rockTop' | 'solid';

/** First tall obstacle on a flight, as the World geometry reports it. */
export interface BloodObstacleHit {
  readonly x: number;
  readonly y: number;
  readonly distance: number;
  readonly kind: 'rock' | 'trunk' | 'base' | 'barrier';
}

/**
 * Read-only terrain view of one World for blood presentation. All answers are local and visual;
 * nothing here feeds back into gameplay.
 */
export interface BloodTerrain {
  /** First obstacle that stops direct fire on the segment; null for a free flight. */
  traceObstacle(startX: number, startY: number, endX: number, endY: number): BloodObstacleHit | null;
  /** Signed distance to the visible waterline in px; positive inside water. */
  waterDepth(x: number, y: number): number;
  /** A standing bridge deck covers the point (blood lands on its planks, not in the water). */
  onDeck(x: number, y: number): boolean;
  /** World rectangle blood stays inside. */
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  /** Origin of the cell grid (arena offset); rock faces lie on its lines. */
  readonly gridX: number;
  readonly gridY: number;
}

export interface BloodLanding {
  x: number;
  y: number;
  surface: BloodSurface;
  /** Outward face normal for rock faces and solids (points back towards the open ground). */
  nx: number;
  ny: number;
  /** Distance actually flown. */
  travel: number;
}

export function createBloodLanding(): BloodLanding {
  return { x: 0, y: 0, surface: 'ground', nx: 0, ny: 0, travel: 0 };
}

export interface BloodLandingRules {
  /** Signed water depth from which a point counts as water. */
  readonly landingDepthPx: number;
  /** Share of rock hits that clear the face and land on top. */
  readonly overShare: number;
  readonly overDepthPx: readonly [number, number];
}

/** Ground, deck or water at a point that no obstacle covers. */
export function classifyBloodPoint(terrain: BloodTerrain | null, x: number, y: number,
  landingDepthPx: number): 'ground' | 'deck' | 'water' {
  if (!terrain) return 'ground';
  if (terrain.onDeck(x, y)) return 'deck';
  return terrain.waterDepth(x, y) > landingDepthPx ? 'water' : 'ground';
}

/**
 * Clips one flight against the terrain. Rocks are higher than the flight: most of the spray hits
 * the face and sticks there; `over` (0..1, seeded) lets a share clear the face and land on top.
 * Other solids stop the blood, which drops at their foot. Free flights land on ground, deck or water.
 */
export function landBloodFlight(terrain: BloodTerrain | null, startX: number, startY: number,
  endX: number, endY: number, over: number, rules: BloodLandingRules, out: BloodLanding): BloodLanding {
  const dx = endX - startX, dy = endY - startY, length = Math.hypot(dx, dy);
  const dirX = length > 1e-6 ? dx / length : 1, dirY = length > 1e-6 ? dy / length : 0;
  out.nx = -dirX; out.ny = -dirY;
  if (!terrain) {
    out.x = endX; out.y = endY; out.travel = length; out.surface = 'ground';
    return out;
  }
  // Keep the end inside the World first; the arena edge is not a wall to splash against.
  let travel = length;
  const b = terrain.bounds, inset = 2;
  if (dirX > 0 && endX > b.x + b.width - inset) travel = Math.min(travel, (b.x + b.width - inset - startX) / dirX);
  if (dirX < 0 && endX < b.x + inset) travel = Math.min(travel, (b.x + inset - startX) / dirX);
  if (dirY > 0 && endY > b.y + b.height - inset) travel = Math.min(travel, (b.y + b.height - inset - startY) / dirY);
  if (dirY < 0 && endY < b.y + inset) travel = Math.min(travel, (b.y + inset - startY) / dirY);
  travel = Math.max(0, travel);
  const clippedX = startX + dirX * travel, clippedY = startY + dirY * travel;

  const hit = travel > 0.5 ? terrain.traceObstacle(startX, startY, clippedX, clippedY) : null;
  if (hit) {
    if (hit.kind === 'rock') {
      rockFaceNormal(terrain, hit.x, hit.y, dirX, dirY, out);
      if (over < rules.overShare) {
        // Cleared the face: lands a little way onto the rock top.
        const depth = rules.overDepthPx[0] + (rules.overDepthPx[1] - rules.overDepthPx[0]) * (over / Math.max(1e-6, rules.overShare));
        const remaining = Math.max(0, travel - hit.distance);
        const inward = Math.min(depth, Math.max(rules.overDepthPx[0], remaining));
        out.x = hit.x + dirX * inward; out.y = hit.y + dirY * inward;
        out.travel = hit.distance + inward; out.surface = 'rockTop';
        return out;
      }
      out.x = hit.x - dirX * 0.5; out.y = hit.y - dirY * 0.5;
      out.travel = Math.max(0, hit.distance - 0.5); out.surface = 'rockFace';
      return out;
    }
    out.x = hit.x - dirX * 1.5; out.y = hit.y - dirY * 1.5;
    out.travel = Math.max(0, hit.distance - 1.5); out.surface = 'solid';
    return out;
  }
  out.x = clippedX; out.y = clippedY; out.travel = travel;
  out.surface = classifyBloodPoint(terrain, clippedX, clippedY, rules.landingDepthPx);
  return out;
}

/**
 * Rock cells are grid rectangles: a hit on a vertical grid line is a west/east face, on a
 * horizontal one a north/south face. Corners lean both ways. The normal points out of the rock.
 */
function rockFaceNormal(terrain: BloodTerrain, x: number, y: number, dirX: number, dirY: number, out: BloodLanding): void {
  const fx = Math.abs(gridFraction(x - terrain.gridX)), fy = Math.abs(gridFraction(y - terrain.gridY));
  const onVertical = fx < 0.05, onHorizontal = fy < 0.05;
  let nx = onVertical ? -Math.sign(dirX) : 0, ny = onHorizontal ? -Math.sign(dirY) : 0;
  if (nx === 0 && ny === 0) { nx = -dirX; ny = -dirY; }
  const length = Math.hypot(nx, ny) || 1;
  out.nx = nx / length; out.ny = ny / length;
}

function gridFraction(value: number): number {
  const cells = value / CELL_SIZE;
  return (cells - Math.round(cells)) * CELL_SIZE;
}
