import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE, GRID_COLS, GRID_ROWS } from '../config';
import type { DirtCell } from '../types';
import type { ArenaVisualGridMetrics } from './ArenaVisualFactory';
import { hashSeededCell01 } from './CellHash';
import {
  GROUND_COVER_CONFIG,
  getGroundCoverPlacementBudget,
  getGroundCoverTextureKey,
  getGroundCoverVariantsForAnchor,
} from './GroundCoverConfig';
import type { GroundCoverAnchor, GroundCoverLayerConfig } from './GroundCoverConfig';

/**
 * Platzierung der Ground-Cover-Schicht: deterministisch aus Seed und Dirt-Geometrie, ohne jede
 * Phaser-Abhaengigkeit und damit direkt testbar.
 *
 * Die Schicht ist bewusst kein Teil von `ArenaLayout.decals`. Decals sind zellgebundene 16-px-
 * Marken mit eigenem Netzwerk- und Rehydrierungsvertrag; diese Flecken sind mehrere Zellen gross,
 * liegen absichtlich neben ihrer Ankerzelle und werden auf jedem Peer beim Backen neu abgeleitet.
 * `layout.seed` und `layout.dirt` stehen dafuer ueberall zur Verfuegung, am Wire-Format aendert
 * sich nichts.
 */

export interface GroundCoverPlacement {
  textureKey: string;
  worldX: number;
  worldY: number;
  /** Laengere Kante in Weltpixeln; die kuerzere folgt dem Seitenverhaeltnis der Textur. */
  sizePx: number;
  rotation: number;
  alpha: number;
  mirrorX: boolean;
  mirrorY: boolean;
  /** Ankerklasse der Platzierung. Nur fuer Tests und Diagnose. */
  anchor: GroundCoverAnchor;
}

export interface GroundCoverFieldOptions {
  seed: number;
  dirt: readonly DirtCell[];
  /** Rahmen und Gittergroesse. Ohne Angabe die laufenden Arena-Metriken. */
  metrics?: ArenaVisualGridMetrics;
  config?: GroundCoverLayerConfig;
  /** Zellen, auf denen kein Anker liegen darf (z. B. UI-Reservezonen der Lobby-Vorschau). */
  excludeCell?: (gridX: number, gridY: number) => boolean;
}

/** Abstand in Zellen, ab dem Gras als Innenflaeche gilt. Dazwischen liegt ein bewusstes Totband. */
const GRASS_INTERIOR_DISTANCE_CELLS = 2;

function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t;
}

