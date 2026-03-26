import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { GrenadeVisualPreset } from '../types';
import { configureAdditiveImage, createEmitter, destroyEmitter, ensureCanvasTexture } from './EffectUtils';

const TEX_GRENADE_GLOW       = '__grenade_glow';
const TEX_MOLOTOV_FIRE_PUFF  = '__grenade_fire_puff';

const BODY_KEYS: Record<GrenadeVisualPreset, string> = {
  he:      '__grenade_body_he',
  smoke:   '__grenade_body_smoke',
  molotov: '__grenade_body_molotov',
};

const DETAIL_KEYS: Record<GrenadeVisualPreset, string> = {
  he:      '__grenade_detail_he',
  smoke:   '__grenade_detail_smoke',
  molotov: '__grenade_detail_molotov',
};

const SPARK_KEYS: Record<GrenadeVisualPreset, string> = {
  he:      '__grenade_spark_he',
  smoke:   '__grenade_spark_smoke',
  molotov: '__grenade_spark_molotov',
};

interface GrenadePresetConfig {
  bodyScale: number;
  glowAlpha: number;
  glowScale: number;
  detailAlpha: number;
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
  lastFireX: number;
  lastFireY: number;
  lastFireAt: number;
}

const PRESETS: Record<GrenadeVisualPreset, GrenadePresetConfig> = {
  he: {
    bodyScale:       1.0,
    glowAlpha:       0.32,
    glowScale:       1.4,
    detailAlpha:     0.90,
    trailAlpha:      0.20,
    trailFrequency:  44,
    trailLifespan:   { min: 150, max: 280 },
    trailScaleStart: 0.24,
    trailScaleEnd:   0.02,
    trailSpeed:      10,
    trailTints:      [0xc4d888, 0x6a7a40, 0x30381a],
  },
  smoke: {
    bodyScale:       1.0,
    glowAlpha:       0.28,
    glowScale:       1.3,
    detailAlpha:     0.86,
    trailAlpha:      0.18,
    trailFrequency:  28,
    trailLifespan:   { min: 260, max: 480 },
    trailScaleStart: 0.46,
    trailScaleEnd:   0.10,
    trailSpeed:      7,
    trailTints:      [0xe0eaee, 0x90a8b2, 0x485460],
  },
  molotov: {
    bodyScale:       0.5,
    glowAlpha:       0.42,
    glowScale:       1.65,
    detailAlpha:     0.94,
    trailAlpha:      0.82,
    trailFrequency:  200,
    trailLifespan:   { min: 5, max: 10 },
    trailScaleStart: 0.28,
    trailScaleEnd:   0.01,
    trailSpeed:      16,
    trailTints:      [0xffffff, 0xffee50, 0xff8018],
  },
};

export class GrenadeRenderer {
  private visuals   = new Map<number, GrenadeVisual>();
  private firePuffs = new Set<Phaser.GameObjects.Image>();

  constructor(private readonly scene: Phaser.Scene) {}

