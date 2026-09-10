import { StinkPlagueRenderer } from './StinkPlagueRenderer';
import type { PlagueApplication } from '../systems/StinkPlagueRuntime';
import * as Phaser from 'phaser';
import { DEPTH, VOID_FIRE_COLOR } from '../config';
import { ensureCanvasTexture, recordGraphicsWork, registerGraphicsObject } from './EffectUtils';
import type { DamageZoneVisualStyle, SyncedStinkCloud } from '../types';
import type { LightingSystem } from './LightingSystem';
import type { LightPresetKey } from './LightingConfig';
import { StinkCloudBody } from './StinkCloudBody';
import { ensureStinkPuffTexture } from './gpu/GpuVfxSourceTextures';
import { getVisibleWorldView } from '../ui/HostileBaseIndicator';
import type { GpuVfxSystem } from './gpu/GpuVfxSystem';
import { StinkCloudGpuParticles, type StinkCloudParticleTints } from './StinkCloudGpuParticles';

/* ── Texture keys ─────────────────────────────────────── */
const TEX_STINK_GROUND = 'stink_ground';
const GROUND_SIZE = 256;

/* ── Visual constants ──────────────────────────────────── */
const FADE_IN_MS  = 300;
const FADE_OUT_MS = 500;
const REF_RADIUS  = 180;
const STINK_DEPTH = DEPTH.STINK; // between FIRE (16) and SMOKE (18)

/* ── Stink cloud tint palette ─────────────────────────── */
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
const VOID_SPORE_CORE = 0xd887ff;
const VOID_SPORE_PARTICLE = [0xf2c8ff, 0xd477ff, VOID_FIRE_COLOR] as const;
const VOID_SPORE_EDGE = [0xf4d4ff, 0xd887ff, VOID_FIRE_COLOR] as const;

/* ── Electric (ASMD) variant palette ─────────────────────── */
const ELEC_GROUND     = 0x0d2b45;
const ELEC_DAMAGE     = 0x4fc3ff;
const ELEC_REACTION   = 0xcdefff;
const ELEC_PARTICLE   = [0x9fe8ff, 0x4fc3ff, 0xffffff] as const;
const ELEC_EDGE       = [0xcdefff, 0x9fe8ff, 0xffffff] as const;
const ELEC_ARC        = 0xbdefff;
const ELEC_ARC_BRIGHT = 0xffffff;

/* ── Damage event (returned to host for WorldCombatCore processing) ── */
export interface StinkCloudDamageEvent {
  readonly cloudId: number;
  readonly kind: 'player-primary' | 'enemy-aura' | 'stationary';
  readonly plague?: PlagueApplication;
  readonly tickAt: number;
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
  kind: 'player-primary' | 'enemy-aura' | 'stationary';
  plague?: PlagueApplication;
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

/* ── Visual representation (all clients) ── */
interface StinkCloudVisual {
  groundGlow:      Phaser.GameObjects.Image;
  damageAura:      Phaser.GameObjects.Image;
  reactionPulse:   Phaser.GameObjects.Image;
  body: StinkCloudBody;
  electricArcs: Phaser.GameObjects.Graphics | null;
  visualVariant:  DamageZoneVisualStyle;
  birthTime:      number;
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
  private readonly plagueRenderer: StinkPlagueRenderer;
  clearPlagueVisuals(): void { this.plagueRenderer.clear(); }
  syncPlagueVisuals(snapshot: import('../systems/StinkPlagueRuntime').StinkPlagueSnapshot, now: number,
    lookup: (id: string) => import('./SmokeBodyEffect').EntityStatusVisualTarget | null): void {
    this.plagueRenderer.sync(snapshot, now, lookup);
  }
  private hostNow = 0;
  private primaryCloudEnd: ((cloudId: number, ownerId: string, endedAt: number) => void) | null = null;

