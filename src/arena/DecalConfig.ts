import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import type { DecalKey, DecalTerrainLayer } from '../types';

/**
 * Wo ein Fels-Decal sitzen darf.
 *
 * - `edge`   – Zelle mit mindestens einer freiliegenden Kardinalkante. Bewuchs sammelt sich
 *              an der Silhouette, deshalb liegt hier die hoehere Deckung. Nur kleine
 *              Varianten, damit der Ueberhang auf den Boden gering bleibt.
 * - `interior`– Zelle mit vier belegten Kardinalnachbarn: Risse, Abplatzungen, Mineraladern.
 * - `core`   – Zelle mit vollstaendig belegter 8er-Nachbarschaft. Erst hier passen die
 *              grossen Moos-/Flechtenmatten vollstaendig in die Felsmasse.
 */
export type DecalPlacement = 'edge' | 'interior' | 'core';

export interface DecalVariantConfig {
  fileName: string;
  frequencyPercent: number;
  displaySize?: number;
  alpha?: number;
  placement?: DecalPlacement;
}

export interface DecalLayerConfig {
  coveragePercent: number;
  maxOffsetX: number;
  maxOffsetY: number;
  variants: readonly DecalVariantConfig[];
}

export interface RockDecalLayerConfig extends DecalLayerConfig {
  /** Deckung auf Zellen mit freiliegender Kante. */
  edgeCoveragePercent: number;
  /** Deckung auf Zellen im Inneren des Verbunds. */
  interiorCoveragePercent: number;
}

export const DECAL_SIZE = 16;
export const DECAL_MAX_SAFE_OFFSET_PX = Math.floor((CELL_SIZE - DECAL_SIZE) / 2);
/** Rock decals are intentionally slightly larger than ground specks so a few can cross a cell seam. */
export const ROCK_DECAL_SIZE = 26;
/** Breite der vollflaechigeren, aber weiterhin transparenten Moos-/Flechten-Decals. */
export const ROCK_DECAL_LARGE_SIZE = 48;
/** Breite der sehr grossen, perforierten Matten auf vollstaendig umschlossenen Felszellen. */
export const ROCK_DECAL_VERY_LARGE_SIZE = 64;
export const ROCK_DECAL_MAX_OFFSET_PX = 7;
export const ROCK_DECAL_LARGE_MAX_OFFSET_PX = 4;
export const ROCK_DECAL_VERY_LARGE_MAX_OFFSET_PX = 2;
const DECAL_ASSET_PATH = './assets/sprites/decals';

