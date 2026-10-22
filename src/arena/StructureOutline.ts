import { CELL_SIZE } from '../config';
import { EDGE_BOTTOM, EDGE_LEFT, EDGE_RIGHT, EDGE_TOP } from '../effects/lightShadowGeometry';

/**
 * Silhouette of a structure as a few axis-aligned rectangles on a fine pixel grid.
 *
 * The only rule owner for outline geometry: occupancy, movement cells, the nearest wall point,
 * bounds, fine rasterization and authoring validation. Outlines come from checked-in authored
 * data only and are never derived from textures at runtime, so a headless host computes exactly
 * what every peer computes.
 */
export interface StructureRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  /** Exposed edges as `EDGE_*` bits; a fully shared edge casts no light shadow. */
  readonly edges: number;
}

export interface StructureOutlineDefinition {
  readonly stepPx: number;
  readonly rects: readonly StructureRect[];
}

export interface StructureBounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export interface StructurePoint {
  readonly x: number;
  readonly y: number;
  /** Zero on or inside the outline. */
  readonly distance: number;
}

export interface StructureRaster {
  readonly originX: number;
  readonly originY: number;
  readonly step: number;
  readonly cols: number;
  readonly rows: number;
  /** 1 where the step cell's centre lies inside the outline. */
  readonly mask: Uint8Array;
}

/** Authoring rules: a fine grid, no slivers a sliding circle can catch on, a bounded rect count. */
export const STRUCTURE_OUTLINE_RULES = { stepPx: 8, minSidePx: 16, maxRects: 16 } as const;

export function structureBounds(rects: readonly Pick<StructureRect, 'x' | 'y' | 'width' | 'height'>[]): StructureBounds {
  let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x); top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width); bottom = Math.max(bottom, rect.y + rect.height);
  }
  return rects.length > 0 ? { left, top, right, bottom } : { left: 0, top: 0, right: 0, bottom: 0 };
}

/** Half-open containment, so neighbouring rects never both claim a shared border point. */
function containsPoint(rect: Pick<StructureRect, 'x' | 'y' | 'width' | 'height'>, x: number, y: number): boolean {
  return x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height;
}

export function isInsideStructure(rects: readonly Pick<StructureRect, 'x' | 'y' | 'width' | 'height'>[], x: number, y: number): boolean {
  for (const rect of rects) if (containsPoint(rect, x, y)) return true;
  return false;
}

/**
 * Every cell with area overlap: placement, reservations and footprint validators see the whole
 * structure. Rects are local to a cell-aligned origin; the cells are local to the same origin.
 */
export function structureOccupancyCells(rects: readonly StructureRect[], cellSize = CELL_SIZE): { gridX: number; gridY: number }[] {
  const keys = new Set<string>();
  const cells: { gridX: number; gridY: number }[] = [];
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    for (let gy = Math.floor(rect.y / cellSize); gy < Math.ceil((rect.y + rect.height) / cellSize); gy++) {
      for (let gx = Math.floor(rect.x / cellSize); gx < Math.ceil((rect.x + rect.width) / cellSize); gx++) {
        const key = `${gx}:${gy}`;
        if (keys.has(key)) continue;
        keys.add(key); cells.push({ gridX: gx, gridY: gy });
      }
    }
  }
  return cells.sort((a, b) => a.gridY - b.gridY || a.gridX - b.gridX);
}

/**
 * Cells whose centre lies inside the outline. This is the same rule the World uses for world
 * props, so cell-based movement assistance treats a thin overhang as open ground.
 */
export function structureMovementCells(rects: readonly StructureRect[], cellSize = CELL_SIZE): { gridX: number; gridY: number }[] {
  return structureOccupancyCells(rects, cellSize)
    .filter(cell => isInsideStructure(rects, (cell.gridX + .5) * cellSize, (cell.gridY + .5) * cellSize));
}

/** Nearest point on the outline's closed area; inside points return themselves at distance 0. */
export function nearestStructurePoint(rects: readonly Pick<StructureRect, 'x' | 'y' | 'width' | 'height'>[], x: number, y: number): StructurePoint {
  let bestX = x, bestY = y, best = Infinity;
  for (const rect of rects) {
    const cx = Math.min(Math.max(x, rect.x), rect.x + rect.width);
    const cy = Math.min(Math.max(y, rect.y), rect.y + rect.height);
    const d2 = (cx - x) ** 2 + (cy - y) ** 2;
    if (d2 < best) { best = d2; bestX = cx; bestY = cy; }
  }
  return { x: bestX, y: bestY, distance: Number.isFinite(best) ? Math.sqrt(best) : Infinity };
}

