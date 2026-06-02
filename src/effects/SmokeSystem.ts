import * as Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import { addInternalBlur, setInternalFxPadding, type BlurHandle } from '../utils/phaserFx';
import { circleZone, createSeededRandom, edgeZone, ensureCanvasTexture, mixColors } from './EffectUtils';
import type { SmokeGrenadeEffect, SyncedSmokeCloud } from '../types';

const TAU = Math.PI * 2;

const TEX_CORE = '__smoke_core_volume';
const TEX_VOLUME = '__smoke_body_volume';
const TEX_WISP = '__smoke_wisp_volume';
const TEX_PARTICLE = '__smoke_micro_particle';

const CORE_TEXTURE_SIZE = 280;
const BODY_TEXTURE_SIZE = 224;
const WISP_TEXTURE_SIZE = 192;
const PARTICLE_TEXTURE_SIZE = 96;
const REF_RADIUS = 100;
const FILTER_PADDING = 56;

interface SmokeLayerTemplate {
  angle: number;
  dist: number;
  scaleX: number;
  scaleY: number;
  alpha: number;
  drift: number;
  tint: number;
  texture: string;
  blurX: number;
  blurY: number;
  blurStrength: number;
  rotationRate: number;
  pulseRate: number;
  densityBias: number;
}

const LAYER_TEMPLATES: readonly SmokeLayerTemplate[] = [
  {
    angle: 0,
    dist: 0,
    scaleX: 2.05,
    scaleY: 1.82,
    alpha: 0.82,
    drift: 5,
    tint: mixColors(COLORS.GREY_8, COLORS.GREY_9, 0.35),
    texture: TEX_CORE,
    blurX: 5.2,
    blurY: 5.2,
    blurStrength: 1.15,
    rotationRate: 0.022,
    pulseRate: 0.36,
    densityBias: 0.96,
  },
  {
    angle: 0.48,
    dist: 0.12,
    scaleX: 1.72,
    scaleY: 1.58,
    alpha: 0.6,
    drift: 11,
    tint: mixColors(COLORS.GREY_7, COLORS.GREY_6, 0.35),
    texture: TEX_VOLUME,
    blurX: 4.6,
    blurY: 4.6,
    blurStrength: 0.98,
    rotationRate: 0.032,
    pulseRate: 0.54,
    densityBias: 0.9,
  },
  {
    angle: 2.36,
    dist: 0.16,
    scaleX: 1.66,
    scaleY: 1.48,
    alpha: 0.56,
    drift: 12,
    tint: mixColors(COLORS.GREY_7, COLORS.GREY_5, 0.48),
    texture: TEX_VOLUME,
    blurX: 4.4,
    blurY: 4.8,
    blurStrength: 0.96,
    rotationRate: 0.03,
    pulseRate: 0.49,
    densityBias: 0.88,
  },
  {
    angle: -0.82,
    dist: 0.27,
    scaleX: 1.44,
    scaleY: 1.28,
    alpha: 0.42,
    drift: 15,
    tint: mixColors(COLORS.GREY_6, COLORS.GREY_4, 0.26),
    texture: TEX_VOLUME,
    blurX: 3.8,
    blurY: 4.2,
    blurStrength: 0.82,
    rotationRate: 0.042,
    pulseRate: 0.67,
    densityBias: 0.74,
  },
  {
    angle: 1.58,
    dist: 0.31,
    scaleX: 1.36,
    scaleY: 1.24,
    alpha: 0.38,
    drift: 16,
    tint: mixColors(COLORS.GREY_6, COLORS.GREY_4, 0.4),
    texture: TEX_WISP,
    blurX: 3.6,
    blurY: 4,
    blurStrength: 0.74,
    rotationRate: 0.048,
    pulseRate: 0.72,
    densityBias: 0.68,
  },
  {
    angle: -2.24,
    dist: 0.38,
    scaleX: 1.28,
    scaleY: 1.16,
    alpha: 0.34,
    drift: 18,
    tint: mixColors(COLORS.GREY_5, COLORS.GREY_3, 0.2),
    texture: TEX_WISP,
    blurX: 3.4,
    blurY: 3.9,
    blurStrength: 0.68,
    rotationRate: 0.054,
    pulseRate: 0.8,
    densityBias: 0.62,
  },
  {
    angle: 0.96,
    dist: 0.54,
    scaleX: 1.02,
    scaleY: 0.94,
    alpha: 0.24,
    drift: 22,
    tint: mixColors(COLORS.GREY_4, COLORS.GREY_3, 0.22),
    texture: TEX_WISP,
    blurX: 2.9,
    blurY: 3.3,
    blurStrength: 0.58,
    rotationRate: 0.066,
    pulseRate: 0.92,
    densityBias: 0.54,
  },
  {
    angle: -0.18,
    dist: 0.62,
    scaleX: 0.94,
    scaleY: 0.84,
    alpha: 0.2,
    drift: 24,
    tint: mixColors(COLORS.GREY_4, COLORS.GREY_2, 0.35),
    texture: TEX_WISP,
    blurX: 2.6,
    blurY: 3.1,
    blurStrength: 0.52,
    rotationRate: 0.072,
    pulseRate: 1.04,
    densityBias: 0.48,
  },
  {
    angle: -1.52,
    dist: 0.7,
    scaleX: 0.88,
    scaleY: 0.78,
    alpha: 0.16,
    drift: 26,
    tint: mixColors(COLORS.GREY_4, COLORS.GREY_2, 0.5),
    texture: TEX_WISP,
    blurX: 2.3,
    blurY: 2.9,
    blurStrength: 0.46,
    rotationRate: 0.078,
    pulseRate: 1.16,
    densityBias: 0.42,
  },
];

