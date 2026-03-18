import Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import type { SmokeGrenadeEffect, SyncedSmokeCloud } from '../types';

/* ── Texture keys ─────────────────────────────────────── */
const TEX_BLOB = 'smoke_blob';
const TEX_PUFF = 'smoke_puff';

/* ── Texture generation params (pixel-art chunky feel) ── */
const BLOB_SIZE = 64;
const BLOB_PX   = 4;   // logical-pixel block size
const PUFF_SIZE = 32;
const PUFF_PX   = 3;

/* ── Blobs are designed relative to this radius ───────── */
const REF_RADIUS = 100;

/* ── Blob placement template (polar coords + visual) ──── */
interface BlobTemplate {
  angle: number;
  dist:  number;   // fraction of cloud radius (0 = center, 1 = edge)
  scale: number;   // sprite scale at REF_RADIUS
  alpha: number;   // base alpha
  drift: number;   // drift amplitude in px at REF_RADIUS
  tint:  number;
}

const TEMPLATES: readonly BlobTemplate[] = [
  /* ── CORE: dense, opaque centre ── */
  { angle: 0,               dist: 0,    scale: 1.70, alpha: 0.95, drift: 3,   tint: COLORS.GREY_6 },
  { angle: 0.8,             dist: 0.13, scale: 1.45, alpha: 0.90, drift: 4,   tint: COLORS.GREY_5 },
  { angle: Math.PI,         dist: 0.15, scale: 1.50, alpha: 0.88, drift: 3.5, tint: COLORS.GREY_6 },
  { angle: Math.PI * 0.52,  dist: 0.20, scale: 1.35, alpha: 0.85, drift: 4.5, tint: COLORS.GREY_5 },
  { angle: -Math.PI * 0.48, dist: 0.18, scale: 1.40, alpha: 0.87, drift: 4,   tint: COLORS.GREY_6 },
  /* ── MID: fill gaps, medium density ── */
  { angle: Math.PI * 0.28,  dist: 0.38, scale: 1.15, alpha: 0.62, drift: 6,   tint: COLORS.GREY_5 },
  { angle: Math.PI * 0.78,  dist: 0.35, scale: 1.10, alpha: 0.58, drift: 5.5, tint: COLORS.GREY_4 },
  { angle: -Math.PI * 0.32, dist: 0.40, scale: 1.20, alpha: 0.55, drift: 7,   tint: COLORS.GREY_5 },
  { angle: -Math.PI * 0.82, dist: 0.42, scale: 1.08, alpha: 0.52, drift: 6,   tint: COLORS.GREY_4 },
  /* ── EDGE: semi-transparent wispy boundary ── */
  { angle: Math.PI * 0.12,  dist: 0.65, scale: 0.88, alpha: 0.34, drift: 9,   tint: COLORS.GREY_4 },
  { angle: Math.PI * 0.58,  dist: 0.70, scale: 0.82, alpha: 0.30, drift: 10,  tint: COLORS.GREY_3 },
  { angle: -Math.PI * 0.22, dist: 0.67, scale: 0.85, alpha: 0.28, drift: 9.5, tint: COLORS.GREY_4 },
  { angle: -Math.PI * 0.72, dist: 0.72, scale: 0.80, alpha: 0.25, drift: 10,  tint: COLORS.GREY_3 },
];

/* ── Runtime per-blob data ── */
interface SmokeBlob {
  image:    Phaser.GameObjects.Image;
  template: BlobTemplate;
  phase:    number;
}

interface ActiveSmokeCloud {
  id: number;
  x: number;
  y: number;
  createdAt: number;
  config: SmokeGrenadeEffect;
}

interface SmokeCloudVisual {
  container:    Phaser.GameObjects.Container;
  blobs:        SmokeBlob[];
  edgeEmitter:  Phaser.GameObjects.Particles.ParticleEmitter;
  innerEmitter: Phaser.GameObjects.Particles.ParticleEmitter;
  zoneRadius:   number;
  birthTime:    number;
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
    const activeIds = new Set(clouds.map(c => c.id));

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

  /* ── Snapshot (host-authoritative lifecycle) ── */

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

  /* ── Visual creation ── */

