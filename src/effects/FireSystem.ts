import Phaser from 'phaser';
import { COLORS, DEPTH } from '../config';
import type { FireGrenadeEffect, SyncedFireZone } from '../types';

/* ── Texture keys ─────────────────────────────────────── */
const TEX_EMBER = 'fire_ember';
const TEX_SPARK = 'fire_spark';

/* ── Visual fade constants ────────────────────────────── */
const FADE_IN_MS   = 300;
const FADE_OUT_MS  = 600;

/* ── Damage event (returned to host for CombatSystem processing) ── */
export interface FireDamageEvent {
  x:       number;
  y:       number;
  radius:  number;
  damage:  number;
  ownerId: string;
  rockDamageMult:  number;
  trainDamageMult: number;
}

/* ── Internal host-side tracking ── */
interface ActiveFireZone {
  id:         number;
  x:          number;
  y:          number;
  config:     FireGrenadeEffect;
  ownerId:    string;
  createdAt:  number;
  lastTickAt: number;
}

/* ── Visual representation (all clients) ── */
interface FireZoneVisual {
  /** Solid semi-transparent base circle marking the exact radius */
  baseGfx:       Phaser.GameObjects.Graphics;
  /** Dense inner emitter – embers floating within the zone */
  emberEmitter:  Phaser.GameObjects.Particles.ParticleEmitter;
  /** Bright sparks that flicker and drift upward */
  sparkEmitter:  Phaser.GameObjects.Particles.ParticleEmitter;
  /** Edge ring emitter to clearly mark the boundary */
  rimEmitter:    Phaser.GameObjects.Particles.ParticleEmitter;
  zoneRadius:    number;
}

