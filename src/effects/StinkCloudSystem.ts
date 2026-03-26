import Phaser from 'phaser';
import { DEPTH, NET_SMOOTH_TIME_MS } from '../config';
import { circleZone, edgeZone, ensureCanvasTexture } from './EffectUtils';
import type { SyncedStinkCloud } from '../types';

/* ── Texture keys ─────────────────────────────────────── */
const TEX_STINK_GROUND = 'stink_ground';
const TEX_STINK_HAZE = 'stink_haze';
const TEX_STINK_BLOB = 'stink_blob';
const TEX_STINK_PUFF = 'stink_puff';

/* ── Texture generation params ─────────────────────────── */
const HAZE_SIZE = 192;
const GROUND_SIZE = 256;
const BLOB_SIZE = 96;
const BLOB_PX   = 3;
const PUFF_SIZE = 40;
const PUFF_PX   = 2;

/* ── Visual constants ──────────────────────────────────── */
const FADE_IN_MS  = 300;
const FADE_OUT_MS = 500;
const REF_RADIUS  = 180;
const STINK_DEPTH = DEPTH.FIRE + 1; // between FIRE (16) and SMOKE (18)

/* ── Stink cloud tint palette ─────────────────────────── */
const TINT_CORE_DEEP   = 0x35581f;
const TINT_CORE_MID    = 0x426d12;
const TINT_MOSS        = 0x6ca116;
const TINT_TOXIC       = 0xa4dd18;
const TINT_ACID        = 0xdbff2c;
const TINT_SULFUR      = 0xf6ff9a;
const TINT_CHEM_BLUE   = 0x50f2d4;
const TINT_CHEM_CYAN   = 0x98fff2;
const TINT_PARTICLE_1  = 0x70aa18;
const TINT_PARTICLE_2  = 0xb6ee26;
const TINT_PARTICLE_3  = 0xf0ff8f;
const TINT_RIM_GLOW    = 0xeeff66;
const TINT_RIM_SOFT    = 0x87ff42;
const TINT_GROUND_GLOW = 0x1d5e09;
const TINT_DAMAGE_GLOW = 0x72ff2f;

/* ── Volumetric layer templates ────────────────────────── */
interface HazeTemplate {
  angle:    number;
  dist:     number;
  scale:    number;
  alpha:    number;
  drift:    number;
  stretchX: number;
  stretchY: number;
  tint:     number;
}

interface BlobTemplate {
  angle: number;
  dist:  number;   // fraction of cloud radius (0 = center, 1 = edge)
  scale: number;   // sprite scale at REF_RADIUS
  alpha: number;   // base alpha
  drift: number;   // drift amplitude in px at REF_RADIUS
  swirl: number;   // wobble speed factor
  tint:  number;
}

const HAZE_TEMPLATES: readonly HazeTemplate[] = [
  { angle: 0.10,          dist: 0.00, scale: 1.72, alpha: 0.34, drift: 8,  stretchX: 1.22, stretchY: 0.98, tint: TINT_CORE_DEEP },
  { angle: Math.PI * 0.5, dist: 0.10, scale: 1.46, alpha: 0.30, drift: 11, stretchX: 1.04, stretchY: 1.10, tint: TINT_CORE_MID },
  { angle: Math.PI,       dist: 0.16, scale: 1.34, alpha: 0.24, drift: 13, stretchX: 1.28, stretchY: 0.90, tint: TINT_MOSS },
  { angle: -1.10,         dist: 0.18, scale: 1.18, alpha: 0.20, drift: 16, stretchX: 0.94, stretchY: 1.18, tint: TINT_TOXIC },
  { angle: 2.40,          dist: 0.08, scale: 1.08, alpha: 0.15, drift: 18, stretchX: 1.34, stretchY: 0.82, tint: TINT_CHEM_BLUE },
  { angle: 0.90,          dist: 0.28, scale: 1.18, alpha: 0.20, drift: 15, stretchX: 1.36, stretchY: 0.86, tint: TINT_TOXIC },
  { angle: -2.10,         dist: 0.34, scale: 1.12, alpha: 0.17, drift: 17, stretchX: 1.22, stretchY: 0.90, tint: TINT_ACID },
];

