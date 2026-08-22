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

/** Stable signature used to skip cluster work when the replicated cell state is unchanged. */
export function groundFireCellsSignature(cells: readonly SyncedBurningGroundCell[]): string {
  const entries = cells.map(cell => (
    `${cell.visualStyle}:${cell.gridX}:${cell.gridY}:${cell.expiresAt}:${cell.intensity}:${cell.id}`
  ));
  entries.sort();
  return entries.join('|');
}

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
  const id = `groundfire:${visualStyle}:${minGridX}:${minGridY}`;
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
