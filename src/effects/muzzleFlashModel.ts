import { MUZZLE_FLASH_VFX } from '../config';
import type { BulletVisualPreset, EnergyBallVariant, ProjectileStyle } from '../types';

export type MuzzleFlashPreset =
  | 'glock'
  | 'xbow'
  | 'p90'
  | 'ak47'
  | 'shotgun'
  | 'awp'
  | 'gauss'
  | 'negev'
  | 'rocket'
  | 'flame'
  | 'energy'
  | 'plasma'
  | 'asmd_primary'
  | 'default';

interface FlashPresetConfig {
  tint: number;
  alpha: number;
  scaleX: number;
  scaleY: number;
  sparkCount: number;
  sparkSpeed: number;
  sparkSpread: number;
  sparkTints: readonly number[];
  useEnergyCore?: boolean;
}

const FLASH_PRESETS: Record<MuzzleFlashPreset, FlashPresetConfig> = {
  default: { tint: 0xffd794, alpha: 0.84, scaleX: 0.9, scaleY: 0.7, sparkCount: 5, sparkSpeed: 60, sparkSpread: 18, sparkTints: [0xffffff, 0xffd48d, 0xff8c42] },
  glock: { tint: 0xffe0b2, alpha: 0.7, scaleX: 0.75, scaleY: 0.56, sparkCount: 4, sparkSpeed: 52, sparkSpread: 14, sparkTints: [0xffffff, 0xffdb9b, 0xff9a4d] },
  xbow: { tint: 0xe8dcc2, alpha: 0.26, scaleX: 0.7, scaleY: 0.28, sparkCount: 2, sparkSpeed: 36, sparkSpread: 10, sparkTints: [0xfef8e9, 0xd2c09d] },
  p90: { tint: 0xffd183, alpha: 0.75, scaleX: 0.95, scaleY: 0.58, sparkCount: 6, sparkSpeed: 80, sparkSpread: 14, sparkTints: [0xffffff, 0xffe5a4, 0xffa04e] },
  ak47: { tint: 0xffc46e, alpha: 0.84, scaleX: 1.08, scaleY: 0.62, sparkCount: 8, sparkSpeed: 86, sparkSpread: 17, sparkTints: [0xffffff, 0xffd28f, 0xff8e35] },
  shotgun: { tint: 0xffe6b3, alpha: 0.84, scaleX: 1.22, scaleY: 0.9, sparkCount: 10, sparkSpeed: 96, sparkSpread: 26, sparkTints: [0xffffff, 0xffdf9e, 0xff9145] },
  awp: { tint: 0xfff3c2, alpha: 0.88, scaleX: 1.35, scaleY: 0.62, sparkCount: 11, sparkSpeed: 110, sparkSpread: 14, sparkTints: [0xffffff, 0xfff0c8, 0xffb35f] },
  gauss: { tint: 0xbef4ff, alpha: 0.98, scaleX: 1.65, scaleY: 1.02, sparkCount: 12, sparkSpeed: 96, sparkSpread: 20, sparkTints: [0xffffff, 0xcff8ff, 0x78d6ff], useEnergyCore: true },
  negev: { tint: 0xffcc74, alpha: 0.8, scaleX: 1.0, scaleY: 0.58, sparkCount: 7, sparkSpeed: 90, sparkSpread: 20, sparkTints: [0xffffff, 0xffd98d, 0xff8f2e] },
  rocket: { tint: 0xffa247, alpha: 0.8, scaleX: 1.12, scaleY: 0.76, sparkCount: 8, sparkSpeed: 72, sparkSpread: 16, sparkTints: [0xffffff, 0xffc475, 0xff7131] },
  flame: { tint: 0xff8c34, alpha: 0.42, scaleX: 0.95, scaleY: 0.62, sparkCount: 5, sparkSpeed: 48, sparkSpread: 22, sparkTints: [0xffffff, 0xffcf6f, 0xff6326] },
  energy: { tint: 0xc8f7ff, alpha: 0.76, scaleX: 1.0, scaleY: 0.82, sparkCount: 8, sparkSpeed: 64, sparkSpread: 24, sparkTints: [0xffffff, 0xc8f7ff, 0x73bed3], useEnergyCore: true },
  plasma: { tint: 0xf1f1f1, alpha: 0.7, scaleX: 0.92, scaleY: 0.78, sparkCount: 8, sparkSpeed: 54, sparkSpread: 24, sparkTints: [0xffffff, 0xdedede, 0x9ea4a8], useEnergyCore: true },
  asmd_primary: { tint: 0xd7fbff, alpha: 0.96, scaleX: 1.42, scaleY: 1.04, sparkCount: 14, sparkSpeed: 104, sparkSpread: 22, sparkTints: [0xffffff, 0xdaf9ff, 0x9de7ff, 0x73bed3], useEnergyCore: true },
};