/** Fine occupancy on `step` cells covering the outline bounds; a cell counts when its centre is inside. */
export function rasterizeStructure(rects: readonly StructureRect[], step: number = STRUCTURE_OUTLINE_RULES.stepPx): StructureRaster {
  const bounds = structureBounds(rects);
  const originX = Math.floor(bounds.left / step) * step, originY = Math.floor(bounds.top / step) * step;
  const cols = Math.max(0, Math.ceil((bounds.right - originX) / step));
  const rows = Math.max(0, Math.ceil((bounds.bottom - originY) / step));
  const mask = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row++) for (let col = 0; col < cols; col++) {
    if (isInsideStructure(rects, originX + (col + .5) * step, originY + (row + .5) * step)) mask[row * cols + col] = 1;
  }
  return { originX, originY, step, cols, rows, mask };
}

/**
 * Edges with any stretch facing open ground. A partly shared edge still counts as exposed: its
 * light shadow then also covers the solid neighbour, which is harmless.
 */
export function deriveStructureEdges(rects: readonly Pick<StructureRect, 'x' | 'y' | 'width' | 'height'>[], step: number = STRUCTURE_OUTLINE_RULES.stepPx): number[] {
  const half = step / 2;
  return rects.map(rect => {
    let edges = 0;
    const open = (x: number, y: number) => !isInsideStructure(rects, x, y);
    for (let x = rect.x + half; x < rect.x + rect.width; x += step) {
      if (open(x, rect.y - half)) edges |= EDGE_TOP;
      if (open(x, rect.y + rect.height + half)) edges |= EDGE_BOTTOM;
    }
    for (let y = rect.y + half; y < rect.y + rect.height; y += step) {
      if (open(rect.x - half, y)) edges |= EDGE_LEFT;
      if (open(rect.x + rect.width + half, y)) edges |= EDGE_RIGHT;
    }
    return edges;
  });
}

/** Moves local outline rects into another frame, e.g. world pixels of the resolved structure. */
export function translateStructureRects(rects: readonly StructureRect[], dx: number, dy: number): StructureRect[] {
  return rects.map(rect => ({ x: rect.x + dx, y: rect.y + dy, width: rect.width, height: rect.height, edges: rect.edges }));
}

/**
 * Authoring problems of an outline local to its shape origin, empty when valid. `widthPx` and
 * `heightPx` bound the shape the outline belongs to.
 */
export function validateStructureRects(outline: StructureOutlineDefinition, widthPx: number, heightPx: number): string[] {
  const { stepPx, rects } = outline;
  const errors: string[] = [];
  if (stepPx !== STRUCTURE_OUTLINE_RULES.stepPx) errors.push(`stepPx must be ${STRUCTURE_OUTLINE_RULES.stepPx}`);
  if (rects.length === 0) errors.push('outline has no rects');
  if (rects.length > STRUCTURE_OUTLINE_RULES.maxRects) errors.push(`outline has more than ${STRUCTURE_OUTLINE_RULES.maxRects} rects`);
  rects.forEach((rect, index) => {
    const label = `rect ${index}`;
    if (![rect.x, rect.y, rect.width, rect.height].every(value => Number.isInteger(value) && value % STRUCTURE_OUTLINE_RULES.stepPx === 0)) {
      errors.push(`${label} is off the ${STRUCTURE_OUTLINE_RULES.stepPx}-px grid`);
    }
    if (rect.width <= 0 || rect.height <= 0) errors.push(`${label} has no area`);
    else if (Math.min(rect.width, rect.height) < STRUCTURE_OUTLINE_RULES.minSidePx) {
      errors.push(`${label} is thinner than ${STRUCTURE_OUTLINE_RULES.minSidePx} px`);
    }
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > widthPx || rect.y + rect.height > heightPx) {
      errors.push(`${label} lies outside the shape`);
    }
    for (let other = 0; other < index; other++) {
      const o = rects[other];
      if (rect.x < o.x + o.width && o.x < rect.x + rect.width && rect.y < o.y + o.height && o.y < rect.y + rect.height) {
        errors.push(`${label} overlaps rect ${other}`);
      }
    }
  });
  if (errors.length === 0) {
    const derived = deriveStructureEdges(rects);
    rects.forEach((rect, index) => {
      if (rect.edges !== derived[index]) errors.push(`rect ${index} declares edges ${rect.edges}, outline exposes ${derived[index]}`);
    });
  }
  return errors;
}
