import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  GRID_COLS,
  GRID_ROWS,
  isCaptureTheBeerBaseCell,
  isCaptureTheBeerBaseModeActive,
  isCoopDefenseBasesActive,
  isGridCellInArenaRegion,
  type ArenaGridRegion,
} from '../config';
import {
  COOP_DEFENSE_BASES,
  type CoopBaseAnchor,
  type CoopBaseCellOffset,
  type CoopBaseConfig,
  type CoopBaseShape,
} from '../config/coopDefenseBases';

/**
 * Beschreibt eine einzelne Basis: Identität + Grid-Footprint + HP-Soll.
 *
 *  - `cells`  ist die maßgebliche Quelle für alle räumlichen Lookups
 *             (Flow-Field, Autotile, Per-Zell-Collider, Mitgliedschafts-Checks).
 *             Erlaubt beliebige (auch konkave) Formen.
 *  - `region` ist die abgeleitete achsenparallele Bounding-Box. Wird für
 *             HP-Bar-Positionierung, Pixel-Bounds und die konservativen
 *             Clearance-/Border-Tests des Generators verwendet.
 *  - `hpMax`  stammt aus der Konfigurationsdatei (`coopDefenseBases.ts`).
 */
export interface BaseSpec {
  readonly id: string;
  readonly cells: readonly { gridX: number; gridY: number }[];
  readonly region: ArenaGridRegion;
  readonly hpMax: number;
}

// ── Anker- & Shape-Auflösung ───────────────────────────────────────────────

function resolveShape(shape: CoopBaseShape): {
  cells: readonly CoopBaseCellOffset[];
  width: number;
  height: number;
} {
  if (shape.kind === 'rectangle') {
    const w = Math.max(1, shape.widthCells);
    const h = Math.max(1, shape.heightCells);
    const cells: CoopBaseCellOffset[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) cells.push({ gridX: x, gridY: y });
    }
    return { cells, width: w, height: h };
  }
  let maxX = 0;
  let maxY = 0;
  for (const cell of shape.cells) {
    if (cell.gridX > maxX) maxX = cell.gridX;
    if (cell.gridY > maxY) maxY = cell.gridY;
  }
  return { cells: shape.cells, width: maxX + 1, height: maxY + 1 };
}

function resolveAnchorOrigin(anchor: CoopBaseAnchor, width: number, height: number): {
  minGridX: number;
  minGridY: number;
} {
  switch (anchor.kind) {
    case 'right-center': {
      const inset = Math.max(0, anchor.edgeInsetCells);
      const minGridX = GRID_COLS - width - inset;
      const minGridY = Math.floor((GRID_ROWS - height) / 2);
      return { minGridX, minGridY };
    }
    case 'left-center': {
      const inset = Math.max(0, anchor.edgeInsetCells);
      const minGridX = inset;
      const minGridY = Math.floor((GRID_ROWS - height) / 2);
      return { minGridX, minGridY };
    }
    case 'center-offset': {
      const minGridX = Math.floor((GRID_COLS - width) / 2) + anchor.dxCells;
      const minGridY = Math.floor((GRID_ROWS - height) / 2) + anchor.dyCells;
      return { minGridX, minGridY };
    }
  }
}

function clampOriginToGrid(originX: number, originY: number, width: number, height: number): {
  minGridX: number;
  minGridY: number;
} {
  const minGridX = Math.max(0, Math.min(originX, GRID_COLS - width));
  const minGridY = Math.max(0, Math.min(originY, GRID_ROWS - height));
  return { minGridX, minGridY };
}

function resolveBaseSpec(config: CoopBaseConfig): BaseSpec {
  const { cells: relativeCells, width, height } = resolveShape(config.shape);
  const origin = resolveAnchorOrigin(config.anchor, width, height);
  const { minGridX, minGridY } = clampOriginToGrid(origin.minGridX, origin.minGridY, width, height);

  const absoluteCells = relativeCells
    .map((cell) => ({ gridX: minGridX + cell.gridX, gridY: minGridY + cell.gridY }))
    .filter((cell) => cell.gridX >= 0 && cell.gridX < GRID_COLS && cell.gridY >= 0 && cell.gridY < GRID_ROWS);

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const cell of absoluteCells) {
    if (cell.gridX < minX) minX = cell.gridX;
    if (cell.gridY < minY) minY = cell.gridY;
    if (cell.gridX > maxX) maxX = cell.gridX;
    if (cell.gridY > maxY) maxY = cell.gridY;
  }
  const region: ArenaGridRegion = absoluteCells.length > 0
    ? { minGridX: minX, maxGridX: maxX, minGridY: minY, maxGridY: maxY }
    : { minGridX: 0, maxGridX: 0, minGridY: 0, maxGridY: 0 };

  return {
    id: config.id,
    cells: absoluteCells,
    region,
    hpMax: Math.max(1, config.hpMax),
  };
}

// ── Öffentliche API ────────────────────────────────────────────────────────