  private createVisual(cloud: SyncedSmokeCloud): SmokeCloudVisual {
    const container = this.scene.add.container(cloud.x, cloud.y).setDepth(DEPTH.SMOKE);

    const blobs: SmokeBlob[] = TEMPLATES.map(tmpl => {
      const img = this.scene.add.image(0, 0, TEX_BLOB).setOrigin(0.5).setTint(tmpl.tint);
      container.add(img);
      return { image: img, template: tmpl, phase: Math.random() * Math.PI * 2 };
    });

    const edgeEmitter = this.scene.add.particles(cloud.x, cloud.y, TEX_PUFF, {
      lifespan: { min: 1800, max: 3200 },
      frequency: 50,
      quantity: 2,
      speedX: { min: -18, max: 18 },
      speedY: { min: -18, max: 18 },
      scale: { start: 0.3, end: 1.5 },
      alpha: { start: 0.28, end: 0 },
      tint: [COLORS.GREY_3, COLORS.GREY_4, COLORS.GREY_5],
      rotate: { min: 0, max: 360 },
      emitting: true,
      blendMode: Phaser.BlendModes.NORMAL,
    });
    edgeEmitter.setDepth(DEPTH.SMOKE);
    edgeEmitter.addEmitZone(this.circleZone(Math.max(cloud.radius * 0.75, 10)));

    const innerEmitter = this.scene.add.particles(cloud.x, cloud.y, TEX_PUFF, {
      lifespan: { min: 800, max: 1500 },
      frequency: 75,
      quantity: 1,
      speedX: { min: -9, max: 9 },
      speedY: { min: -9, max: 9 },
      scale: { start: 0.45, end: 0.85 },
      alpha: { start: 0.2, end: 0 },
      tint: [COLORS.GREY_5, COLORS.GREY_6],
      rotate: { min: 0, max: 360 },
      emitting: true,
      blendMode: Phaser.BlendModes.NORMAL,
    });
    innerEmitter.setDepth(DEPTH.SMOKE);
    innerEmitter.addEmitZone(this.circleZone(Math.max(cloud.radius * 0.35, 6)));

    return {
      container,
      blobs,
      edgeEmitter,
      innerEmitter,
      zoneRadius: cloud.radius,
      birthTime: this.scene.time.now,
    };
  }

  /* ── Per-frame visual update ── */

  private updateVisual(visual: SmokeCloudVisual, cloud: SyncedSmokeCloud): void {
    const radius  = Math.max(cloud.radius, 8);
    const alpha   = Phaser.Math.Clamp(cloud.alpha, 0, 1);
    const density = Phaser.Math.Clamp(cloud.density, 0.15, 1);
    const t       = (this.scene.time.now - visual.birthTime) * 0.001;
    const rScale  = radius / REF_RADIUS;

    visual.container.setPosition(cloud.x, cloud.y).setVisible(alpha > 0.01);

    /* ── animated blobs ── */
    for (const b of visual.blobs) {
      const { template: tp, phase: p } = b;

      const dx = (Math.sin(t * 0.7 + p) + Math.sin(t * 1.3 + p * 2.1) * 0.3) * tp.drift * rScale;
      const dy = (Math.cos(t * 0.9 + p * 1.4) + Math.cos(t * 1.1 + p * 0.6) * 0.3) * tp.drift * rScale;
      const pulse = 1 + Math.sin(t * 0.5 + p * 0.8) * 0.06;

      b.image.setPosition(
        Math.cos(tp.angle) * tp.dist * radius + dx,
        Math.sin(tp.angle) * tp.dist * radius + dy,
      );
      b.image.setScale(tp.scale * rScale * pulse);
      b.image.setAlpha(tp.alpha * alpha * Phaser.Math.Linear(0.7, 1, density));
      b.image.setRotation(t * 0.15 + p);
    }

    /* ── edge emitter ── */
    visual.edgeEmitter.setPosition(cloud.x, cloud.y);
    visual.edgeEmitter.setAlpha(Phaser.Math.Linear(0.08, 0.32, alpha));
    visual.edgeEmitter.setFrequency(
      Math.floor(Phaser.Math.Linear(100, 38, density)),
      Math.ceil(Phaser.Math.Linear(1, 3, density)),
    );
    visual.edgeEmitter.setParticleScale(
      Phaser.Math.Linear(0.2, 0.4, density) * rScale,
      Phaser.Math.Linear(0.9, 1.7, density) * rScale,
    );

    /* ── inner emitter ── */
    visual.innerEmitter.setPosition(cloud.x, cloud.y);
    visual.innerEmitter.setAlpha(Phaser.Math.Linear(0.04, 0.22, alpha * density));
    visual.innerEmitter.setFrequency(Math.floor(Phaser.Math.Linear(120, 55, density)), 1);
    visual.innerEmitter.setParticleScale(
      Phaser.Math.Linear(0.3, 0.5, density) * rScale,
      Phaser.Math.Linear(0.6, 1.0, density) * rScale,
    );

    /* ── emit-zone resize when radius changed significantly ── */
    const target = Math.max(radius * 0.78, 10);
    if (Math.abs(target - visual.zoneRadius) >= 6) {
      visual.edgeEmitter.clearEmitZones();
      visual.edgeEmitter.addEmitZone(this.circleZone(target));
      visual.innerEmitter.clearEmitZones();
      visual.innerEmitter.addEmitZone(this.circleZone(target * 0.45));
      visual.zoneRadius = target;
    }
  }

