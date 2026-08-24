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
  default: { tint: 0xffd794, alpha: 0.7, scaleX: 0.9, scaleY: 0.7, duration: 60, sparkCount: 4, sparkSpeed: 60, sparkSpread: 18, sparkTints: [0xffffff, 0xffd48d, 0xff8c42] },
  glock: { tint: 0xffe0b2, alpha: 0.55, scaleX: 0.75, scaleY: 0.48, duration: 48, sparkCount: 3, sparkSpeed: 52, sparkSpread: 14, sparkTints: [0xffffff, 0xffdb9b, 0xff9a4d] },
  xbow: { tint: 0xe8dcc2, alpha: 0.26, scaleX: 0.7, scaleY: 0.24, duration: 44, sparkCount: 2, sparkSpeed: 36, sparkSpread: 10, sparkTints: [0xfef8e9, 0xd2c09d] },
  p90: { tint: 0xffd183, alpha: 0.58, scaleX: 0.95, scaleY: 0.42, duration: 42, sparkCount: 4, sparkSpeed: 80, sparkSpread: 14, sparkTints: [0xffffff, 0xffe5a4, 0xffa04e] },
  ak47: { tint: 0xffc46e, alpha: 0.68, scaleX: 1.08, scaleY: 0.52, duration: 56, sparkCount: 6, sparkSpeed: 86, sparkSpread: 17, sparkTints: [0xffffff, 0xffd28f, 0xff8e35] },
  shotgun: { tint: 0xffe6b3, alpha: 0.76, scaleX: 1.22, scaleY: 0.8, duration: 76, sparkCount: 7, sparkSpeed: 96, sparkSpread: 26, sparkTints: [0xffffff, 0xffdf9e, 0xff9145] },
  awp: { tint: 0xfff3c2, alpha: 0.82, scaleX: 1.35, scaleY: 0.52, duration: 88, sparkCount: 8, sparkSpeed: 110, sparkSpread: 14, sparkTints: [0xffffff, 0xfff0c8, 0xffb35f] },
  gauss: { tint: 0xbef4ff, alpha: 0.95, scaleX: 1.65, scaleY: 1.02, duration: 110, sparkCount: 10, sparkSpeed: 96, sparkSpread: 20, sparkTints: [0xffffff, 0xcff8ff, 0x78d6ff], useEnergyCore: true },
  negev: { tint: 0xffcc74, alpha: 0.62, scaleX: 1.0, scaleY: 0.46, duration: 40, sparkCount: 5, sparkSpeed: 90, sparkSpread: 20, sparkTints: [0xffffff, 0xffd98d, 0xff8f2e] },
  rocket: { tint: 0xffa247, alpha: 0.72, scaleX: 1.12, scaleY: 0.72, duration: 90, sparkCount: 6, sparkSpeed: 72, sparkSpread: 16, sparkTints: [0xffffff, 0xffc475, 0xff7131] },
  flame: { tint: 0xff8c34, alpha: 0.42, scaleX: 0.95, scaleY: 0.62, duration: 54, sparkCount: 5, sparkSpeed: 48, sparkSpread: 22, sparkTints: [0xffffff, 0xffcf6f, 0xff6326] },
  energy: { tint: 0xc8f7ff, alpha: 0.66, scaleX: 1.0, scaleY: 0.82, duration: 84, sparkCount: 6, sparkSpeed: 64, sparkSpread: 24, sparkTints: [0xffffff, 0xc8f7ff, 0x73bed3], useEnergyCore: true },
  plasma: { tint: 0xf1f1f1, alpha: 0.6, scaleX: 0.92, scaleY: 0.78, duration: 70, sparkCount: 5, sparkSpeed: 54, sparkSpread: 24, sparkTints: [0xffffff, 0xdedede, 0x9ea4a8], useEnergyCore: true },
  asmd_primary: { tint: 0xd7fbff, alpha: 0.92, scaleX: 1.42, scaleY: 1.04, duration: 118, sparkCount: 12, sparkSpeed: 104, sparkSpread: 22, sparkTints: [0xffffff, 0xdaf9ff, 0x9de7ff, 0x73bed3], useEnergyCore: true },
};

export class MuzzleFlashRenderer {
  private lighting: LightingSystem | null = null;
  private gpuVfx: GpuVfxSystem | null = null;
  private bodySpec: GpuVfxSpawnSpec | null = null;
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

    this.bodySpec = system.createSpec(GpuVfxEffectId.MuzzleFlashBody);
    this.bodySpec.positionEase = GpuVfxEase.Linear;
    this.bodySpec.yMode = GpuVfxEase.Linear;
    this.bodySpec.scaleEase = GpuVfxEase.QuadOut;
    this.bodySpec.alphaEase = GpuVfxEase.QuadOut;
    this.bodySpec.angularVelocity = 0;
    this.bodySpec.gravityFactor = 1;
    this.bodySpec.tintBlendStart = 1;
    this.bodySpec.tintBlendEnd = 1;

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
    const bodySpec = this.bodySpec;
    const sparkSpec = this.sparkSpec;
    if (!system || !bodySpec || !sparkSpec) return;

    const nowMs = system.now();

    // `scale` drives the old Y axis, while `stretch` carries the independent X axis. This keeps
    // the exact cfg.scaleX/cfg.scaleY start values and grows both axes by exactly 1.25.
    bodySpec.lifeMs = cfg.duration;
    bodySpec.x = x;
    bodySpec.y = y;
    bodySpec.vx = 0;
    bodySpec.vy = 0;
    bodySpec.rotation = angle;
    bodySpec.scaleStart = cfg.scaleY;
    bodySpec.scaleEnd = cfg.scaleY * 1.25;
    bodySpec.stretchStart = cfg.scaleX / cfg.scaleY;
    bodySpec.stretchEnd = bodySpec.stretchStart;
    bodySpec.alphaStart = emissiveAlpha(cfg.alpha);
    bodySpec.alphaEnd = 0;
    bodySpec.tint = color ?? cfg.tint;
    bodySpec.frame = cfg.useEnergyCore ? GpuVfxFrameId.MuzzleEnergy : GpuVfxFrameId.MuzzleFlash;
    // The body is critical and is intentionally not passed through scaleBurst: it must remain
    // visible even when standard spark quality is reduced.
    system.spawn(bodySpec, GPU_VFX_NO_SOURCE_HANDLE, nowMs);

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