export const ARENA_DECAL_CONFIG = {
  dirt: {
    coveragePercent: 18,
    maxOffsetX: 6,
    maxOffsetY: 6,
    variants: [
     // { fileName: 'decal01.png', frequencyPercent: 1 },
      { fileName: 'decal06.png', frequencyPercent: 1 },
      { fileName: 'Kiesel2.png', frequencyPercent: 1 },
      { fileName: 'Kiesel3.png', frequencyPercent: 1 },
      { fileName: 'dirt_brown_clod_a.png', frequencyPercent: 8 },
      { fileName: 'dirt_brown_clod_b.png', frequencyPercent: 8 },
      { fileName: 'dirt_brown_clod_c.png', frequencyPercent: 8 },
      { fileName: 'dirt_brown_clod_d.png', frequencyPercent: 8 },
      { fileName: 'dirt_brown_pebble_a.png', frequencyPercent: 7 },
      { fileName: 'dirt_brown_pebble_b.png', frequencyPercent: 7 },
      { fileName: 'dirt_brown_pebble_c.png', frequencyPercent: 7 },
      { fileName: 'dirt_brown_pebble_d.png', frequencyPercent: 7 },
      { fileName: 'dirt_brown_crumb_a.png', frequencyPercent: 6 },
      { fileName: 'dirt_brown_crumb_b.png', frequencyPercent: 6 },
      { fileName: 'dirt_brown_crumb_c.png', frequencyPercent: 6 },
      { fileName: 'dirt_brown_crumb_d.png', frequencyPercent: 6 },
      { fileName: 'dirt_brown_speck_a.png', frequencyPercent: 6 },
      { fileName: 'dirt_brown_speck_b.png', frequencyPercent: 6 },
      { fileName: 'dirt_brown_speck_c.png', frequencyPercent: 6 },
      { fileName: 'dirt_brown_speck_d.png', frequencyPercent: 6 },
      { fileName: 'dirt_brown_mottle_a.png', frequencyPercent: 5 },
      { fileName: 'dirt_brown_mottle_b.png', frequencyPercent: 5 },
      { fileName: 'dirt_brown_mottle_c.png', frequencyPercent: 5 },
      { fileName: 'dirt_brown_mottle_d.png', frequencyPercent: 5 },
    ],
  },
  grass: {
    /**
     * `coveragePercent` ist die Wahrscheinlichkeit pro Zelle, `frequencyPercent` nur das
     * relative Gewicht innerhalb der gezogenen Zellen. Die Anhebung von 18 auf 30 erhoeht also
     * die Gesamtdichte um Faktor 1,67.
     *
     * Grund: Decals sind mit 16 px punktfoermig und fuellen als duenne Streuung kein
     * durchgehendes Band. Zusammen mit der Detailkachel (siehe ArenaBackground) schliessen sie
     * damit den Bereich zwischen Halmkorn und grossflaechiger Variation.
     *
     * Bluehendes und Pilze sind bewusst gegengerechnet (Gewichte durch 1,67 geteilt): Ihre
     * absolute Dichte bleibt unveraendert, weil sie als Farbakzente wirken und bei 1,67-facher
     * Menge die Flaeche unruhig statt dichter machen wuerden. Die zusaetzliche Deckung faellt
     * damit vollstaendig auf die kontrastarmen Gras-, Busch- und Kieselvarianten.
     */
    coveragePercent: 30,
    maxOffsetX: 6,
    maxOffsetY: 6,
    variants: [
      //{ fileName: 'decal02.png', frequencyPercent: 50 },
      { fileName: 'decal03.png', frequencyPercent: 100 },
      { fileName: 'decal04.png', frequencyPercent: 100 },
      { fileName: 'decal05.png', frequencyPercent: 100 },
      { fileName: 'decal07.png', frequencyPercent: 100 },
      { fileName: 'Kiesel4.png', frequencyPercent: 100 },
      { fileName: 'Kiesel5.png', frequencyPercent: 100 },
      { fileName: 'flower01.png', frequencyPercent: 18 },
      { fileName: 'flower02.png', frequencyPercent: 12 },
      { fileName: 'flower03.png', frequencyPercent: 18 },
      { fileName: 'flower04.png', frequencyPercent: 36 },
      { fileName: 'busch01.png', frequencyPercent: 100 },
      { fileName: 'busch02.png', frequencyPercent: 100 },
      { fileName: 'grass01.png', frequencyPercent: 100 },
      { fileName: 'grass02.png', frequencyPercent: 100 },
      { fileName: 'pilz01.png', frequencyPercent: 18 },
    ],
  },
} satisfies Record<Exclude<DecalTerrainLayer, 'rock'>, DecalLayerConfig>;

/**
 * Dezente Dirt-Details, die exakt unter einer Felszelle liegen. Sie bleiben unter dem
 * dynamischen Fels-Layer verborgen und werden erst nach seiner Zerstoerung sichtbar.
 */
export const DIRT_ROCK_UNDERLAY_DECAL_CONFIG: DecalLayerConfig = {
  coveragePercent: 24,
  maxOffsetX: 4,
  maxOffsetY: 4,
  variants: [
    { fileName: 'dirt_rock_shadow_fleck_a.png', frequencyPercent: 8 },
    { fileName: 'dirt_rock_shadow_fleck_b.png', frequencyPercent: 8 },
    { fileName: 'dirt_rock_shadow_fleck_c.png', frequencyPercent: 7 },
    { fileName: 'dirt_rock_shadow_fleck_d.png', frequencyPercent: 7 },
    { fileName: 'dirt_rock_slate_speck_a.png', frequencyPercent: 7 },
    { fileName: 'dirt_rock_slate_speck_b.png', frequencyPercent: 7 },
    { fileName: 'dirt_rock_slate_speck_c.png', frequencyPercent: 6 },
    { fileName: 'dirt_rock_earth_chip_a.png', frequencyPercent: 7 },
    { fileName: 'dirt_rock_earth_chip_b.png', frequencyPercent: 6 },
    { fileName: 'dirt_rock_earth_chip_c.png', frequencyPercent: 6 },
  ],
};

