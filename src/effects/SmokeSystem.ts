import * as Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import { addInternalBlur, setInternalFxPadding, type BlurHandle } from '../utils/phaserFx';
import { circleZone, createSeededRandom, edgeZone, ensureCanvasTexture, mixColors } from './EffectUtils';
import type { SmokeGrenadeEffect, SyncedSmokeCloud } from '../types';

const TAU = Math.PI * 2;

const TEX_BODY_A = '__smoke_body_a';
const TEX_BODY_B = '__smoke_body_b';
const TEX_WISP = '__smoke_wisp';
const TEX_PARTICLE = '__smoke_micro_particle';

const BODY_TEXTURE_SIZE = 512;
const WISP_TEXTURE_SIZE = 256;
const PARTICLE_TEXTURE_SIZE = 128;

/** Layer scale is expressed relative to this radius, so visuals scale linearly. */
const REF_RADIUS = 100;
const FILTER_PADDING = 64;

const TEX_SIZE: Readonly<Record<string, number>> = {
  [TEX_BODY_A]: BODY_TEXTURE_SIZE,
  [TEX_BODY_B]: BODY_TEXTURE_SIZE,
  [TEX_WISP]: WISP_TEXTURE_SIZE,
};

interface SmokeLayerTemplate {
  /** Whether this layer is part of the opaque, sight-blocking body of the cloud. */
  occluder: boolean;
  /** Visible radius of the layer as a fraction of the cloud radius. */
  radiusFraction: number;
  /** Offset of the layer center from the cloud center (fraction of radius). */
  dist: number;
  angle: number;
  alpha: number;
  drift: number;
  tint: number;
  texture: string;
  blur: number;
  rotationRate: number;
  pulseRate: number;
}

/**
 * The cloud is built from two groups of layers:
 *   - occluder layers fill (almost) the whole radius and are near-opaque, so the
 *     sight-blocking silhouette matches the gameplay radius with only a soft rim.
 *   - wisp layers are smaller, lighter and livelier, riding on top of the body to
 *     give a modern, volumetric top-down read without thinning the occlusion.
 */
const LAYER_TEMPLATES: readonly SmokeLayerTemplate[] = [
  // ── Occluders (full-radius, near-opaque) ────────────────────────────────
  {
    occluder: true,
    radiusFraction: 1.0,
    dist: 0,
    angle: 0,
    alpha: 0.98,
    drift: 3,
    tint: mixColors(COLORS.GREY_8, COLORS.GREY_7, 0.55),
    texture: TEX_BODY_A,
    blur: 4.4,
    rotationRate: 0.016,
    pulseRate: 0.3,
  },
  {
    occluder: true,
    radiusFraction: 0.99,
    dist: 0.05,
    angle: 1.7,
    alpha: 0.82,
    drift: 4,
    tint: mixColors(COLORS.GREY_6, COLORS.GREY_7, 0.45),
    texture: TEX_BODY_B,
    blur: 3.8,
    rotationRate: -0.024,
    pulseRate: 0.44,
  },
  {
    occluder: true,
    radiusFraction: 0.97,
    dist: 0.07,
    angle: 3.6,
    alpha: 0.66,
    drift: 5,
    tint: mixColors(COLORS.GREY_7, COLORS.GREY_6, 0.4),
    texture: TEX_BODY_A,
    blur: 3.4,
    rotationRate: 0.03,
    pulseRate: 0.52,
  },
  // ── Wisps (inner surface detail, lighter, livelier) ─────────────────────
  {
    occluder: false,
    radiusFraction: 0.74,
    dist: 0.1,
    angle: 0.6,
    alpha: 0.42,
    drift: 9,
    tint: mixColors(COLORS.GREY_5, COLORS.GREY_6, 0.4),
    texture: TEX_WISP,
    blur: 0,
    rotationRate: 0.05,
    pulseRate: 0.72,
  },
  {
    occluder: false,
    radiusFraction: 0.62,
    dist: 0.18,
    angle: 2.5,
    alpha: 0.34,
    drift: 11,
    tint: mixColors(COLORS.GREY_4, COLORS.GREY_5, 0.4),
    texture: TEX_WISP,
    blur: 0,
    rotationRate: -0.062,
    pulseRate: 0.86,
  },
  {
    occluder: false,
    radiusFraction: 0.52,
    dist: 0.24,
    angle: -1.4,
    alpha: 0.28,
    drift: 12,
    tint: mixColors(COLORS.GREY_5, COLORS.GREY_4, 0.3),
    texture: TEX_WISP,
    blur: 0,
    rotationRate: 0.074,
    pulseRate: 1.02,
  },
];