/** Aktive Coop-Basen für die laufende Runde. Leeres Array außerhalb des Coop-Modus. */
export function getCoopDefenseBases(): readonly BaseSpec[] {
  if (!isCoopDefenseBasesActive()) return [];
  return COOP_DEFENSE_BASES.map(resolveBaseSpec);
}

/** Pixel-Bounds einer Basis-Region (Bounding-Box) anhand der aktiven Arena-Metriken. */
export function getBaseWorldBounds(region: ArenaGridRegion): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: ARENA_OFFSET_X + region.minGridX * CELL_SIZE,
    y: ARENA_OFFSET_Y + region.minGridY * CELL_SIZE,
    width: (region.maxGridX - region.minGridX + 1) * CELL_SIZE,
    height: (region.maxGridY - region.minGridY + 1) * CELL_SIZE,
  };
}

/**
 * Räumlicher Schutz-Radius um eine Coop-Basis (Chebyshev-Distanz in Zellen
 * relativ zur Bounding-Box), innerhalb dessen KEINE bewegungs-blockierenden
 * Elemente platziert werden (Felsen, Bäume, Power-Up-Podeste).
 *
 * Dirt und Decals sind rein visuell und blockieren die Bewegung nicht; sie
 * dürfen weiterhin im Schutz-Radius erscheinen (siehe `isReservedBaseSurfaceCell`).
 */
export const COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS = 5;

function isCoopDefenseBaseWithinBoundingBoxDistance(gx: number, gy: number, distance: number): boolean {
  if (!isCoopDefenseBasesActive()) return false;
  for (const base of getCoopDefenseBases()) {
    if (
      gx >= base.region.minGridX - distance
      && gx <= base.region.maxGridX + distance
      && gy >= base.region.minGridY - distance
      && gy <= base.region.maxGridY + distance
    ) return true;
  }
  return false;
}

/** True wenn (gx, gy) **exakt** auf einer Zelle einer Coop-Basis liegt (konkavitätsbewusst). */
export function isCoopDefenseBaseCell(gx: number, gy: number): boolean {
  if (!isCoopDefenseBasesActive()) return false;
  for (const base of getCoopDefenseBases()) {
    for (const cell of base.cells) {
      if (cell.gridX === gx && cell.gridY === gy) return true;
    }
  }
  return false;
}

/**
 * True wenn (gx, gy) in der Bounding-Box einer Coop-Basis ODER im 1-Zellen-Rand
 * drumherum liegt. Wird vom Spawn-System genutzt (Spieler sollen weder auf
 * noch direkt neben der Basis spawnen).
 */
export function isCoopDefenseBaseOrBorderCell(gx: number, gy: number): boolean {
  return isCoopDefenseBaseWithinBoundingBoxDistance(gx, gy, 1);
}

/**
 * True wenn (gx, gy) innerhalb des Hindernis-Schutz-Radius einer Coop-Basis
 * liegt (= Bounding-Box + 5 Zellen). Bewusst Bounding-Box-basiert, damit
 * konkave Innenflächen (z. B. die Lücke einer C-Form) frei von Felsen/Bäumen
 * bleiben.
 */
export function isCoopDefenseBaseObstacleClearanceCell(gx: number, gy: number): boolean {
  return isCoopDefenseBaseWithinBoundingBoxDistance(gx, gy, COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS);
}

/**
 * Aggregator: vom Generator zu reservierende Zelle für **bewegungs-blockierende**
 * Elemente (Felsen, Bäume, Power-Up-Podeste).
 * - CTB: exakte Basis-Zelle.
 * - Coop: Bounding-Box + 5-Zellen-Schutz-Radius.
 */
export function isReservedBaseObstacleCell(gx: number, gy: number): boolean {
  if (isCaptureTheBeerBaseCell(gx, gy)) return true;
  if (isCoopDefenseBaseObstacleClearanceCell(gx, gy)) return true;
  return false;
}

/**
 * Aggregator: vom Generator zu reservierende Zelle für **rein visuelle**
 * Oberflächen-Elemente (Dirt, Decals).
 * - CTB: exakte Basis-Zelle.
 * - Coop: exakte Basis-Zelle (konkavitätsbewusst – Lücken bleiben begehbar
 *   und dürfen Dirt/Decals tragen).
 */
export function isReservedBaseSurfaceCell(gx: number, gy: number): boolean {
  if (isCaptureTheBeerBaseCell(gx, gy)) return true;
  if (isCoopDefenseBaseCell(gx, gy)) return true;
  return false;
}

/**
 * Hilfsfunktion: Region (Bounding-Box) → True wenn (gx,gy) drinliegt.
 * Wird vom Generator-Pfad weiterhin als Sanity-Check verwendet.
 */
export function isCellInBaseRegion(spec: BaseSpec, gx: number, gy: number): boolean {
  return isGridCellInArenaRegion(spec.region, gx, gy);
}

/**
 * True wenn der aktive Modus den Zug-Gleis-Spawn zentriert (CTB & Coop).
 */
export function usesCenteredTrackSpawn(): boolean {
  return isCoopDefenseBasesActive() || isCaptureTheBeerBaseModeActive();
}