const BLOB_TEMPLATES: readonly BlobTemplate[] = [
  { angle: 0.00,          dist: 0.02, scale: 1.48, alpha: 0.44, drift: 7,  swirl: 1.00, tint: TINT_CORE_DEEP },
  { angle: 0.72,          dist: 0.14, scale: 1.32, alpha: 0.40, drift: 8,  swirl: 1.12, tint: TINT_CORE_MID },
  { angle: 1.42,          dist: 0.18, scale: 1.22, alpha: 0.36, drift: 10, swirl: 0.88, tint: TINT_CORE_DEEP },
  { angle: 2.08,          dist: 0.24, scale: 1.18, alpha: 0.34, drift: 9,  swirl: 1.18, tint: TINT_MOSS },
  { angle: 2.86,          dist: 0.20, scale: 1.24, alpha: 0.35, drift: 10, swirl: 0.94, tint: TINT_CORE_MID },
  { angle: -2.64,         dist: 0.30, scale: 1.12, alpha: 0.30, drift: 12, swirl: 1.25, tint: TINT_MOSS },
  { angle: -1.94,         dist: 0.34, scale: 1.08, alpha: 0.28, drift: 12, swirl: 0.90, tint: TINT_TOXIC },
  { angle: -1.18,         dist: 0.36, scale: 1.08, alpha: 0.27, drift: 13, swirl: 1.14, tint: TINT_MOSS },
  { angle: -0.52,         dist: 0.40, scale: 1.00, alpha: 0.24, drift: 14, swirl: 1.08, tint: TINT_TOXIC },
  { angle: 0.18,          dist: 0.50, scale: 0.98, alpha: 0.22, drift: 15, swirl: 0.96, tint: TINT_ACID },
  { angle: 0.92,          dist: 0.58, scale: 0.98, alpha: 0.25, drift: 17, swirl: 1.20, tint: TINT_TOXIC },
  { angle: 1.70,          dist: 0.64, scale: 0.96, alpha: 0.23, drift: 18, swirl: 1.04, tint: TINT_ACID },
  { angle: 2.52,          dist: 0.62, scale: 0.94, alpha: 0.22, drift: 18, swirl: 0.92, tint: TINT_SULFUR },
  { angle: -2.98,         dist: 0.56, scale: 0.98, alpha: 0.23, drift: 16, swirl: 1.15, tint: TINT_TOXIC },
  { angle: -2.16,         dist: 0.68, scale: 0.90, alpha: 0.20, drift: 19, swirl: 1.02, tint: TINT_ACID },
  { angle: -1.38,         dist: 0.70, scale: 0.88, alpha: 0.19, drift: 20, swirl: 1.10, tint: TINT_SULFUR },
  { angle: -0.70,         dist: 0.66, scale: 0.94, alpha: 0.20, drift: 18, swirl: 1.08, tint: TINT_ACID },
  { angle: 0.42,          dist: 0.26, scale: 1.04, alpha: 0.24, drift: 11, swirl: 1.32, tint: TINT_CHEM_BLUE },
  { angle: -2.30,         dist: 0.46, scale: 0.96, alpha: 0.19, drift: 15, swirl: 1.22, tint: TINT_CHEM_CYAN },
  { angle: 2.20,          dist: 0.74, scale: 0.90, alpha: 0.19, drift: 20, swirl: 1.28, tint: TINT_CHEM_BLUE },
  { angle: 0.04,          dist: 0.78, scale: 0.92, alpha: 0.18, drift: 19, swirl: 1.06, tint: TINT_TOXIC },
  { angle: 1.18,          dist: 0.80, scale: 0.88, alpha: 0.17, drift: 20, swirl: 1.18, tint: TINT_ACID },
  { angle: -1.84,         dist: 0.82, scale: 0.86, alpha: 0.17, drift: 21, swirl: 1.24, tint: TINT_SULFUR },
  { angle: 2.88,          dist: 0.78, scale: 0.90, alpha: 0.18, drift: 20, swirl: 1.12, tint: TINT_TOXIC },
];

/* ── Damage event (returned to host for CombatSystem processing) ── */
export interface StinkCloudDamageEvent {
  x:              number;
  y:              number;
  radius:         number;
  damage:         number;
  ownerId:        string;
  rockDamageMult: number;
  trainDamageMult: number;
  visualVariant?: 'stink' | 'spore';
}

/* ── Host-side active cloud tracking ── */
interface ActiveStinkCloud {
  id:             number;
  ownerId:        string;
  ownerColor:     number;
  radius:         number;
  duration:       number;       // ms
  damagePerTick:  number;
  tickInterval:   number;       // ms
  rockDamageMult: number;
  trainDamageMult: number;
  visualVariant:  'stink' | 'spore';
  followOwner:    boolean;
  x:              number;
  y:              number;
  createdAt:      number;
  lastTickAt:     number;
}

/* ── Player position lookup (injected) ── */
export interface StinkCloudPlayerInfo {
  x:          number;
  y:          number;
  alive:      boolean;
  burrowed:   boolean;
  color:      number;
}

/* ── Visual per-blob data ── */
interface StinkHazeLayer {
  image:    Phaser.GameObjects.Image;
  template: HazeTemplate;
  phase:    number;
}

interface StinkBlob {
  image:    Phaser.GameObjects.Image;
  template: BlobTemplate;
  phase:    number;
}

/* ── Visual representation (all clients) ── */
interface StinkCloudVisual {
  groundGlow:      Phaser.GameObjects.Image;
  damageAura:      Phaser.GameObjects.Image;
  reactionPulse:   Phaser.GameObjects.Image;
  container:      Phaser.GameObjects.Container;
  hazes:          StinkHazeLayer[];
  blobs:          StinkBlob[];
  neonCore:       Phaser.GameObjects.Image;
  outerGlow:      Phaser.GameObjects.Image;
  accentEmitter:  Phaser.GameObjects.Particles.ParticleEmitter;
  plumeEmitter:   Phaser.GameObjects.Particles.ParticleEmitter;
  edgeEmitter:    Phaser.GameObjects.Particles.ParticleEmitter;
  innerEmitter:   Phaser.GameObjects.Particles.ParticleEmitter;
  fairnessCircle: Phaser.GameObjects.Graphics;
  zoneRadius:     number;
  birthTime:      number;
  /** Interpolated display position (lerped toward target each frame) */
  displayX:       number;
  displayY:       number;
  /** Latest server-authoritative position */
  targetX:        number;
  targetY:        number;
  /** Latest full cloud snapshot for per-frame rendering */
  lastCloud:      SyncedStinkCloud;
}

