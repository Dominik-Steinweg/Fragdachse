import Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import type { SmokeGrenadeEffect, SyncedSmokeCloud } from '../types';

const SMOKE_PARTICLE_TEXTURE = 'smoke_particle';

interface ActiveSmokeCloud {
  id: number;
  x: number;
  y: number;
  createdAt: number;
  config: SmokeGrenadeEffect;
}

interface SmokeCloudVisual {
  container: Phaser.GameObjects.Container;
  outerLayer: Phaser.GameObjects.Ellipse;
  midLayer: Phaser.GameObjects.Ellipse;
  coreLayer: Phaser.GameObjects.Ellipse;
  fringeLayer: Phaser.GameObjects.Ellipse;
  emitter: Phaser.GameObjects.Particles.ParticleEmitter;
  zoneRadius: number;
}

export class SmokeSystem {
  private readonly activeClouds: ActiveSmokeCloud[] = [];
  private readonly visuals = new Map<number, SmokeCloudVisual>();
  private nextId = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.ensureParticleTexture();
  }

  hostCreateCloud(x: number, y: number, config: SmokeGrenadeEffect): void {
    this.activeClouds.push({
      id: this.nextId++,
      x,
      y,
      createdAt: Date.now(),
      config,
    });
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
    const activeIds = new Set(clouds.map(cloud => cloud.id));

    for (const [id, visual] of this.visuals) {
      if (activeIds.has(id)) continue;
      visual.emitter.stop();
      visual.emitter.destroy();
      visual.container.destroy(true);
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
        radius: radius * eased,
        alpha: maxAlpha * Phaser.Math.Linear(0.18, 1, eased),
        density: Phaser.Math.Linear(0.35, 1, eased),
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
      radius: radius * Phaser.Math.Linear(1, 1.08, eased),
      alpha: maxAlpha * (1 - eased),
      density: Phaser.Math.Linear(1, 0.2, eased),
    };
  }

  private createVisual(cloud: SyncedSmokeCloud): SmokeCloudVisual {
    const container = this.scene.add.container(cloud.x, cloud.y);
    container.setDepth(DEPTH.SMOKE);

    const outerLayer = this.scene.add.ellipse(0, 0, 32, 24, COLORS.GREY_6, 0.28);
    const midLayer = this.scene.add.ellipse(0, 0, 28, 22, COLORS.GREY_4, 0.35);
    const coreLayer = this.scene.add.ellipse(0, 0, 24, 20, COLORS.GREY_3, 0.4);
    const fringeLayer = this.scene.add.ellipse(0, 0, 20, 18, COLORS.GREY_5, 0.22);
    container.add([outerLayer, midLayer, coreLayer, fringeLayer]);

    const emitter = this.scene.add.particles(cloud.x, cloud.y, SMOKE_PARTICLE_TEXTURE, {
      lifespan: { min: 1400, max: 2400 },
      frequency: 65,
      quantity: 2,
      speedX: { min: -14, max: 14 },
      speedY: { min: -16, max: 10 },
      scale: { start: 0.22, end: 1.5 },
      alpha: { start: 0.24, end: 0 },
      tint: [COLORS.GREY_2, COLORS.GREY_3, COLORS.GREY_4, COLORS.GREY_5],
      emitting: true,
      blendMode: Phaser.BlendModes.NORMAL,
    });
    emitter.setDepth(DEPTH.SMOKE);
    emitter.addEmitZone(this.createRandomEmitZone(12));

    return {
      container,
      outerLayer,
      midLayer,
      coreLayer,
      fringeLayer,
      emitter,
      zoneRadius: 12,
    };
  }

  private updateVisual(visual: SmokeCloudVisual, cloud: SyncedSmokeCloud): void {
    const radius = Math.max(cloud.radius, 8);
    const alpha = Phaser.Math.Clamp(cloud.alpha, 0, 1);
    const density = Phaser.Math.Clamp(cloud.density, 0.15, 1);

    visual.container.setPosition(cloud.x, cloud.y);
    visual.container.setVisible(alpha > 0.01);
    visual.container.setAlpha(alpha);

    visual.outerLayer.setPosition(-radius * 0.08, -radius * 0.04);
    visual.outerLayer.setSize(radius * 2.15, radius * 1.8);
    visual.outerLayer.setFillStyle(COLORS.GREY_6, 0.34 * alpha);

    visual.midLayer.setPosition(radius * 0.1, -radius * 0.06);
    visual.midLayer.setSize(radius * 1.9, radius * 1.55);
    visual.midLayer.setFillStyle(COLORS.GREY_4, 0.4 * alpha);

    visual.coreLayer.setPosition(0, radius * 0.06);
    visual.coreLayer.setSize(radius * 1.7, radius * 1.45);
    visual.coreLayer.setFillStyle(COLORS.GREY_3, 0.48 * alpha);

    visual.fringeLayer.setPosition(-radius * 0.18, radius * 0.12);
    visual.fringeLayer.setSize(radius * 1.45, radius * 1.25);
    visual.fringeLayer.setFillStyle(COLORS.GREY_5, 0.3 * alpha);

    visual.emitter.setPosition(cloud.x, cloud.y);
    visual.emitter.setAlpha(Phaser.Math.Linear(0.2, 0.65, alpha));
    visual.emitter.setFrequency(Math.floor(Phaser.Math.Linear(115, 42, density)), Math.ceil(Phaser.Math.Linear(1, 3, density)));
    visual.emitter.setParticleScale(Phaser.Math.Linear(0.16, 0.26, density), Phaser.Math.Linear(1.05, 1.7, density));

    const targetZoneRadius = Math.max(radius * 0.78, 10);
    if (Math.abs(targetZoneRadius - visual.zoneRadius) >= 6) {
      visual.emitter.clearEmitZones();
      visual.emitter.addEmitZone(this.createRandomEmitZone(targetZoneRadius));
      visual.zoneRadius = targetZoneRadius;
    }
  }

  private createRandomEmitZone(radius: number): Phaser.Types.GameObjects.Particles.EmitZoneData {
    return {
      type: 'random',
      source: new Phaser.Geom.Circle(0, 0, radius),
    } as Phaser.Types.GameObjects.Particles.EmitZoneData;
  }

  private ensureParticleTexture(): void {
    if (this.scene.textures.exists(SMOKE_PARTICLE_TEXTURE)) return;

    const gfx = this.scene.make.graphics({ x: 0, y: 0 }, false);
    gfx.clear();
    gfx.fillStyle(0xffffff, 0.08);
    gfx.fillCircle(32, 32, 30);
    gfx.fillStyle(0xffffff, 0.18);
    gfx.fillCircle(32, 32, 22);
    gfx.fillStyle(0xffffff, 0.3);
    gfx.fillCircle(32, 32, 14);
    gfx.generateTexture(SMOKE_PARTICLE_TEXTURE, 64, 64);
    gfx.destroy();
  }
}