export const ROCK_DECAL_CONFIG: RockDecalLayerConfig = {
  /** Mittelwert der beiden Deckungen; bleibt als Rueckfalloption fuer alte Aufrufer erhalten. */
  coveragePercent: 34,
  edgeCoveragePercent: 52,
  interiorCoveragePercent: 24,
  maxOffsetX: ROCK_DECAL_MAX_OFFSET_PX,
  maxOffsetY: ROCK_DECAL_MAX_OFFSET_PX,
  variants: [
    { fileName: 'rock_crack_hairline.png', frequencyPercent: 18, displaySize: ROCK_DECAL_SIZE, placement: 'interior' },
    { fileName: 'rock_crack_branch.png', frequencyPercent: 5, displaySize: ROCK_DECAL_SIZE, placement: 'interior' },
    { fileName: 'rock_crack_fracture.png', frequencyPercent: 5, displaySize: ROCK_DECAL_SIZE, placement: 'interior' },
    { fileName: 'rock_moss_fringe.png', frequencyPercent: 7, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_lichen_patch.png', frequencyPercent: 2, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_moss_crescent.png', frequencyPercent: 6, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_sprout_pair.png', frequencyPercent: 9, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_fern_cluster.png', frequencyPercent: 7, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_pebbles.png', frequencyPercent: 8, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_mineral_streak.png', frequencyPercent: 5, displaySize: ROCK_DECAL_SIZE, placement: 'interior' },
    { fileName: 'rock_crack_split.png', frequencyPercent: 6, displaySize: ROCK_DECAL_SIZE, placement: 'interior' },
    { fileName: 'rock_crack_branchlet.png', frequencyPercent: 10, displaySize: ROCK_DECAL_SIZE, placement: 'interior' },
    { fileName: 'rock_chip_angular.png', frequencyPercent: 9, displaySize: ROCK_DECAL_SIZE, placement: 'interior' },
    { fileName: 'rock_lichen_specks.png', frequencyPercent: 9, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_moss_tuft.png', frequencyPercent: 9, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_root_threads.png', frequencyPercent: 8, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_sprout_single.png', frequencyPercent: 2, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_pebble_crescent.png', frequencyPercent: 2, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_mineral_vein.png', frequencyPercent: 1, displaySize: ROCK_DECAL_SIZE, placement: 'interior' },
    { fileName: 'rock_fern_frond.png', frequencyPercent: 6, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_crack_fine.png', frequencyPercent: 11, displaySize: ROCK_DECAL_SIZE, placement: 'interior' },
    { fileName: 'rock_chip_pitted.png', frequencyPercent: 8, displaySize: ROCK_DECAL_SIZE, placement: 'interior' },
    { fileName: 'rock_lichen_dots.png', frequencyPercent: 8, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_root_hairs.png', frequencyPercent: 7, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_moss_crescent_small.png', frequencyPercent: 7, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_pebble_scatter.png', frequencyPercent: 7, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_dry_sprig.png', frequencyPercent: 8, displaySize: ROCK_DECAL_SIZE, placement: 'edge' },
    { fileName: 'rock_moss_edge_fleck.png', frequencyPercent: 4, displaySize: ROCK_DECAL_SIZE, alpha: 0.66, placement: 'edge' },
    { fileName: 'rock_moss_edge_hook.png', frequencyPercent: 4, displaySize: ROCK_DECAL_SIZE, alpha: 0.64, placement: 'edge' },
    { fileName: 'rock_moss_edge_scallop.png', frequencyPercent: 4, displaySize: ROCK_DECAL_SIZE, alpha: 0.68, placement: 'edge' },
    { fileName: 'rock_moss_edge_broken.png', frequencyPercent: 4, displaySize: ROCK_DECAL_SIZE, alpha: 0.64, placement: 'edge' },
    { fileName: 'rock_lichen_edge_trace.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.62, placement: 'edge' },
    { fileName: 'rock_lichen_edge_cluster.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.64, placement: 'edge' },
    { fileName: 'rock_lichen_edge_rim.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.62, placement: 'edge' },
    { fileName: 'rock_lichen_edge_speckle.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.6, placement: 'edge' },
    { fileName: 'rock_root_edge_tendril.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.66, placement: 'edge' },
    { fileName: 'rock_root_edge_split.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.62, placement: 'edge' },
    { fileName: 'rock_root_edge_knot.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.62, placement: 'edge' },
    { fileName: 'rock_root_edge_threads2.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.64, placement: 'edge' },
    { fileName: 'rock_crack_edge_nick.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.7, placement: 'edge' },
    { fileName: 'rock_crack_edge_spur.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.66, placement: 'edge' },
    { fileName: 'rock_crack_edge_branch.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.64, placement: 'edge' },
    { fileName: 'rock_chip_edge_nibble.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.62, placement: 'edge' },
    { fileName: 'rock_chip_edge_cascade.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.62, placement: 'edge' },
    { fileName: 'rock_chip_edge_scatter.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.58, placement: 'edge' },
    { fileName: 'rock_pebble_edge_pair.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.64, placement: 'edge' },
    { fileName: 'rock_pebble_edge_trio.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.6, placement: 'edge' },
    { fileName: 'rock_pebble_edge_arc.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.58, placement: 'edge' },
    { fileName: 'rock_sprig_edge_stem.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.58, placement: 'edge' },
    { fileName: 'rock_sprig_edge_tuft.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.58, placement: 'edge' },
    { fileName: 'rock_sprig_edge_leaflet.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.56, placement: 'edge' },
    { fileName: 'rock_fern_edge_leaf.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.62, placement: 'edge' },
    { fileName: 'rock_fern_edge_frill.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.6, placement: 'edge' },
    { fileName: 'rock_fern_edge_stem.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.58, placement: 'edge' },
    { fileName: 'rock_mineral_edge_dash.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.58, placement: 'edge' },
    { fileName: 'rock_mineral_edge_thread.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.56, placement: 'edge' },
    { fileName: 'rock_mineral_edge_bead.png', frequencyPercent: 3, displaySize: ROCK_DECAL_SIZE, alpha: 0.56, placement: 'edge' },
    { fileName: 'rock_moss_carpet.png', frequencyPercent: 7, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.78, placement: 'core' },
    { fileName: 'rock_moss_crescent_large.png', frequencyPercent: 7, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.8, placement: 'core' },
    { fileName: 'rock_lichen_plate_large.png', frequencyPercent: 6, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.78, placement: 'core' },
    { fileName: 'rock_damp_island.png', frequencyPercent: 6, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.76, placement: 'core' },
    { fileName: 'rock_fern_moss_mat.png', frequencyPercent: 5, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.82, placement: 'core' },
    { fileName: 'rock_moss_ribbon.png', frequencyPercent: 5, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.8, placement: 'core' },
    { fileName: 'rock_lichen_field_large.png', frequencyPercent: 5, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.74, placement: 'core' },
    { fileName: 'rock_root_moss_tangle.png', frequencyPercent: 4, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.82, placement: 'core' },
    { fileName: 'rock_moss_growth_blotch.png', frequencyPercent: 4, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.72, placement: 'core' },
    { fileName: 'rock_moss_shelf.png', frequencyPercent: 4, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.8, placement: 'core' },
    { fileName: 'rock_lichen_streak.png', frequencyPercent: 5, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.7, placement: 'core' },
    { fileName: 'rock_moss_fan.png', frequencyPercent: 5, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.68, placement: 'core' },
    { fileName: 'rock_damp_patch_large.png', frequencyPercent: 5, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.64, placement: 'core' },
    { fileName: 'rock_mineral_seam.png', frequencyPercent: 4, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.66, placement: 'core' },
    { fileName: 'rock_moss_cluster_large.png', frequencyPercent: 4, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.7, placement: 'core' },
    { fileName: 'rock_lichen_crescent_large2.png', frequencyPercent: 4, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.65, placement: 'core' },
    { fileName: 'rock_root_vein_braid.png', frequencyPercent: 4, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.66, placement: 'core' },
    { fileName: 'rock_moss_pool_very_large.png', frequencyPercent: 4, displaySize: ROCK_DECAL_VERY_LARGE_SIZE, alpha: 0.56, placement: 'core' },
    { fileName: 'rock_lichen_veil_very_large.png', frequencyPercent: 4, displaySize: ROCK_DECAL_VERY_LARGE_SIZE, alpha: 0.54, placement: 'core' },
    { fileName: 'rock_moss_ring_very_large.png', frequencyPercent: 3, displaySize: ROCK_DECAL_VERY_LARGE_SIZE, alpha: 0.58, placement: 'core' },
    { fileName: 'rock_damp_bloom_very_large.png', frequencyPercent: 3, displaySize: ROCK_DECAL_VERY_LARGE_SIZE, alpha: 0.52, placement: 'core' },
    { fileName: 'rock_moss_band_very_large.png', frequencyPercent: 3, displaySize: ROCK_DECAL_VERY_LARGE_SIZE, alpha: 0.56, placement: 'core' },
    { fileName: 'rock_lichen_mat_very_large.png', frequencyPercent: 3, displaySize: ROCK_DECAL_VERY_LARGE_SIZE, alpha: 0.54, placement: 'core' },
  ],
};

/**
 * Varianten, die auf einer Zelle der gegebenen Lage sitzen duerfen. Eine Kernzelle erbt die
 * Innen-Varianten, weil Risse ueberall im Verbund vorkommen; die grossen Matten bleiben
 * ausschliesslich dort, wo sie vollstaendig auf Fels liegen.
 */
export function getRockDecalVariantsForPlacement(placement: DecalPlacement): readonly DecalVariantConfig[] {
  return ROCK_DECAL_CONFIG.variants.filter((variant) => {
    const variantPlacement = variant.placement ?? 'interior';
    if (placement === 'core') return variantPlacement === 'core' || variantPlacement === 'interior';
    return variantPlacement === placement;
  });
}

export function getDecalTextureKey(fileName: string): DecalKey {
  return fileName.replace(/\.[^.]+$/, '');
}

export function getRockDecalVariant(textureKey: DecalKey): DecalVariantConfig | undefined {
  return ROCK_DECAL_CONFIG.variants.find((variant) => getDecalTextureKey(variant.fileName) === textureKey);
}

/**
 * Die Texturschluessel der `core`-Varianten. Einmal aufgebaut statt je Decal gesucht: Der
 * Fels-Decal-Bake fragt das fuer jedes Decal jeder Kachel ab.
 */
const ENCLOSED_ROCK_DECAL_KEYS: ReadonlySet<DecalKey> = new Set(
  ROCK_DECAL_CONFIG.variants
    .filter((variant) => variant.placement === 'core')
    .map((variant) => getDecalTextureKey(variant.fileName)),
);

/**
 * Liegt dieses Decal per Konstruktion vollstaendig auf Fels?
 *
 * `core` heisst: vollstaendig belegte 8er-Nachbarschaft. Die grossen 48- und 64-px-Matten sitzen
 * nur dort, ihre Flaeche endet also selbst am aeussersten Rand noch auf Fels und haengt nie ueber
 * freien Boden. Fuer sie – und nur fuer sie – ist der rein geometrische Schnitt an der
 * weggefallenen Felsflaeche vollstaendig: Faellt ihre Ankerzelle, bleibt ihr Anteil auf den
 * Nachbarfelsen unveraendert stehen, statt dass die ganze Matte verschwindet.
 *
 * Kleine Kanten-Decals koennen das nicht: Ihr Ueberhang liegt ueber nie belegtem Boden, den keine
 * Stanzform trifft. Sie muessen deshalb mit ihrer Ankerzelle verschwinden.
 */
export function isEnclosedRockDecal(textureKey: DecalKey): boolean {
  return ENCLOSED_ROCK_DECAL_KEYS.has(textureKey);
}

export function getRockDecalMaxOffsetPx(displaySize: number | undefined): number {
  if (displaySize === ROCK_DECAL_VERY_LARGE_SIZE) return ROCK_DECAL_VERY_LARGE_MAX_OFFSET_PX;
  if (displaySize === ROCK_DECAL_LARGE_SIZE) return ROCK_DECAL_LARGE_MAX_OFFSET_PX;
  return ROCK_DECAL_MAX_OFFSET_PX;
}

export function preloadArenaDecalAssets(loader: Phaser.Loader.LoaderPlugin): void {
  const seen = new Set<string>();
  for (const layerConfig of [...Object.values(ARENA_DECAL_CONFIG), DIRT_ROCK_UNDERLAY_DECAL_CONFIG, ROCK_DECAL_CONFIG]) {
    for (const variant of layerConfig.variants) {
      if (seen.has(variant.fileName)) continue;
      seen.add(variant.fileName);
      loader.image(getDecalTextureKey(variant.fileName), `${DECAL_ASSET_PATH}/${variant.fileName}`);
    }
  }
}

export function clampDecalPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

export function clampDecalOffsetPx(offsetPx: number): number {
  return Math.max(0, Math.min(DECAL_MAX_SAFE_OFFSET_PX, Math.floor(offsetPx)));
}