export class StinkCloudSystem {
  private readonly activeZones: ActiveStinkCloud[] = [];
  private readonly visuals = new Map<number, StinkCloudVisual>();
  private nextId = 0;

  constructor(private readonly scene: Phaser.Scene) {
    this.ensureTextures();
  }

  // ── Host API ───────────────────────────────────────────────────────────────

  /** Host-only: Aktiviert eine neue Stinkwolke um einen Spieler. */
  hostActivate(
    ownerId: string,
    radius: number,
    duration: number,
    damagePerTick: number,
    tickInterval: number,
    rockDamageMult: number,
    trainDamageMult: number,
  ): void {
    const now = Date.now();
    this.activeZones.push({
      id: this.nextId++,
      ownerId,
      ownerColor: 0xffffff,
      radius,
      duration,
      damagePerTick,
      tickInterval,
      rockDamageMult,
      trainDamageMult,
      visualVariant: 'stink',
      followOwner: true,
      x: 0,
      y: 0,
      createdAt:  now,
      lastTickAt: now,
    });
  }

  hostCreateStationaryCloud(
    ownerId: string,
    ownerColor: number,
    x: number,
    y: number,
    radius: number,
    duration: number,
    damagePerTick: number,
    tickInterval: number,
    rockDamageMult: number,
    trainDamageMult: number,
  ): void {
    const now = Date.now();
    this.activeZones.push({
      id: this.nextId++,
      ownerId,
      ownerColor,
      radius,
      duration,
      damagePerTick,
      tickInterval,
      rockDamageMult,
      trainDamageMult,
      visualVariant: 'spore',
      followOwner: false,
      x,
      y,
      createdAt: now,
      lastTickAt: now,
    });
  }

  /**
   * Host-only: Tick-Update der Stinkwolken.
   * Gibt Damage-Ereignisse und Netzwerk-Snapshots zurück.
   * playerLookup liefert Position/Status/Farbe pro Spieler-ID.
   */
  hostUpdate(
    now: number,
    playerLookup: (id: string) => StinkCloudPlayerInfo | null,
  ): { synced: SyncedStinkCloud[]; damageEvents: StinkCloudDamageEvent[] } {
    const synced:       SyncedStinkCloud[]       = [];
    const damageEvents: StinkCloudDamageEvent[]  = [];

    for (let i = this.activeZones.length - 1; i >= 0; i--) {
      const zone = this.activeZones[i];
      const info = playerLookup(zone.ownerId);

      if (zone.followOwner) {
        // Deaktivierung: Spieler tot, eingebuddelt, oder nicht mehr vorhanden
        if (!info || !info.alive || info.burrowed) {
          this.activeZones.splice(i, 1);
          continue;
        }
        zone.x = info.x;
        zone.y = info.y;
        zone.ownerColor = info.color;
      }

      // Duration abgelaufen
      const elapsed = now - zone.createdAt;
      if (elapsed >= zone.duration) {
        this.activeZones.splice(i, 1);
        continue;
      }

      // Damage-Tick
      if (now - zone.lastTickAt >= zone.tickInterval) {
        zone.lastTickAt += zone.tickInterval;
        damageEvents.push({
          x:               zone.x,
          y:               zone.y,
          radius:          zone.radius,
          damage:          zone.damagePerTick,
          ownerId:         zone.ownerId,
          rockDamageMult:  zone.rockDamageMult,
          trainDamageMult: zone.trainDamageMult,
          visualVariant:   zone.visualVariant,
        });
      }

      // Snapshot für Netzwerk
      synced.push({
        id:         zone.id,
        ownerId:    zone.ownerId,
        x:          Math.round(zone.x),
        y:          Math.round(zone.y),
        radius:     zone.radius,
        alpha:      Math.round(this.computeAlpha(elapsed, zone.duration) * 100) / 100,
        ownerColor: zone.ownerColor,
        visualVariant: zone.visualVariant,
      });
    }

    synced.sort((a, b) => a.id - b.id);
    this.syncVisuals(synced);
    return { synced, damageEvents };
  }

  /** Host-only: Deaktiviert sofort alle Wolken eines Spielers. */
  hostDeactivateForPlayer(playerId: string): void {
    for (let i = this.activeZones.length - 1; i >= 0; i--) {
      if (this.activeZones[i].ownerId === playerId) {
        this.activeZones.splice(i, 1);
      }
    }
  }

  // ── Client/All-Clients API ─────────────────────────────────────────────────

