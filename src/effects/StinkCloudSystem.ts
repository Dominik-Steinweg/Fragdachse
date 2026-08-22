import * as Phaser from 'phaser';
import { DEPTH, NET_SMOOTH_TIME_MS, VOID_FIRE_COLOR } from '../config';
import { edgeZone, ensureCanvasTexture, recordGraphicsWork, recordParticleSpawn, registerGraphicsObject, registerParticleEmitter } from './EffectUtils';
import type { DamageZoneVisualStyle, SyncedStinkCloud } from '../types';
import type { LightingSystem } from './LightingSystem';
import type { LightPresetKey } from './LightingConfig';
import { TEX_STINK_PUFF, ensureStinkPuffTexture } from './gpu/GpuVfxSourceTextures';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { StinkCloudGpuParticles, type StinkCloudParticleTints } from './StinkCloudGpuParticles';

/* ── Texture keys ─────────────────────────────────────── */
const TEX_STINK_GROUND = 'stink_ground';
const TEX_STINK_HAZE = 'stink_haze';
const TEX_STINK_BLOB = 'stink_blob';

/* ── Texture generation params ─────────────────────────── */
const HAZE_SIZE = 192;
const GROUND_SIZE = 256;
const BLOB_SIZE = 96;
const BLOB_PX   = 3;

/* ── Visual constants ──────────────────────────────────── */
const FADE_IN_MS  = 300;
const FADE_OUT_MS = 500;
const REF_RADIUS  = 180;
const STINK_DEPTH = DEPTH.STINK; // between FIRE (16) and SMOKE (18)

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

/* Purple danger palette for the Warden's spore cloud. */
const VOID_SPORE_GROUND = 0x2a153e;
const VOID_SPORE_DAMAGE = 0x8d3bc7;
const VOID_SPORE_REACTION = 0xf0dcff;
const VOID_SPORE_OUTER = 0xa83cff;
const VOID_SPORE_CORE = 0xd887ff;
const VOID_SPORE_HAZE = [0x3a1a58, 0x562074, 0x7628a8, 0x8b35c2, 0x68218f, 0x9a3bd0, 0x4b1b70] as const;
const VOID_SPORE_BLOB = [0x6b22a3, 0x9d35ee, 0xc76cff, 0x7a2baf] as const;
const VOID_SPORE_PARTICLE = [0xf2c8ff, 0xd477ff, VOID_FIRE_COLOR] as const;
const VOID_SPORE_EDGE = [0xf4d4ff, 0xd887ff, VOID_FIRE_COLOR] as const;

/* ── Electric (ASMD) variant palette ─────────────────────── */
const ELEC_GROUND     = 0x0d2b45;
const ELEC_DAMAGE     = 0x4fc3ff;
const ELEC_REACTION   = 0xcdefff;
const ELEC_OUTER      = 0x2a8fd6;
const ELEC_CORE       = 0x9fe8ff;
const ELEC_HAZE       = 0x1f6f9e;
const ELEC_BLOB       = [0x3aa8e0, 0x7fd8f7, 0xeaffff] as const;
const ELEC_PARTICLE   = [0x9fe8ff, 0x4fc3ff, 0xffffff] as const;
const ELEC_EDGE       = [0xcdefff, 0x9fe8ff, 0xffffff] as const;
const ELEC_ARC        = 0xbdefff;
const ELEC_ARC_BRIGHT = 0xffffff;

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
  baseDamageMult: number;
  visualVariant?: DamageZoneVisualStyle;
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
  baseDamageMult: number;
  visualVariant:  DamageZoneVisualStyle;
  followOwner:    boolean;
  x:              number;
  y:              number;
  createdAt:      number;
  lastTickAt:     number;
  afterCloudDurationMs: number;
  afterCloudRadiusFactor: number;
  afterCloudDamageFactor: number;
}

type StinkCloudEndReason = 'natural' | 'owner_inactive' | 'cleanup';

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
  fairnessCircle: Phaser.GameObjects.Graphics;
  visualVariant:  DamageZoneVisualStyle;
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

/**
 * Beleuchtung je Wolkenvariante. Die Farben sind gegenüber den Partikeln aufgehellt: als
 * Licht muss die Farbe alle drei Kanäle anheben. Normale Sporen wabern leicht grün,
 * Void-Sporen lila (das Flackern steckt im Preset), das Elektrofeld pulst kalt blau.
 */
