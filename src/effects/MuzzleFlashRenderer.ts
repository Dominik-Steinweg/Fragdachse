import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { BulletVisualPreset, EnergyBallVariant, HitscanVisualPreset, ProjectileStyle } from '../types';
import { createEmitter, destroyEmitter, ensureCanvasTexture } from './EffectUtils';

const TEX_FLASH = '__muzzle_flash';
const TEX_SPARK = '__muzzle_spark';
const TEX_ENERGY = '__muzzle_energy';

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
  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    const textures = this.scene.textures;

    if (!textures.exists(TEX_FLASH)) {
      ensureCanvasTexture(textures, TEX_FLASH, 32, 18, (ctx) => {
        const grad = ctx.createRadialGradient(10, 9, 0, 10, 9, 14);
        grad.addColorStop(0, 'rgba(255,255,255,1.0)');
        grad.addColorStop(0.28, 'rgba(255,236,180,0.96)');
        grad.addColorStop(0.6, 'rgba(255,170,88,0.44)');
        grad.addColorStop(1, 'rgba(255,128,48,0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(2, 9);
        ctx.lineTo(29, 2);
        ctx.lineTo(23, 9);
        ctx.lineTo(29, 16);
        ctx.closePath();
        ctx.fill();
      });
    }

    if (!textures.exists(TEX_SPARK)) {
      ensureCanvasTexture(textures, TEX_SPARK, 8, 8, (ctx) => {
        const grad = ctx.createRadialGradient(4, 4, 0, 4, 4, 4);
        grad.addColorStop(0, 'rgba(255,255,255,1.0)');
        grad.addColorStop(0.45, 'rgba(255,220,160,0.72)');
        grad.addColorStop(1, 'rgba(255,120,40,0.0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 8, 8);
      });
    }

    if (!textures.exists(TEX_ENERGY)) {
      ensureCanvasTexture(textures, TEX_ENERGY, 36, 24, (ctx) => {
        const grad = ctx.createRadialGradient(11, 12, 0, 11, 12, 15);
        grad.addColorStop(0, 'rgba(255,255,255,1.0)');
        grad.addColorStop(0.35, 'rgba(212,248,255,0.92)');
        grad.addColorStop(0.68, 'rgba(115,190,211,0.32)');
        grad.addColorStop(1, 'rgba(115,190,211,0.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(3, 12);
        ctx.lineTo(33, 4);
        ctx.lineTo(25, 12);
        ctx.lineTo(33, 20);
        ctx.closePath();
        ctx.fill();
      });
    }
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
    this.playFlash(x, y, vx, vy, preset === 'asmd_primary' ? 'asmd_primary' : 'default', color);
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
    // x, y is already the muzzle origin – callers compute it before passing here
    const texture = cfg.useEnergyCore ? TEX_ENERGY : TEX_FLASH;
    const flash = this.scene.add.image(x, y, texture)
      .setDepth(DEPTH.PROJECTILES + 2)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color ?? cfg.tint)
      .setAlpha(cfg.alpha)
      .setRotation(angle)
      .setScale(cfg.scaleX, cfg.scaleY);

    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scaleX: cfg.scaleX * 1.25,
      scaleY: cfg.scaleY * 1.25,
      duration: cfg.duration,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });

    const emitter = createEmitter(this.scene, x, y, TEX_SPARK, {
      lifespan: { min: Math.max(cfg.duration * 1.1, 50), max: cfg.duration * 2 },
      quantity: cfg.sparkCount,
      frequency: -1,
      angle: { min: Phaser.Math.RadToDeg(angle) - cfg.sparkSpread, max: Phaser.Math.RadToDeg(angle) + cfg.sparkSpread },
      speed: { min: cfg.sparkSpeed * 0.35, max: cfg.sparkSpeed },
      scale: { start: 0.6, end: 0.04 },
      alpha: { start: 0.82, end: 0 },
      tint: [...cfg.sparkTints],
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    }, DEPTH.PROJECTILES + 1.5);
    emitter.explode(cfg.sparkCount);
    this.scene.time.delayedCall(cfg.duration * 2 + 40, () => destroyEmitter(emitter));
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