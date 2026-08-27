import { ACTIVE_ARENA_METRICS_PROFILE, CELL_SIZE, getArenaMetricsProfile, type ArenaMetricsProfile } from '../config';
import { COOP_DEFENSE_MODE } from '../gameModes';

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
  readonly trackSpawnMinCol: number;
  readonly trackSpawnMaxCol: number;
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
  const gridCols = Math.floor(profile.arenaWidth / CELL_SIZE);
  const gridRows = Math.floor(profile.arenaHeight / CELL_SIZE);
  return {
    widthPx: profile.arenaWidth,
    heightPx: profile.arenaHeight,
    offsetX: profile.arenaOffsetX,
    offsetY: profile.arenaOffsetY,
    maxX: profile.arenaOffsetX + profile.arenaWidth,
    maxY: profile.arenaOffsetY + profile.arenaHeight,
    viewportWidth: profile.arenaViewportWidth,
    viewportHeight: profile.arenaViewportHeight,
    gridCols,
    gridRows,
    trackSpawnMinCol: Math.floor(gridCols * 0.25),
    trackSpawnMaxCol: Math.floor(gridCols * 0.75),
    usesDynamicCamera: profile.usesDynamicCamera,
    showStaticFrames: profile.showStaticArenaFrames,
  };
}

/**
 * Metrik einer authored Coop-World allein aus ihren eigenen Zellmassen.
 *
 * Damit haengt world-scoped Geometrie nicht mehr davon ab, welche Arena gerade global aktiv
 * ist: dieselbe Map ergibt in Lobby, Host und Client dieselbe Metrik.
 */
export function resolveCoopDefenseWorldMetrics(
  widthCells: number | undefined,
  heightCells: number | undefined,
): WorldMetrics {
  return resolveWorldMetrics(getArenaMetricsProfile(COOP_DEFENSE_MODE, 'ARENA', widthCells, heightCells));
}

/**
 * Metrik der derzeit global aktiven Arena.
 *
 * Uebergangshilfe fuer Aufrufer, die noch nicht an einer World haengen – vor allem Tests und
 * Praesentationscode. Sie ist ausdruecklich kein Default irgendeiner World-API: wer eine World
 * besitzt, nimmt deren Metrik. World-Simulation darf sie nicht verwenden.
 */
export function resolveActiveArenaWorldMetrics(): WorldMetrics {
  return resolveWorldMetrics(ACTIVE_ARENA_METRICS_PROFILE);
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

/** Weltposition der Zellmitte. */
export function worldCellCenter(
  metrics: WorldMetrics,
  gridX: number,
  gridY: number,
): { readonly x: number; readonly y: number } {
  return {
    x: metrics.offsetX + gridX * CELL_SIZE + CELL_SIZE / 2,
    y: metrics.offsetY + gridY * CELL_SIZE + CELL_SIZE / 2,
  };
}

/** Rasterzelle einer Weltposition, auf die World begrenzt. */
export function worldPositionToCell(
  metrics: WorldMetrics,
  x: number,
  y: number,
): { readonly gridX: number; readonly gridY: number } {
  return {
    gridX: clamp(Math.floor((x - metrics.offsetX) / CELL_SIZE), 0, metrics.gridCols - 1),
    gridY: clamp(Math.floor((y - metrics.offsetY) / CELL_SIZE), 0, metrics.gridRows - 1),
  };
}

/** Naechstgelegene Zellmitte einer Weltposition, auf die World begrenzt. */
export function worldPositionToNearestCell(
  metrics: WorldMetrics,
  x: number,
  y: number,
): { readonly gridX: number; readonly gridY: number } {
  return {
    gridX: clamp(Math.round((x - metrics.offsetX - CELL_SIZE * 0.5) / CELL_SIZE), 0, metrics.gridCols - 1),
    gridY: clamp(Math.round((y - metrics.offsetY - CELL_SIZE * 0.5) / CELL_SIZE), 0, metrics.gridRows - 1),
  };
}

/** True, solange die Weltposition innerhalb dieser World liegt. */
export function isPointInsideWorld(metrics: WorldMetrics, x: number, y: number): boolean {
  return x >= metrics.offsetX && x <= metrics.maxX && y >= metrics.offsetY && y <= metrics.maxY;
}

/**
 * Beschneidet einen Strahl an den Grenzen dieser World. Gegenstueck zu
 * `clipPointToArenaRay()`, das dieselbe Rechnung gegen die global aktive Arena ausfuehrt.
 */
export function clipPointToWorldRay(
  metrics: WorldMetrics,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): { x: number; y: number; inside: boolean } {
  if (isPointInsideWorld(metrics, endX, endY)) return { x: endX, y: endY, inside: true };

  const dx = endX - startX;
  const dy = endY - startY;
  let t = 1;

  if (dx > 0) t = Math.min(t, (metrics.maxX - startX) / dx);
  else if (dx < 0) t = Math.min(t, (metrics.offsetX - startX) / dx);

  if (dy > 0) t = Math.min(t, (metrics.maxY - startY) / dy);
  else if (dy < 0) t = Math.min(t, (metrics.offsetY - startY) / dy);

  t = Math.max(0, Math.min(1, t));
  return { x: startX + dx * t, y: startY + dy * t, inside: false };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