interface SmokeLayer {
  image: Phaser.GameObjects.Image;
  template: SmokeLayerTemplate;
  blur: BlurHandle | null;
  phase: number;
  phaseB: number;
}

interface ActiveSmokeCloud {
  id: number;
  x: number;
  y: number;
  createdAt: number;
  config: SmokeGrenadeEffect;
}

interface SmokeCloudVisual {
  container: Phaser.GameObjects.Container;
  layers: SmokeLayer[];
  edgeEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  bodyEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  detailEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  edgeZoneRadius: number;
  bodyZoneRadius: number;
  detailZoneRadius: number;
  birthTime: number;
  lastDensity: number;
  lastRScale: number;
}

export class SmokeSystem {
  private readonly activeClouds: ActiveSmokeCloud[] = [];
  private readonly visuals = new Map<number, SmokeCloudVisual>();
  private nextId = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.ensureSmokeTextures();
  }

  hostCreateCloud(x: number, y: number, config: SmokeGrenadeEffect): void {
    this.activeClouds.push({ id: this.nextId++, x, y, createdAt: Date.now(), config });
  }

  hostUpdate(now: number): SyncedSmokeCloud[] {
    const synced: SyncedSmokeCloud[] = [];

    for (let i = this.activeClouds.length - 1; i >= 0; i--) {
      const cloud = this.activeClouds[i];
      const snapshot = this.buildSnapshot(cloud, now);
      if (!snapshot) {
        this.activeClouds.splice(i, 1);
        continue;
      }
      synced.push(snapshot);
    }

    synced.sort((a, b) => a.id - b.id);
    this.syncVisuals(synced);
    return synced;
  }

  syncVisuals(clouds: SyncedSmokeCloud[]): void {
    const activeIds = new Set(clouds.map((cloud) => cloud.id));

    for (const [id, visual] of this.visuals) {
      if (activeIds.has(id)) continue;
      this.destroyVisual(visual);
      this.visuals.delete(id);
    }

    for (const cloud of clouds) {
      let visual = this.visuals.get(cloud.id);
      if (!visual) {
        visual = this.createVisual(cloud);
        this.visuals.set(cloud.id, visual);
      }
      this.updateVisual(visual, cloud);
    }
  }

  destroyAll(): void {
    this.activeClouds.length = 0;
    this.syncVisuals([]);
  }

  private buildSnapshot(cloud: ActiveSmokeCloud, now: number): SyncedSmokeCloud | null {
    const { spreadDuration, lingerDuration, dissipateDuration, radius, maxAlpha } = cloud.config;
    const elapsed = now - cloud.createdAt;
    const totalDuration = spreadDuration + lingerDuration + dissipateDuration;
    if (elapsed >= totalDuration) return null;

    if (elapsed < spreadDuration) {
      const t = Phaser.Math.Clamp(elapsed / spreadDuration, 0, 1);
      const eased = Phaser.Math.Easing.Cubic.Out(t);
      return {
        id: cloud.id,
        x: cloud.x,
        y: cloud.y,
        radius: Math.round(radius * eased),
        alpha: Math.round(maxAlpha * Phaser.Math.Linear(0.18, 1, eased) * 100) / 100,
        density: Math.round(Phaser.Math.Linear(0.35, 1, eased) * 100) / 100,
      };
    }

    if (elapsed < spreadDuration + lingerDuration) {
      return {
        id: cloud.id,
        x: cloud.x,
        y: cloud.y,
        radius,
        alpha: maxAlpha,
        density: 1,
      };
    }

    const dissipateElapsed = elapsed - spreadDuration - lingerDuration;
    const t = Phaser.Math.Clamp(dissipateElapsed / dissipateDuration, 0, 1);
    const eased = Phaser.Math.Easing.Quadratic.In(t);
    return {
      id: cloud.id,
      x: cloud.x,
      y: cloud.y,
      radius: Math.round(radius * Phaser.Math.Linear(1, 1.08, eased)),
      alpha: Math.round(maxAlpha * (1 - eased) * 100) / 100,
      density: Math.round(Phaser.Math.Linear(1, 0.2, eased) * 100) / 100,
    };
  }

  private createVisual(cloud: SyncedSmokeCloud): SmokeCloudVisual {
    const container = this.scene.add.container(cloud.x, cloud.y).setDepth(DEPTH.SMOKE);
    const rand = createSeededRandom((cloud.id + 1) * 0x9e3779b9);

    const layers: SmokeLayer[] = LAYER_TEMPLATES.map((template) => {
      const image = this.scene.add.image(0, 0, template.texture)
        .setOrigin(0.5)
        .setTint(template.tint)
        .setBlendMode(Phaser.BlendModes.NORMAL);

      setInternalFxPadding(image, FILTER_PADDING);
      const blur = addInternalBlur(image, 2, template.blurX, template.blurY, template.blurStrength, 0xffffff, 2);
      container.add(image);

      return {
        image,
        template,
        blur,
        phase: rand() * TAU,
        phaseB: rand() * TAU,
      };
    });

    const edgeEmitter = this.scene.add.particles(cloud.x, cloud.y, TEX_PARTICLE, {
      lifespan: { min: 2600, max: 4200 },
      frequency: 32,
      quantity: 2,
      angle: { min: 0, max: 360 },
      speed: { min: 6, max: 22 },
      scale: { start: 0.2, end: 1.85, ease: 'quad.out' },
      alpha: { start: 0.2, end: 0, ease: 'quad.out' },
      color: [COLORS.GREY_3, COLORS.GREY_4, COLORS.GREY_6, COLORS.GREY_8],
      rotate: { min: -42, max: 42 },
      emitting: true,
      blendMode: Phaser.BlendModes.NORMAL,
    });
    edgeEmitter.setDepth(DEPTH.SMOKE);
    edgeEmitter.addEmitZone(edgeZone(Math.max(cloud.radius * 0.82, 14), 72));

    const bodyEmitter = this.scene.add.particles(cloud.x, cloud.y, TEX_PARTICLE, {
      lifespan: { min: 1800, max: 3000 },
      frequency: 18,
      quantity: 3,
      angle: { min: 0, max: 360 },
      speed: { min: 4, max: 14 },
      scale: { start: 0.16, end: 1.18, ease: 'cubic.out' },
      alpha: { start: 0.24, end: 0, ease: 'quad.out' },
      color: [COLORS.GREY_2, COLORS.GREY_4, COLORS.GREY_6, COLORS.GREY_8],
      rotate: { min: -28, max: 28 },
      emitting: true,
      blendMode: Phaser.BlendModes.NORMAL,
    });
    bodyEmitter.setDepth(DEPTH.SMOKE);
    bodyEmitter.addEmitZone(circleZone(Math.max(cloud.radius * 0.48, 10)));

    const detailEmitter = this.scene.add.particles(cloud.x, cloud.y, TEX_PARTICLE, {
      lifespan: { min: 1200, max: 2100 },
      frequency: 12,
      quantity: 2,
      angle: { min: 0, max: 360 },
      speed: { min: 2, max: 9 },
      scale: { start: 0.08, end: 0.48, ease: 'cubic.out' },
      alpha: { start: 0.18, end: 0, ease: 'quad.out' },
      color: [COLORS.GREY_1, COLORS.GREY_3, COLORS.GREY_5, COLORS.GREY_7],
      rotate: { min: -18, max: 18 },
      emitting: true,
      blendMode: Phaser.BlendModes.NORMAL,
    });
    detailEmitter.setDepth(DEPTH.SMOKE);
    detailEmitter.addEmitZone(circleZone(Math.max(cloud.radius * 0.22, 6)));

    return {
      container,
      layers,
      edgeEmitter,
      bodyEmitter,
      detailEmitter,
      edgeZoneRadius: Math.max(cloud.radius * 0.82, 14),
      bodyZoneRadius: Math.max(cloud.radius * 0.48, 10),
      detailZoneRadius: Math.max(cloud.radius * 0.22, 6),
      birthTime: this.scene.time.now,
      lastDensity: -1,
      lastRScale: -1,
    };
  }

  private updateVisual(visual: SmokeCloudVisual, cloud: SyncedSmokeCloud): void {
    const radius = Math.max(cloud.radius, 8);
    const alpha = Phaser.Math.Clamp(cloud.alpha, 0, 1);
    const density = Phaser.Math.Clamp(cloud.density, 0.15, 1);
    const t = (this.scene.time.now - visual.birthTime) * 0.001;
    const rScale = radius / REF_RADIUS;

    visual.container.setPosition(cloud.x, cloud.y).setVisible(alpha > 0.01);

    for (const layer of visual.layers) {
      const { template, phase, phaseB, blur } = layer;
      const orbit = template.angle + Math.sin(t * 0.2 + phaseB) * 0.14;
      const dx = (
        Math.sin(t * (0.55 + template.pulseRate * 0.25) + phase) +
        Math.sin(t * 1.18 + phaseB) * 0.45
      ) * template.drift * rScale;
      const dy = (
        Math.cos(t * (0.62 + template.pulseRate * 0.2) + phaseB) +
        Math.cos(t * 1.06 + phase * 0.7) * 0.38
      ) * template.drift * rScale;
      const pulseX = 1 + Math.sin(t * template.pulseRate + phase) * 0.07;
      const pulseY = 1 + Math.cos(t * (template.pulseRate * 0.88) + phaseB) * 0.06;
      const densityAlpha = Phaser.Math.Clamp(
        template.densityBias * density + (1 - template.densityBias) * 0.56,
        0.18,
        1,
      );

      layer.image.setPosition(
        Math.cos(orbit) * template.dist * radius + dx,
        Math.sin(orbit) * template.dist * radius + dy,
      );
      layer.image.setScale(template.scaleX * rScale * pulseX, template.scaleY * rScale * pulseY);
      layer.image.setAlpha(template.alpha * alpha * densityAlpha);
      layer.image.setRotation(t * template.rotationRate + phase * 0.45 + Math.sin(t * 0.33 + phaseB) * 0.08);

      if (blur) {
        const blurScale = Phaser.Math.Linear(0.78, 1.14, density) * Phaser.Math.Linear(0.9, 1.22, rScale);
        blur.x = template.blurX * blurScale;
        blur.y = template.blurY * blurScale;
        blur.strength = template.blurStrength * Phaser.Math.Linear(0.86, 1.18, density);
      }
    }

    visual.edgeEmitter.setPosition(cloud.x, cloud.y);
    visual.edgeEmitter.setAlpha(Phaser.Math.Linear(0.08, 0.28, alpha * density));

    visual.bodyEmitter.setPosition(cloud.x, cloud.y);
    visual.bodyEmitter.setAlpha(Phaser.Math.Linear(0.06, 0.22, alpha * density));

    visual.detailEmitter.setPosition(cloud.x, cloud.y);
    visual.detailEmitter.setAlpha(Phaser.Math.Linear(0.03, 0.16, alpha * density));

    if (density !== visual.lastDensity || rScale !== visual.lastRScale) {
      visual.lastDensity = density;
      visual.lastRScale = rScale;

      visual.edgeEmitter.setFrequency(
        Math.floor(Phaser.Math.Linear(74, 18, density)),
        Math.ceil(Phaser.Math.Linear(1, 3, density)),
      );
      visual.edgeEmitter.setParticleScale(
        Phaser.Math.Linear(0.08, 0.18, density) * rScale,
        Phaser.Math.Linear(1, 2.1, density) * rScale,
      );

      visual.bodyEmitter.setFrequency(
        Math.floor(Phaser.Math.Linear(54, 14, density)),
        Math.ceil(Phaser.Math.Linear(2, 4, density)),
      );
      visual.bodyEmitter.setParticleScale(
        Phaser.Math.Linear(0.06, 0.14, density) * rScale,
        Phaser.Math.Linear(0.7, 1.32, density) * rScale,
      );

      visual.detailEmitter.setFrequency(
        Math.floor(Phaser.Math.Linear(34, 9, density)),
        Math.ceil(Phaser.Math.Linear(1, 2, density)),
      );
      visual.detailEmitter.setParticleScale(
        Phaser.Math.Linear(0.04, 0.08, density) * rScale,
        Phaser.Math.Linear(0.22, 0.54, density) * rScale,
      );
    }

    const targetEdgeRadius = Math.max(radius * 0.82, 14);
    if (Math.abs(targetEdgeRadius - visual.edgeZoneRadius) >= 8) {
      visual.edgeEmitter.clearEmitZones();
      visual.edgeEmitter.addEmitZone(edgeZone(targetEdgeRadius, 72));
      visual.edgeZoneRadius = targetEdgeRadius;
    }

    const targetBodyRadius = Math.max(radius * 0.48, 10);
    if (Math.abs(targetBodyRadius - visual.bodyZoneRadius) >= 6) {
      visual.bodyEmitter.clearEmitZones();
      visual.bodyEmitter.addEmitZone(circleZone(targetBodyRadius));
      visual.bodyZoneRadius = targetBodyRadius;
    }

    const targetDetailRadius = Math.max(radius * 0.22, 6);
    if (Math.abs(targetDetailRadius - visual.detailZoneRadius) >= 4) {
      visual.detailEmitter.clearEmitZones();
      visual.detailEmitter.addEmitZone(circleZone(targetDetailRadius));
      visual.detailZoneRadius = targetDetailRadius;
    }
  }

  private destroyVisual(visual: SmokeCloudVisual): void {
    visual.edgeEmitter.stop();
    visual.edgeEmitter.destroy();
    visual.bodyEmitter.stop();
    visual.bodyEmitter.destroy();
    visual.detailEmitter.stop();
    visual.detailEmitter.destroy();
    visual.container.destroy(true);
  }

  private ensureSmokeTextures(): void {
    this.generateCoreTexture();
    this.generateBodyTexture();
    this.generateWispTexture();
    this.generateParticleTexture();
  }

  private generateCoreTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_CORE, CORE_TEXTURE_SIZE, CORE_TEXTURE_SIZE, (ctx) => {
      this.drawSmokeTexture(ctx, CORE_TEXTURE_SIZE, 0x52fa3c17, {
        lobeCount: 34,
        spread: CORE_TEXTURE_SIZE * 0.19,
        minRadius: CORE_TEXTURE_SIZE * 0.14,
        maxRadius: CORE_TEXTURE_SIZE * 0.3,
        centerBoost: 0.54,
        maskInner: 0.06,
        maskOuter: 0.46,
        streakCount: 6,
      });
    });
  }

  private generateBodyTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_VOLUME, BODY_TEXTURE_SIZE, BODY_TEXTURE_SIZE, (ctx) => {
      this.drawSmokeTexture(ctx, BODY_TEXTURE_SIZE, 0x9f1d4b73, {
        lobeCount: 26,
        spread: BODY_TEXTURE_SIZE * 0.24,
        minRadius: BODY_TEXTURE_SIZE * 0.12,
        maxRadius: BODY_TEXTURE_SIZE * 0.24,
        centerBoost: 0.34,
        maskInner: 0.08,
        maskOuter: 0.48,
        streakCount: 4,
      });
    });
  }

  private generateWispTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_WISP, WISP_TEXTURE_SIZE, WISP_TEXTURE_SIZE, (ctx) => {
      this.drawSmokeTexture(ctx, WISP_TEXTURE_SIZE, 0xd4c89a51, {
        lobeCount: 18,
        spread: WISP_TEXTURE_SIZE * 0.28,
        minRadius: WISP_TEXTURE_SIZE * 0.1,
        maxRadius: WISP_TEXTURE_SIZE * 0.2,
        centerBoost: 0.18,
        maskInner: 0.1,
        maskOuter: 0.49,
        streakCount: 5,
      });
    });
  }

  private generateParticleTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_PARTICLE, PARTICLE_TEXTURE_SIZE, PARTICLE_TEXTURE_SIZE, (ctx) => {
      this.drawSmokeTexture(ctx, PARTICLE_TEXTURE_SIZE, 0x74a31c5d, {
        lobeCount: 10,
        spread: PARTICLE_TEXTURE_SIZE * 0.14,
        minRadius: PARTICLE_TEXTURE_SIZE * 0.12,
        maxRadius: PARTICLE_TEXTURE_SIZE * 0.22,
        centerBoost: 0.28,
        maskInner: 0.04,
        maskOuter: 0.46,
        streakCount: 0,
      });
    });
  }

  private drawSmokeTexture(
    ctx: CanvasRenderingContext2D,
    size: number,
    seed: number,
    config: {
      lobeCount: number;
      spread: number;
      minRadius: number;
      maxRadius: number;
      centerBoost: number;
      maskInner: number;
      maskOuter: number;
      streakCount: number;
    },
  ): void {
    const rand = createSeededRandom(seed);
    const center = size / 2;

    ctx.clearRect(0, 0, size, size);

    for (let i = 0; i < config.lobeCount; i++) {
      const angle = rand() * TAU;
      const dist = Math.pow(rand(), 1.4) * config.spread;
      const radius = Phaser.Math.Linear(config.minRadius, config.maxRadius, rand());
      const x = center + Math.cos(angle) * dist;
      const y = center + Math.sin(angle) * dist;
      const blobAlpha = Phaser.Math.Linear(0.08, 0.18, rand());
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);

      gradient.addColorStop(0, `rgba(255,255,255,${blobAlpha})`);
      gradient.addColorStop(0.42, `rgba(255,255,255,${blobAlpha * 0.88})`);
      gradient.addColorStop(0.78, `rgba(255,255,255,${blobAlpha * 0.24})`);
      gradient.addColorStop(1, 'rgba(255,255,255,0)');

      ctx.fillStyle = gradient;
      ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    }

    const coreGradient = ctx.createRadialGradient(center, center, size * 0.02, center, center, size * 0.28);
    coreGradient.addColorStop(0, `rgba(255,255,255,${config.centerBoost})`);
    coreGradient.addColorStop(0.58, `rgba(255,255,255,${config.centerBoost * 0.6})`);
    coreGradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = coreGradient;
    ctx.fillRect(center - size * 0.28, center - size * 0.28, size * 0.56, size * 0.56);

    if (config.streakCount > 0) {
      ctx.lineCap = 'round';
      for (let i = 0; i < config.streakCount; i++) {
        const angle = rand() * TAU;
        const radius = size * Phaser.Math.Linear(0.14, 0.24, rand());
        const startX = center + Math.cos(angle) * radius;
        const startY = center + Math.sin(angle) * radius;
        const ctrlX = center + Math.cos(angle + Phaser.Math.Linear(-0.7, 0.7, rand())) * size * 0.08;
        const ctrlY = center + Math.sin(angle + Phaser.Math.Linear(-0.7, 0.7, rand())) * size * 0.08;
        const endX = center + Math.cos(angle + Phaser.Math.Linear(-0.42, 0.42, rand())) * radius * 0.45;
        const endY = center + Math.sin(angle + Phaser.Math.Linear(-0.42, 0.42, rand())) * radius * 0.45;

        ctx.strokeStyle = `rgba(255,255,255,${Phaser.Math.Linear(0.025, 0.055, rand())})`;
        ctx.lineWidth = Phaser.Math.Linear(size * 0.028, size * 0.05, rand());
        ctx.beginPath();
        ctx.moveTo(startX, startY);
        ctx.quadraticCurveTo(ctrlX, ctrlY, endX, endY);
        ctx.stroke();
      }
    }

    ctx.globalCompositeOperation = 'destination-in';
    const mask = ctx.createRadialGradient(
      center,
      center,
      size * config.maskInner,
      center,
      center,
      size * config.maskOuter,
    );
    mask.addColorStop(0, 'rgba(255,255,255,1)');
    mask.addColorStop(0.68, 'rgba(255,255,255,0.94)');
    mask.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = mask;
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
  }
}