export class FireSystem {
  private readonly activeZones: ActiveFireZone[] = [];
  private readonly visuals = new Map<number, FireZoneVisual>();
  private nextId = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.ensureFireTextures();
  }

  // ── Host API ───────────────────────────────────────────────────────────────

  /** Host-only: Legt eine neue Feuerzone an (nach Molotov-Explosion). */
  hostCreateZone(x: number, y: number, config: FireGrenadeEffect, ownerId: string): void {
    const now = Date.now();
    this.activeZones.push({
      id: this.nextId++,
      x,
      y,
      config,
      ownerId,
      createdAt:  now,
      lastTickAt: now,
    });
  }

  /**
   * Host-only: Tick-Update der Feuerzonen.
   * Gibt Damage-Ereignisse und Netzwerk-Snapshots zurück.
   * Aufgerufen einmal pro Host-Frame.
   */
  hostUpdate(now: number): { synced: SyncedFireZone[]; damageEvents: FireDamageEvent[] } {
    const synced:       SyncedFireZone[]  = [];
    const damageEvents: FireDamageEvent[] = [];

    for (let i = this.activeZones.length - 1; i >= 0; i--) {
      const zone    = this.activeZones[i];
      const elapsed = now - zone.createdAt;

      if (elapsed >= zone.config.lingerDuration) {
        this.activeZones.splice(i, 1);
        continue;
      }

      // Schaden-Tick
      if (now - zone.lastTickAt >= zone.config.tickInterval) {
        zone.lastTickAt += zone.config.tickInterval;
        damageEvents.push({
          x:       zone.x,
          y:       zone.y,
          radius:  zone.config.radius,
          damage:  zone.config.damagePerTick,
          ownerId: zone.ownerId,
          rockDamageMult:  zone.config.rockDamageMult  ?? 1,
          trainDamageMult: zone.config.trainDamageMult ?? 1,
        });
      }

      synced.push({
        id:     zone.id,
        x:      zone.x,
        y:      zone.y,
        radius: zone.config.radius,
        alpha:  this.computeAlpha(elapsed, zone.config.lingerDuration),
      });
    }

    synced.sort((a, b) => a.id - b.id);
    this.syncVisuals(synced);
    return { synced, damageEvents };
  }

  // ── Client/All-Clients API ─────────────────────────────────────────────────

  /** Synchronisiert die visuellen Feuerzonen anhand des Netzwerk-Snapshots. */
  syncVisuals(zones: SyncedFireZone[]): void {
    const activeIds = new Set(zones.map(z => z.id));

    for (const [id, visual] of this.visuals) {
      if (activeIds.has(id)) continue;
      this.destroyVisual(visual);
      this.visuals.delete(id);
    }

    for (const zone of zones) {
      let visual = this.visuals.get(zone.id);
      if (!visual) {
        visual = this.createVisual(zone);
        this.visuals.set(zone.id, visual);
      }
      this.updateVisual(visual, zone);
    }
  }

  destroyAll(): void {
    this.activeZones.length = 0;
    this.syncVisuals([]);
  }

  // ── Alpha-Lifecycle ───────────────────────────────────────────────────────

  private computeAlpha(elapsed: number, lingerDuration: number): number {
    if (elapsed < FADE_IN_MS) {
      return elapsed / FADE_IN_MS;
    }
    const fadeOutStart = lingerDuration - FADE_OUT_MS;
    if (elapsed > fadeOutStart) {
      return 1 - (elapsed - fadeOutStart) / FADE_OUT_MS;
    }
    return 1;
  }

  // ── Visual Creation ───────────────────────────────────────────────────────

  private createVisual(zone: SyncedFireZone): FireZoneVisual {
    const r = Math.max(zone.radius, 8);

    /* ── Solid floor glow: marks exact radius ── */
    const baseGfx = this.scene.add.graphics().setDepth(DEPTH.FIRE);
    this.drawBaseCircle(baseGfx, zone.x, zone.y, r, 0);

    /* ── Dense ember emitter (fills the zone) ── */
    const emberEmitter = this.scene.add.particles(zone.x, zone.y, TEX_EMBER, {
      lifespan:  { min: 600,  max: 1200 },
      frequency: 18,
      quantity:  3,
      speedX:    { min: -22, max: 22 },
      speedY:    { min: -40, max: -8 },
      scale:     { start: 0.55, end: 0.1 },
      alpha:     { start: 0.85, end: 0 },
      tint:      [COLORS.RED_1, COLORS.GOLD_2, COLORS.RED_2, COLORS.GOLD_1],
      rotate:    { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    });
    emberEmitter.setDepth(DEPTH.FIRE);
    emberEmitter.addEmitZone(this.circleZone(r * 0.85));

    /* ── Bright spark emitter (concentrated near center, drifts upward) ── */
    const sparkEmitter = this.scene.add.particles(zone.x, zone.y, TEX_SPARK, {
      lifespan:  { min: 300, max: 700 },
      frequency: 28,
      quantity:  2,
      speedX:    { min: -15, max: 15 },
      speedY:    { min: -55, max: -20 },
      scale:     { start: 0.8, end: 0.05 },
      alpha:     { start: 1.0, end: 0 },
      tint:      [COLORS.GOLD_1, COLORS.RED_1, 0xffffff],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    });
    sparkEmitter.setDepth(DEPTH.FIRE + 0.1);
    sparkEmitter.addEmitZone(this.circleZone(r * 0.5));

    /* ── Rim emitter: clearly marks damage boundary ── */
    const rimEmitter = this.scene.add.particles(zone.x, zone.y, TEX_EMBER, {
      lifespan:  { min: 400, max: 800 },
      frequency: 35,
      quantity:  1,
      speedX:    { min: -12, max: 12 },
      speedY:    { min: -20, max: 5 },
      scale:     { start: 0.35, end: 0.05 },
      alpha:     { start: 0.7, end: 0 },
      tint:      [COLORS.RED_3, COLORS.RED_2, COLORS.GOLD_3],
      blendMode: Phaser.BlendModes.ADD,
      emitting:  true,
    });
    rimEmitter.setDepth(DEPTH.FIRE);
    rimEmitter.addEmitZone(this.edgeZone(r));

    return { baseGfx, emberEmitter, sparkEmitter, rimEmitter, zoneRadius: r };
  }

  // ── Visual Update ─────────────────────────────────────────────────────────

  private updateVisual(visual: FireZoneVisual, zone: SyncedFireZone): void {
    const alpha  = Phaser.Math.Clamp(zone.alpha, 0, 1);
    const r      = Math.max(zone.radius, 8);

    /* Base circle opacity */
    this.drawBaseCircle(visual.baseGfx, zone.x, zone.y, r, alpha * 0.22);

    /* Scale emitter alphas with zone lifecycle alpha */
    visual.emberEmitter.setAlpha(Phaser.Math.Linear(0, 0.85, alpha));
    visual.sparkEmitter.setAlpha(Phaser.Math.Linear(0, 1.0,  alpha));
    visual.rimEmitter.setAlpha  (Phaser.Math.Linear(0, 0.7,  alpha));

    /* Resize emit zones if radius changed significantly */
    if (Math.abs(r - visual.zoneRadius) >= 4) {
      visual.emberEmitter.clearEmitZones();
      visual.emberEmitter.addEmitZone(this.circleZone(r * 0.85));
      visual.sparkEmitter.clearEmitZones();
      visual.sparkEmitter.addEmitZone(this.circleZone(r * 0.5));
      visual.rimEmitter.clearEmitZones();
      visual.rimEmitter.addEmitZone(this.edgeZone(r));
      visual.zoneRadius = r;
    }
  }

  private destroyVisual(visual: FireZoneVisual): void {
    visual.baseGfx.destroy();
    visual.emberEmitter.stop();
    visual.emberEmitter.destroy();
    visual.sparkEmitter.stop();
    visual.sparkEmitter.destroy();
    visual.rimEmitter.stop();
    visual.rimEmitter.destroy();
  }

  // ── Graphics helpers ──────────────────────────────────────────────────────

  private drawBaseCircle(
    gfx:   Phaser.GameObjects.Graphics,
    x:     number,
    y:     number,
    r:     number,
    alpha: number,
  ): void {
    gfx.clear();
    if (alpha <= 0.001) return;
    // Outer glow ring (darker, at exact radius boundary)
    gfx.lineStyle(3, COLORS.RED_3, alpha * 0.9);
    gfx.strokeCircle(x, y, r);
    // Filled base
    gfx.fillStyle(COLORS.RED_4, alpha);
    gfx.fillCircle(x, y, r);
    // Bright inner core ring
    gfx.lineStyle(2, COLORS.GOLD_2, alpha * 0.6);
    gfx.strokeCircle(x, y, r * 0.55);
  }

  // ── Texture generation ────────────────────────────────────────────────────

  private ensureFireTextures(): void {
    if (!this.scene.textures.exists(TEX_EMBER)) this.generateEmberTexture();
    if (!this.scene.textures.exists(TEX_SPARK)) this.generateSparkTexture();
  }

  /**
   * Weiche kreisförmige Glut – warm orange, mit hellem Kern.
   * 24×24 px, quadratische Pixelblöcke für den Pixel-Art-Look.
   */
  private generateEmberTexture(): void {
    const SIZE  = 24;
    const PX    = 2; // block size
    const CX    = SIZE / 2;
    const CY    = SIZE / 2;
    const R     = SIZE / 2;

    const gfx = this.scene.add.graphics();
    for (let by = 0; by < SIZE; by += PX) {
      for (let bx = 0; bx < SIZE; bx += PX) {
        const cx = bx + PX / 2;
        const cy = by + PX / 2;
        const dist = Math.sqrt((cx - CX) ** 2 + (cy - CY) ** 2);
        if (dist > R) continue;
        const t = 1 - dist / R;
        const alpha = t * t;
        const color = t > 0.6 ? COLORS.GOLD_1 : t > 0.3 ? COLORS.RED_1 : COLORS.RED_2;
        gfx.fillStyle(color, alpha);
        gfx.fillRect(bx, by, PX, PX);
      }
    }
    gfx.generateTexture(TEX_EMBER, SIZE, SIZE);
    gfx.destroy();
  }

  /**
   * Heller Funken – punkt-förmig, sehr klein.
   * 8×8 px Textur.
   */
  private generateSparkTexture(): void {
    const SIZE = 8;
    const PX   = 2;
    const CX   = SIZE / 2;
    const CY   = SIZE / 2;
    const R    = SIZE / 2;

    const gfx = this.scene.add.graphics();
    for (let by = 0; by < SIZE; by += PX) {
      for (let bx = 0; bx < SIZE; bx += PX) {
        const cx = bx + PX / 2;
        const cy = by + PX / 2;
        const dist = Math.sqrt((cx - CX) ** 2 + (cy - CY) ** 2);
        if (dist > R) continue;
        const t = 1 - dist / R;
        const alpha = t ** 1.5;
        gfx.fillStyle(0xffffff, alpha);
        gfx.fillRect(bx, by, PX, PX);
      }
    }
    gfx.generateTexture(TEX_SPARK, SIZE, SIZE);
    gfx.destroy();
  }

  // ── Zone helpers ──────────────────────────────────────────────────────────

  private circleZone(r: number): Phaser.Types.GameObjects.Particles.EmitZoneData {
    return {
      type:   'random',
      source: new Phaser.Geom.Circle(0, 0, r),
    } as Phaser.Types.GameObjects.Particles.EmitZoneData;
  }

  /** Randzone: Partikel entstehen genau auf dem Kreisrand. */
  private edgeZone(r: number): Phaser.Types.GameObjects.Particles.EmitZoneData {
    return {
      type:   'edge',
      source: new Phaser.Geom.Circle(0, 0, r),
      quantity: 32,
    } as Phaser.Types.GameObjects.Particles.EmitZoneData;
  }
}