export function generateGroundCoverPlacements(options: GroundCoverFieldOptions): GroundCoverPlacement[] {
  const config = options.config ?? GROUND_COVER_CONFIG;
  const metrics = options.metrics;
  const offsetX = metrics?.offsetX ?? ARENA_OFFSET_X;
  const offsetY = metrics?.offsetY ?? ARENA_OFFSET_Y;
  const cols = metrics?.gridCols ?? GRID_COLS;
  const rows = metrics?.gridRows ?? GRID_ROWS;
  if (cols <= 0 || rows <= 0) return [];

  const dirtSet = new Set<number>();
  for (const { gridX, gridY } of options.dirt) dirtSet.add(gridY * cols + gridX);

  /**
   * Ausserhalb des Gitters wird die Randzelle fortgesetzt (Edge-Clamp).
   *
   * Weder "aussen ist Dirt" noch "aussen ist Gras" waere richtig: Beides macht den Arenarahmen
   * selbst zu einer Materialgrenze und legt einen umlaufenden Moossaum genau auf die Spielfeld-
   * kante. Mit dem Clamp ist der Rand neutral, und eine Karte ganz ohne Dirt bleibt durchgehend
   * Grasinnenflaeche.
   */
  const isDirt = (gridX: number, gridY: number): boolean => {
    const clampedX = Math.min(cols - 1, Math.max(0, gridX));
    const clampedY = Math.min(rows - 1, Math.max(0, gridY));
    return dirtSet.has(clampedY * cols + clampedX);
  };

  /**
   * Nicht-Dirt-Zellen im Abstand von genau `GRASS_INTERIOR_DISTANCE_CELLS` bleiben absichtlich
   * unklassifiziert. Ohne dieses Totband liefen Saum- und Grasbevoelkerung ineinander und die
   * Deckung waere ueberall gleich, der geforderte Schwerpunkt am Uebergang ginge verloren.
   */
  const classify = (gridX: number, gridY: number): GroundCoverAnchor | null => {
    let sawDirt = false;
    let sawGrass = false;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (isDirt(gridX + dx, gridY + dy)) sawDirt = true;
        else sawGrass = true;
      }
    }
    if (sawDirt && sawGrass) return 'seam';
    if (sawDirt) return 'dirt';

    const reach = GRASS_INTERIOR_DISTANCE_CELLS;
    for (let dy = -reach; dy <= reach; dy += 1) {
      for (let dx = -reach; dx <= reach; dx += 1) {
        if (isDirt(gridX + dx, gridY + dy)) return null;
      }
    }
    return 'grass';
  };

  const placements: GroundCoverPlacement[] = [];
  const blockCols = Math.ceil(cols / config.blockCells);
  const blockRows = Math.ceil(rows / config.blockCells);
  const placementBudget = getGroundCoverPlacementBudget(cols, rows, config);

  for (let blockY = 0; blockY < blockRows; blockY += 1) {
    for (let blockX = 0; blockX < blockCols; blockX += 1) {
      for (let slot = 0; slot < config.maxPerBlock; slot += 1) {
        // Das Budget stammt aus genau dem Blockraster, das dieser Lauf verarbeitet. Es kann daher
        // nur als defensive Konsistenzgrenze wirken und nie einen spaeteren Kartenabschnitt
        // abschneiden.
        if (placements.length >= placementBudget) return placements;
        const salt = slot * 997;
        const jitterX = (hashSeededCell01(options.seed, blockX, blockY, salt + 1) - 0.5) * 2 * config.jitterCells;
        const jitterY = (hashSeededCell01(options.seed, blockX, blockY, salt + 2) - 0.5) * 2 * config.jitterCells;
        // Bewusst ungeklemmt: Ein Anker darf knapp neben dem Gitter liegen, sein Fleck laeuft dann
        // ueber die Arenakante hinaus und wird von der RenderTexture beschnitten. Ein Clamp auf
        // 0 bzw. `cols` wuerde die Position dort auf ganze Zellen runden, ausgerechnet die
        // Rasterbindung, die diese Schicht aufloesen soll.
        const anchorX = (blockX + 0.5) * config.blockCells + jitterX;
        const anchorY = (blockY + 0.5) * config.blockCells + jitterY;

        const cellX = Math.min(cols - 1, Math.max(0, Math.floor(anchorX)));
        const cellY = Math.min(rows - 1, Math.max(0, Math.floor(anchorY)));
        const anchor = classify(cellX, cellY);
        if (!anchor) continue;
        if (options.excludeCell?.(cellX, cellY)) continue;

        // Idiom aus `stampBlobSurfaceMottle`: ganzzahliger Anteil garantiert, Rest als Chance.
        const anchorConfig = config[anchor];
        const guaranteed = Math.floor(anchorConfig.perBlock);
        const extra = hashSeededCell01(options.seed, blockX, blockY, salt + 3) < anchorConfig.perBlock - guaranteed ? 1 : 0;
        if (slot >= guaranteed + extra) continue;

        const variants = getGroundCoverVariantsForAnchor(anchor, config);
        if (variants.length === 0) continue;
        let totalWeight = 0;
        for (const variant of variants) totalWeight += variant.frequencyPercent;
        let roll = hashSeededCell01(options.seed, blockX, blockY, salt + 4) * totalWeight;
        let picked = variants[variants.length - 1];
        for (const variant of variants) {
          roll -= variant.frequencyPercent;
          if (roll <= 0) {
            picked = variant;
            break;
          }
        }

        const sizeRoll = hashSeededCell01(options.seed, blockX, blockY, salt + 5) ** anchorConfig.sizeBias;
        placements.push({
          textureKey: getGroundCoverTextureKey(picked.fileName),
          worldX: offsetX + anchorX * CELL_SIZE,
          worldY: offsetY + anchorY * CELL_SIZE,
          sizePx: CELL_SIZE * lerp(anchorConfig.minSizeCells, anchorConfig.maxSizeCells, sizeRoll),
          rotation: hashSeededCell01(options.seed, blockX, blockY, salt + 6) * Math.PI * 2,
          alpha: lerp(anchorConfig.minAlpha, anchorConfig.maxAlpha, hashSeededCell01(options.seed, blockX, blockY, salt + 7)),
          // Spiegeln vervierfacht die unterscheidbaren Erscheinungen der acht Vorlagen ohne
          // Texturkosten, wie bei den Mottle-Stempeln, die ebenfalls keine Nahtbedingung haben.
          mirrorX: hashSeededCell01(options.seed, blockX, blockY, salt + 8) < 0.5,
          mirrorY: hashSeededCell01(options.seed, blockX, blockY, salt + 9) < 0.5,
          anchor,
        });
      }
    }
  }

  return placements;
}