interface SmokeLayer {
  image: Phaser.GameObjects.Image;
  template: SmokeLayerTemplate;
  texHalf: number;
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
  ownerId: string;
  lastTickAt: number;
}

/* ── Damage event (returned to host for CombatSystem processing) ── */
export interface SmokeDamageEvent {
  x:       number;
  y:       number;
  radius:  number;
  damage:  number;
  ownerId: string;
}

interface SmokeCloudVisual {
  container: Phaser.GameObjects.Container;
  layers: SmokeLayer[];
  rimEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  bodyEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  rimZoneRadius: number;
  bodyZoneRadius: number;
  birthTime: number;
  lastDensity: number;
  lastRScale: number;
  /** Gewitter-Blitze (nur wenn storm aktiv); sonst null. */
  storm: StormVisual | null;
}

/* ── Lightning overlay (storm variant) ── */
interface StormVisual {
  /** Über dem Rauch liegender Blitz-/Flash-Layer (depth > Rauch); zeichnet in Weltkoordinaten. */
  gfx: Phaser.GameObjects.Graphics;
  /** Sanftes Aufleuchten des gesamten Rauchs beim Einschlag. */
  glow: Phaser.GameObjects.Image;
  timer: Phaser.Time.TimerEvent;
  x: number;
  y: number;
  radius: number;
  /** Lifecycle-Alpha des Rauchs (dimmt Blitze beim Auflösen). */
  lifeAlpha: number;
}

