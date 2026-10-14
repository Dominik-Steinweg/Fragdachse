import type { DawnNightModifierId } from '../../dawn/contracts/DawnContentIds';

/** Runtime keys of the night atmosphere art (`public/assets/sprites/dawn-night/manifest.json`). */
export const DAWN_NIGHT_TEXTURES = {
  lut: (id: DawnNightModifierId | 'identity') => `dawn-night-lut-${id}-256x16`,
  cloud: 'dawn-night-noise-cloud-512',
  smoke: 'dawn-night-noise-smoke-512',
  ember: 'dawn-night-ember-mask-512',
  edge: 'dawn-night-edge-mask-1920x1080',
  bomberShadow: 'dawn-night-bomber-shadow-256x128',
} as const;

export interface DawnNightFilterParams {
  readonly lut: DawnNightModifierId | 'identity';
  readonly lutAmount: number;
  /** amount, tile size (world px), density threshold, drift (world px/s). */
  readonly haze: readonly [number, number, number, number];
  readonly hazeColor: number;
  readonly smoke: number;
  /** amount, tile size (world px), rise (world px/s), flicker (rad/s). */
  readonly embers: readonly [number, number, number, number];
  readonly emberColor: number;
  readonly edgeColor: number;
  readonly edgeAmount: number;
}

export type DawnNightStyle = Omit<DawnNightFilterParams, 'edgeAmount'> & {
  readonly edgeAmount: number;
  /** Edge pulse period (bomber warning, fire flicker); 0 = steady. */
  readonly pulseMs: number;
};

/**
 * Final M3 night-modifier look (Art Direction V1, textures from `dawn-assets`): one owner, one parameter
 * set. The world camera receives a single filter pass; HUD and markers on the clarity camera stay untouched.
 */
export const NIGHT_MODIFIER_ATMOSPHERE = {
  enabled: true,
  fadeInMs: 3500,
  styles: {
    'blood-moon': { lut: 'blood-moon', lutAmount: 0.9, haze: [0.32, 2600, 0.42, 6], hazeColor: 0x5a0f1a, smoke: 0,
      embers: [0, 1, 0, 0], emberColor: 0, edgeColor: 0x2e050c, edgeAmount: 0.55, pulseMs: 0 },
    fog: { lut: 'fog', lutAmount: 0.8, haze: [0.46, 3000, 0.26, 10], hazeColor: 0x7d879c, smoke: 0,
      embers: [0, 1, 0, 0], emberColor: 0, edgeColor: 0x596075, edgeAmount: 0.35, pulseMs: 0 },
    bombers: { lut: 'bombers', lutAmount: 0.75, haze: [0.12, 2600, 0.55, 14], hazeColor: 0x2b2622, smoke: 0,
      embers: [0, 1, 0, 0], emberColor: 0, edgeColor: 0x8a1410, edgeAmount: 0.4, pulseMs: 2400 },
    fire: { lut: 'fire', lutAmount: 0.85, haze: [0.14, 2400, 0.5, 8], hazeColor: 0x3a1c0c, smoke: 0.3,
      embers: [0.95, 700, 26, 3.5], emberColor: 0xff8a3a, edgeColor: 0x6e2408, edgeAmount: 0.42, pulseMs: 5200 },
  } satisfies Record<DawnNightModifierId, DawnNightStyle>,
};

