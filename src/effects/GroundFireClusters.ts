import type { GroundFireVisualStyle, SyncedBurningGroundCell } from '../types';

/**
 * Phaser-freie Beschreibung einer zusammenhängenden GroundFire-Fläche.
 *
 * Die Layouts werden nur bei einer neuen synchronisierten Zellkarte erzeugt. Der Renderer kann
 * die Daten danach frameweise lesen, ohne die Rasterkarte erneut zu durchsuchen oder Phaser-
 * Objekte pro Zelle anzulegen.
 */
export interface GroundFireClusterLayout {
  readonly id: string;
  readonly seed: number;
  readonly visualStyle: GroundFireVisualStyle;
  readonly cells: readonly SyncedBurningGroundCell[];
  readonly layoutSignature: string;
  readonly minGridX: number;
  readonly minGridY: number;
  readonly maxGridX: number;
  readonly maxGridY: number;
  readonly centerX: number;
  readonly centerY: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly totalIntensity: number;
  readonly maxIntensity: number;
  readonly expiresAt: number;
}

const NEIGHBOURS: readonly (readonly [number, number])[] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

/**
 * Finds 4-connected GroundFire components. Normal and void fire deliberately stay in separate
 * components even when they occupy neighbouring cells because their temperature palettes and
 * lighting presets are different.
 */
export function buildGroundFireClusterLayouts(
  cells: readonly SyncedBurningGroundCell[],
  cellSize = 16,
): GroundFireClusterLayout[] {
  const byKey = new Map<string, SyncedBurningGroundCell>();
  for (const cell of cells) {
    const key = cellKey(cell.visualStyle, cell.gridX, cell.gridY);
    const previous = byKey.get(key);
    // The network contract emits one visual per style and raster cell. Keeping the strongest
    // duplicate makes the visual resolver deterministic if an older peer sends a duplicate.
    if (!previous || cell.intensity > previous.intensity || cell.expiresAt > previous.expiresAt) {
      byKey.set(key, cell);
    }
  }

  const orderedCells = [...byKey.values()];
  orderedCells.sort(compareCells);
  const visited = new Set<string>();
  const layouts: GroundFireClusterLayout[] = [];

  for (const seedCell of orderedCells) {
    const seedKey = cellKey(seedCell.visualStyle, seedCell.gridX, seedCell.gridY);
    if (visited.has(seedKey)) continue;

    const queue: SyncedBurningGroundCell[] = [seedCell];
    const component: SyncedBurningGroundCell[] = [];
    visited.add(seedKey);

    for (let head = 0; head < queue.length; head += 1) {
      const cell = queue[head];
      component.push(cell);

      for (const [dx, dy] of NEIGHBOURS) {
        const neighbourKey = cellKey(cell.visualStyle, cell.gridX + dx, cell.gridY + dy);
        if (visited.has(neighbourKey)) continue;
        const neighbour = byKey.get(neighbourKey);
        if (!neighbour) continue;
        visited.add(neighbourKey);
        queue.push(neighbour);
      }
    }

    component.sort(compareCells);
    layouts.push(createLayout(component, cellSize));
  }

  layouts.sort((left, right) => left.id.localeCompare(right.id));
  return layouts;
}

function createLayout(
  component: readonly SyncedBurningGroundCell[],
  cellSize: number,
  stableId?: string,
): GroundFireClusterLayout {
  const first = component[0];
  let minGridX = first.gridX;
  let minGridY = first.gridY;
  let maxGridX = first.gridX;
  let maxGridY = first.gridY;
  let totalIntensity = 0;
  let maxIntensity = 0;
  let expiresAt = first.expiresAt;
  let weightedX = 0;
  let weightedY = 0;
  let weight = 0;

  for (const cell of component) {
    minGridX = Math.min(minGridX, cell.gridX);
    minGridY = Math.min(minGridY, cell.gridY);
    maxGridX = Math.max(maxGridX, cell.gridX);
    maxGridY = Math.max(maxGridY, cell.gridY);
    const intensity = Math.max(1, cell.intensity);
    totalIntensity += intensity;
    maxIntensity = Math.max(maxIntensity, intensity);
    expiresAt = Math.max(expiresAt, cell.expiresAt);
    weightedX += (cell.gridX + 0.5) * cellSize * intensity;
    weightedY += (cell.gridY + 0.5) * cellSize * intensity;
    weight += intensity;
  }

  const visualStyle = first.visualStyle;
  const id = stableId ?? `groundfire:${visualStyle}:${minGridX}:${minGridY}`;
  return {
    id,
    seed: hashClusterId(id),
    visualStyle,
    cells: component,
    layoutSignature: component.map(cell => `${cell.gridX}:${cell.gridY}`).join(';'),
    minGridX,
    minGridY,
    maxGridX,
    maxGridY,
    centerX: weightedX / weight,
    centerY: weightedY / weight,
    widthPx: (maxGridX - minGridX + 1) * cellSize,
    heightPx: (maxGridY - minGridY + 1) * cellSize,
    totalIntensity,
    maxIntensity,
    expiresAt,
  };
}

