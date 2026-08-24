import * as Phaser from 'phaser';
import { VOID_FIRE_COLOR } from '../config';
import type { BulletVisualPreset, EnergyBallVariant, HitscanVisualPreset, ProjectileStyle } from '../types';
import { mixColors } from './EffectUtils';
import { emissiveAlpha } from './EmissiveScale';
import type { LightingSystem } from './LightingSystem';
import { ensureMuzzleFlashTextures } from './gpu/GpuVfxSourceTextures';
import { GpuVfxEase } from './gpu/GpuVfxEase';
import { GpuVfxEffectId } from './gpu/GpuVfxEffects';
import { GpuVfxFrameId } from './gpu/GpuVfxAtlas';
import { GPU_VFX_NO_SOURCE_HANDLE, GpuVfxSystem } from './gpu/GpuVfxSystem';
import type { GpuVfxSpawnSpec } from './gpu/GpuVfxSpawnSpec';

type MuzzleFlashPreset =
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
  duration: number;
  sparkCount: number;
  sparkSpeed: number;
  sparkSpread: number;
  sparkTints: readonly number[];
  useEnergyCore?: boolean;
}

const FLASH_PRESETS: Record<MuzzleFlashPreset, FlashPresetConfig> = {
  default: { tint: 0xffd794, alpha: 0.7, scaleX: 0.9, scaleY: 0.7, duration: 64, sparkCount: 5, sparkSpeed: 60, sparkSpread: 18, sparkTints: [0xffffff, 0xffd48d, 0xff8c42] },
  glock: { tint: 0xffe0b2, alpha: 0.55, scaleX: 0.75, scaleY: 0.56, duration: 60, sparkCount: 4, sparkSpeed: 52, sparkSpread: 14, sparkTints: [0xffffff, 0xffdb9b, 0xff9a4d] },
  xbow: { tint: 0xe8dcc2, alpha: 0.26, scaleX: 0.7, scaleY: 0.28, duration: 48, sparkCount: 2, sparkSpeed: 36, sparkSpread: 10, sparkTints: [0xfef8e9, 0xd2c09d] },
  p90: { tint: 0xffd183, alpha: 0.58, scaleX: 0.95, scaleY: 0.58, duration: 60, sparkCount: 6, sparkSpeed: 80, sparkSpread: 14, sparkTints: [0xffffff, 0xffe5a4, 0xffa04e] },
  ak47: { tint: 0xffc46e, alpha: 0.68, scaleX: 1.08, scaleY: 0.62, duration: 70, sparkCount: 8, sparkSpeed: 86, sparkSpread: 17, sparkTints: [0xffffff, 0xffd28f, 0xff8e35] },
  shotgun: { tint: 0xffe6b3, alpha: 0.76, scaleX: 1.22, scaleY: 0.9, duration: 96, sparkCount: 10, sparkSpeed: 96, sparkSpread: 26, sparkTints: [0xffffff, 0xffdf9e, 0xff9145] },
  awp: { tint: 0xfff3c2, alpha: 0.82, scaleX: 1.35, scaleY: 0.62, duration: 108, sparkCount: 11, sparkSpeed: 110, sparkSpread: 14, sparkTints: [0xffffff, 0xfff0c8, 0xffb35f] },
  gauss: { tint: 0xbef4ff, alpha: 0.95, scaleX: 1.65, scaleY: 1.02, duration: 110, sparkCount: 12, sparkSpeed: 96, sparkSpread: 20, sparkTints: [0xffffff, 0xcff8ff, 0x78d6ff], useEnergyCore: true },
  negev: { tint: 0xffcc74, alpha: 0.62, scaleX: 1.0, scaleY: 0.58, duration: 60, sparkCount: 7, sparkSpeed: 90, sparkSpread: 20, sparkTints: [0xffffff, 0xffd98d, 0xff8f2e] },
  rocket: { tint: 0xffa247, alpha: 0.72, scaleX: 1.12, scaleY: 0.76, duration: 100, sparkCount: 8, sparkSpeed: 72, sparkSpread: 16, sparkTints: [0xffffff, 0xffc475, 0xff7131] },
  flame: { tint: 0xff8c34, alpha: 0.42, scaleX: 0.95, scaleY: 0.62, duration: 54, sparkCount: 5, sparkSpeed: 48, sparkSpread: 22, sparkTints: [0xffffff, 0xffcf6f, 0xff6326] },
  energy: { tint: 0xc8f7ff, alpha: 0.66, scaleX: 1.0, scaleY: 0.82, duration: 96, sparkCount: 8, sparkSpeed: 64, sparkSpread: 24, sparkTints: [0xffffff, 0xc8f7ff, 0x73bed3], useEnergyCore: true },
  plasma: { tint: 0xf1f1f1, alpha: 0.6, scaleX: 0.92, scaleY: 0.78, duration: 84, sparkCount: 8, sparkSpeed: 54, sparkSpread: 24, sparkTints: [0xffffff, 0xdedede, 0x9ea4a8], useEnergyCore: true },
  asmd_primary: { tint: 0xd7fbff, alpha: 0.92, scaleX: 1.42, scaleY: 1.04, duration: 118, sparkCount: 14, sparkSpeed: 104, sparkSpread: 22, sparkTints: [0xffffff, 0xdaf9ff, 0x9de7ff, 0x73bed3], useEnergyCore: true },
};