  setPrimaryCloudEndHandler(handler: typeof this.primaryCloudEnd): void { this.primaryCloudEnd = handler; }
  private readonly activeZones: ActiveStinkCloud[] = [];
  private readonly visuals = new Map<number, StinkCloudVisual>();
  private nextId = 0;
  private lighting: LightingSystem | null = null;
  private gpuParticles: StinkCloudGpuParticles | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.ensureTextures();
    this.plagueRenderer = new StinkPlagueRenderer(scene);
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
    now = this.hostNow,
    plague?: PlagueApplication,
    kind: 'player-primary' | 'enemy-aura' = 'enemy-aura',
  ): number {
    this.hostNow = now;
    const id = this.nextId++;
    this.activeZones.push({
      kind,
      plague,
      id,
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
      lastTickAt: kind === 'player-primary' ? now - tickInterval : now,
      afterCloudDurationMs,
      afterCloudRadiusFactor,
      afterCloudDamageFactor,
    });
    return id;
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
    now = this.hostNow,
  ): void {
    this.hostNow = now;
    this.activeZones.push({
      kind: 'stationary',
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
    this.hostNow = now;
    const synced:       SyncedStinkCloud[]       = [];
    const damageEvents: StinkCloudDamageEvent[]  = [];

    for (let i = this.activeZones.length - 1; i >= 0; i--) {
      const zone = this.activeZones[i];
      const info = ownerLookup(zone.ownerId);

      if (zone.followOwner) {
        // Deaktivierung: Spieler tot, eingebuddelt, oder nicht mehr vorhanden
        if (!info || !info.alive || info.burrowed) {
          this.endZoneAt(i, 'owner_inactive', now);
          continue;
        }
        zone.x = info.x;
        zone.y = info.y;
        zone.ownerColor = info.color;
      }

      const elapsed = now - zone.createdAt;

      // Damage-Tick
      while (now - zone.lastTickAt >= zone.tickInterval
        && zone.lastTickAt + zone.tickInterval < zone.createdAt + zone.duration) {
        zone.lastTickAt += zone.tickInterval;
        damageEvents.push({
          cloudId: zone.id, kind: zone.kind, plague: zone.plague, tickAt: zone.lastTickAt,
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

      if (elapsed >= zone.duration) {
        this.endZoneAt(i, 'natural', zone.createdAt + zone.duration);
        continue;
      }
      // Snapshot für Netzwerk
      synced.push({
        id:         zone.id,
        ownerId:    zone.ownerId,
        followOwner: zone.followOwner,
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
  hostDeactivateForPlayer(playerId: string, now = this.hostNow): void {
    for (let i = this.activeZones.length - 1; i >= 0; i--) {
      if (this.activeZones[i].ownerId === playerId) {
        this.endZoneAt(i, 'owner_inactive', now);
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
        visual.lastCloud = cloud;
      }
      // Snapshot position is the fallback until the presentation frame resolves the owner pose.
      this.updateVisual(visual, cloud.x, cloud.y, cloud);
    }
  }

  /** Follow the already rendered owner pose, without a second interpolation delay. */
  clientUpdate(delta: number, ownerPose?: (id: string) => { x: number; y: number } | null): void {
    this.plagueRenderer.update(delta);
    for (const visual of this.visuals.values()) {
      const cloud = visual.lastCloud;
      const pose = cloud.followOwner ? ownerPose?.(cloud.ownerId) : null;
      this.updateVisual(visual, pose?.x ?? cloud.x, pose?.y ?? cloud.y, cloud);
    }
  }

  destroyAll(): void {
    this.plagueRenderer.clear();
    for (let i = this.activeZones.length - 1; i >= 0; i--) {
      this.endZoneAt(i, 'cleanup');
    }
    this.syncVisuals([]);
  }

  private endZoneAt(index: number, reason: StinkCloudEndReason, endedAt = this.hostNow): void {
    const [zone] = this.activeZones.splice(index, 1);
    if (zone?.kind === 'player-primary' && reason !== 'cleanup') this.primaryCloudEnd?.(zone.id, zone.ownerId, endedAt);
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

    const body = new StinkCloudBody(this.scene, cloud.id, cloud.visualVariant ?? 'stink');

    /* ── Kontinuierliche Partikel (inner/plume/accent/edge) auf geteilten GPU-Layern ── */
    this.gpuParticles?.registerCloud(
      cloud.id,
      cloud.visualVariant ?? 'stink',
      PARTICLE_TINTS[cloud.visualVariant ?? 'stink'],
    );

    const electricArcs = isElectric ? this.scene.add.graphics()
      .setDepth(STINK_DEPTH + 0.1).setBlendMode(Phaser.BlendModes.ADD) : null;
    if (electricArcs) registerGraphicsObject(this.scene, 'stinkCloudGraphics', electricArcs);

    this.gpuParticles?.queueSpawnBurst(cloud.id);

    return {
      groundGlow,
      damageAura,
      reactionPulse,
      body,
      electricArcs,
      visualVariant: cloud.visualVariant ?? 'stink',
      birthTime:   this.scene.time.now,
      lastCloud:   cloud,
    };
  }

  // ── Visual Update ─────────────────────────────────────────────────────────

  private updateVisual(visual: StinkCloudVisual, x: number, y: number, cloud: SyncedStinkCloud): void {
    const radius = Math.max(cloud.radius, 0);
    const alpha  = Phaser.Math.Clamp(cloud.alpha, 0, 1);
    const t      = (this.scene.time.now - visual.birthTime) * 0.001;
    const rScale = radius / REF_RADIUS;
    const isSpore = cloud.visualVariant === 'spore' || cloud.visualVariant === 'spore_void';
    const view = getVisibleWorldView(this.scene.cameras.main);
    const visible = alpha > 0.01 && radius > 0
      && x + radius >= view.x && y + radius >= view.y
      && x - radius <= view.x + view.width && y - radius <= view.y + view.height;
    const pulseWave = Phaser.Math.Clamp(Math.pow((Math.sin(t * 2.8 + 0.8) + 1) * 0.5, 6), 0, 1);
    const damagePulse = Phaser.Math.Clamp(Math.pow((Math.sin(t * 1.7 - 0.4) + 1) * 0.5, 2.2), 0, 1);

    /* ── Shared GPU body and supporting light layers ── */
    visual.body.update(x, y, radius, alpha, visible);
    visual.electricArcs?.setVisible(visible);

    visual.groundGlow
      .setPosition(x, y)
      .setVisible(visible)
      .setScale(1.52 * rScale, 1.42 * rScale)
      .setAlpha((isSpore ? 0.07 : 0.09 + damagePulse * 0.02) * alpha)
      .setRotation(Math.sin(t * 0.11) * 0.08);

    visual.damageAura
      .setPosition(x, y)
      .setVisible(visible)
      .setScale(1.06 * rScale * (1 + damagePulse * 0.035), 1.02 * rScale * (1 + damagePulse * 0.028))
      .setAlpha((isSpore ? 0.04 + damagePulse * 0.02 : 0.05 + damagePulse * 0.025) * alpha)
      .setRotation(Math.cos(t * 0.16) * 0.05);

    visual.reactionPulse
      .setPosition(x, y - radius * 0.02)
      .setVisible(visible)
      .setScale((0.54 + pulseWave * 0.38) * rScale, (0.5 + pulseWave * 0.34) * rScale)
      .setAlpha((pulseWave * (isSpore ? 0.03 : 0.04)) * alpha)
      .setRotation(Math.sin(t * 0.35 + 0.6) * 0.14);

    /* ── Kontinuierliche Partikel: nur den Wolkenzustand nachfuehren ── */
    // Neue Puffs entstehen an der aktuellen interpolierten Position; bereits gespawnte Member
    // laufen rein GPU-seitig weiter und bleiben bei bewegten Wolken bewusst in Weltkoordinaten
    // zurueck. Das ist billiger als eine Member-Aktualisierung pro Frame und faellt bei
    // Gaswolken kaum auf. Wolkenbild und Licht folgen weiterhin exakt.
    this.gpuParticles?.syncCloud(cloud.id, x, y, radius, alpha, pulseWave, visible);

    if (visible && visual.electricArcs) this.drawElectricField(visual.electricArcs, x, y, radius, alpha, t);

    /* ── Dynamisches Licht der Fläche ── */
    this.syncCloudLight(cloud, x, y, radius, visible ? alpha : 0);
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

  /** ASMD field arcs retain their identity without an explicit radius outline. */
  private drawElectricField(
    gfx: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    radius: number,
    alpha: number,
    time: number,
  ): void {
    gfx.clear();
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

  // ── Visual Destruction ──────────────────────────────────────────────────

  private destroyVisual(visual: StinkCloudVisual): void {
    this.lighting?.releaseLight(`stinkcloud:${visual.lastCloud.id}`);
    visual.groundGlow.destroy();
    visual.damageAura.destroy();
    visual.reactionPulse.destroy();
    this.gpuParticles?.releaseCloud(visual.lastCloud.id);
    visual.body.destroy();
    visual.electricArcs?.destroy();
  }

  // ── Texture Generation ──────────────────────────────────────────────────

  private ensureTextures(): void {
    this.generateGroundTexture();
    // Body marks in StinkPlagueRenderer still use this independently of the cloud GPU backend.
    ensureStinkPuffTexture(this.scene);
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

}