export interface MuzzleTuning {
  muzzleFlashIntensity: number;
  muzzleFlashDuration: number;
  muzzleFlashSparkStrength: number;
}
export const MUZZLE_MAX_DURATION = 400;
// Longest preset (AWP) spark tail: 400 * 1.5 * 1.8.
export const MUZZLE_MAX_LIFETIME = MUZZLE_MAX_DURATION * 1.5 * 1.8;
const BALLISTIC_SIZE: Partial<Record<MuzzleFlashPreset, number>> = {
  default: 1, glock: 0.75, p90: 0.8, negev: 0.85, ak47: 1, shotgun: 1.25, awp: 1.4,
};
export interface MuzzleProfile extends FlashPresetConfig {
  duration: number;
  outerDuration: number;
  sparkLifeMin: number;
  sparkLifeMax: number;
  sparkScale: number;
  sparkStretch: number;
  lightRadius: number;
  lightIntensity: number;
  lightDuration: number;
}
const clamp = (n: number, min: number, max: number, fallback: number) =>
  Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;

/** Only the renderer's reusable output is mutated; no per-shot config copies. */
export function resolveMuzzleProfile(preset: MuzzleFlashPreset, tuning: MuzzleTuning = MUZZLE_FLASH_VFX,
  out: MuzzleProfile = {} as MuzzleProfile): MuzzleProfile {
  const cfg = FLASH_PRESETS[preset];
  const intensity = clamp(tuning.muzzleFlashIntensity, 0, 4, 1.8);
  const duration = clamp(tuning.muzzleFlashDuration, 60, MUZZLE_MAX_DURATION, 180);
  const sparks = clamp(tuning.muzzleFlashSparkStrength, 0, 3, 1.5);
  const relative = BALLISTIC_SIZE[preset];
  const sx = relative === undefined ? cfg.scaleX : 1.05 * relative;
  const sy = relative === undefined ? cfg.scaleY : 0.70 * relative;
  const character = relative ?? cfg.scaleX / 1.08;
  const timeFactor = preset === 'awp' ? 1.5 : preset === 'shotgun' ? 1.25
    : cfg.useEnergyCore ? 1.2 : preset === 'flame' || preset === 'xbow' ? 0.4 : 1;
  const rapid = preset === 'p90' || preset === 'negev';
  out.tint = cfg.tint;
  out.useEnergyCore = cfg.useEnergyCore;
  out.scaleX = sx * intensity;
  out.scaleY = sy * intensity;
  out.alpha = intensity === 0 ? 0 : Math.min(0.98, cfg.alpha * (0.85 + 0.15 * intensity));
  out.duration = preset === 'p90' ? Math.min(60, duration / 3)
    : preset === 'negev' ? Math.min(45, duration / 4) : duration * timeFactor;
  out.outerDuration = rapid ? out.duration + (preset === 'p90' ? 10 : 5) : out.duration * 1.1;
  out.sparkCount = intensity === 0 || sparks === 0 ? 0 : preset === 'ak47' ? 12 : cfg.sparkCount;
  out.sparkSpeed = cfg.sparkSpeed * 2.17 * sparks * Math.sqrt(intensity / 1.8);
  out.sparkSpread = cfg.sparkSpread;
  out.sparkTints = cfg.sparkTints;
  out.sparkScale = 0.70 * Math.sqrt(sparks) * Math.sqrt(intensity / 1.8);
  out.sparkStretch = 2.8 * Math.sqrt(sparks);
  out.sparkLifeMin = duration * timeFactor * 1.22;
  out.sparkLifeMax = duration * timeFactor * 1.8;
  out.lightRadius = 156 * intensity * Math.sqrt(character);
  out.lightIntensity = intensity === 0 ? 0 : Math.min(1.8, 0.67 * intensity * character);
  out.lightDuration = rapid ? out.duration : out.duration * 0.94;
  return out;
}

export function resolveProjectileMuzzlePreset(
  style?: ProjectileStyle, bulletPreset?: BulletVisualPreset, energyBallVariant?: EnergyBallVariant,
): MuzzleFlashPreset | null {
  if (style === 'grenade' || style === 'holy_grenade' || style === 'translocator_puck' || style === 'leaf_blower') return null;
  if (style === 'energy_ball') return energyBallVariant === 'plasma' ? 'plasma' : 'energy';
  if (style === 'hydra' || style === 'bfg') return 'energy';
  if (style === 'rocket' || style === 'flame' || style === 'gauss' || style === 'awp') return style;
  if (bulletPreset === 'awp_charged' || bulletPreset === 'awp_corridor') return 'awp';
  return bulletPreset && bulletPreset in FLASH_PRESETS ? bulletPreset as MuzzleFlashPreset : 'default';
}