const CLOUD_LIGHT: Record<DamageZoneVisualStyle, {
  preset: LightPresetKey;
  color: number;
  radiusScale: number;
  intensity: number;
}> = {
  stink:    { preset: 'slimeGlow',      color: 0xbfff9a, radiusScale: 1.4, intensity: 0.34 },
  spore:    { preset: 'sporeProjectile', color: 0xd9ffb0, radiusScale: 1.5, intensity: 0.5 },
  spore_void: { preset: 'sporeVoidProjectile', color: 0xe9c6ff, radiusScale: 1.5, intensity: 0.65 },
  electric: { preset: 'electricField',  color: 0xcdf1ff, radiusScale: 1.6, intensity: 1.0 },
};

/**
 * Tint-Auswahl der vier Partikelfamilien je Variante. Einmal aufgeloest statt pro Wolke neu
 * zusammengebaut; die Auswahl selbst passiert beim Spawn wie in Phasers Tint-Array-Op.
 */
const PARTICLE_TINTS: Readonly<Record<DamageZoneVisualStyle, StinkCloudParticleTints>> = {
  stink: {
    inner:  [TINT_PARTICLE_1, TINT_PARTICLE_2, TINT_TOXIC],
    accent: [TINT_CHEM_BLUE, TINT_CHEM_CYAN, TINT_SULFUR],
    plume:  [TINT_PARTICLE_2, TINT_PARTICLE_3, TINT_ACID],
    edge:   [TINT_RIM_SOFT, TINT_ACID, TINT_CHEM_CYAN],
  },
  spore: {
    inner:  [TINT_PARTICLE_1, TINT_PARTICLE_2, TINT_TOXIC],
    accent: [TINT_CHEM_BLUE, TINT_CHEM_CYAN, TINT_SULFUR],
    plume:  [TINT_PARTICLE_2, TINT_PARTICLE_3, TINT_ACID],
    edge:   [TINT_RIM_SOFT, TINT_ACID, TINT_CHEM_CYAN],
  },
  spore_void: {
    inner:  [...VOID_SPORE_PARTICLE],
    accent: [...VOID_SPORE_PARTICLE],
    plume:  [...VOID_SPORE_PARTICLE],
    edge:   [...VOID_SPORE_EDGE],
  },
  electric: {
    inner:  [...ELEC_PARTICLE],
    accent: [...ELEC_PARTICLE],
    plume:  [...ELEC_PARTICLE],
    edge:   [...ELEC_EDGE],
  },
};

