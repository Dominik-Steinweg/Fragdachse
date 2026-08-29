import * as Phaser from 'phaser';
import { CELL_SIZE, DEPTH, TEAM_BLUE_COLOR, TEAM_RED_COLOR } from '../config';
import { AutoTiler, BASE_AUTOTILE } from '../arena/AutoTiler';
import { mixColors } from '../effects/EffectUtils';
import type { WorldMetrics } from '../world/WorldMetrics';

/** Aufgehellte Teamfarbe der Basis: als Licht braucht es alle drei Kanaele. */
export const BASE_LIGHT_COLOR = mixColors(TEAM_BLUE_COLOR, 0xffffff, 0.5);
/** Hellerer, konzentrierter Lichtkern fuer freundliche Basistuerme. */
export const BASE_TURRET_LIGHT_COLOR = mixColors(TEAM_BLUE_COLOR, 0xffffff, 0.72);
/** Gegnerbasen leuchten in derselben Helligkeit, aber in der Farbe des roten Teams. */
export const HOSTILE_BASE_LIGHT_COLOR = mixColors(TEAM_RED_COLOR, 0xffffff, 0.5);
export const HOSTILE_BASE_TURRET_LIGHT_COLOR = mixColors(TEAM_RED_COLOR, 0xffffff, 0.72);

const BASE_LIGHT_SPACING = CELL_SIZE * 4.5;
const BASE_LIGHT_OVERHANG = CELL_SIZE * 1.25;
export const BASE_LIGHT_RADIUS = BASE_LIGHT_SPACING * 1.35;

export interface BaseVisualCell {
  readonly gridX: number;
  readonly gridY: number;
}

/** Erzeugt die statischen 47-Blob-Basisbilder ohne Bodies oder sonstige Entity-Laufzeit. */
export function createBaseSurfaceImages(
  scene: Phaser.Scene,
  cells: readonly BaseVisualCell[],
  metrics: WorldMetrics,
  textureKey: string,
): Phaser.GameObjects.Image[] {
  const cellKeySet = new Set<number>();
  const keyOf = (gridX: number, gridY: number) => gridY * 100000 + gridX;
  for (const cell of cells) cellKeySet.add(keyOf(cell.gridX, cell.gridY));
  const isOccupied = (gridX: number, gridY: number) => cellKeySet.has(keyOf(gridX, gridY));

  return cells.map((cell) => {
    const worldX = metrics.offsetX + cell.gridX * CELL_SIZE + CELL_SIZE / 2;
    const worldY = metrics.offsetY + cell.gridY * CELL_SIZE + CELL_SIZE / 2;
    const mask = AutoTiler.computeMask(cell.gridX, cell.gridY, isOccupied);
    const frame = AutoTiler.getFrame(mask, BASE_AUTOTILE);
    return scene.add.image(worldX, worldY, textureKey, frame)
      .setDisplaySize(CELL_SIZE, CELL_SIZE)
      .setDepth(DEPTH.BASES);
  });
}

/** Dieselbe sparsame Lichtpunktverteilung wie bei einer aktiven BaseEntity. */
export function getBaseLightSpots(
  bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
): readonly { readonly x: number; readonly y: number; readonly radius: number }[] {
  const minX = bounds.x - BASE_LIGHT_OVERHANG;
  const minY = bounds.y - BASE_LIGHT_OVERHANG;
  const spanX = bounds.width + BASE_LIGHT_OVERHANG * 2;
  const spanY = bounds.height + BASE_LIGHT_OVERHANG * 2;
  const cols = Math.max(1, Math.ceil(spanX / BASE_LIGHT_SPACING));
  const rows = Math.max(1, Math.ceil(spanY / BASE_LIGHT_SPACING));
  const spots: { x: number; y: number; radius: number }[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      spots.push({
        x: minX + ((col + 0.5) / cols) * spanX,
        y: minY + ((row + 0.5) / rows) * spanY,
        radius: BASE_LIGHT_RADIUS,
      });
    }
  }
  return spots;
}