export class SmokeSystem {
  private readonly activeClouds: ActiveSmokeCloud[] = [];
  private readonly visuals = new Map<number, SmokeCloudVisual>();
  private nextId = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.ensureSmokeTextures();
  }

  hostCreateCloud(x: number, y: number, config: SmokeGrenadeEffect, ownerId = ''): void {
    const now = Date.now();
    this.activeClouds.push({ id: this.nextId++, x, y, createdAt: now, config, ownerId, lastTickAt: now });
  }

  hostUpdate(now: number): { synced: SyncedSmokeCloud[]; damageEvents: SmokeDamageEvent[] } {
    const synced: SyncedSmokeCloud[] = [];
    const damageEvents: SmokeDamageEvent[] = [];

    for (let i = this.activeClouds.length - 1; i >= 0; i--) {
      const cloud = this.activeClouds[i];
      const snapshot = this.buildSnapshot(cloud, now);
      if (!snapshot) {
        this.activeClouds.splice(i, 1);
        continue;
      }
      synced.push(snapshot);

      // Schaden über Zeit ("Gewittersturm"): Radius/Dauer kommen vom Rauch,
      // nur die Schadenswerte stammen aus dem Upgrade.
      const dpt = cloud.config.dotDamagePerTick ?? 0;
      const tickMs = cloud.config.dotTickIntervalMs ?? 0;
      if (dpt > 0 && tickMs > 0) {
        while (now - cloud.lastTickAt >= tickMs) {
          cloud.lastTickAt += tickMs;
          damageEvents.push({
            x: cloud.x,
            y: cloud.y,
            radius: snapshot.radius,
            damage: dpt,
            ownerId: cloud.ownerId,
          });
        }
      }
    }

    synced.sort((a, b) => a.id - b.id);
    this.syncVisuals(synced);
    return { synced, damageEvents };
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

    const storm = (cloud.config.dotDamagePerTick ?? 0) > 0;
    const stormTickMs = storm ? (cloud.config.dotTickIntervalMs ?? 250) : undefined;

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
        storm,
        stormTickMs,
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
        storm,
        stormTickMs,
      };
    }

    const dissipateElapsed = elapsed - spreadDuration - lingerDuration;
    const t = Phaser.Math.Clamp(dissipateElapsed / dissipateDuration, 0, 1);
    const eased = Phaser.Math.Easing.Quadratic.In(t);
    return {
      id: cloud.id,
      x: cloud.x,
      y: cloud.y,
      radius: Math.round(radius * Phaser.Math.Linear(1, 1.05, eased)),
      alpha: Math.round(maxAlpha * (1 - eased) * 100) / 100,
      density: Math.round(Phaser.Math.Linear(1, 0.2, eased) * 100) / 100,
      storm,
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

      let blur: BlurHandle | null = null;
      if (template.blur > 0) {
        setInternalFxPadding(image, FILTER_PADDING);
        blur = addInternalBlur(image, 2, template.blur, template.blur, 1, 0xffffff, 2);
      }
      container.add(image);

      return {
        image,
        template,
        texHalf: (TEX_SIZE[template.texture] ?? BODY_TEXTURE_SIZE) / 2,
        blur,
        phase: rand() * TAU,
        phaseB: rand() * TAU,
      };
    });

    const rimZoneRadius = Math.max(cloud.radius * 0.7, 12);
    const rimEmitter = this.scene.add.particles(cloud.x, cloud.y, TEX_PARTICLE, {
      lifespan: { min: 1600, max: 2600 },
      frequency: 40,
      quantity: 2,
      angle: { min: 0, max: 360 },
      speed: { min: 4, max: 14 },
      scale: { start: 0.18, end: 0.62, ease: 'quad.out' },
      alpha: { start: 0.14, end: 0, ease: 'quad.out' },
      color: [COLORS.GREY_3, COLORS.GREY_4, COLORS.GREY_5],
      rotate: { min: -34, max: 34 },
      emitting: true,
      blendMode: Phaser.BlendModes.NORMAL,
    });
    rimEmitter.setDepth(DEPTH.SMOKE);
    rimEmitter.addEmitZone(edgeZone(rimZoneRadius, 64));

    const bodyZoneRadius = Math.max(cloud.radius * 0.5, 10);
    const bodyEmitter = this.scene.add.particles(cloud.x, cloud.y, TEX_PARTICLE, {
      lifespan: { min: 1400, max: 2400 },
      frequency: 24,
      quantity: 2,
      angle: { min: 0, max: 360 },
      speed: { min: 2, max: 8 },
      scale: { start: 0.14, end: 0.5, ease: 'cubic.out' },
      alpha: { start: 0.12, end: 0, ease: 'quad.out' },
      color: [COLORS.GREY_4, COLORS.GREY_5, COLORS.GREY_6],
      rotate: { min: -22, max: 22 },
      emitting: true,
      blendMode: Phaser.BlendModes.NORMAL,
    });
    bodyEmitter.setDepth(DEPTH.SMOKE);
    bodyEmitter.addEmitZone(circleZone(bodyZoneRadius));

    return {
      container,
      layers,
      rimEmitter,
      bodyEmitter,
      rimZoneRadius,
      bodyZoneRadius,
      birthTime: this.scene.time.now,
      lastDensity: -1,
      lastRScale: -1,
      storm: cloud.storm ? this.createStormVisual(cloud) : null,
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
      const { template, phase, phaseB, blur, texHalf } = layer;
      const orbit = template.angle + Math.sin(t * 0.2 + phaseB) * 0.12;
      const dx = (
        Math.sin(t * (0.5 + template.pulseRate * 0.25) + phase) +
        Math.sin(t * 1.12 + phaseB) * 0.42
      ) * template.drift * rScale;
      const dy = (
        Math.cos(t * (0.58 + template.pulseRate * 0.2) + phaseB) +
        Math.cos(t * 1.02 + phase * 0.7) * 0.36
      ) * template.drift * rScale;
      const pulseX = 1 + Math.sin(t * template.pulseRate + phase) * 0.05;
      const pulseY = 1 + Math.cos(t * (template.pulseRate * 0.88) + phaseB) * 0.045;

      // Occluders track alpha tightly (so the cloud stays solid); wisps fade more
      // with density so the lit surface detail comes and goes.
      const layerAlpha = template.occluder
        ? template.alpha * alpha * Phaser.Math.Linear(0.82, 1, density)
        : template.alpha * alpha * density;

      // Map the texture so its rim sits exactly at radiusFraction * radius. The
      // texture's baked falloff then keeps the sight-blocking edge at the radius.
      const visibleRadius = radius * template.radiusFraction;
      const scale = visibleRadius / texHalf;

      layer.image.setPosition(
        Math.cos(orbit) * template.dist * radius + dx,
        Math.sin(orbit) * template.dist * radius + dy,
      );
      layer.image.setScale(scale * pulseX, scale * pulseY);
      layer.image.setAlpha(layerAlpha);
      layer.image.setRotation(t * template.rotationRate + phase * 0.4 + Math.sin(t * 0.3 + phaseB) * 0.06);

      if (blur) {
        const blurScale = Phaser.Math.Linear(0.85, 1.16, rScale) * Phaser.Math.Linear(0.9, 1.1, density);
        blur.x = template.blur * blurScale;
        blur.y = template.blur * blurScale;
      }
    }

    visual.rimEmitter.setPosition(cloud.x, cloud.y);
    visual.rimEmitter.setAlpha(Phaser.Math.Linear(0.05, 0.2, alpha * density));

    visual.bodyEmitter.setPosition(cloud.x, cloud.y);
    visual.bodyEmitter.setAlpha(Phaser.Math.Linear(0.04, 0.16, alpha * density));

    if (density !== visual.lastDensity || rScale !== visual.lastRScale) {
      visual.lastDensity = density;
      visual.lastRScale = rScale;

      visual.rimEmitter.setFrequency(
        Math.floor(Phaser.Math.Linear(80, 28, density)),
        Math.ceil(Phaser.Math.Linear(1, 2, density)),
      );
      visual.rimEmitter.setParticleScale(
        Phaser.Math.Linear(0.1, 0.2, density) * rScale,
        Phaser.Math.Linear(0.4, 0.7, density) * rScale,
      );

      visual.bodyEmitter.setFrequency(
        Math.floor(Phaser.Math.Linear(48, 18, density)),
        Math.ceil(Phaser.Math.Linear(1, 2, density)),
      );
      visual.bodyEmitter.setParticleScale(
        Phaser.Math.Linear(0.08, 0.16, density) * rScale,
        Phaser.Math.Linear(0.32, 0.56, density) * rScale,
      );
    }

    const targetRimRadius = Math.max(radius * 0.7, 12);
    if (Math.abs(targetRimRadius - visual.rimZoneRadius) >= 8) {
      visual.rimEmitter.clearEmitZones();
      visual.rimEmitter.addEmitZone(edgeZone(targetRimRadius, 64));
      visual.rimZoneRadius = targetRimRadius;
    }

    const targetBodyRadius = Math.max(radius * 0.5, 10);
    if (Math.abs(targetBodyRadius - visual.bodyZoneRadius) >= 6) {
      visual.bodyEmitter.clearEmitZones();
      visual.bodyEmitter.addEmitZone(circleZone(targetBodyRadius));
      visual.bodyZoneRadius = targetBodyRadius;
    }

    // Gewitter-Layer folgt Radius/Lifecycle des Rauchs. gfx zeichnet in
    // Weltkoordinaten (keine Verschiebung); Alpha steuern die Flash-Tweens.
    if (visual.storm) {
      visual.storm.radius = radius;
      visual.storm.lifeAlpha = alpha;
    }
  }

  /**
   * Baut den Gewitter-Blitz-Layer für elektrisierten Rauch. Liegt über dem Rauch
   * (höhere Depth), damit die Blitze trotz dichtem Rauch sichtbar sind. Ein Timer
   * löst in unregelmäßigen Abständen einzelne Blitze aus (wie in einem Sturm).
   */
  private createStormVisual(cloud: SyncedSmokeCloud): StormVisual {
    const gfx = this.scene.add.graphics()
      .setDepth(DEPTH.SMOKE + 0.2)
      .setBlendMode(Phaser.BlendModes.ADD);

    // Sanftes Aufleuchten des gesamten Rauchs beim Einschlag (verkauft das Wetterleuchten).
    const glow = this.scene.add.image(cloud.x, cloud.y, TEX_PARTICLE)
      .setDepth(DEPTH.SMOKE + 0.15)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(0xbfe6ff)
      .setAlpha(0);

    const storm: StormVisual = {
      gfx,
      glow,
      x: cloud.x,
      y: cloud.y,
      radius: Math.max(cloud.radius, 8),
      lifeAlpha: 1,
      // Blitz-Intervall = DoT-Schadensintervall (gleichmäßiger Abstand).
      timer: this.scene.time.addEvent({
        delay: cloud.stormTickMs ?? 250,
        loop: true,
        callback: () => this.flashLightning(storm),
      }),
    };
    return storm;
  }

  /** Zeichnet einen kurzen Blitz innerhalb des Rauchs und lässt ihn ausfaden. */
  private flashLightning(storm: StormVisual): void {
    const { gfx, glow, x, y, radius, lifeAlpha } = storm;
    if (lifeAlpha <= 0.02) return;
    gfx.clear();

    const bolts = Phaser.Math.Between(1, 2);
    for (let b = 0; b < bolts; b++) {
      // Kleiner, zentrumsnaher Blitz: Start im oberen mittleren Bereich, Ende nahe Zentrum.
      const startAngle = Phaser.Math.FloatBetween(-Math.PI * 0.75, -Math.PI * 0.25);
      const startR = radius * Phaser.Math.FloatBetween(0.32, 0.5);
      const sx = x + Math.cos(startAngle) * startR;
      const sy = y + Math.sin(startAngle) * startR;
      const endAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const endR = radius * Phaser.Math.FloatBetween(0.04, 0.22);
      const ex = x + Math.cos(endAngle) * endR;
      const ey = y + Math.sin(endAngle) * endR;

      const segments = 5;
      const points: Array<{ x: number; y: number }> = [{ x: sx, y: sy }];
      for (let s = 1; s < segments; s++) {
        const frac = s / segments;
        const jitter = radius * 0.07;
        points.push({
          x: Phaser.Math.Linear(sx, ex, frac) + Phaser.Math.FloatBetween(-jitter, jitter),
          y: Phaser.Math.Linear(sy, ey, frac) + Phaser.Math.FloatBetween(-jitter, jitter),
        });
      }
      points.push({ x: ex, y: ey });

      gfx.lineStyle(3.0, 0x8fd0ff, 0.5);
      gfx.beginPath();
      gfx.moveTo(points[0].x, points[0].y);
      for (let s = 1; s < points.length; s++) gfx.lineTo(points[s].x, points[s].y);
      gfx.strokePath();

      gfx.lineStyle(1.3, 0xffffff, 0.95);
      gfx.beginPath();
      gfx.moveTo(points[0].x, points[0].y);
      for (let s = 1; s < points.length; s++) gfx.lineTo(points[s].x, points[s].y);
      gfx.strokePath();
    }

    // Kurzer heller Flash + Blitz-Ausblendung (gedimmt mit Lifecycle-Alpha).
    this.scene.tweens.killTweensOf(gfx);
    gfx.setAlpha(lifeAlpha);
    this.scene.tweens.add({ targets: gfx, alpha: 0, duration: 180, ease: 'Quad.easeOut' });

    this.scene.tweens.killTweensOf(glow);
    glow.setAlpha(0.28 * lifeAlpha).setScale((radius * 1.1) / (PARTICLE_TEXTURE_SIZE / 2));
    this.scene.tweens.add({ targets: glow, alpha: 0, duration: 240, ease: 'Quad.easeOut' });
  }

  private destroyVisual(visual: SmokeCloudVisual): void {
    visual.rimEmitter.stop();
    visual.rimEmitter.destroy();
    visual.bodyEmitter.stop();
    visual.bodyEmitter.destroy();
    if (visual.storm) {
      visual.storm.timer.remove();
      this.scene.tweens.killTweensOf(visual.storm.gfx);
      this.scene.tweens.killTweensOf(visual.storm.glow);
      visual.storm.gfx.destroy();
      visual.storm.glow.destroy();
    }
    visual.container.destroy(true);
  }

  private ensureSmokeTextures(): void {
    this.generateBodyTexture(TEX_BODY_A, 0x52fa3c17, {
      lobeCount: 30,
      plateau: 0.7,
      baseAlpha: 0.96,
      lobeAlpha: [0.4, 0.72],
    });
    this.generateBodyTexture(TEX_BODY_B, 0x9f1d4b73, {
      lobeCount: 40,
      plateau: 0.62,
      baseAlpha: 0.58,
      lobeAlpha: [0.28, 0.55],
    });
    this.generateWispTexture();
    this.generateParticleTexture();
  }

  /**
   * A near-opaque body puff: organic billow lobes lifted to a flat, opaque
   * plateau, then carved by a radial mask that keeps the centre solid and only
   * feathers transparency into the outer rim.
   */
  private generateBodyTexture(
    key: string,
    seed: number,
    config: { lobeCount: number; plateau: number; baseAlpha: number; lobeAlpha: [number, number] },
  ): void {
    ensureCanvasTexture(this.scene.textures, key, BODY_TEXTURE_SIZE, BODY_TEXTURE_SIZE, (ctx) => {
      const size = BODY_TEXTURE_SIZE;
      const center = size / 2;
      const rand = createSeededRandom(seed);

      ctx.clearRect(0, 0, size, size);

      // 1) Organic billow lobes biased outward to fill the disc.
      for (let i = 0; i < config.lobeCount; i++) {
        const angle = rand() * TAU;
        const dist = Math.pow(rand(), 0.7) * center * 0.74;
        const r = Phaser.Math.Linear(size * 0.1, size * 0.2, rand());
        const x = center + Math.cos(angle) * dist;
        const y = center + Math.sin(angle) * dist;
        const a = Phaser.Math.Linear(config.lobeAlpha[0], config.lobeAlpha[1], rand());
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, `rgba(255,255,255,${a})`);
        gradient.addColorStop(0.5, `rgba(255,255,255,${a * 0.72})`);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }

      // 2) Lift the core to a near-opaque plateau (additive clamp toward white).
      ctx.globalCompositeOperation = 'lighter';
      const lift = ctx.createRadialGradient(center, center, 0, center, center, center * config.plateau);
      lift.addColorStop(0, `rgba(255,255,255,${config.baseAlpha})`);
      lift.addColorStop(0.72, `rgba(255,255,255,${config.baseAlpha * 0.92})`);
      lift.addColorStop(1, `rgba(255,255,255,${config.baseAlpha * 0.6})`);
      ctx.fillStyle = lift;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';

      // 3) Carve the silhouette: solid centre, transparency only at the rim.
      ctx.globalCompositeOperation = 'destination-in';
      const mask = ctx.createRadialGradient(
        center,
        center,
        center * config.plateau,
        center,
        center,
        center,
      );
      mask.addColorStop(0, 'rgba(255,255,255,1)');
      mask.addColorStop(0.45, 'rgba(255,255,255,0.92)');
      mask.addColorStop(0.78, 'rgba(255,255,255,0.5)');
      mask.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = mask;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';
    });
  }

  private generateWispTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_WISP, WISP_TEXTURE_SIZE, WISP_TEXTURE_SIZE, (ctx) => {
      const size = WISP_TEXTURE_SIZE;
      const center = size / 2;
      const rand = createSeededRandom(0xd4c89a51);

      ctx.clearRect(0, 0, size, size);

      for (let i = 0; i < 16; i++) {
        const angle = rand() * TAU;
        const dist = Math.pow(rand(), 1.2) * center * 0.5;
        const r = Phaser.Math.Linear(size * 0.1, size * 0.22, rand());
        const x = center + Math.cos(angle) * dist;
        const y = center + Math.sin(angle) * dist;
        const a = Phaser.Math.Linear(0.16, 0.34, rand());
        const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
        gradient.addColorStop(0, `rgba(255,255,255,${a})`);
        gradient.addColorStop(0.55, `rgba(255,255,255,${a * 0.6})`);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      }

      ctx.globalCompositeOperation = 'destination-in';
      const mask = ctx.createRadialGradient(center, center, size * 0.05, center, center, center * 0.95);
      mask.addColorStop(0, 'rgba(255,255,255,1)');
      mask.addColorStop(0.6, 'rgba(255,255,255,0.85)');
      mask.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = mask;
      ctx.fillRect(0, 0, size, size);
      ctx.globalCompositeOperation = 'source-over';
    });
  }

  private generateParticleTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_PARTICLE, PARTICLE_TEXTURE_SIZE, PARTICLE_TEXTURE_SIZE, (ctx) => {
      const size = PARTICLE_TEXTURE_SIZE;
      const center = size / 2;
      const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
      gradient.addColorStop(0, 'rgba(255,255,255,0.6)');
      gradient.addColorStop(0.5, 'rgba(255,255,255,0.32)');
      gradient.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, size, size);
    });
  }
}
