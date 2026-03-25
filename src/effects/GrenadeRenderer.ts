import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { GrenadeVisualPreset } from '../types';
import { configureAdditiveImage, createEmitter, destroyEmitter, ensureCanvasTexture } from './EffectUtils';

const TEX_GRENADE_GLOW = '__grenade_glow';

const BODY_KEYS: Record<GrenadeVisualPreset, string> = {
  he: '__grenade_body_he',
  smoke: '__grenade_body_smoke',
  molotov: '__grenade_body_molotov',
};

const DETAIL_KEYS: Record<GrenadeVisualPreset, string> = {
  he: '__grenade_detail_he',
  smoke: '__grenade_detail_smoke',
  molotov: '__grenade_detail_molotov',
};

const SPARK_KEYS: Record<GrenadeVisualPreset, string> = {
  he: '__grenade_spark_he',
  smoke: '__grenade_spark_smoke',
  molotov: '__grenade_spark_molotov',
};

interface GrenadePresetConfig {
  bodyScale: number;
  glowAlpha: number;
  glowScale: number;
  detailAlpha: number;
  detailTint?: number;
  trailAlpha: number;
  trailFrequency: number;
  trailLifespan: { min: number; max: number };
  trailScaleStart: number;
  trailScaleEnd: number;
  trailSpeed: number;
  trailTints: readonly number[];
}

interface GrenadeVisual {
  glow: Phaser.GameObjects.Image;
  body: Phaser.GameObjects.Image;
  detail: Phaser.GameObjects.Image;
  trail: Phaser.GameObjects.Particles.ParticleEmitter;
  preset: GrenadeVisualPreset;
}

const PRESETS: Record<GrenadeVisualPreset, GrenadePresetConfig> = {
  he: {
    bodyScale: 1,
    glowAlpha: 0.18,
    glowScale: 1.35,
    detailAlpha: 0.96,
    detailTint: 0xe6ddb2,
    trailAlpha: 0.28,
    trailFrequency: 34,
    trailLifespan: { min: 180, max: 320 },
    trailScaleStart: 0.38,
    trailScaleEnd: 0.04,
    trailSpeed: 18,
    trailTints: [0xd5ddaa, 0x7f8d58, 0x3f472f],
  },
  smoke: {
    bodyScale: 1,
    glowAlpha: 0.08,
    glowScale: 1.15,
    detailAlpha: 0.82,
    detailTint: 0xaab3bc,
    trailAlpha: 0.22,
    trailFrequency: 28,
    trailLifespan: { min: 220, max: 420 },
    trailScaleStart: 0.42,
    trailScaleEnd: 0.12,
    trailSpeed: 12,
    trailTints: [0xcfd7dc, 0x7e8d96, 0x434e56],
  },
  molotov: {
    bodyScale: 1.02,
    glowAlpha: 0.22,
    glowScale: 1.5,
    detailAlpha: 0.92,
    detailTint: 0xf3d8aa,
    trailAlpha: 0.34,
    trailFrequency: 20,
    trailLifespan: { min: 120, max: 240 },
    trailScaleStart: 0.48,
    trailScaleEnd: 0.06,
    trailSpeed: 24,
    trailTints: [0xfff2c8, 0xffa64d, 0xff6224],
  },
};

export class GrenadeRenderer {
  private visuals = new Map<number, GrenadeVisual>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    const textures = this.scene.textures;

    if (!textures.exists(TEX_GRENADE_GLOW)) {
      ensureCanvasTexture(textures, TEX_GRENADE_GLOW, 56, 56, (ctx) => {
        const grad = ctx.createRadialGradient(28, 28, 0, 28, 28, 28);
        grad.addColorStop(0, 'rgba(255,235,186,0.45)');
        grad.addColorStop(0.45, 'rgba(255,180,86,0.12)');
        grad.addColorStop(1, 'rgba(255,180,86,0.0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 56, 56);
      });
    }

    this.generateHeTextures(textures);
    this.generateSmokeTextures(textures);
    this.generateMolotovTextures(textures);
  }

