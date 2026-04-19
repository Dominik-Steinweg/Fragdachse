import { CELL_SIZE } from '../config';
import type { DecalKey, DecalTerrainLayer } from '../types';

export interface DecalVariantConfig {
  key: DecalKey;
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

export const ARENA_DECAL_CONFIG = {
  dirt: {
    coveragePercent: 18,
    maxOffsetX: 6,
    maxOffsetY: 6,
    variants: [
      { key: 'decal01', frequencyPercent: 50 },
      { key: 'decal02', frequencyPercent: 50 },
    ],
  },
  grass: {
    coveragePercent: 12,
    maxOffsetX: 6,
    maxOffsetY: 6,
    variants: [
      { key: 'decal03', frequencyPercent: 50 },
      { key: 'decal04', frequencyPercent: 50 },
    ],
  },
} satisfies Record<DecalTerrainLayer, DecalLayerConfig>;

export function clampDecalPercent(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

export function clampDecalOffsetPx(offsetPx: number): number {
  return Math.max(0, Math.min(DECAL_MAX_SAFE_OFFSET_PX, Math.floor(offsetPx)));
}