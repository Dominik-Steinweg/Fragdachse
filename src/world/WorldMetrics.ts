import { CELL_SIZE, type ArenaMetricsProfile } from '../config';

/**
 * Raeumliche Grundlage genau einer World-Instanz.
 *
 * Heute stehen dieselben Werte zusaetzlich als mutable Modulvariablen in `src/config.ts`
 * (`ARENA_WIDTH`, `ARENA_OFFSET_X`, `GRID_COLS`, …). Genau das ist das Problem: eine einzelne
 * globale "aktive Arena-Metrik" kann nicht gleichzeitig eine Lobby-Praesentation und eine davon
 * unabhaengige Shared-World-Simulation beschreiben.
 *
 * `WorldMetrics` ist deshalb ein unveraenderlicher Wert, der zu genau einer World gehoert und
 * ueber ihren {@link import('./WorldRuntimeContext').WorldRuntimeContext} erreichbar ist.
 */
export interface WorldMetrics {
  readonly widthPx: number;
  readonly heightPx: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly gridCols: number;
  readonly gridRows: number;
  readonly usesDynamicCamera: boolean;
  readonly showStaticFrames: boolean;
}

/**
 * Leitet die World-Metrik aus einem bereits aufgeloesten Arena-Profil ab.
 *
 * Die Auswahl des Profils bleibt bewusst bei `getArenaMetricsProfile()` – dort steht sie heute
 * und dort gehoert sie hin, solange die prozedurale Arena noch keine eigene WorldDefinition
 * besitzt. Diese Funktion dupliziert keine Regel; sie bindet dasselbe Ergebnis an eine World,
 * statt es in globale Variablen zu schreiben.
 */
export function resolveWorldMetrics(profile: ArenaMetricsProfile): WorldMetrics {
  return {
    widthPx: profile.arenaWidth,
    heightPx: profile.arenaHeight,
    offsetX: profile.arenaOffsetX,
    offsetY: profile.arenaOffsetY,
    maxX: profile.arenaOffsetX + profile.arenaWidth,
    maxY: profile.arenaOffsetY + profile.arenaHeight,
    viewportWidth: profile.arenaViewportWidth,
    viewportHeight: profile.arenaViewportHeight,
    gridCols: Math.floor(profile.arenaWidth / CELL_SIZE),
    gridRows: Math.floor(profile.arenaHeight / CELL_SIZE),
    usesDynamicCamera: profile.usesDynamicCamera,
    showStaticFrames: profile.showStaticArenaFrames,
  };
}

/** Weltposition der linken oberen Ecke einer Rasterzelle dieser World. */
export function worldCellOrigin(
  metrics: WorldMetrics,
  gridX: number,
  gridY: number,
): { readonly x: number; readonly y: number } {
  return {
    x: metrics.offsetX + gridX * CELL_SIZE,
    y: metrics.offsetY + gridY * CELL_SIZE,
  };
}

/** True, solange die Rasterzelle innerhalb dieser World liegt. */
export function isCellInsideWorld(metrics: WorldMetrics, gridX: number, gridY: number): boolean {
  return Number.isInteger(gridX)
    && Number.isInteger(gridY)
    && gridX >= 0
    && gridY >= 0
    && gridX < metrics.gridCols
    && gridY < metrics.gridRows;
}