const CORE_SCALE_END_MULTIPLIER = 1.35;
const OUTER_SCALE_START_MULTIPLIER = 1.35;
const OUTER_SCALE_END_MULTIPLIER = 1.12;
const OUTER_LIFETIME_MULTIPLIER = 1.2;
const OUTER_ALPHA_MULTIPLIER = 0.48;
const OUTER_TINT_BLEND_START = 0.42;

export class MuzzleFlashRenderer {
  private lighting: LightingSystem | null = null;
  private gpuVfx: GpuVfxSystem | null = null;
  private coreSpec: GpuVfxSpawnSpec | null = null;
  private outerSpec: GpuVfxSpawnSpec | null = null;
  private sparkSpec: GpuVfxSpawnSpec | null = null;

  constructor(private readonly scene: Phaser.Scene) {}

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  generateTextures(): void {
    ensureMuzzleFlashTextures(this.scene);
  }

  /** Meldet die eventgetriebenen One-Shot-Effekte beim gemeinsamen GPU-VFX-Backend an. */
  registerGpuVfx(system: GpuVfxSystem): void {
    if (this.gpuVfx) return;
    this.gpuVfx = system;

    this.coreSpec = system.createSpec(GpuVfxEffectId.MuzzleFlashBody);
    this.coreSpec.positionEase = GpuVfxEase.Linear;
    this.coreSpec.yMode = GpuVfxEase.Linear;
    this.coreSpec.scaleEase = GpuVfxEase.QuadOut;
    this.coreSpec.alphaEase = GpuVfxEase.QuadOut;
    this.coreSpec.angularVelocity = 0;
    this.coreSpec.gravityFactor = 1;
    this.coreSpec.tintBlendStart = 1;
    this.coreSpec.tintBlendEnd = 1;

    this.outerSpec = system.createSpec(GpuVfxEffectId.MuzzleFlashBody);
    this.outerSpec.positionEase = GpuVfxEase.Linear;
    this.outerSpec.yMode = GpuVfxEase.Linear;
    this.outerSpec.scaleEase = GpuVfxEase.Linear;
    this.outerSpec.alphaEase = GpuVfxEase.Linear;
    this.outerSpec.angularVelocity = 0;
    this.outerSpec.gravityFactor = 1;
    this.outerSpec.tintBlendStart = OUTER_TINT_BLEND_START;
    this.outerSpec.tintBlendEnd = 1;

    this.sparkSpec = system.createSpec(GpuVfxEffectId.MuzzleFlashSpark);
    this.sparkSpec.positionEase = GpuVfxEase.Linear;
    this.sparkSpec.yMode = GpuVfxEase.Linear;
    this.sparkSpec.scaleEase = GpuVfxEase.Linear;
    this.sparkSpec.alphaEase = GpuVfxEase.Linear;
    this.sparkSpec.angularVelocity = 0;
    this.sparkSpec.gravityFactor = 1;
    this.sparkSpec.stretchStart = 1;
    this.sparkSpec.stretchEnd = 1;
    this.sparkSpec.tintBlendStart = 1;
    this.sparkSpec.tintBlendEnd = 1;
  }

