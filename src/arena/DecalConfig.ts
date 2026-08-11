import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import type { DecalKey, DecalTerrainLayer } from '../types';

export interface DecalVariantConfig {
  fileName: string;
  frequencyPercent: number;
  displaySize?: number;
  alpha?: number;
}

export interface DecalLayerConfig {
  coveragePercent: number;
  maxOffsetX: number;
  maxOffsetY: number;
  variants: readonly DecalVariantConfig[];
}

export const DECAL_SIZE = 16;
export const DECAL_MAX_SAFE_OFFSET_PX = Math.floor((CELL_SIZE - DECAL_SIZE) / 2);
/** Rock decals are intentionally slightly larger than ground specks so a few can cross a cell seam. */
export const ROCK_DECAL_SIZE = 26;
/** Breite der vollflaechigeren, aber weiterhin transparenten Moos-/Flechten-Decals. */
export const ROCK_DECAL_LARGE_SIZE = 48;
export const ROCK_DECAL_MAX_OFFSET_PX = 7;
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
    ],
  },
  grass: {
    coveragePercent: 18,
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
      { fileName: 'flower01.png', frequencyPercent: 30 },
      { fileName: 'flower02.png', frequencyPercent: 20 },
      { fileName: 'flower03.png', frequencyPercent: 30 },
      { fileName: 'flower04.png', frequencyPercent: 60 },
      { fileName: 'busch01.png', frequencyPercent: 100 },
      { fileName: 'busch02.png', frequencyPercent: 100 },
      { fileName: 'grass01.png', frequencyPercent: 100 },
      { fileName: 'grass02.png', frequencyPercent: 100 },
      { fileName: 'pilz01.png', frequencyPercent: 30 },
    ],
  },
} satisfies Record<Exclude<DecalTerrainLayer, 'rock'>, DecalLayerConfig>;

export const ROCK_DECAL_CONFIG: DecalLayerConfig = {
  coveragePercent: 30,
  maxOffsetX: ROCK_DECAL_MAX_OFFSET_PX,
  maxOffsetY: ROCK_DECAL_MAX_OFFSET_PX,
  variants: [
    { fileName: 'rock_crack_hairline.png', frequencyPercent: 18, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_crack_branch.png', frequencyPercent: 14, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_crack_fracture.png', frequencyPercent: 10, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_moss_fringe.png', frequencyPercent: 12, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_lichen_patch.png', frequencyPercent: 10, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_moss_crescent.png', frequencyPercent: 10, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_sprout_pair.png', frequencyPercent: 8, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_fern_cluster.png', frequencyPercent: 6, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_pebbles.png', frequencyPercent: 7, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_mineral_streak.png', frequencyPercent: 5, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_crack_split.png', frequencyPercent: 12, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_crack_branchlet.png', frequencyPercent: 10, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_chip_angular.png', frequencyPercent: 9, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_lichen_specks.png', frequencyPercent: 8, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_moss_tuft.png', frequencyPercent: 8, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_root_threads.png', frequencyPercent: 7, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_sprout_single.png', frequencyPercent: 6, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_pebble_crescent.png', frequencyPercent: 6, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_mineral_vein.png', frequencyPercent: 1, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_fern_frond.png', frequencyPercent: 5, displaySize: ROCK_DECAL_SIZE },
    { fileName: 'rock_moss_carpet.png', frequencyPercent: 7, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.78 },
    { fileName: 'rock_moss_crescent_large.png', frequencyPercent: 7, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.8 },
    { fileName: 'rock_lichen_plate_large.png', frequencyPercent: 6, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.78 },
    { fileName: 'rock_damp_island.png', frequencyPercent: 6, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.76 },
    { fileName: 'rock_fern_moss_mat.png', frequencyPercent: 5, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.82 },
    { fileName: 'rock_moss_ribbon.png', frequencyPercent: 5, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.8 },
    { fileName: 'rock_lichen_field_large.png', frequencyPercent: 5, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.74 },
    { fileName: 'rock_root_moss_tangle.png', frequencyPercent: 4, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.82 },
    { fileName: 'rock_moss_growth_blotch.png', frequencyPercent: 4, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.72 },
    { fileName: 'rock_moss_shelf.png', frequencyPercent: 4, displaySize: ROCK_DECAL_LARGE_SIZE, alpha: 0.8 },
  ],
};

export function getDecalTextureKey(fileName: string): DecalKey {
  return fileName.replace(/\.[^.]+$/, '');
}

export function getRockDecalVariant(textureKey: DecalKey): DecalVariantConfig | undefined {
  return ROCK_DECAL_CONFIG.variants.find((variant) => getDecalTextureKey(variant.fileName) === textureKey);
}

export function preloadArenaDecalAssets(loader: Phaser.Loader.LoaderPlugin): void {
  const seen = new Set<string>();
  for (const layerConfig of [...Object.values(ARENA_DECAL_CONFIG), ROCK_DECAL_CONFIG]) {
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
