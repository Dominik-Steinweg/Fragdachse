import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, GRID_COLS, GRID_ROWS } from '../config';
import type { RockCell } from '../types';
import type { ArenaVisualGridMetrics } from './ArenaVisualFactory';
import { hashSeededCell01 } from './CellHash';
import { getRockMossPlacementBudget, ROCK_MOSS_CONFIG, getRockMossTextureKey } from './RockMossConfig';
import type { RockMossLayerConfig } from './RockMossConfig';

/**
 * Platzierung des grossflaechigen Fels-Mooses: deterministisch aus Seed und Felsgeometrie, ohne
 * Phaser-Abhaengigkeit und damit direkt testbar. Aufbau wie {@link ./GroundCoverField}.
 *
 * Der entscheidende Unterschied zum Boden: Die Platzierung leitet sich aus dem **vollstaendigen**
 * Felsbestand des Layouts ab, nie aus den gerade noch stehenden Felsen. Wuerde sie den lebenden
 * Bestand kennen, wuerfelte jede Zerstoerung das gesamte Feld neu aus – im Spiel sichtbar als
 * springendes Moos auf allen unbeteiligten Felsen, wenn irgendwo einer zerbricht. Dieselbe Regel
 * traegt bereits `BlobSurfaceMottle`.
 *
 * Dass Moos nur auf noch stehendem Fels erscheint, ist deshalb keine Frage der Platzierung,
 * sondern der Silhouettenmaske beim Backen (siehe {@link ./RockMossLayer}).
 */

export interface RockMossPlacement {
  textureKey: string;
  worldX: number;
  worldY: number;
  /** Laengere Kante in Weltpixeln; die kuerzere folgt dem Seitenverhaeltnis der Textur. */
  sizePx: number;
  rotation: number;
  alpha: number;
  mirrorX: boolean;
  mirrorY: boolean;
}

export interface RockMossFieldOptions {
  seed: number;
  /** Alle Felsen des Layouts, einschliesslich bereits zerstoerter. Siehe Modulkommentar. */
  rocks: readonly RockCell[];
  /** Rahmen und Gittergroesse. Ohne Angabe gilt der globale Kompatibilitaetsrahmen. */
  metrics?: ArenaVisualGridMetrics;
  config?: RockMossLayerConfig;
}

/**
 * Eigener Salt-Versatz gegen {@link ./GroundCoverField}. Ohne ihn lieferten beide Felder bei
 * gleichem Seed und gleichen Blockkoordinaten dieselben Hashwerte, und Bodenflecken und
 * Felsmoos laegen sichtbar im selben Muster.
 */
const ROCK_MOSS_SALT_BASE = 0x4d05;

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function generateRockMossPlacements(options: RockMossFieldOptions): RockMossPlacement[] {
  const config = options.config ?? ROCK_MOSS_CONFIG;
  const metrics = options.metrics;
  const offsetX = metrics?.offsetX ?? ARENA_OFFSET_X;
  const offsetY = metrics?.offsetY ?? ARENA_OFFSET_Y;
  const cols = metrics?.gridCols ?? GRID_COLS;
  const rows = metrics?.gridRows ?? GRID_ROWS;
  if (cols <= 0 || rows <= 0 || options.rocks.length === 0) return [];

  const rockSet = new Set<number>();
  for (const { gridX, gridY } of options.rocks) rockSet.add(gridY * cols + gridX);

  const placements: RockMossPlacement[] = [];
  const blockCols = Math.ceil(cols / config.blockCells);
  const blockRows = Math.ceil(rows / config.blockCells);
  const placementBudget = getRockMossPlacementBudget(cols, rows, config);

  for (let blockY = 0; blockY < blockRows; blockY += 1) {
    for (let blockX = 0; blockX < blockCols; blockX += 1) {
      for (let slot = 0; slot < config.maxPerBlock; slot += 1) {
        // Das Budget stammt aus genau dem Blockraster, das dieser Lauf verarbeitet. Es kann daher
        // nur als defensive Konsistenzgrenze wirken und nie einen spaeteren Kartenabschnitt
        // abschneiden.
        if (placements.length >= placementBudget) return placements;
        const salt = ROCK_MOSS_SALT_BASE + slot * 997;
        const jitterX = (hashSeededCell01(options.seed, blockX, blockY, salt + 1) - 0.5) * 2 * config.jitterCells;
        const jitterY = (hashSeededCell01(options.seed, blockX, blockY, salt + 2) - 0.5) * 2 * config.jitterCells;
        const anchorX = (blockX + 0.5) * config.blockCells + jitterX;
        const anchorY = (blockY + 0.5) * config.blockCells + jitterY;

        const cellX = Math.min(cols - 1, Math.max(0, Math.floor(anchorX)));
        const cellY = Math.min(rows - 1, Math.max(0, Math.floor(anchorY)));
        if (!rockSet.has(cellY * cols + cellX)) continue;

        const guaranteed = Math.floor(config.perBlock);
        const extra = hashSeededCell01(options.seed, blockX, blockY, salt + 3) < config.perBlock - guaranteed ? 1 : 0;
        if (slot >= guaranteed + extra) continue;

        let totalWeight = 0;
        for (const variant of config.variants) totalWeight += variant.frequencyPercent;
        let roll = hashSeededCell01(options.seed, blockX, blockY, salt + 4) * totalWeight;
        let picked = config.variants[config.variants.length - 1];
        for (const variant of config.variants) {
          roll -= variant.frequencyPercent;
          if (roll <= 0) {
            picked = variant;
            break;
          }
        }

        const sizeRoll = hashSeededCell01(options.seed, blockX, blockY, salt + 5) ** config.sizeBias;
        placements.push({
          textureKey: getRockMossTextureKey(picked.fileName),
          worldX: offsetX + anchorX * CELL_SIZE,
          worldY: offsetY + anchorY * CELL_SIZE,
          sizePx: CELL_SIZE * lerp(config.minSizeCells, config.maxSizeCells, sizeRoll),
          rotation: hashSeededCell01(options.seed, blockX, blockY, salt + 6) * Math.PI * 2,
          alpha: lerp(config.minAlpha, config.maxAlpha, hashSeededCell01(options.seed, blockX, blockY, salt + 7)),
          mirrorX: hashSeededCell01(options.seed, blockX, blockY, salt + 8) < 0.5,
          mirrorY: hashSeededCell01(options.seed, blockX, blockY, salt + 9) < 0.5,
        });
      }
    }
  }

  return placements;
}

/** Halbe Diagonale eines Flecks – konservativer Radius fuer Chunk-Ueberschneidungstests. */
export function getRockMossPlacementRadiusPx(placement: RockMossPlacement): number {
  return placement.sizePx * Math.SQRT1_2;
}
