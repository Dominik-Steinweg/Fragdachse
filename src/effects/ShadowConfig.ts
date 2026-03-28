import {
  ARENA_MAX_X,
  ARENA_MAX_Y,
  ARENA_OFFSET_X,
  ARENA_OFFSET_Y,
  CANOPY_RADIUS,
  CELL_SIZE,
  DEPTH,
  PLAYER_SIZE,
  TRUNK_RADIUS,
} from '../config';
import { TRAIN } from '../train/TrainConfig';
import type { ProjectileStyle } from '../types';

export type ShadowShape = 'cell' | 'circle' | 'ellipse' | 'capsule';

export interface ShadowCasterConfig {
  readonly enabled: boolean;
  readonly layerDepth: number;
  readonly airborneHeightPx?: number;
  readonly castHeightPx: number;
  readonly opacity: number;
  readonly softnessPx: number;
  readonly blurLayers: number;
  readonly stretch: number;
  readonly inflatePx: number;
  readonly shape: ShadowShape;
  readonly footprintWidthPx: number;
  readonly footprintHeightPx: number;
}

export interface ShadowProjectileSample {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly style?: ProjectileStyle;
}

export const WORLD_SHADOW_CONFIG = {
  color: 0x05070b,
  lightDirection: { x: 0.84, y: 0.62 },
  cullMarginPx: 140,
  arenaBounds: {
    minX: ARENA_OFFSET_X,
    minY: ARENA_OFFSET_Y,
    maxX: ARENA_MAX_X,
    maxY: ARENA_MAX_Y,
  },
} as const;

export const SHADOW_CASTERS = {
  rock: {
    enabled: true,
    layerDepth: DEPTH.ROCKS - 0.35,
    castHeightPx: 40,
    opacity: 0.68,
    softnessPx: 16,
    blurLayers: 24,
    stretch: 1.3,
    inflatePx: 4,
    shape: 'cell',
    footprintWidthPx: CELL_SIZE * 1.5,
    footprintHeightPx: CELL_SIZE * 1.5,
  },
  trunk: {
    enabled: true,
    layerDepth: DEPTH.ROCKS - 0.2,
    castHeightPx: 60,
    opacity: 0.84,
    softnessPx: 10,
    blurLayers: 24,
    stretch: 0.75,
    inflatePx: 1,
    shape: 'circle',
    footprintWidthPx: TRUNK_RADIUS * 2,
    footprintHeightPx: TRUNK_RADIUS * 2,
  },
  canopy: {
    enabled: true,
    layerDepth: DEPTH.CANOPY - 0.2,
    airborneHeightPx: 60,
    castHeightPx: 32,
    opacity: 0.78,
    softnessPx: 98,
    blurLayers: 32,
    stretch: 1.35,
    inflatePx: 12,
    shape: 'circle',
    footprintWidthPx: CANOPY_RADIUS * 1.64,
    footprintHeightPx: CANOPY_RADIUS * 1.34,
  },
  player: {
    enabled: true,
    layerDepth: DEPTH.PLAYERS - 0.08,
    castHeightPx: 16,
    opacity: 0.72,
    softnessPx: 32,
    blurLayers: 16,
    stretch: 1.15,
    inflatePx: 1,
    shape: 'ellipse',
    footprintWidthPx: PLAYER_SIZE * 0.58,
    footprintHeightPx: PLAYER_SIZE * 0.58,
  },
  turret: {
    enabled: true,
    layerDepth: DEPTH.ROCKS + 0.12,
    castHeightPx: 22,
    opacity: 0.26,
    softnessPx: 12,
    blurLayers: 16,
    stretch: 0.82,
    inflatePx: 2,
    shape: 'ellipse',
    footprintWidthPx: CELL_SIZE * 0.96,
    footprintHeightPx: CELL_SIZE * 0.62,
  },
  trainLoco: {
    enabled: true,
    layerDepth: DEPTH.TRAIN - 0.08,
    castHeightPx: 60,
    opacity: 0.74,
    softnessPx: 14,
    blurLayers: 16,
    stretch: 0.9,
    inflatePx: 3,
    shape: 'capsule',
    footprintWidthPx: TRAIN.VISUAL_WIDTH * 0.98,
    footprintHeightPx: TRAIN.LOCO_HEIGHT * 0.95,
  },
  trainWagon: {
    enabled: true,
    layerDepth: DEPTH.TRAIN - 0.08,
    castHeightPx: 64,
    opacity: 0.72,
    softnessPx: 12,
    blurLayers: 16,
    stretch: 0.96,
    inflatePx: 2,
    shape: 'capsule',
    footprintWidthPx: TRAIN.VISUAL_WIDTH * 0.94,
    footprintHeightPx: TRAIN.WAGON_HEIGHT * 0.98,
  },
  projectileRocket: {
    enabled: true,
    layerDepth: DEPTH.PROJECTILES - 0.12,
    airborneHeightPx: 18,
    castHeightPx: 8,
    opacity: 0.58,
    softnessPx: 24,
    blurLayers: 8,
    stretch: 0.72,
    inflatePx: 1,
    shape: 'ellipse',
    footprintWidthPx: 18,
    footprintHeightPx: 10,
  },
  projectileGrenade: {
    enabled: true,
    layerDepth: DEPTH.PROJECTILES - 0.12,
    airborneHeightPx: 12,
    castHeightPx: 12,
    opacity: 0.98,
    softnessPx: 8,
    blurLayers: 8,
    stretch: 0.68,
    inflatePx: 1,
    shape: 'ellipse',
    footprintWidthPx: 16,
    footprintHeightPx: 10,
  },
  projectileHolyGrenade: {
    enabled: true,
    layerDepth: DEPTH.PROJECTILES - 0.12,
    airborneHeightPx: 13,
    castHeightPx: 13,
    opacity: 0.2,
    softnessPx: 8,
    blurLayers: 8,
    stretch: 0.7,
    inflatePx: 1,
    shape: 'ellipse',
    footprintWidthPx: 18,
    footprintHeightPx: 11,
  },
  projectileTranslocatorPuck: {
    enabled: true,
    layerDepth: DEPTH.PROJECTILES - 0.12,
    castHeightPx: 10,
    opacity: 0.16,
    softnessPx: 7,
    blurLayers: 4,
    stretch: 0.62,
    inflatePx: 1,
    shape: 'ellipse',
    footprintWidthPx: 14,
    footprintHeightPx: 9,
  },
} as const satisfies Record<string, ShadowCasterConfig>;

export function getProjectileShadowConfig(style?: ProjectileStyle): ShadowCasterConfig | null {
  switch (style) {
    case 'rocket':
      return SHADOW_CASTERS.projectileRocket;
    case 'grenade':
      return SHADOW_CASTERS.projectileGrenade;
    case 'holy_grenade':
      return SHADOW_CASTERS.projectileHolyGrenade;
    case 'translocator_puck':
      return SHADOW_CASTERS.projectileTranslocatorPuck;
    case 'bullet':
    case 'ball':
    case 'energy_ball':
    case 'spore':
    case 'flame':
    case 'bfg':
    case 'awp':
    case 'gauss':
    default:
      return null;
  }
}