  generateTextures(): void {
    const textures = this.scene.textures;

    // Neutral white soft-glow – tinted at runtime with player color.
    ensureCanvasTexture(textures, TEX_GRENADE_GLOW, 56, 56, (ctx) => {
      const g = ctx.createRadialGradient(28, 28, 0, 28, 28, 28);
      g.addColorStop(0,   'rgba(255,255,255,0.58)');
      g.addColorStop(0.4, 'rgba(255,255,255,0.18)');
      g.addColorStop(1,   'rgba(255,255,255,0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 56, 56);
    });

    // Fire-puff sprite for the Molotov trail.
    ensureCanvasTexture(textures, TEX_MOLOTOV_FIRE_PUFF, 30, 30, (ctx) => {
      const g = ctx.createRadialGradient(15, 15, 0, 15, 15, 15);
      g.addColorStop(0,    'rgba(255,255,240,0.84)');
      g.addColorStop(0.26, 'rgba(255,210,55,0.66)');
      g.addColorStop(0.56, 'rgba(255,100,18,0.34)');
      g.addColorStop(1,    'rgba(200,36,0,0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 30, 30);
    });

    this.generateHeTextures(textures);
    this.generateSmokeTextures(textures);
    this.generateMolotovTextures(textures);
  }

  createVisual(
    id: number,
    x: number,
    y: number,
    size: number,
    preset: GrenadeVisualPreset,
    playerColor?: number,
  ): void {
    if (this.visuals.has(id)) return;

    const cfg      = PRESETS[preset];
    const glowTint = playerColor ?? 0xffffff;

    const glow = configureAdditiveImage(
      this.scene.add.image(x, y, TEX_GRENADE_GLOW),
      DEPTH.PROJECTILES - 1,
      cfg.glowAlpha,
      glowTint,
    );
    const body   = this.scene.add.image(x, y, BODY_KEYS[preset]).setDepth(DEPTH.PROJECTILES).setAlpha(0.98);
    const detail = this.scene.add.image(x, y, DETAIL_KEYS[preset]).setDepth(DEPTH.PROJECTILES + 0.2).setAlpha(cfg.detailAlpha);

    const trail = createEmitter(this.scene, x, y, SPARK_KEYS[preset], {
      lifespan:  cfg.trailLifespan,
      frequency: cfg.trailFrequency,
      quantity:  1,
      speedX:    { min: -cfg.trailSpeed, max: cfg.trailSpeed },
      speedY:    { min: -cfg.trailSpeed, max: cfg.trailSpeed },
      scale:     { start: cfg.trailScaleStart, end: cfg.trailScaleEnd },
      alpha:     { start: cfg.trailAlpha, end: 0 },
      tint:      [...cfg.trailTints],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    }, DEPTH.PROJECTILES - 0.2);

    const now = this.scene.time.now;
    this.visuals.set(id, { glow, body, detail, trail, preset, lastFireX: x, lastFireY: y, lastFireAt: now });
    this.updateVisual(id, x, y, size, 1, 0);
  }

  updateVisual(id: number, x: number, y: number, size: number, vx: number, vy: number): void {
    const visual = this.visuals.get(id);
    if (!visual) return;

    const cfg       = PRESETS[visual.preset];
    const speed     = Math.max(Math.hypot(vx, vy), 1);
    const angle     = Math.atan2(vy, vx);
    const baseScale = Math.max(size / 16, 0.8) * cfg.bodyScale;
    const spin      = this.scene.time.now * 0.009 + id * 0.3;
    const nx        = vx / speed;
    const ny        = vy / speed;
    const tailX     = x - nx * size * 0.45;
    const tailY     = y - ny * size * 0.45;

    visual.glow.setPosition(x, y).setScale(baseScale * cfg.glowScale).setRotation(-spin * 0.18);

    const isMolotov = visual.preset === 'molotov';
    const bodyRot   = isMolotov ? angle + Math.PI / 2 : spin;
    visual.body.setPosition(x, y).setScale(baseScale).setRotation(bodyRot);
    visual.detail.setPosition(x, y).setScale(baseScale).setRotation(bodyRot);

    visual.trail.setPosition(tailX, tailY);

    if (isMolotov) {
      const now  = this.scene.time.now;
      const dist = Phaser.Math.Distance.Between(visual.lastFireX, visual.lastFireY, tailX, tailY);
      if (dist >= Math.max(size * 0.38, 4) || now - visual.lastFireAt >= 20) {
        this.spawnFirePuff(tailX, tailY, size);
        visual.lastFireX  = tailX;
        visual.lastFireY  = tailY;
        visual.lastFireAt = now;
      }
    }
  }

  private spawnFirePuff(x: number, y: number, size: number): void {
    const puff = this.scene.add.image(x, y, TEX_MOLOTOV_FIRE_PUFF)
      .setDepth(DEPTH.FIRE)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.90)
      .setScale(Math.max(size / 26, 0.22));

    this.firePuffs.add(puff);

    const driftX = Phaser.Math.Between(-4, 4);
    const driftY = Phaser.Math.Between(-11, -2);
    this.scene.tweens.add({
      targets:  puff,
      x:        x + driftX,
      y:        y + driftY,
      alpha:    0,
      scale:    puff.scaleX * 2.6,
      duration: 700,
      ease:     'Quad.easeOut',
      onComplete: () => {
        this.firePuffs.delete(puff);
        puff.destroy();
      },
    });
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
    for (const puff of this.firePuffs) {
      puff.destroy();
    }
    this.firePuffs.clear();
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Texture generation
  // ──────────────────────────────────────────────────────────────────────────

  private generateHeTextures(textures: Phaser.Textures.TextureManager): void {
    // Body: classic oval fragmentation grenade, olive-green with radial highlight.
    ensureCanvasTexture(textures, BODY_KEYS.he, 34, 34, (ctx) => {
      const g = ctx.createRadialGradient(12, 11, 1, 17, 18, 13);
      g.addColorStop(0,    'rgba(202,220,118,1.0)');
      g.addColorStop(0.36, 'rgba(98,118,50,0.98)');
      g.addColorStop(0.74, 'rgba(52,66,26,1.0)');
      g.addColorStop(1,    'rgba(26,36,12,1.0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(17, 19, 11, 12, 0, 0, Math.PI * 2);
      ctx.fill();
      // Neck / fuse cap
      ctx.fillStyle = 'rgba(136,156,72,1.0)';
      ctx.fillRect(14, 7, 6, 5);
      ctx.beginPath();
      ctx.arc(17, 7, 3, Math.PI, 0);
      ctx.fill();
    });

    // Detail: horizontal segmentation bands + safety lever (spoon).
    ensureCanvasTexture(textures, DETAIL_KEYS.he, 34, 34, (ctx) => {
      // Three segment grooves drawn as thin ellipses to follow the oval contour.
      ctx.strokeStyle = 'rgba(22,32,10,0.50)';
      ctx.lineWidth   = 1.1;
      for (let i = 0; i < 3; i++) {
        const cy = 14 + i * 5;
        ctx.beginPath();
        ctx.ellipse(17, cy, 10.5, 1.5, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      // Safety lever (spoon) – small flat protrusion on right
      ctx.fillStyle = 'rgba(192,212,116,0.86)';
      ctx.fillRect(27, 15, 5, 3);
      ctx.fillRect(28, 13, 3, 7);
      // Highlight on fuse cap
      ctx.fillStyle = 'rgba(226,240,172,0.58)';
      ctx.fillRect(15, 7, 3, 3);
    });

    ensureCanvasTexture(textures, SPARK_KEYS.he, 10, 10, (ctx) => {
      const g = ctx.createRadialGradient(5, 5, 0, 5, 5, 5);
      g.addColorStop(0,   'rgba(218,234,166,0.86)');
      g.addColorStop(0.6, 'rgba(96,122,50,0.28)');
      g.addColorStop(1,   'rgba(48,62,22,0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 10, 10);
    });
  }

  private generateSmokeTextures(textures: Phaser.Textures.TextureManager): void {
    // Body: metallic cylinder with side-light gradient.
    ensureCanvasTexture(textures, BODY_KEYS.smoke, 34, 40, (ctx) => {
      const g = ctx.createLinearGradient(6, 0, 28, 0);
      g.addColorStop(0,    'rgba(62,74,82,1.0)');
      g.addColorStop(0.20, 'rgba(148,164,172,1.0)');
      g.addColorStop(0.52, 'rgba(118,132,140,0.98)');
      g.addColorStop(0.82, 'rgba(76,88,96,1.0)');
      g.addColorStop(1,    'rgba(44,54,62,1.0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(8, 7, 18, 26, 3);
      ctx.fill();
      // Top cap (ellipse)
      ctx.fillStyle = 'rgba(116,132,140,1.0)';
      ctx.beginPath();
      ctx.ellipse(17, 7, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      // Bottom cap
      ctx.fillStyle = 'rgba(56,68,76,1.0)';
      ctx.beginPath();
      ctx.ellipse(17, 33, 9, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    });

    // Detail: distinctive yellow identification band + emission holes.
    ensureCanvasTexture(textures, DETAIL_KEYS.smoke, 34, 40, (ctx) => {
      // Yellow band (classic smoke grenade marker)
      ctx.fillStyle = 'rgba(238,216,92,0.92)';
      ctx.fillRect(8, 17, 18, 6);
      ctx.strokeStyle = 'rgba(28,26,8,0.34)';
      ctx.lineWidth = 0.8;
      ctx.strokeRect(8, 17, 18, 6);
      // Emission holes at top cap
      ctx.fillStyle = 'rgba(28,38,44,0.80)';
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.arc(11 + i * 4, 8, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      // Metal sheen stripe on left
      ctx.fillStyle = 'rgba(196,218,228,0.24)';
      ctx.fillRect(9, 8, 3, 24);
    });

    ensureCanvasTexture(textures, SPARK_KEYS.smoke, 14, 14, (ctx) => {
      const g = ctx.createRadialGradient(7, 7, 0, 7, 7, 7);
      g.addColorStop(0,    'rgba(216,228,234,0.68)');
      g.addColorStop(0.52, 'rgba(108,122,132,0.22)');
      g.addColorStop(1,    'rgba(58,70,78,0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 14, 14);
    });
  }

  private generateMolotovTextures(textures: Phaser.Textures.TextureManager): void {
    // Canvas orientation: y=0 is the FRONT (wick/flame) because rotation = angle + PI/2.
    // Body: amber/brown glass bottle – narrow neck at top, wider body below.
    ensureCanvasTexture(textures, BODY_KEYS.molotov, 28, 46, (ctx) => {
      // Bottle body (wider lower section)
      const bg = ctx.createLinearGradient(4, 0, 24, 0);
      bg.addColorStop(0,    'rgba(56,24,6,1.0)');
      bg.addColorStop(0.18, 'rgba(152,80,20,0.98)');
      bg.addColorStop(0.44, 'rgba(188,112,34,0.96)');
      bg.addColorStop(0.72, 'rgba(128,64,14,0.98)');
      bg.addColorStop(1,    'rgba(44,18,4,1.0)');
      ctx.fillStyle = bg;
      ctx.beginPath();
      ctx.roundRect(5, 22, 18, 20, 8);
      ctx.fill();
      // Shoulder taper (connecting neck to body)
      ctx.fillStyle = 'rgba(140,74,18,0.96)';
      ctx.beginPath();
      ctx.moveTo(5,  30);
      ctx.lineTo(9,  22);
      ctx.lineTo(19, 22);
      ctx.lineTo(23, 30);
      ctx.closePath();
      ctx.fill();
      // Neck
      const ng = ctx.createLinearGradient(8, 0, 20, 0);
      ng.addColorStop(0,    'rgba(64,28,6,1.0)');
      ng.addColorStop(0.28, 'rgba(160,92,26,0.96)');
      ng.addColorStop(0.68, 'rgba(136,76,16,0.96)');
      ng.addColorStop(1,    'rgba(50,20,4,1.0)');
      ctx.fillStyle = ng;
      ctx.beginPath();
      ctx.roundRect(10, 10, 8, 14, 2);
      ctx.fill();
      // Bottle mouth
      ctx.fillStyle = 'rgba(72,32,8,1.0)';
      ctx.fillRect(11, 5, 6, 7);
    });

    // Detail: glass highlights, liquid level line, burning wick with flame.
    ensureCanvasTexture(textures, DETAIL_KEYS.molotov, 28, 46, (ctx) => {
      // Glass highlight on left side of bottle body
      ctx.fillStyle = 'rgba(224,182,118,0.28)';
      ctx.fillRect(6, 25, 3, 14);
      ctx.fillStyle = 'rgba(244,206,148,0.16)';
      ctx.fillRect(6, 25, 5, 7);
      // Liquid level inside bottle
      ctx.strokeStyle = 'rgba(238,184,80,0.48)';
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(6,  32);
      ctx.lineTo(22, 32);
      ctx.stroke();
      // Wick cloth (at bottle mouth)
      ctx.fillStyle = 'rgba(172,114,38,0.92)';
      ctx.fillRect(11, 3, 6, 4);
      // Flame – bright inner core
      ctx.fillStyle = 'rgba(255,246,90,0.94)';
      ctx.beginPath();
      ctx.ellipse(14, 0, 3, 4, 0, 0, Math.PI * 2);
      ctx.fill();
      // Flame – orange mid
      ctx.fillStyle = 'rgba(255,172,18,0.78)';
      ctx.beginPath();
      ctx.ellipse(12, -1, 2.2, 3.2, -0.28, 0, Math.PI * 2);
      ctx.fill();
      // Flame – red outer tip
      ctx.fillStyle = 'rgba(255,72,8,0.54)';
      ctx.beginPath();
      ctx.ellipse(16, -1, 2, 3, 0.28, 0, Math.PI * 2);
      ctx.fill();
    });

    ensureCanvasTexture(textures, SPARK_KEYS.molotov, 12, 12, (ctx) => {
      const g = ctx.createRadialGradient(6, 6, 0, 6, 6, 6);
      g.addColorStop(0,    'rgba(255,255,204,1.0)');
      g.addColorStop(0.34, 'rgba(255,200,56,0.80)');
      g.addColorStop(0.68, 'rgba(255,96,10,0.38)');
      g.addColorStop(1,    'rgba(200,48,0,0.0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 12, 12);
    });
  }
}