  private destroyVisual(visual: SmokeCloudVisual): void {
    visual.edgeEmitter.stop();
    visual.edgeEmitter.destroy();
    visual.innerEmitter.stop();
    visual.innerEmitter.destroy();
    visual.container.destroy(true);
  }

  /* ── Helpers ── */

  private circleZone(r: number): Phaser.Types.GameObjects.Particles.EmitZoneData {
    return {
      type: 'random',
      source: new Phaser.Geom.Circle(0, 0, r),
    } as Phaser.Types.GameObjects.Particles.EmitZoneData;
  }

  /* ── Pixel-art texture generation (createCanvas for reliable WebGL upload) ── */

  private ensureSmokeTextures(): void {
    this.generateBlobTexture();
    this.generatePuffTexture();
  }

  private generateBlobTexture(): void {
    if (this.scene.textures.exists(TEX_BLOB)) return;
    const ct = this.scene.textures.createCanvas(TEX_BLOB, BLOB_SIZE, BLOB_SIZE)!;
    const ctx = ct.context;
    const half = BLOB_SIZE / 2;
    const maxR = half - BLOB_PX;

    for (let py = 0; py < BLOB_SIZE; py += BLOB_PX) {
      for (let px = 0; px < BLOB_SIZE; px += BLOB_PX) {
        const d = Math.hypot(px + BLOB_PX / 2 - half, py + BLOB_PX / 2 - half) / maxR;
        if (d > 1.1) continue;
        const a = d < 0.30 ? 1.0
                : d < 0.50 ? 0.85
                : d < 0.65 ? 0.65
                : d < 0.78 ? 0.42
                : d < 0.90 ? 0.20
                :            0.07;
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fillRect(px, py, BLOB_PX, BLOB_PX);
      }
    }
    ct.refresh();
  }

  private generatePuffTexture(): void {
    if (this.scene.textures.exists(TEX_PUFF)) return;
    const ct = this.scene.textures.createCanvas(TEX_PUFF, PUFF_SIZE, PUFF_SIZE)!;
    const ctx = ct.context;
    const half = PUFF_SIZE / 2;
    const maxR = half - PUFF_PX;

    for (let py = 0; py < PUFF_SIZE; py += PUFF_PX) {
      for (let px = 0; px < PUFF_SIZE; px += PUFF_PX) {
        const d = Math.hypot(px + PUFF_PX / 2 - half, py + PUFF_PX / 2 - half) / maxR;
        if (d > 1.15) continue;
        const a = d < 0.35 ? 0.75
                : d < 0.60 ? 0.48
                : d < 0.80 ? 0.22
                :            0.07;
        ctx.fillStyle = `rgba(255,255,255,${a})`;
        ctx.fillRect(px, py, PUFF_PX, PUFF_PX);
      }
    }
    ct.refresh();
  }
}