  playProjectileFlash(
    x: number,
    y: number,
    vx: number,
    vy: number,
    style?: ProjectileStyle,
    bulletPreset?: BulletVisualPreset,
    energyBallVariant?: EnergyBallVariant,
    color?: number,
  ): void {
    const preset = this.resolveProjectilePreset(style, bulletPreset, energyBallVariant);
    if (!preset) return;
    this.playFlash(x, y, vx, vy, preset, color);
  }

  playHitscanFlash(
    x: number,
    y: number,
    vx: number,
    vy: number,
    preset: HitscanVisualPreset = 'default',
    color?: number,
  ): void {
    const resolvedPreset = preset === 'asmd_primary' ? preset : 'default';
    this.playFlash(x, y, vx, vy, resolvedPreset, color);
  }

  private playFlash(
    x: number,
    y: number,
    vx: number,
    vy: number,
    preset: MuzzleFlashPreset,
    color?: number,
  ): void {
    const cfg = FLASH_PRESETS[preset];
    const angle = Math.atan2(vy, vx);

    // Kurzer Lichtimpuls in der Mündungsfarbe. Bewusst ohne Lichtverdeckung: Schüsse
    // sind die mit Abstand häufigste Lichtquelle, und der Impuls ist zu kurz, als dass
    // ein Schlagschatten überhaupt lesbar wäre.
    const isVoidFlame = preset === 'flame' && color === VOID_FIRE_COLOR;
    const lightColor = isVoidFlame
      ? mixColors(color, 0xffffff, 0.58)
      : color ?? cfg.tint;
    this.lighting?.pulse('muzzleFlash', x, y, {
      color: lightColor,
      radiusPx: 170 * (0.8 + cfg.scaleX * 0.4),
      intensity: Phaser.Math.Clamp(cfg.alpha * 1.35, 0.45, 1),
    });

    const system = this.gpuVfx;
    const coreSpec = this.coreSpec;
    const outerSpec = this.outerSpec;
    const sparkSpec = this.sparkSpec;
    if (!system || !coreSpec || !outerSpec || !sparkSpec) return;

    const nowMs = system.now();
    const forwardOffset = (cfg.useEnergyCore ? 15 : 14) * cfg.scaleX;
    const bodyX = x + Math.cos(angle) * forwardOffset;
    const bodyY = y + Math.sin(angle) * forwardOffset;
    const bodyStretch = cfg.scaleX / cfg.scaleY;
    const frame = cfg.useEnergyCore ? GpuVfxFrameId.MuzzleEnergy : GpuVfxFrameId.MuzzleFlash;

    // The asymmetric texture starts at the real muzzle and extends forward. Only the two body
    // members use this offset; sparks deliberately stay at the original muzzle origin.
    coreSpec.lifeMs = cfg.duration;
    coreSpec.x = bodyX;
    coreSpec.y = bodyY;
    coreSpec.vx = 0;
    coreSpec.vy = 0;
    coreSpec.rotation = angle;
    coreSpec.scaleStart = cfg.scaleY;
    coreSpec.scaleEnd = cfg.scaleY * CORE_SCALE_END_MULTIPLIER;
    coreSpec.stretchStart = bodyStretch;
    coreSpec.stretchEnd = bodyStretch;
    coreSpec.alphaStart = emissiveAlpha(cfg.alpha);
    coreSpec.alphaEnd = 0;
    coreSpec.tint = color ?? cfg.tint;
    coreSpec.frame = frame;
    // Both bodies are critical and intentionally bypass burst quality scaling; standard quality
    // only reduces the optional sparks.
    system.spawn(coreSpec, GPU_VFX_NO_SOURCE_HANDLE, nowMs);

    outerSpec.lifeMs = Math.round(cfg.duration * OUTER_LIFETIME_MULTIPLIER);
    outerSpec.x = bodyX;
    outerSpec.y = bodyY;
    outerSpec.vx = 0;
    outerSpec.vy = 0;
    outerSpec.rotation = angle;
    outerSpec.scaleStart = cfg.scaleY * OUTER_SCALE_START_MULTIPLIER;
    outerSpec.scaleEnd = cfg.scaleY * OUTER_SCALE_START_MULTIPLIER * OUTER_SCALE_END_MULTIPLIER;
    outerSpec.stretchStart = bodyStretch;
    outerSpec.stretchEnd = bodyStretch;
    outerSpec.alphaStart = emissiveAlpha(cfg.alpha * OUTER_ALPHA_MULTIPLIER);
    outerSpec.alphaEnd = 0;
    outerSpec.tint = color ?? cfg.tint;
    outerSpec.frame = frame;
    system.spawn(outerSpec, GPU_VFX_NO_SOURCE_HANDLE, nowMs);

    const sparkCount = system.quality.scaleDiscreteBurst(GpuVfxEffectId.MuzzleFlashSpark, cfg.sparkCount);
    if (sparkCount < cfg.sparkCount) {
      system.recordQualityDrop(GpuVfxEffectId.MuzzleFlashSpark, cfg.sparkCount - sparkCount);
    }

    sparkSpec.lifeMs = 0;
    sparkSpec.x = x;
    sparkSpec.y = y;
    sparkSpec.scaleStart = 0.6;
    sparkSpec.scaleEnd = 0.04;
    sparkSpec.alphaStart = emissiveAlpha(0.82);
    sparkSpec.alphaEnd = 0;
    sparkSpec.rotation = 0;
    sparkSpec.stretchStart = 1;
    sparkSpec.stretchEnd = 1;
    sparkSpec.tintBlendStart = 1;
    sparkSpec.tintBlendEnd = 1;

    const sparkTints = isVoidFlame
      ? [0xffffff, mixColors(color, 0xffffff, 0.58), color]
      : cfg.sparkTints;
    for (let index = 0; index < sparkCount; index += 1) {
      sparkSpec.lifeMs = Phaser.Math.FloatBetween(Math.max(cfg.duration * 1.1, 50), cfg.duration * 2);
      const sparkAngle = angle + Phaser.Math.FloatBetween(-cfg.sparkSpread, cfg.sparkSpread) * Math.PI / 180;
      const speed = Phaser.Math.FloatBetween(cfg.sparkSpeed * 0.35, cfg.sparkSpeed);
      sparkSpec.vx = Math.cos(sparkAngle) * speed;
      sparkSpec.vy = Math.sin(sparkAngle) * speed;
      const stretchBand = index % 3;
      sparkSpec.rotation = sparkAngle;
      sparkSpec.stretchStart = 1.8 + stretchBand * 0.25;
      sparkSpec.stretchEnd = 0.65 + stretchBand * 0.15;
      sparkSpec.tint = sparkTints[Math.floor(Phaser.Math.FloatBetween(0, sparkTints.length)) % sparkTints.length];
      system.spawn(sparkSpec, GPU_VFX_NO_SOURCE_HANDLE, nowMs);
    }
  }

  private resolveProjectilePreset(
    style?: ProjectileStyle,
    bulletPreset?: BulletVisualPreset,
    energyBallVariant?: EnergyBallVariant,
  ): MuzzleFlashPreset | null {
    if (style === 'grenade' || style === 'holy_grenade' || style === 'translocator_puck') return null;
    if (style === 'energy_ball') return energyBallVariant === 'plasma' ? 'plasma' : 'energy';
    if (style === 'hydra') return 'energy';
    if (style === 'rocket') return 'rocket';
    if (style === 'flame') return 'flame';
    if (style === 'leaf_blower') return null;
    if (style === 'bfg') return 'energy';
    if (style === 'gauss') return 'gauss';
    if (style === 'awp') return 'awp';

    switch (bulletPreset) {
      case 'glock': return 'glock';
      case 'xbow': return 'xbow';
      case 'p90': return 'p90';
      case 'ak47': return 'ak47';
      case 'shotgun': return 'shotgun';
      case 'awp': return 'awp';
      case 'gauss': return 'gauss';
      case 'negev': return 'negev';
      default: return 'default';
    }
  }
}