  /** Synchronisiert die visuellen Stinkwolken anhand des Netzwerk-Snapshots. */
  syncVisuals(clouds: SyncedStinkCloud[]): void {
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
      } else {
        visual.targetX   = cloud.x;
        visual.targetY   = cloud.y;
        visual.lastCloud = cloud;
      }
      // Always render on sync using current interpolated display position
      this.updateVisual(visual, visual.displayX, visual.displayY, visual.lastCloud);
    }
  }

  /**
   * Per-frame update: lerps display positions toward server targets and
   * re-renders each active cloud. Call this every game frame.
   */
  clientUpdate(delta: number): void {
    const factor = 1 - Math.exp(-delta / NET_SMOOTH_TIME_MS);
    for (const visual of this.visuals.values()) {
      visual.displayX = Phaser.Math.Linear(visual.displayX, visual.targetX, factor);
      visual.displayY = Phaser.Math.Linear(visual.displayY, visual.targetY, factor);
      this.updateVisual(visual, visual.displayX, visual.displayY, visual.lastCloud);
    }
  }

  destroyAll(): void {
    this.activeZones.length = 0;
    this.syncVisuals([]);
  }

  // ── Alpha-Lifecycle ───────────────────────────────────────────────────────

  private computeAlpha(elapsed: number, duration: number): number {
    if (elapsed < FADE_IN_MS) {
      return elapsed / FADE_IN_MS;
    }
    const fadeOutStart = duration - FADE_OUT_MS;
    if (elapsed > fadeOutStart) {
      return Math.max(0, 1 - (elapsed - fadeOutStart) / FADE_OUT_MS);
    }
    return 1;
  }

  // ── Visual Creation ───────────────────────────────────────────────────────

  private createVisual(cloud: SyncedStinkCloud): StinkCloudVisual {
    const r = Math.max(cloud.radius, 8);
    const isSpore = cloud.visualVariant === 'spore';

    const groundGlow = this.scene.add.image(cloud.x, cloud.y, TEX_STINK_GROUND)
      .setDepth(STINK_DEPTH - 0.12)
      .setTint(isSpore ? 0x5b3818 : TINT_GROUND_GLOW)
      .setBlendMode(Phaser.BlendModes.MULTIPLY)
      .setAlpha(0.26);

    const damageAura = this.scene.add.image(cloud.x, cloud.y, TEX_STINK_GROUND)
      .setDepth(STINK_DEPTH - 0.08)
      .setTint(isSpore ? 0xc7d85a : TINT_DAMAGE_GLOW)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.18);

    const reactionPulse = this.scene.add.image(cloud.x, cloud.y, TEX_STINK_GROUND)
      .setDepth(STINK_DEPTH - 0.04)
      .setTint(isSpore ? 0xf0e68c : TINT_CHEM_CYAN)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);

    /* ── Container for volumetric haze + blobs ── */
    const container = this.scene.add.container(cloud.x, cloud.y).setDepth(STINK_DEPTH);

    const hazes: StinkHazeLayer[] = HAZE_TEMPLATES.map(tmpl => {
      const img = this.scene.add.image(0, 0, TEX_STINK_HAZE)
        .setOrigin(0.5)
        .setTint(tmpl.tint)
        .setBlendMode(tmpl.tint === TINT_CHEM_BLUE ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      container.add(img);
      return { image: img, template: tmpl, phase: Math.random() * Math.PI * 2 };
    });

    const outerGlow = this.scene.add.image(0, 0, TEX_STINK_HAZE)
      .setOrigin(0.5)
      .setTint(isSpore ? 0xf6c14d : TINT_CHEM_BLUE)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.2);
    container.add(outerGlow);

    const neonCore = this.scene.add.image(0, 0, TEX_STINK_HAZE)
      .setOrigin(0.5)
      .setTint(isSpore ? 0xf0e97f : TINT_ACID)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.26);
    container.add(neonCore);

    const blobs: StinkBlob[] = BLOB_TEMPLATES.map(tmpl => {
      const img = this.scene.add.image(0, 0, TEX_STINK_BLOB)
        .setOrigin(0.5)
        .setTint(tmpl.tint)
        .setBlendMode(tmpl.tint === TINT_CHEM_BLUE || tmpl.tint === TINT_CHEM_CYAN ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      container.add(img);
      return { image: img, template: tmpl, phase: Math.random() * Math.PI * 2 };
    });

    /* ── Inner particle emitter (rolling core gas) ── */
    const innerEmitter = this.scene.add.particles(cloud.x, cloud.y, TEX_STINK_PUFF, {
      lifespan:  { min: 900, max: 1800 },
      frequency: 52,
      quantity:  1,
      speedX:    { min: -18, max: 18 },
      speedY:    { min: -16, max: 10 },
      scale:     { start: 0.34, end: 1.0 },
      alpha:     { start: 0.2, end: 0 },
      tint:      [TINT_PARTICLE_1, TINT_PARTICLE_2, TINT_TOXIC],
      rotate:    { min: 0, max: 360 },
      emitting:  true,
      blendMode: Phaser.BlendModes.NORMAL,
    });
    innerEmitter.setDepth(STINK_DEPTH);
    innerEmitter.addEmitZone(circleZone(Math.max(r * 0.42, 10)));

    const accentEmitter = this.scene.add.particles(cloud.x, cloud.y, TEX_STINK_PUFF, {
      lifespan:  { min: 900, max: 1600 },
      frequency: 44,
      quantity:  1,
      speedX:    { min: -14, max: 14 },
      speedY:    { min: -20, max: 6 },
      scale:     { start: 0.12, end: 0.42 },
      alpha:     { start: 0.34, end: 0 },
      tint:      [TINT_CHEM_BLUE, TINT_CHEM_CYAN, TINT_SULFUR],
      rotate:    { min: 0, max: 360 },
      emitting:  true,
      blendMode: Phaser.BlendModes.ADD,
    });
    accentEmitter.setDepth(STINK_DEPTH + 0.03);
    accentEmitter.addEmitZone(circleZone(Math.max(r * 0.3, 8)));

    /* ── Upward plume emitter (sells volume) ── */
    const plumeEmitter = this.scene.add.particles(cloud.x, cloud.y, TEX_STINK_PUFF, {
      lifespan:  { min: 1400, max: 2600 },
      frequency: 62,
      quantity:  1,
      speedX:    { min: -10, max: 10 },
      speedY:    { min: -34, max: -12 },
      scale:     { start: 0.3, end: 1.26 },
      alpha:     { start: 0.16, end: 0 },
      tint:      [TINT_PARTICLE_2, TINT_PARTICLE_3, TINT_ACID],
      rotate:    { min: 0, max: 360 },
      emitting:  true,
      blendMode: Phaser.BlendModes.NORMAL,
    });
    plumeEmitter.setDepth(STINK_DEPTH + 0.02);
    plumeEmitter.addEmitZone(circleZone(Math.max(r * 0.24, 6)));

    /* ── Edge emitter (bright wisps at the radius) ── */
    const edgeEmitter = this.scene.add.particles(cloud.x, cloud.y, TEX_STINK_PUFF, {
      lifespan:  { min: 1300, max: 2400 },
      frequency: 34,
      quantity:  3,
      speedX:    { min: -18, max: 18 },
      speedY:    { min: -18, max: 18 },
      scale:     { start: 0.22, end: 1.36 },
      alpha:     { start: 0.22, end: 0 },
      tint:      [TINT_RIM_SOFT, TINT_ACID, TINT_CHEM_CYAN],
      rotate:    { min: 0, max: 360 },
      emitting:  true,
      blendMode: Phaser.BlendModes.ADD,
    });
    edgeEmitter.setDepth(STINK_DEPTH + 0.04);
    edgeEmitter.addEmitZone(edgeZone(Math.max(r * 0.86, 12), 56));

    /* ── Fairness circle: readable, still organic ── */
    const fairnessCircle = this.scene.add.graphics()
      .setDepth(STINK_DEPTH + 0.1)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.drawFairnessCircle(fairnessCircle, cloud.x, cloud.y, r, cloud.ownerColor, 0, 0);

    this.playSpawnBurst(cloud.x, cloud.y, r);

    return {
      groundGlow,
      damageAura,
      reactionPulse,
      container,
      hazes,
      blobs,
      neonCore,
      outerGlow,
      accentEmitter,
      plumeEmitter,
      edgeEmitter,
      innerEmitter,
      fairnessCircle,
      zoneRadius:  r,
      birthTime:   this.scene.time.now,
      displayX:    cloud.x,
      displayY:    cloud.y,
      targetX:     cloud.x,
      targetY:     cloud.y,
      lastCloud:   cloud,
    };
  }

  // ── Visual Update ─────────────────────────────────────────────────────────

  private updateVisual(visual: StinkCloudVisual, x: number, y: number, cloud: SyncedStinkCloud): void {
    const radius = Math.max(cloud.radius, 8);
    const alpha  = Phaser.Math.Clamp(cloud.alpha, 0, 1);
    const t      = (this.scene.time.now - visual.birthTime) * 0.001;
    const rScale = radius / REF_RADIUS;
    const isSpore = cloud.visualVariant === 'spore';
    const visible = alpha > 0.01;
    const pulseWave = Phaser.Math.Clamp(Math.pow((Math.sin(t * 2.8 + 0.8) + 1) * 0.5, 6), 0, 1);
    const damagePulse = Phaser.Math.Clamp(Math.pow((Math.sin(t * 1.7 - 0.4) + 1) * 0.5, 2.2), 0, 1);

    /* ── Position container + emitters ── */
    visual.container.setPosition(x, y).setVisible(visible);

    visual.groundGlow
      .setPosition(x, y)
      .setVisible(visible)
      .setScale(1.52 * rScale, 1.42 * rScale)
      .setAlpha((isSpore ? 0.14 : 0.2 + damagePulse * 0.06) * alpha)
      .setRotation(Math.sin(t * 0.11) * 0.08);

    visual.damageAura
      .setPosition(x, y)
      .setVisible(visible)
      .setScale(1.06 * rScale * (1 + damagePulse * 0.035), 1.02 * rScale * (1 + damagePulse * 0.028))
      .setAlpha((isSpore ? 0.12 + damagePulse * 0.08 : 0.16 + damagePulse * 0.1) * alpha)
      .setRotation(Math.cos(t * 0.16) * 0.05);

    visual.reactionPulse
      .setPosition(x, y - radius * 0.02)
      .setVisible(visible)
      .setScale((0.54 + pulseWave * 0.38) * rScale, (0.5 + pulseWave * 0.34) * rScale)
      .setAlpha((pulseWave * (isSpore ? 0.12 : 0.2)) * alpha)
      .setRotation(Math.sin(t * 0.35 + 0.6) * 0.14);

    const corePulse = 1 + Math.sin(t * 0.42) * 0.06;
    const shellPulse = 1 + Math.cos(t * 0.28 + 0.7) * 0.08;

    visual.outerGlow
      .setScale(1.46 * rScale * shellPulse, 1.28 * rScale * shellPulse)
      .setAlpha((0.16 + Math.sin(t * 0.3) * 0.03 + damagePulse * 0.03) * alpha)
      .setRotation(Math.sin(t * 0.12) * 0.18);

    visual.neonCore
      .setScale(0.9 * rScale * corePulse, 0.78 * rScale * corePulse)
      .setAlpha((0.22 + Math.sin(t * 0.54 + 0.3) * 0.03 + pulseWave * 0.09) * alpha)
      .setRotation(Math.cos(t * 0.16 + 0.4) * 0.12);

    /* ── Slow volumetric haze layers ── */
    for (const haze of visual.hazes) {
      const { template: tp, phase: p } = haze;
      const driftX = Math.cos(t * 0.16 + p) * tp.drift * rScale;
      const driftY = Math.sin(t * 0.13 + p * 1.27) * tp.drift * rScale * 0.7;
      const pulse = 1 + Math.sin(t * 0.24 + p * 0.8) * 0.05;

      haze.image.setPosition(
        Math.cos(tp.angle) * tp.dist * radius * 0.4 + driftX,
        Math.sin(tp.angle) * tp.dist * radius * 0.3 + driftY,
      );
      haze.image.setScale(tp.scale * rScale * tp.stretchX * pulse, tp.scale * rScale * tp.stretchY * pulse);
      haze.image.setAlpha(tp.alpha * alpha * (tp.tint === TINT_CHEM_BLUE ? 1.18 + pulseWave * 0.24 : 1));
      haze.image.setRotation(Math.sin(t * 0.1 + p) * 0.15);
    }

    /* ── Animated blobs ── */
    for (const b of visual.blobs) {
      const { template: tp, phase: p } = b;

      const dx = (Math.sin(t * (0.42 + tp.swirl * 0.12) + p)
        + Math.sin(t * (0.88 + tp.swirl * 0.16) + p * 1.9) * 0.42) * tp.drift * rScale;
      const dy = (Math.cos(t * (0.48 + tp.swirl * 0.09) + p * 1.3)
        + Math.cos(t * (0.78 + tp.swirl * 0.14) + p * 0.55) * 0.36) * tp.drift * rScale;
      const pulse = 1 + Math.sin(t * (0.34 + tp.swirl * 0.08) + p * 0.9) * 0.1;
      const orbitRadius = radius * tp.dist * (1 + Math.sin(t * 0.22 + p) * 0.04);

      b.image.setPosition(
        Math.cos(tp.angle + Math.sin(t * 0.08 + p) * 0.08) * orbitRadius + dx,
        Math.sin(tp.angle + Math.cos(t * 0.09 + p) * 0.08) * orbitRadius + dy,
      );
      b.image.setScale(tp.scale * rScale * pulse);
      b.image.setAlpha(tp.alpha * alpha * Phaser.Math.Linear(0.98, 1.18, Math.sin(t * 0.3 + p) * 0.5 + 0.5));
      b.image.setRotation(t * (0.06 + tp.swirl * 0.02) + p);
    }

    /* ── Edge emitter ── */
    visual.edgeEmitter.setPosition(x, y).setVisible(visible);
    visual.edgeEmitter.setAlpha(Phaser.Math.Linear(0.1, 0.24, alpha));
    visual.edgeEmitter.setFrequency(Math.floor(Phaser.Math.Linear(54, 24, alpha)), 3);
    visual.edgeEmitter.setParticleScale(0.24 * rScale, Phaser.Math.Linear(1.08, 1.68, alpha) * rScale);

    /* ── Inner emitter ── */
    visual.innerEmitter.setPosition(x, y).setVisible(visible);
    visual.innerEmitter.setAlpha(Phaser.Math.Linear(0.12, 0.28, alpha));
    visual.innerEmitter.setFrequency(Math.floor(Phaser.Math.Linear(74, 34, alpha)), 2);
    visual.innerEmitter.setParticleScale(0.22 * rScale, Phaser.Math.Linear(0.82, 1.26, alpha) * rScale);

    /* ── Neon accent emitter ── */
    visual.accentEmitter.setPosition(x, y - radius * 0.04).setVisible(visible);
    visual.accentEmitter.setAlpha(Phaser.Math.Linear(0.08, 0.18 + pulseWave * 0.14, alpha));
    visual.accentEmitter.setFrequency(Math.floor(Phaser.Math.Linear(54, 18, alpha)), 1);
    visual.accentEmitter.setParticleScale(0.1 * rScale, Phaser.Math.Linear(0.24, 0.66 + pulseWave * 0.18, alpha) * rScale);

    /* ── Upward plume emitter ── */
    visual.plumeEmitter.setPosition(x, y + radius * 0.12).setVisible(visible);
    visual.plumeEmitter.setAlpha(Phaser.Math.Linear(0.08, 0.18, alpha));
    visual.plumeEmitter.setFrequency(Math.floor(Phaser.Math.Linear(92, 42, alpha)), 2);
    visual.plumeEmitter.setParticleScale(0.18 * rScale, Phaser.Math.Linear(0.94, 1.46, alpha) * rScale);

    /* ── Fairness circle ── */
    this.drawFairnessCircle(visual.fairnessCircle, x, y, radius, cloud.ownerColor, alpha, t, isSpore);

    /* ── Emit-zone resize ── */
    const target = Math.max(radius * 0.86, 12);
    if (Math.abs(target - visual.zoneRadius) >= 5) {
      visual.edgeEmitter.clearEmitZones();
      visual.edgeEmitter.addEmitZone(edgeZone(target, 56));
      visual.innerEmitter.clearEmitZones();
      visual.innerEmitter.addEmitZone(circleZone(Math.max(target * 0.5, 8)));
      visual.accentEmitter.clearEmitZones();
      visual.accentEmitter.addEmitZone(circleZone(Math.max(target * 0.36, 8)));
      visual.plumeEmitter.clearEmitZones();
      visual.plumeEmitter.addEmitZone(circleZone(Math.max(target * 0.28, 6)));
      visual.zoneRadius = target;
    }
  }

  private drawFairnessCircle(
    gfx: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    color: number,
    alpha: number,
    time: number,
    isSpore = false,
  ): void {
    gfx.clear();
    if (alpha < 0.01) return;

    gfx.lineStyle(2.2, isSpore ? 0xf2dc76 : TINT_RIM_GLOW, 0.03 * alpha);
    gfx.strokeCircle(x, y, radius);

    gfx.lineStyle(1.8, isSpore ? 0xe4a94d : TINT_CHEM_BLUE, 0.035 * alpha);
    gfx.strokeCircle(x, y, radius * 1.01);

    gfx.lineStyle(1.2, color, 0.22 * alpha);
    gfx.strokeCircle(x, y, radius);

    gfx.lineStyle(0.8, isSpore ? 0xf4e6a3 : TINT_SULFUR, 0.08 * alpha);
    gfx.strokeCircle(x, y, radius * 0.93);

    for (let i = 0; i < 4; i++) {
      const span = 0.48 + Math.sin(time * 0.55 + i) * 0.08;
      const center = time * 0.24 + i * (Math.PI / 2) + Math.sin(time * 0.4 + i * 1.7) * 0.18;
      const arcRadius = radius * (0.96 + Math.sin(time * 0.8 + i) * 0.015);
      gfx.lineStyle(1.2, i % 2 === 0 ? (isSpore ? 0xf2dc76 : TINT_RIM_GLOW) : (isSpore ? 0xe4a94d : TINT_CHEM_CYAN), 0.04 * alpha);
      gfx.beginPath();
      gfx.arc(x, y, arcRadius, center - span * 0.5, center + span * 0.5, false);
      gfx.strokePath();
    }
  }

  private playSpawnBurst(x: number, y: number, radius: number): void {
    const burstEmitter = this.scene.add.particles(x, y, TEX_STINK_PUFF, {
      lifespan:  { min: 700, max: 2400 },
      quantity:  1,
      speedX:    { min: -95, max: 95 },
      speedY:    { min: -95, max: 95 },
      scale:     { start: 0.22, end: 0.78 },
      alpha:     { start: 0.34, end: 0 },
      tint:      [TINT_ACID, TINT_CHEM_CYAN, TINT_SULFUR],
      rotate:    { min: 0, max: 360 },
      emitting:  false,
      blendMode: Phaser.BlendModes.ADD,
    });
    burstEmitter.setDepth(STINK_DEPTH + 0.05);
    burstEmitter.addEmitZone(edgeZone(Math.max(radius * 0.72, 12), 64));
    burstEmitter.explode(Math.max(32, Math.round(radius * 0.22)));

    const flash = this.scene.add.image(x, y, TEX_STINK_GROUND)
      .setDepth(STINK_DEPTH + 0.03)
      .setTint(TINT_DAMAGE_GLOW)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.5)
      .setScale(0.32 * (radius / REF_RADIUS), 0.3 * (radius / REF_RADIUS));

    this.scene.tweens.add({
      targets: flash,
      scaleX: 1.38 * (radius / REF_RADIUS),
      scaleY: 1.28 * (radius / REF_RADIUS),
      alpha: 0,
      duration: 300,
      ease: 'Cubic.Out',
      onComplete: () => flash.destroy(),
    });

    this.scene.time.delayedCall(1800, () => {
      burstEmitter.stop();
      burstEmitter.destroy();
    });
  }

  // ── Visual Destruction ──────────────────────────────────────────────────

  private destroyVisual(visual: StinkCloudVisual): void {
    visual.groundGlow.destroy();
    visual.damageAura.destroy();
    visual.reactionPulse.destroy();
    visual.accentEmitter.stop();
    visual.accentEmitter.destroy();
    visual.plumeEmitter.stop();
    visual.plumeEmitter.destroy();
    visual.edgeEmitter.stop();
    visual.edgeEmitter.destroy();
    visual.innerEmitter.stop();
    visual.innerEmitter.destroy();
    visual.neonCore.destroy();
    visual.outerGlow.destroy();
    visual.fairnessCircle.destroy();
    visual.container.destroy(true);
  }

  // ── Texture Generation ──────────────────────────────────────────────────

  private ensureTextures(): void {
    this.generateGroundTexture();
    this.generateHazeTexture();
    this.generateBlobTexture();
    this.generatePuffTexture();
  }

  private generateGroundTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_STINK_GROUND, GROUND_SIZE, GROUND_SIZE, (ctx) => {
      const half = GROUND_SIZE / 2;
      const glow = ctx.createRadialGradient(half, half, 0, half, half, half);
      glow.addColorStop(0, 'rgba(255,255,255,0.92)');
      glow.addColorStop(0.28, 'rgba(255,255,255,0.72)');
      glow.addColorStop(0.56, 'rgba(255,255,255,0.34)');
      glow.addColorStop(0.82, 'rgba(255,255,255,0.12)');
      glow.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.clearRect(0, 0, GROUND_SIZE, GROUND_SIZE);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, GROUND_SIZE, GROUND_SIZE);
    });
  }

  private generateHazeTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_STINK_HAZE, HAZE_SIZE, HAZE_SIZE, (ctx) => {
      const half = HAZE_SIZE / 2;
      ctx.clearRect(0, 0, HAZE_SIZE, HAZE_SIZE);

      const lobes = [
        { x: -30, y: -12, r: 58, a: 0.28 },
        { x: 20, y: -20, r: 56, a: 0.25 },
        { x: -14, y: 24, r: 66, a: 0.22 },
        { x: 32, y: 22, r: 50, a: 0.18 },
        { x: 0, y: 0, r: 78, a: 0.2 },
        { x: 12, y: 10, r: 38, a: 0.16 },
      ] as const;

      for (const lobe of lobes) {
        const gradient = ctx.createRadialGradient(
          half + lobe.x,
          half + lobe.y,
          0,
          half + lobe.x,
          half + lobe.y,
          lobe.r,
        );
        gradient.addColorStop(0, `rgba(255,255,255,${lobe.a})`);
        gradient.addColorStop(0.5, `rgba(255,255,255,${lobe.a * 0.75})`);
        gradient.addColorStop(0.82, `rgba(255,255,255,${lobe.a * 0.24})`);
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, HAZE_SIZE, HAZE_SIZE);
      }
    });
  }

  private generateBlobTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_STINK_BLOB, BLOB_SIZE, BLOB_SIZE, (ctx) => {
      const half = BLOB_SIZE / 2;
      const maxR = half - BLOB_PX * 2;

      ctx.clearRect(0, 0, BLOB_SIZE, BLOB_SIZE);

      for (let py = 0; py < BLOB_SIZE; py += BLOB_PX) {
        for (let px = 0; px < BLOB_SIZE; px += BLOB_PX) {
          const sx = px + BLOB_PX / 2 - half;
          const sy = py + BLOB_PX / 2 - half;
          const angle = Math.atan2(sy, sx);
          const noise =
            Math.sin(angle * 3.2 + 0.6) * 0.06
            + Math.sin(angle * 6.7 - 1.3) * 0.035
            + Math.cos((sx - sy) * 0.08) * 0.025;
          const d = Math.hypot(sx, sy) / maxR;
          if (d > 1.04 + noise) continue;
          const a = d < 0.18 ? 0.95
                  : d < 0.36 ? 0.78
                  : d < 0.54 ? 0.54
                  : d < 0.72 ? 0.30
                  : d < 0.88 ? 0.14
                  :            0.05;
          ctx.fillStyle = `rgba(255,255,255,${a})`;
          ctx.fillRect(px, py, BLOB_PX, BLOB_PX);
        }
      }
    });
  }

  private generatePuffTexture(): void {
    ensureCanvasTexture(this.scene.textures, TEX_STINK_PUFF, PUFF_SIZE, PUFF_SIZE, (ctx) => {
      const half = PUFF_SIZE / 2;
      const maxR = half - PUFF_PX * 2;

      ctx.clearRect(0, 0, PUFF_SIZE, PUFF_SIZE);

      for (let py = 0; py < PUFF_SIZE; py += PUFF_PX) {
        for (let px = 0; px < PUFF_SIZE; px += PUFF_PX) {
          const sx = px + PUFF_PX / 2 - half;
          const sy = py + PUFF_PX / 2 - half;
          const angle = Math.atan2(sy, sx);
          const wobble = Math.sin(angle * 5.1 + 0.8) * 0.08 + Math.cos(angle * 2.7 - 0.5) * 0.04;
          const d = Math.hypot(sx, sy) / maxR;
          if (d > 1.05 + wobble) continue;
          const a = d < 0.24 ? 0.74
                  : d < 0.48 ? 0.46
                  : d < 0.72 ? 0.22
                  :            0.07;
          ctx.fillStyle = `rgba(255,255,255,${a})`;
          ctx.fillRect(px, py, PUFF_PX, PUFF_PX);
        }
      }
    });
  }
}
