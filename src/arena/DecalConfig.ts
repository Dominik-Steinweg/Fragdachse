import * as Phaser from 'phaser';
import { CELL_SIZE } from '../config';
import type { DecalKey, DecalTerrainLayer } from '../types';

export interface DecalVariantConfig {
  fileName: string;
  frequencyPercent: number;
}

export interface DecalLayerConfig {
  coveragePercent: number;
  maxOffsetX: number;
  maxOffsetY: number;
  variants: readonly DecalVariantConfig[];
}

export const DECAL_SIZE = 16;
export const DECAL_MAX_SAFE_OFFSET_PX = Math.floor((CELL_SIZE - DECAL_SIZE) / 2);
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
} satisfies Record<DecalTerrainLayer, DecalLayerConfig>;

export function getDecalTextureKey(fileName: string): DecalKey {
  return fileName.replace(/\.[^.]+$/, '');
}

export function preloadArenaDecalAssets(loader: Phaser.Loader.LoaderPlugin): void {
  const seen = new Set<string>();
  for (const layerConfig of Object.values(ARENA_DECAL_CONFIG)) {
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