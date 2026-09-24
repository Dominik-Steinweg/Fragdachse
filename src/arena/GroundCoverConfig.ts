import type * as Phaser from 'phaser';

/** Three tiers supplement the authored materials, concentrated at the grass/soil seam: large
 * feathered moss/grass patches, leafy clumps and compact blade tufts, in that draw order. Sources and reproducible export:
 * scripts/generate-ground-cover-textures.mjs. */

const GROUND_COVER_ASSET_PATH = './assets/sprites/groundcover';

/**
 * Ankerklasse einer Platzierung.
 *
 * - `seam`   – beidseitig des Dirt/Gras-Uebergangs; der Schwerpunkt der Schicht.
 * - `dirt`   – Dirt-Innenflaeche.
 * - `grass`  – Gras-Innenflaeche, weit genug vom Dirt entfernt.
 */
export type GroundCoverAnchor = 'seam' | 'dirt' | 'grass';

export interface GroundCoverVariantConfig {
  fileName: string;
  /** Relatives Gewicht innerhalb der fuer eine Ankerklasse zugelassenen Varianten. */
  frequencyPercent: number;
  /** Erlaubte Ankerklassen. Ohne Angabe: alle. */
  anchors?: readonly GroundCoverAnchor[];
}

export interface GroundCoverAnchorConfig {
  /** Erwartete Stempelzahl je Ankerblock; der Nachkommaanteil ist Wahrscheinlichkeit. */
  perBlock: number;
  minSizeCells: number;
  maxSizeCells: number;
  /** Exponent auf dem Groessen-Hash. Werte > 1 ziehen die Verteilung zur Untergrenze. */
  sizeBias: number;
  minAlpha: number;
  maxAlpha: number;
}

export interface GroundCoverLayerConfig {
  /** Hash salt of this tier, so tiers never share placement rolls. */
  seedSalt: number;
  /** Kantenlaenge eines Ankerblocks in Zellen. */
  blockCells: number;
  /** Maximale Zahl lokaler Anker-Slots je Block; der Gesamtumfang folgt aus dem Map-Raster. */
  maxPerBlock: number;
  /** Streuung des Ankers innerhalb seines Blocks, in Zellen. */
  jitterCells: number;
  seam: GroundCoverAnchorConfig;
  dirt: GroundCoverAnchorConfig;
  grass: GroundCoverAnchorConfig;
  variants: readonly GroundCoverVariantConfig[];
}

/** Compact blade tufts. Bounded placement density, independent of chunk residency and camera. */
export const GROUND_COVER_CONFIG: GroundCoverLayerConfig = {
  seedSalt: 0,
  blockCells: 2,
  maxPerBlock: 1,
  jitterCells: 1,
  seam: { perBlock: .7, minSizeCells: .5, maxSizeCells: 1.35, sizeBias: 1.5, minAlpha: .8, maxAlpha: 1 },
  dirt: { perBlock: .07, minSizeCells: .4, maxSizeCells: .9, sizeBias: 1.8, minAlpha: .7, maxAlpha: .95 },
  grass: { perBlock: .16, minSizeCells: .45, maxSizeCells: 1.1, sizeBias: 1.6, minAlpha: .75, maxAlpha: 1 },
  variants: Array.from({ length: 8 }, (_, index) => ({
    fileName: `ground_cover_${String(index + 1).padStart(2, '0')}.png`, frequencyPercent: 12.5,
  })),
};

/** Large grass patches: thicker growth that breaks up grass areas and softens soil borders. */
export const GROUND_PATCH_CONFIG: GroundCoverLayerConfig = {
  seedSalt: 0x6a1d,
  blockCells: 4,
  maxPerBlock: 1,
  jitterCells: 2,
  seam: { perBlock: .6, minSizeCells: 2, maxSizeCells: 4, sizeBias: 1.4, minAlpha: .6, maxAlpha: .85 },
  dirt: { perBlock: .08, minSizeCells: 1.5, maxSizeCells: 2.6, sizeBias: 1.6, minAlpha: .5, maxAlpha: .75 },
  grass: { perBlock: .3, minSizeCells: 2, maxSizeCells: 4.5, sizeBias: 1.3, minAlpha: .55, maxAlpha: .85 },
  variants: Array.from({ length: 16 }, (_, index) => ({
    fileName: `ground_patch_${String(index + 1).padStart(2, '0')}.png`, frequencyPercent: 6.25,
  })),
};

/** Low broad-leaved clumps with a baked contact shadow; readable at stamp size. */
export const GROUND_CLUMP_CONFIG: GroundCoverLayerConfig = {
  seedSalt: 0x3c55,
  blockCells: 3,
  maxPerBlock: 1,
  jitterCells: 1.5,
  seam: { perBlock: .42, minSizeCells: 1.4, maxSizeCells: 2.6, sizeBias: 1.4, minAlpha: .9, maxAlpha: 1 },
  dirt: { perBlock: .05, minSizeCells: 1, maxSizeCells: 1.8, sizeBias: 1.6, minAlpha: .85, maxAlpha: 1 },
  grass: { perBlock: .2, minSizeCells: 1.4, maxSizeCells: 3, sizeBias: 1.4, minAlpha: .85, maxAlpha: 1 },
  variants: Array.from({ length: 16 }, (_, index) => ({
    fileName: `ground_clump_${String(index + 1).padStart(2, '0')}.png`, frequencyPercent: 6.25,
  })),
};

/** Draw order: patches, clumps, tufts on top. */
export const GROUND_COVER_TIERS: readonly GroundCoverLayerConfig[] = [GROUND_PATCH_CONFIG, GROUND_CLUMP_CONFIG, GROUND_COVER_CONFIG];

/**
 * Obergrenze des Blockrasters fuer eine konkrete Map. Sie skaliert mit der Mapflaeche und ist
 * deshalb keine globale, auf kleine Arenen zugeschnittene Placement-Grenze.
 */
export function getGroundCoverPlacementBudget(
  gridCols: number,
  gridRows: number,
  config: GroundCoverLayerConfig = GROUND_COVER_CONFIG,
): number {
  if (gridCols <= 0 || gridRows <= 0) return 0;
  return Math.ceil(gridCols / config.blockCells)
    * Math.ceil(gridRows / config.blockCells)
    * Math.ceil(config.maxPerBlock);
}

export function getGroundCoverTextureKey(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

/** Alle fuer eine Ankerklasse zugelassenen Varianten, in Tabellenreihenfolge. */
export function getGroundCoverVariantsForAnchor(
  anchor: GroundCoverAnchor,
  config: GroundCoverLayerConfig = GROUND_COVER_CONFIG,
): readonly GroundCoverVariantConfig[] {
  return config.variants.filter((variant) => !variant.anchors || variant.anchors.includes(anchor));
}

export function getGroundCoverAnchorConfig(
  anchor: GroundCoverAnchor,
  config: GroundCoverLayerConfig = GROUND_COVER_CONFIG,
): GroundCoverAnchorConfig {
  return config[anchor];
}

export function preloadGroundCoverAssets(loader: Phaser.Loader.LoaderPlugin): void {
  for (const tier of GROUND_COVER_TIERS) for (const variant of tier.variants) {
    loader.image(getGroundCoverTextureKey(variant.fileName), `${GROUND_COVER_ASSET_PATH}/${variant.fileName}`);
  }
}