/** Edge length of a fixed emission region, in GroundFire raster cells. */
export const GROUND_FIRE_REGION_CELLS = 8;

const STYLE_INDEX: Readonly<Record<GroundFireVisualStyle, number>> = { normal: 0, void: 1 };
const KEY_OFFSET = 2 ** 13;
const KEY_ROW = 2 ** 14;
const KEY_STYLE = 2 ** 28;

/**
 * Allocation-free numeric identity of a style/raster position. Frame and diff paths use it
 * instead of template strings. Keys stay small integers (fast V8 map keys) and exact within
 * ±8192 cells per axis, far beyond any arena.
 */
export function groundFireCellKey(style: GroundFireVisualStyle, gridX: number, gridY: number): number {
  return STYLE_INDEX[style] * KEY_STYLE + (gridY + KEY_OFFSET) * KEY_ROW + gridX + KEY_OFFSET;
}

/** Key of the neighbouring raster cell or region; keys stay exact within the coordinate range. */
export function offsetGroundFireKey(key: number, dx: number, dy: number): number {
  return key + dy * KEY_ROW + dx;
}

/** Numeric identity of the fixed emission region containing a raster cell. */
export function groundFireRegionKey(style: GroundFireVisualStyle, gridX: number, gridY: number): number {
  return groundFireCellKey(
    style,
    Math.floor(gridX / GROUND_FIRE_REGION_CELLS),
    Math.floor(gridY / GROUND_FIRE_REGION_CELLS),
  );
}

/** Stable string identity of an emission region; seeds and light owners derive from it. */
export function groundFireRegionId(style: GroundFireVisualStyle, gridX: number, gridY: number, regionCells = GROUND_FIRE_REGION_CELLS): string {
  return `groundfire-region:${style}:${Math.floor(gridX / regionCells)}:${Math.floor(gridY / regionCells)}`;
}

/** Strongest duplicate wins; keeps resolution deterministic for duplicate peer cells. */
export function isStrongerGroundFireCell(cell: SyncedBurningGroundCell, previous: SyncedBurningGroundCell | undefined): boolean {
  return !previous || cell.intensity > previous.intensity || cell.expiresAt > previous.expiresAt;
}

/**
 * Layout of exactly one emission region. The caller passes its de-duplicated cells; the
 * renderer uses this to rebuild only regions whose replicated cells actually changed.
 */
export function buildGroundFireRegionLayout(
  cells: SyncedBurningGroundCell[],
  cellSize = 16,
  regionCells = GROUND_FIRE_REGION_CELLS,
): GroundFireClusterLayout {
  const first = cells[0];
  return createLayout(
    cells.sort(compareCells),
    cellSize,
    groundFireRegionId(first.visualStyle, first.gridX, first.gridY, regionCells),
  );
}

/** Fixed world-space emission regions: a remote bridge cannot change a trail's
 * density, random seed, flow clocks or lighting owner when it burns out. */
export function buildGroundFireEmissionLayouts(
  cells: readonly SyncedBurningGroundCell[],
  cellSize = 16,
  regionCells = GROUND_FIRE_REGION_CELLS,
): GroundFireClusterLayout[] {
  const regions = new Map<string, Map<string, SyncedBurningGroundCell>>();
  for (const cell of cells) {
    const id = groundFireRegionId(cell.visualStyle, cell.gridX, cell.gridY, regionCells);
    let region = regions.get(id);
    if (!region) { region = new Map(); regions.set(id, region); }
    const key = cellKey(cell.visualStyle, cell.gridX, cell.gridY);
    if (isStrongerGroundFireCell(cell, region.get(key))) region.set(key, cell);
  }
  return [...regions.values()].map(region => buildGroundFireRegionLayout([...region.values()], cellSize, regionCells))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function compareCells(left: SyncedBurningGroundCell, right: SyncedBurningGroundCell): number {
  return left.visualStyle.localeCompare(right.visualStyle)
    || left.gridY - right.gridY
    || left.gridX - right.gridX
    || left.id - right.id;
}

function cellKey(style: GroundFireVisualStyle, gridX: number, gridY: number): string {
  return `${style}:${gridX}:${gridY}`;
}

function hashClusterId(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
