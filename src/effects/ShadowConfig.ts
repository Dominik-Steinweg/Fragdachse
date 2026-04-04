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
  lightDirection: { x: 0.75, y: 0.75 },
  cullMarginPx: 140,
  arenaBounds: {
    get minX() { return ARENA_OFFSET_X; },
    get minY() { return ARENA_OFFSET_Y; },
    get maxX() { return ARENA_MAX_X; },
    get maxY() { return ARENA_MAX_Y; },
  },
};

export const SHADOW_CASTERS = {
  rock: {
    enabled: true,
    layerDepth: DEPTH.ROCKS - 0.35,
    castHeightPx: 8,
    opacity: 0.72,
    softnessPx: 4,
    blurLayers: 8,
    stretch: 0.8,
    inflatePx: 1,
    shape: 'cell',
    footprintWidthPx: CELL_SIZE * 0.85,
    footprintHeightPx: CELL_SIZE * 0.85,
  },
  trunk: {
    enabled: true,
    layerDepth: DEPTH.ROCKS - 0.2,
    castHeightPx: 32,
    opacity: 0.84,
    softnessPx: 16,
    blurLayers: 4,
    stretch: 0.5,
    inflatePx: 1,
    shape: 'circle',
    footprintWidthPx: TRUNK_RADIUS * 2,
    footprintHeightPx: TRUNK_RADIUS * 2,
  },
  canopy: {
    enabled: true,
    layerDepth: DEPTH.CANOPY - 0.2,
    airborneHeightPx: 20,
    castHeightPx: 10,
    opacity: 0.78,
    softnessPx: 98,
    blurLayers: 32,
    stretch: 0.55,
    inflatePx: 12,
    shape: 'circle',
    footprintWidthPx: CANOPY_RADIUS * 1.14,
    footprintHeightPx: CANOPY_RADIUS * 1.14,
  },
  player: {
    enabled: true,
    layerDepth: DEPTH.PLAYERS - 0.08,
    castHeightPx: 4,
    opacity: 0.72,
    softnessPx: 12,
    blurLayers: 4,
    stretch: 0.9,
    inflatePx: 0,
    shape: 'circle',
    footprintWidthPx: PLAYER_SIZE,
    footprintHeightPx: PLAYER_SIZE,
  },
  turret: {
    enabled: true,
    layerDepth: DEPTH.ROCKS + 0.12,
    castHeightPx: 4,
    opacity: 0.26,
    softnessPx: 6,
    blurLayers: 1,
    stretch: 1,
    inflatePx: 0,
    shape: 'circle',
    footprintWidthPx: CELL_SIZE * 0.8,
    footprintHeightPx: CELL_SIZE * 0.8,
  },
  trainLoco: {
    enabled: true,
    layerDepth: DEPTH.TRAIN - 0.08,
    castHeightPx: 16,
    opacity: 0.52,
    softnessPx: 2,
    blurLayers: 2,
    stretch: 1,
    inflatePx: 2,
    shape: 'capsule',
    footprintWidthPx: TRAIN.VISUAL_WIDTH,
    footprintHeightPx: TRAIN.LOCO_HEIGHT,
  },
  trainWagon: {
    enabled: true,
    layerDepth: DEPTH.TRAIN - 0.08,
    castHeightPx: 16,
    opacity: 0.52,
    softnessPx: 2,
    blurLayers: 2,
    stretch: 1,
    inflatePx: 2,
    shape: 'capsule',
    footprintWidthPx: TRAIN.VISUAL_WIDTH,
    footprintHeightPx: TRAIN.WAGON_HEIGHT,
  },
  projectileRocket: {
    enabled: true,
    layerDepth: DEPTH.PROJECTILES - 0.12,
    airborneHeightPx: 12,
    castHeightPx: 4,
    opacity: 0.38,
    softnessPx: 2,
    blurLayers: 2,
    stretch: 0.38,
    inflatePx: 1,
    shape: 'ellipse',
    footprintWidthPx: 12,
    footprintHeightPx: 6,
  },
  projectileGrenade: {
    enabled: true,
    layerDepth: DEPTH.PROJECTILES - 0.12,
    airborneHeightPx: 12,
    castHeightPx: 5,
    opacity: 0.78,
    softnessPx: 2,
    blurLayers: 2,
    stretch: 0.36,
    inflatePx: 1,
    shape: 'ellipse',
    footprintWidthPx: 16,
    footprintHeightPx: 10,
  },
  projectileHolyGrenade: {
    enabled: true,
    layerDepth: DEPTH.PROJECTILES - 0.12,
    airborneHeightPx: 12,
    castHeightPx: 5,
    opacity: 0.7,
    softnessPx: 2,
    blurLayers: 2,
    stretch: 0.38,
    inflatePx: 1,
    shape: 'ellipse',
    footprintWidthPx: 18,
    footprintHeightPx: 11,
  },
  projectileTranslocatorPuck: {
    enabled: true,
    layerDepth: DEPTH.PROJECTILES - 0.12,
    castHeightPx: 12,
    opacity: 0.46,
    softnessPx: 2,
    blurLayers: 2,
    stretch: 0.32,
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
    case 'hydra':
    case 'spore':
    case 'flame':
    case 'bfg':
    case 'awp':
    case 'gauss':
    default:
      return null;
  }
}