  createVisual(id: number, x: number, y: number, size: number, preset: GrenadeVisualPreset): void {
    if (this.visuals.has(id)) return;

    const cfg = PRESETS[preset];
    const glow = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_GRENADE_GLOW),
      DEPTH.PROJECTILES - 1,
      cfg.glowAlpha,
      preset === 'smoke' ? 0x8f9ba6 : (preset === 'molotov' ? 0xffac52 : 0xc9d17a),
    );
    const body = this.scene.add.image(x, y, BODY_KEYS[preset]).setDepth(DEPTH.PROJECTILES).setAlpha(0.98);
    const detail = this.scene.add.image(x, y, DETAIL_KEYS[preset]).setDepth(DEPTH.PROJECTILES + 0.2).setAlpha(cfg.detailAlpha);
    if (cfg.detailTint !== undefined) detail.setTint(cfg.detailTint);

    const trail = createEmitter(this.scene, x, y, SPARK_KEYS[preset], {
      lifespan: cfg.trailLifespan,
      frequency: cfg.trailFrequency,
      quantity: 1,
      speedX: { min: -cfg.trailSpeed, max: cfg.trailSpeed },
      speedY: { min: -cfg.trailSpeed, max: cfg.trailSpeed },
      scale: { start: cfg.trailScaleStart, end: cfg.trailScaleEnd },
      alpha: { start: cfg.trailAlpha, end: 0 },
      tint: [...cfg.trailTints],
      blendMode: Phaser.BlendModes.ADD,
      emitting: true,
    }, DEPTH.PROJECTILES - 0.2);

    this.visuals.set(id, { glow, body, detail, trail, preset });
    this.updateVisual(id, x, y, size, 1, 0);
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    const cfg = PRESETS[visual.preset];
    const speed = Math.max(Math.hypot(vx, vy), 1);
    const angle = Math.atan2(vy, vx);
    const baseScale = Math.max(size / 16, 0.8) * cfg.bodyScale;
    const spin = this.scene.time.now * 0.009 + id * 0.3;
    const nx = vx / speed;
    const ny = vy / speed;

    visual.glow.setPosition(x, y).setScale(baseScale * cfg.glowScale).setRotation(-spin * 0.2);
    visual.body.setPosition(x, y).setScale(baseScale).setRotation(visual.preset === 'molotov' ? angle + Math.PI / 2 : spin);
    visual.detail.setPosition(x, y).setScale(baseScale).setRotation(visual.preset === 'molotov' ? angle + Math.PI / 2 : spin);
    visual.trail.setPosition(x - nx * size * 0.45, y - ny * size * 0.45);
  }

  destroyVisual(id: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;
    visual.glow.destroy();
    visual.body.destroy();
    visual.detail.destroy();
    destroyEmitter(visual.trail);
    this.visuals.delete(id);
  }

  has(id: number): boolean {
    return this.visuals.has(id);
  }

  getActiveIds(): number[] {
    return [...this.visuals.keys()];
  }

  destroyAll(): void {
    for (const id of this.getActiveIds()) {
      this.destroyVisual(id);
    }
  }

  private generateHeTextures(textures: Phaser.Textures.TextureManager): void {
    if (!textures.exists(BODY_KEYS.he)) {
      ensureCanvasTexture(textures, BODY_KEYS.he, 34, 34, (ctx) => {
        const grad = ctx.createRadialGradient(13, 11, 1, 17, 18, 14);
        grad.addColorStop(0, 'rgba(206,224,131,1.0)');
        grad.addColorStop(0.42, 'rgba(109,126,68,0.98)');
        grad.addColorStop(1, 'rgba(44,56,31,1.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(8, 8, 18, 18, 4);
        ctx.fill();
      });
    }
    if (!textures.exists(DETAIL_KEYS.he)) {
      ensureCanvasTexture(textures, DETAIL_KEYS.he, 34, 34, (ctx) => {
        ctx.fillStyle = 'rgba(245,239,216,0.98)';
        ctx.fillRect(14, 4, 6, 5);
        ctx.fillRect(12, 1, 10, 4);
        ctx.strokeStyle = 'rgba(38,47,26,0.6)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(11, 13);
        ctx.lineTo(23, 13);
        ctx.moveTo(11, 18);
        ctx.lineTo(23, 18);
        ctx.stroke();
      });
    }
    if (!textures.exists(SPARK_KEYS.he)) {
      ensureCanvasTexture(textures, SPARK_KEYS.he, 12, 12, (ctx) => {
        const grad = ctx.createRadialGradient(6, 6, 0, 6, 6, 6);
        grad.addColorStop(0, 'rgba(235,245,204,0.92)');
        grad.addColorStop(0.6, 'rgba(135,150,84,0.34)');
        grad.addColorStop(1, 'rgba(60,70,46,0.0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 12, 12);
      });
    }
  }

  private generateSmokeTextures(textures: Phaser.Textures.TextureManager): void {
    if (!textures.exists(BODY_KEYS.smoke)) {
      ensureCanvasTexture(textures, BODY_KEYS.smoke, 36, 36, (ctx) => {
        const grad = ctx.createLinearGradient(0, 0, 0, 36);
        grad.addColorStop(0, 'rgba(154,164,173,1.0)');
        grad.addColorStop(0.52, 'rgba(98,111,120,0.98)');
        grad.addColorStop(1, 'rgba(43,52,61,1.0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(9, 7, 18, 20, 4);
        ctx.fill();
      });
    }
    if (!textures.exists(DETAIL_KEYS.smoke)) {
      ensureCanvasTexture(textures, DETAIL_KEYS.smoke, 36, 36, (ctx) => {
        ctx.fillStyle = 'rgba(228,233,236,0.95)';
        ctx.fillRect(13, 3, 10, 5);
        ctx.fillStyle = 'rgba(49,58,66,0.95)';
        ctx.fillRect(12, 14, 12, 4);
        ctx.fillRect(14, 20, 8, 2);
      });
    }
    if (!textures.exists(SPARK_KEYS.smoke)) {
      ensureCanvasTexture(textures, SPARK_KEYS.smoke, 16, 16, (ctx) => {
        const grad = ctx.createRadialGradient(8, 8, 0, 8, 8, 8);
        grad.addColorStop(0, 'rgba(214,220,225,0.72)');
        grad.addColorStop(0.55, 'rgba(119,130,138,0.28)');
        grad.addColorStop(1, 'rgba(70,78,88,0.0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 16, 16);
      });
    }
  }

  private generateMolotovTextures(textures: Phaser.Textures.TextureManager): void {
    if (!textures.exists(BODY_KEYS.molotov)) {
      ensureCanvasTexture(textures, BODY_KEYS.molotov, 34, 42, (ctx) => {
        const grad = ctx.createLinearGradient(0, 0, 0, 42);
        grad.addColorStop(0, 'rgba(255,243,214,0.92)');
        grad.addColorStop(0.38, 'rgba(162,102,42,0.42)');
        grad.addColorStop(0.72, 'rgba(84,33,13,0.88)');
        grad.addColorStop(1, 'rgba(40,20,10,0.98)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.roundRect(11, 10, 12, 24, 5);
        ctx.fill();
        ctx.fillStyle = 'rgba(152,118,78,0.96)';
        ctx.fillRect(14, 4, 6, 8);
      });
    }
    if (!textures.exists(DETAIL_KEYS.molotov)) {
      ensureCanvasTexture(textures, DETAIL_KEYS.molotov, 34, 42, (ctx) => {
        ctx.fillStyle = 'rgba(246,225,186,0.94)';
        ctx.fillRect(12, 1, 10, 6);
        ctx.fillStyle = 'rgba(90,42,22,0.82)';
        ctx.fillRect(12, 16, 10, 8);
        ctx.strokeStyle = 'rgba(255,238,208,0.52)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(13, 12);
        ctx.lineTo(13, 31);
        ctx.stroke();
      });
    }
    if (!textures.exists(SPARK_KEYS.molotov)) {
      ensureCanvasTexture(textures, SPARK_KEYS.molotov, 14, 14, (ctx) => {
        const grad = ctx.createRadialGradient(7, 7, 0, 7, 7, 7);
        grad.addColorStop(0, 'rgba(255,255,222,1.0)');
        grad.addColorStop(0.4, 'rgba(255,171,79,0.72)');
        grad.addColorStop(1, 'rgba(255,84,24,0.0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 14, 14);
      });
    }
  }
}