export class StinkCloudSystem {
  private readonly activeZones: ActiveStinkCloud[] = [];
  private readonly visuals = new Map<number, StinkCloudVisual>();
  private nextId = 0;
  private lighting: LightingSystem | null = null;
  private gpuParticles: StinkCloudGpuParticles | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.ensureTextures();
  }

  setLightingSystem(lighting: LightingSystem | null): void {
    this.lighting = lighting;
  }

  /**
   * Haengt die vier kontinuierlichen Partikelfamilien an das gemeinsame GPU-VFX-Backend – die
   * Layer gehoeren dort hin, nicht der Wolke. Das Backend existiert erst mit dem
   * Renderer-Bundle, deshalb wie beim Lighting eine nachgereichte Injektion.
   */
  setGpuVfxSystem(system: GpuVfxSystem | null): void {
    if (!system || this.gpuParticles) return;
    this.gpuParticles = new StinkCloudGpuParticles(system);
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
    baseDamageMult = 1,
    afterCloudDurationMs = 0,
    afterCloudRadiusFactor = 0,
    afterCloudDamageFactor = 0,
    visualVariant: DamageZoneVisualStyle = 'stink',
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
      baseDamageMult,
      visualVariant,
      followOwner: true,
      x: 0,
      y: 0,
      createdAt:  now,
      lastTickAt: now,
      afterCloudDurationMs,
      afterCloudRadiusFactor,
      afterCloudDamageFactor,
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
    baseDamageMult = 1,
    visualVariant: DamageZoneVisualStyle = 'spore',
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
      baseDamageMult,
      visualVariant,
      followOwner: false,
      x,
      y,
      createdAt: now,
      lastTickAt: now,
      afterCloudDurationMs: 0,
      afterCloudRadiusFactor: 0,
      afterCloudDamageFactor: 0,
    });
  }

  /**
   * Host-only: Tick-Update der Stinkwolken.
   * Gibt Damage-Ereignisse und Netzwerk-Snapshots zurück.
   * playerLookup liefert Position/Status/Farbe pro Spieler-ID.
   */
  hostUpdate(
    now: number,
    ownerLookup: (id: string) => StinkCloudPlayerInfo | null,
  ): { synced: SyncedStinkCloud[]; damageEvents: StinkCloudDamageEvent[] } {
    const synced:       SyncedStinkCloud[]       = [];
    const damageEvents: StinkCloudDamageEvent[]  = [];

    for (let i = this.activeZones.length - 1; i >= 0; i--) {
      const zone = this.activeZones[i];
      const info = ownerLookup(zone.ownerId);

      if (zone.followOwner) {
        // Deaktivierung: Spieler tot, eingebuddelt, oder nicht mehr vorhanden
        if (!info || !info.alive || info.burrowed) {
          this.endZoneAt(i, 'owner_inactive');
          continue;
        }
        zone.x = info.x;
        zone.y = info.y;
        zone.ownerColor = info.color;
      }

      // Duration abgelaufen
      const elapsed = now - zone.createdAt;
      if (elapsed >= zone.duration) {
        this.endZoneAt(i, 'natural');
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
          baseDamageMult:  zone.baseDamageMult,
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
        this.endZoneAt(i, 'cleanup');
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
      const visualVariant = cloud.visualVariant ?? 'stink';
      if (visual && visual.visualVariant !== visualVariant) {
        this.destroyVisual(visual);
        this.visuals.delete(cloud.id);
        visual = undefined;
      }
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
    for (let i = this.activeZones.length - 1; i >= 0; i--) {
      this.endZoneAt(i, 'cleanup');
    }
    this.syncVisuals([]);
  }

  private endZoneAt(index: number, reason: StinkCloudEndReason): void {
    const [zone] = this.activeZones.splice(index, 1);
    if (!zone || reason !== 'natural' || !zone.followOwner || zone.afterCloudDurationMs <= 0) return;
    this.hostCreateStationaryCloud(
      zone.ownerId,
      zone.ownerColor,
      zone.x,
      zone.y,
      zone.radius * zone.afterCloudRadiusFactor,
      zone.afterCloudDurationMs,
      zone.damagePerTick * zone.afterCloudDamageFactor,
      zone.tickInterval,
      zone.rockDamageMult,
      zone.trainDamageMult,
      zone.baseDamageMult,
      'stink',
    );
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
    const isVoidSpore = cloud.visualVariant === 'spore_void';
    const isSpore = cloud.visualVariant === 'spore' || isVoidSpore;
    const isElectric = cloud.visualVariant === 'electric';

    const groundGlow = this.scene.add.image(cloud.x, cloud.y, TEX_STINK_GROUND)
      .setDepth(STINK_DEPTH - 0.12)
      .setTint(isElectric ? ELEC_GROUND : isVoidSpore ? VOID_SPORE_GROUND : isSpore ? 0x5b3818 : TINT_GROUND_GLOW)
      // Elektrofeld glüht additiv statt den Boden abzudunkeln.
      .setBlendMode(isElectric || isVoidSpore ? Phaser.BlendModes.ADD : Phaser.BlendModes.MULTIPLY)
      .setAlpha(isElectric ? 0.22 : 0.26);

    const damageAura = this.scene.add.image(cloud.x, cloud.y, TEX_STINK_GROUND)
      .setDepth(STINK_DEPTH - 0.08)
      .setTint(isElectric ? ELEC_DAMAGE : isVoidSpore ? VOID_SPORE_DAMAGE : isSpore ? 0xc7d85a : TINT_DAMAGE_GLOW)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.18);

    const reactionPulse = this.scene.add.image(cloud.x, cloud.y, TEX_STINK_GROUND)
      .setDepth(STINK_DEPTH - 0.04)
      .setTint(isElectric ? ELEC_REACTION : isVoidSpore ? VOID_SPORE_REACTION : isSpore ? 0xf0e68c : TINT_CHEM_CYAN)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0);

    /* ── Container for volumetric haze + blobs ── */
    const container = this.scene.add.container(cloud.x, cloud.y).setDepth(STINK_DEPTH);

    const hazes: StinkHazeLayer[] = HAZE_TEMPLATES.map((tmpl, index) => {
      const img = this.scene.add.image(0, 0, TEX_STINK_HAZE)
        .setOrigin(0.5)
        .setTint(isElectric ? ELEC_HAZE : isVoidSpore ? VOID_SPORE_HAZE[index % VOID_SPORE_HAZE.length] : tmpl.tint)
        .setBlendMode(isElectric || isVoidSpore || tmpl.tint === TINT_CHEM_BLUE ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      container.add(img);
      return { image: img, template: tmpl, phase: Math.random() * Math.PI * 2 };
    });

    const outerGlow = this.scene.add.image(0, 0, TEX_STINK_HAZE)
      .setOrigin(0.5)
      .setTint(isElectric ? ELEC_OUTER : isVoidSpore ? VOID_SPORE_OUTER : isSpore ? 0xf6c14d : TINT_CHEM_BLUE)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.2);
    container.add(outerGlow);

    const neonCore = this.scene.add.image(0, 0, TEX_STINK_HAZE)
      .setOrigin(0.5)
      .setTint(isElectric ? ELEC_CORE : isVoidSpore ? VOID_SPORE_CORE : isSpore ? 0xf0e97f : TINT_ACID)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setAlpha(0.26);
    container.add(neonCore);

    const blobs: StinkBlob[] = BLOB_TEMPLATES.map((tmpl, index) => {
      const elecTint = ELEC_BLOB[index % ELEC_BLOB.length];
      const img = this.scene.add.image(0, 0, TEX_STINK_BLOB)
        .setOrigin(0.5)
        .setTint(isElectric ? elecTint : isVoidSpore ? VOID_SPORE_BLOB[index % VOID_SPORE_BLOB.length] : tmpl.tint)
        .setBlendMode(isElectric || isVoidSpore || tmpl.tint === TINT_CHEM_BLUE || tmpl.tint === TINT_CHEM_CYAN ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
      container.add(img);
      return { image: img, template: tmpl, phase: Math.random() * Math.PI * 2 };
    });

    /* ── Kontinuierliche Partikel (inner/plume/accent/edge) auf geteilten GPU-Layern ── */
    this.gpuParticles?.registerCloud(
      cloud.id,
      cloud.visualVariant ?? 'stink',
      PARTICLE_TINTS[cloud.visualVariant ?? 'stink'],
    );

    /* ── Fairness circle: readable, still organic ── */
    const fairnessCircle = this.scene.add.graphics()
      .setDepth(STINK_DEPTH + 0.1)
      .setBlendMode(Phaser.BlendModes.ADD);
    registerGraphicsObject(this.scene, 'stinkCloudGraphics', fairnessCircle);
    this.drawFairnessCircle(fairnessCircle, cloud.x, cloud.y, r, cloud.ownerColor, 0, 0, cloud.visualVariant);

    this.playSpawnBurst(cloud.x, cloud.y, r, cloud.visualVariant);

    return {
      groundGlow,
      damageAura,
      reactionPulse,
      container,
      hazes,
      blobs,
      neonCore,
      outerGlow,
      fairnessCircle,
      visualVariant: cloud.visualVariant ?? 'stink',
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
    const isSpore = cloud.visualVariant === 'spore' || cloud.visualVariant === 'spore_void';
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

    /* ── Kontinuierliche Partikel: nur den Wolkenzustand nachfuehren ── */
    // Neue Puffs entstehen an der aktuellen interpolierten Position; bereits gespawnte Member
    // laufen rein GPU-seitig weiter und bleiben bei bewegten Wolken bewusst in Weltkoordinaten
    // zurueck. Das ist billiger als eine Member-Aktualisierung pro Frame und faellt bei
    // Gaswolken kaum auf. Wolkenbild, Fairness-Radius und Licht folgen weiterhin exakt.
    this.gpuParticles?.syncCloud(cloud.id, x, y, radius, alpha, pulseWave, visible);

    /* ── Fairness circle ── */
    this.drawFairnessCircle(visual.fairnessCircle, x, y, radius, cloud.ownerColor, alpha, t, cloud.visualVariant);

    /* ── Dynamisches Licht der Fläche ── */
    this.syncCloudLight(cloud, x, y, radius, alpha);
  }

  /**
   * Eine Schadenszone leuchtet in ihrer Wolkenfarbe. Der Boden unter einer Sporen- oder
   * Stinkwolke soll auch ohne andere Lichtquelle als betroffen erkennbar sein; das
   * Elektrofeld pulst zusätzlich. Die Intensität folgt der Ein-/Ausblendung der Wolke.
   */
  private syncCloudLight(cloud: SyncedStinkCloud, x: number, y: number, radius: number, alpha: number): void {
    const lighting = this.lighting;
    if (!lighting) return;

    const key = `stinkcloud:${cloud.id}`;
    if (alpha <= 0.02) {
      lighting.releaseLight(key);
      return;
    }

    const spec = CLOUD_LIGHT[cloud.visualVariant ?? 'stink'] ?? CLOUD_LIGHT.stink;
    lighting.setLight(key, spec.preset, x, y, {
      radiusPx: Math.max(radius * spec.radiusScale, 60),
      color: spec.color,
      intensity: spec.intensity * alpha,
    });
  }

  private drawFairnessCircle(
    gfx: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    color: number,
    alpha: number,
    time: number,
    variant: DamageZoneVisualStyle = 'stink',
  ): void {
    gfx.clear();
    if (alpha < 0.01) return;

    if (variant === 'electric') {
      this.drawElectricField(gfx, x, y, radius, color, alpha, time);
      return;
    }

    const isVoidSpore = variant === 'spore_void';
    const isSpore = variant === 'spore' || isVoidSpore;
    const fairnessColor = isVoidSpore ? VOID_FIRE_COLOR : color;
    gfx.lineStyle(2.2, isVoidSpore ? VOID_SPORE_REACTION : isSpore ? 0xf2dc76 : TINT_RIM_GLOW, 0.03 * alpha);
    gfx.strokeCircle(x, y, radius);

    gfx.lineStyle(1.8, isVoidSpore ? VOID_SPORE_CORE : isSpore ? 0xe4a94d : TINT_CHEM_BLUE, 0.035 * alpha);
    gfx.strokeCircle(x, y, radius * 1.01);

    gfx.lineStyle(1.2, fairnessColor, 0.22 * alpha);
    gfx.strokeCircle(x, y, radius);

    gfx.lineStyle(0.8, isVoidSpore ? VOID_FIRE_COLOR : isSpore ? 0xf4e6a3 : TINT_SULFUR, 0.08 * alpha);
    gfx.strokeCircle(x, y, radius * 0.93);

    for (let i = 0; i < 4; i++) {
      const span = 0.48 + Math.sin(time * 0.55 + i) * 0.08;
      const center = time * 0.24 + i * (Math.PI / 2) + Math.sin(time * 0.4 + i * 1.7) * 0.18;
      const arcRadius = radius * (0.96 + Math.sin(time * 0.8 + i) * 0.015);
      gfx.lineStyle(1.2, i % 2 === 0
        ? (isVoidSpore ? VOID_SPORE_REACTION : isSpore ? 0xf2dc76 : TINT_RIM_GLOW)
        : (isVoidSpore ? VOID_SPORE_CORE : isSpore ? 0xe4a94d : TINT_CHEM_CYAN), 0.04 * alpha);
      gfx.beginPath();
      gfx.arc(x, y, arcRadius, center - span * 0.5, center + span * 0.5, false);
      gfx.strokePath();
    }
  }

  /**
   * Elektrisierte Fläche (ASMD): blaue Boundary plus flackernde Blitze, die vom
   * Zentrum nach außen zucken – passend zum Look des ASMD-Balls.
   */
  private drawElectricField(
    gfx: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    color: number,
    alpha: number,
    time: number,
  ): void {
    // Boundary-Ringe (lesbarer Radius)
    gfx.lineStyle(2.4, ELEC_ARC, 0.10 * alpha);
    gfx.strokeCircle(x, y, radius);
    gfx.lineStyle(1.4, color, 0.22 * alpha);
    gfx.strokeCircle(x, y, radius);
    gfx.lineStyle(1.0, ELEC_ARC_BRIGHT, 0.06 * alpha);
    gfx.strokeCircle(x, y, radius * 0.96);

    // Flackernde Blitze – Anzahl/Position variieren pro Frame.
    const boltCount = 5;
    for (let i = 0; i < boltCount; i++) {
      const baseAngle = time * 0.6 + i * (Math.PI * 2 / boltCount);
      const angle = baseAngle + Math.sin(time * 3.1 + i * 1.7) * 0.5;
      const reach = radius * Phaser.Math.FloatBetween(0.55, 0.98);
      const segments = 4;
      const points: Array<{ x: number; y: number }> = [{ x, y }];
      for (let s = 1; s <= segments; s++) {
        const frac = s / segments;
        const jitter = radius * 0.16 * (1 - frac);
        const px = x + Math.cos(angle) * reach * frac + Phaser.Math.FloatBetween(-jitter, jitter);
        const py = y + Math.sin(angle) * reach * frac + Phaser.Math.FloatBetween(-jitter, jitter);
        points.push({ x: px, y: py });
      }

      gfx.lineStyle(2.0, ELEC_ARC, 0.22 * alpha);
      gfx.beginPath();
      gfx.moveTo(points[0].x, points[0].y);
      for (let s = 1; s < points.length; s++) gfx.lineTo(points[s].x, points[s].y);
      gfx.strokePath();

      gfx.lineStyle(1.0, ELEC_ARC_BRIGHT, 0.5 * alpha);
      gfx.beginPath();
      gfx.moveTo(points[0].x, points[0].y);
      for (let s = 1; s < points.length; s++) gfx.lineTo(points[s].x, points[s].y);
      gfx.strokePath();
    }
  }

  private playSpawnBurst(
    x: number,
    y: number,
    radius: number,
    variant: DamageZoneVisualStyle = 'stink',
  ): void {
    const isElectric = variant === 'electric';
    const isVoidSpore = variant === 'spore_void';
    const burstEmitter = this.scene.add.particles(x, y, TEX_STINK_PUFF, {
      lifespan:  { min: 700, max: 2400 },
      quantity:  1,
      speedX:    { min: -95, max: 95 },
      speedY:    { min: -95, max: 95 },
      scale:     { start: 0.22, end: 0.78 },
      alpha:     { start: 0.34, end: 0 },
      tint:      isElectric ? [...ELEC_EDGE] : isVoidSpore ? [...VOID_SPORE_EDGE] : [TINT_ACID, TINT_CHEM_CYAN, TINT_SULFUR],
      rotate:    { min: 0, max: 360 },
      emitting:  false,
      blendMode: Phaser.BlendModes.ADD,
    });
    registerParticleEmitter(this.scene, 'stinkCloudBurst', burstEmitter);
    burstEmitter.setDepth(STINK_DEPTH + 0.05);
    burstEmitter.addEmitZone(edgeZone(Math.max(radius * 0.72, 12), 64));
    const burstCount = Math.max(32, Math.round(radius * 0.22));
    burstEmitter.explode(burstCount);
    recordParticleSpawn(this.scene, 'stinkCloudBurst', burstCount);

    const flash = this.scene.add.image(x, y, TEX_STINK_GROUND)
      .setDepth(STINK_DEPTH + 0.03)
      .setTint(isElectric ? ELEC_DAMAGE : isVoidSpore ? VOID_SPORE_DAMAGE : TINT_DAMAGE_GLOW)
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
    this.lighting?.releaseLight(`stinkcloud:${visual.lastCloud.id}`);
    visual.groundGlow.destroy();
    visual.damageAura.destroy();
    visual.reactionPulse.destroy();
    this.gpuParticles?.releaseCloud(visual.lastCloud.id);
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

  /**
   * Die Partikeltextur liegt im gemeinsamen GPU-VFX-Modul: der Atlas blittet sie, der klassische
   * Spawn-Burst-Emitter benutzt sie weiterhin einzeln.
   */
  private generatePuffTexture(): void {
    ensureStinkPuffTexture(this.scene);
  }
}
