import type { ExplosionVisualStyle } from '../types';

export type CombatExplosionVisualStyle = Exclude<ExplosionVisualStyle, 'brood_hatch' | 'regeneration'>;
export type ExplosionSpecialFamily = 'standard' | 'cascade' | 'energy' | 'holy' | 'lightning' | 'train' | 'nuke' | 'pop';

export interface ExplosionVisualProfile {
  readonly family: ExplosionSpecialFamily;
  readonly countScale: number;
  readonly lifeScale: number;
  readonly bodyScale: number;
  readonly smokeScale: number;
  readonly chunkScale: number;
  readonly upwardEmbers: boolean;
}

const STANDARD: ExplosionVisualProfile = {
  family: 'standard', countScale: 1, lifeScale: 1, bodyScale: 1,
  smokeScale: 1, chunkScale: 1, upwardEmbers: false,
};

/**
 * Vollstaendige Stilklassifikation. `null` ist bewusst: beide Ereignisse benutzen zwar das
 * Explosion-RPC, sind aber fachlich keine destruktiven Kampfexplosionen.
 */
export const EXPLOSION_VISUAL_PROFILES = {
  default: STANDARD,
  rocket: {
    family: 'standard', countScale: 1.15, lifeScale: 0.95, bodyScale: 1.05,
    smokeScale: 1, chunkScale: 1.1, upwardEmbers: false,
  },
  mini_rocket: {
    family: 'standard', countScale: 0.7, lifeScale: 0.72, bodyScale: 0.78,
    smokeScale: 0.45, chunkScale: 0.65, upwardEmbers: false,
  },
  mini_rocket_cascade: {
    family: 'cascade', countScale: 0.82, lifeScale: 0.8, bodyScale: 0.85,
    smokeScale: 0.55, chunkScale: 0.7, upwardEmbers: false,
  },
  energy: {
    family: 'energy', countScale: 0.95, lifeScale: 0.72, bodyScale: 0.78,
    smokeScale: 0.12, chunkScale: 0.35, upwardEmbers: true,
  },
  timebomb: {
    family: 'energy', countScale: 1.05, lifeScale: 0.78, bodyScale: 0.88,
    smokeScale: 0.08, chunkScale: 0.4, upwardEmbers: true,
  },
  timebomb_pop: {
    family: 'pop', countScale: 0.45, lifeScale: 0.45, bodyScale: 0.45,
    smokeScale: 0, chunkScale: 0, upwardEmbers: true,
  },
  holy: {
    family: 'holy', countScale: 1.15, lifeScale: 1.25, bodyScale: 1.15,
    smokeScale: 0, chunkScale: 0.65, upwardEmbers: true,
  },
  lightning: {
    family: 'lightning', countScale: 0.9, lifeScale: 0.6, bodyScale: 0.25,
    smokeScale: 0, chunkScale: 0, upwardEmbers: true,
  },
  train: {
    family: 'train', countScale: 1.4, lifeScale: 1.25, bodyScale: 1.35,
    smokeScale: 1.3, chunkScale: 1.5, upwardEmbers: false,
  },
  nuke: {
    family: 'nuke', countScale: 1.7, lifeScale: 1.5, bodyScale: 1.5,
    smokeScale: 2, chunkScale: 1.8, upwardEmbers: true,
  },
  void_nuke: {
    family: 'nuke', countScale: 1.7, lifeScale: 1.5, bodyScale: 1.5,
    smokeScale: 2, chunkScale: 1.8, upwardEmbers: true,
  },
  brood_hatch: null,
  regeneration: null,
} as const satisfies Readonly<Record<ExplosionVisualStyle, ExplosionVisualProfile | null>>;

export function getCombatExplosionProfile(style: ExplosionVisualStyle): ExplosionVisualProfile | null {
  return EXPLOSION_VISUAL_PROFILES[style];
}

export function isThermalExplosionStyle(style: ExplosionVisualStyle): boolean {
  return style === 'default'
    || style === 'rocket'
    || style === 'mini_rocket'
    || style === 'mini_rocket_cascade'
    || style === 'train'
    || style === 'nuke';
}

export function isCombatExplosionStyle(style: ExplosionVisualStyle): style is CombatExplosionVisualStyle {
  return EXPLOSION_VISUAL_PROFILES[style] !== null;
}
