import {
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CELL_SIZE,
  COOP_DEFENSE_BASE_HEIGHT_CELLS,
  COOP_DEFENSE_BASE_WIDTH_CELLS,
  GRID_COLS,
  GRID_ROWS,
  isCaptureTheBeerBaseCell,
  isCaptureTheBeerBaseModeActive,
  isCoopDefenseBasesActive,
  isGridCellInArenaRegion,
  type ArenaGridRegion,
} from '../config';

/**
 * Beschreibt eine einzelne Basis: Identität + Grid-Footprint.
 * Skalierbar – im Coop-Modus startet mit einer Basis, kann ohne Code-Änderung
 * auf beliebig viele wachsen, indem `getCoopDefenseBases()` ein längeres Array
 * zurückgibt.
 *
 * Weltkoordinaten (Pixel) werden bewusst lazy berechnet, weil `ARENA_OFFSET_X`
 * und `GRID_COLS` modusabhängig sind und sich beim Wechsel zwischen Profilen
 * ändern.
 */
export interface BaseSpec {
  readonly id: string;
  readonly region: ArenaGridRegion;
}

interface CoopBaseTemplate {
  readonly id: string;
  readonly widthCells: number;
  readonly heightCells: number;
  readonly placement: CoopBasePlacement;
}

type CoopBasePlacement =
  | { kind: 'right-center'; edgeInsetCells: number };
  // Weitere Platzierungs-Strategien (e.g. 'left-center', 'corner', 'custom') folgen
  // bei Bedarf in späteren Phasen ohne Anpassung der Konsumenten.

/**
 * Statisches Layout-Manifest für Coop-Defense.
 * Phase 1.2: eine Basis am rechten Rand, vertikal mittig zentriert.
 * Erweiterung: einfach weitere Einträge anhängen.
 */
const COOP_DEFENSE_BASE_TEMPLATES: readonly CoopBaseTemplate[] = [
  {
    id: 'coop-base-1',
    widthCells: COOP_DEFENSE_BASE_WIDTH_CELLS,
    heightCells: COOP_DEFENSE_BASE_HEIGHT_CELLS,
    placement: { kind: 'right-center', edgeInsetCells: 0 },
  },
];

function resolveRegion(template: CoopBaseTemplate): ArenaGridRegion {
  const width = Math.max(1, Math.min(template.widthCells, GRID_COLS));
  const height = Math.max(1, Math.min(template.heightCells, GRID_ROWS));
  switch (template.placement.kind) {
    case 'right-center': {
      const edgeInset = Math.max(0, template.placement.edgeInsetCells);
      const maxGridX = Math.max(width - 1, GRID_COLS - 1 - edgeInset);
      const minGridX = maxGridX - width + 1;
      const minGridY = Math.floor((GRID_ROWS - height) / 2);
      return {
        minGridX,
        maxGridX,
        minGridY,
        maxGridY: minGridY + height - 1,
      };
    }
  }
}

/** Aktive Coop-Basen für die laufende Runde. Leeres Array außerhalb des Coop-Modus. */
export function getCoopDefenseBases(): readonly BaseSpec[] {
  if (!isCoopDefenseBasesActive()) return [];
  return COOP_DEFENSE_BASE_TEMPLATES.map((tpl) => ({
    id: tpl.id,
    region: resolveRegion(tpl),
  }));
}

/** Pixel-Bounds einer Basis-Region anhand der aktiven Arena-Metriken. */
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
 * Räumlicher Schutz-Radius um eine Coop-Basis (Chebyshev-Distanz in Zellen),
 * innerhalb dessen KEINE bewegungs-blockierenden Elemente platziert werden:
 *   - Felsen
 *   - Bäume
 *   - Power-Up-Podeste
 *
 * Dirt und Decals sind rein visuell und blockieren die Bewegung nicht; sie
 * dürfen weiterhin im Schutz-Radius erscheinen (siehe `isReservedBaseSurfaceCell`).
 */
export const COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS = 5;

function isCoopDefenseBaseWithinDistance(gx: number, gy: number, distance: number): boolean {
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

/** True wenn (gx, gy) im exakten Footprint einer Coop-Basis liegt. */
export function isCoopDefenseBaseCell(gx: number, gy: number): boolean {
  if (!isCoopDefenseBasesActive()) return false;
  for (const base of getCoopDefenseBases()) {
    if (isGridCellInArenaRegion(base.region, gx, gy)) return true;
  }
  return false;
}

/**
 * True wenn (gx, gy) im Basis-Footprint ODER im 1-Zellen-Rand drumherum liegt.
 * Wird vom Spawn-System genutzt (Spieler dürfen weder auf der Basis noch
 * direkt daneben spawnen, um Kollisionsspawns zu vermeiden).
 */
export function isCoopDefenseBaseOrBorderCell(gx: number, gy: number): boolean {
  return isCoopDefenseBaseWithinDistance(gx, gy, 1);
}

/**
 * True wenn (gx, gy) innerhalb des Hindernis-Schutz-Radius einer Coop-Basis
 * liegt (= Basis + 5 Zellen in alle Richtungen). Verwendet vom Generator,
 * um Felsen / Bäume / Power-Up-Podeste in dieser Zone fernzuhalten.
 */
export function isCoopDefenseBaseObstacleClearanceCell(gx: number, gy: number): boolean {
  return isCoopDefenseBaseWithinDistance(gx, gy, COOP_DEFENSE_BASE_OBSTACLE_CLEARANCE_CELLS);
}

/**
 * Aggregator: vom Generator zu reservierende Zelle für **bewegungs-blockierende**
 * Elemente (Felsen, Bäume, Power-Up-Podeste).
 * - CTB: exakte Basis-Zelle (CTB-Basen sind volle Spielfeldhälften – kein Buffer nötig).
 * - Coop: Basis + 5-Zellen-Schutz-Radius.
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
 * - Coop: exakte Basis-Zelle (Dirt/Decals dürfen bis an die Basis heranreichen).
 */
export function isReservedBaseSurfaceCell(gx: number, gy: number): boolean {
  if (isCaptureTheBeerBaseCell(gx, gy)) return true;
  if (isCoopDefenseBaseCell(gx, gy)) return true;
  return false;
}

/**
 * True wenn der aktive Modus den Zug-Gleis-Spawn zentriert (CTB & Coop).
 * Die Funktion bewertet rein über die Active-Flags, damit der Generator
 * keine GameMode-Kenntnis braucht.
 */
export function usesCenteredTrackSpawn(): boolean {
  return isCoopDefenseBasesActive() || isCaptureTheBeerBaseModeActive();
}
