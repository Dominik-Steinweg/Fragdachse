import * as Phaser from 'phaser';
import { DEPTH, MUZZLE_PROJECTILE_FALLBACK_BACKTRACK, getTopDownMuzzleOrigin, getTopDownMuzzleOriginFromVector } from '../config';
import type { ShadowProjectileSample } from '../effects/ShadowConfig';
import type { BulletVisualPreset, GrenadeVisualPreset, TrackedProjectile, SyncedProjectile, ExplodedGrenade, ExplodedProjectile, ProjectileSpawnConfig, ProjectileHomingConfig, HomingTargetType, EnergyBallVariant, ProjectileStyle } from '../types';
import type { GameAudioSystem } from '../audio/GameAudioSystem';
import type { BulletRenderer }  from '../effects/BulletRenderer';
import type { FlameRenderer }   from '../effects/FlameRenderer';
import type { BfgRenderer }     from '../effects/BfgRenderer';
import type { EnergyBallRenderer } from '../effects/EnergyBallRenderer';
import type { GaussRenderer }   from '../effects/GaussRenderer';
import type { GrenadeRenderer } from '../effects/GrenadeRenderer';
import type { HydraRenderer } from '../effects/HydraRenderer';
import type { HolyGrenadeRenderer } from '../effects/HolyGrenadeRenderer';
import type { MuzzleFlashRenderer } from '../effects/MuzzleFlashRenderer';
import type { RocketRenderer }  from '../effects/RocketRenderer';
import type { SporeRenderer }  from '../effects/SporeRenderer';
import type { TracerRenderer }  from '../effects/TracerRenderer';

/** Minimale Body-Länge (px) entlang der Flugrichtung – Anti-Tunneling. */
const MIN_BODY_LEN = 10;

/** Client-seitiger Projektil-State für Extrapolation zwischen Netzwerk-Ticks. */
interface ClientProjectileState {
  serverX: number;
  serverY: number;
  vx: number;
  vy: number;
  size: number;
  color: number;
  receivedAt: number;
  style?: string;
  bulletVisualPreset?: BulletVisualPreset;
  grenadeVisualPreset?: GrenadeVisualPreset;
  energyBallVariant?: EnergyBallVariant;
  ownerColor?: number;
  // Flammenwerfer-Decay: velocity nimmt exponentiell ab
  isFlame: boolean;
}

interface HomingTargetCandidate {
  id: string;
  type: HomingTargetType;
  x: number;
  y: number;
}

const DEFAULT_HOMING_TARGET_TYPES: readonly HomingTargetType[] = ['players'];

function resolveBulletVisualPreset(style?: string, preset?: BulletVisualPreset): BulletVisualPreset {
  if (preset) return preset;
  if (style === 'gauss') return 'gauss';
  return style === 'awp' ? 'awp' : 'default';
}

export class ProjectileManager {
  private scene:       Phaser.Scene;
  private projectiles: TrackedProjectile[] = [];        // Host: Physik-Projektile
  private clientVisuals = new Map<number, Phaser.GameObjects.Shape>(); // Client: Visuals (ball-Stil)
  private nextId        = 0;
  private readonly scratchPoints: Phaser.Math.Vector2[] = [];

  // ── Client-Extrapolation ──────────────────────────────────────────────────
  private clientProjStates = new Map<number, ClientProjectileState>();

  // ── Bullet-Renderer (Enhanced Bullet Visuals) ─────────────────────────────
  private bulletRenderer: BulletRenderer | null = null;

  // ── Flame-Renderer (Flammenwerfer-Partikel) ───────────────────────────────
  private flameRenderer: FlameRenderer | null = null;

  // ── BFG-Renderer (BFG-Partikel) ─────────────────────────────────────────
  private bfgRenderer: BfgRenderer | null = null;

  // ── Energy-Ball-Renderer (ASMD Secondary) ───────────────────────────────
  private energyBallRenderer: EnergyBallRenderer | null = null;

  // ── Hydra-Renderer (split-bounce energy projectile) ─────────────────────
  private hydraRenderer: HydraRenderer | null = null;

  // ── Gauss-Renderer (elektrische Overlay-Visuals) ───────────────────────
  private gaussRenderer: GaussRenderer | null = null;

  // ── Grenade-Renderer (HE/Smoke/Molotov) ────────────────────────────────
  private grenadeRenderer: GrenadeRenderer | null = null;

  // ── Holy-Grenade-Renderer (goldene Granate mit Kreuzstift) ─────────────
  private holyGrenadeRenderer: HolyGrenadeRenderer | null = null;

  // ── Rocket-Renderer (Raketenkörper + Rauchspur) ────────────────────────
  private rocketRenderer: RocketRenderer | null = null;

  // ── Spore-Renderer (organische Cluster + toxische Spur) ────────────────
  private sporeRenderer: SporeRenderer | null = null;

  // ── Translocator-Puck-Renderer ──────────────────────────────────────────
  private translocatorPuckRenderer: import('../effects/TranslocatorPuckRenderer').TranslocatorPuckRenderer | null = null;


  // ── Tracer-Renderer (data-driven Leuchtlinien, alle Projektilstile) ───────
  private tracerRenderer: TracerRenderer | null = null;

  // ── MuzzleFlash-Renderer (lokales Schuss-Feedback, kein Netzstate) ───────
  private muzzleFlashRenderer: MuzzleFlashRenderer | null = null;
  private audioSystem: GameAudioSystem | null = null;
  private ownerPositionProvider: ((ownerId: string) => { x: number; y: number } | null) | null = null;

  // ── BFG Laser-Callback (Host-only, injiziert von ArenaScene) ────────────
  private bfgLaserCallback: ((proj: TrackedProjectile) => void) | null = null;

  // ── Homing-Zielsuche (Host-only, injiziert von ArenaScene) ──────────────
  private homingTargetProvider: ((config: ProjectileHomingConfig, ownerId: string) => HomingTargetCandidate[]) | null = null;
  private homingLineOfSightChecker: ((sx: number, sy: number, ex: number, ey: number) => boolean) | null = null;

  // ── Host: gepufferte Explosionen explosiver Projektile ──────────────────
  private pendingProjectileExplosions: ExplodedProjectile[] = [];
  private projectileImpactCallback: ((proj: TrackedProjectile, x: number, y: number) => void) | null = null;

  // ── Obstacle-Gruppen (werden nach Arena-Aufbau injiziert) ─────────────────
  private rockGroup:   Phaser.Physics.Arcade.StaticGroup | null = null;
  private rockObjects: (Phaser.GameObjects.Image | null)[] | null = null;
  private trunkGroup:  Phaser.Physics.Arcade.StaticGroup | null = null;
  private onRockHit:   ((rockId: number, damage: number, attackerId: string) => void) | null = null;

  // ── Zug-Kollision ─────────────────────────────────────────────────────────
  private trainGroup:  Phaser.Physics.Arcade.StaticGroup | null = null;
  private onTrainHit:  ((damage: number, attackerId: string) => void) | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  // ── Gruppen injizieren (nach buildDynamic) ─────────────────────────────────

  /**
   * Setzt die Kollisions-Gruppen für Felsen und Trunks.
   * Wird nach Arena-Aufbau aufgerufen; bei null (Lobby-Teardown) alles leeren.
   */
  setRockGroup(
    group:      Phaser.Physics.Arcade.StaticGroup | null,
    objects:    (Phaser.GameObjects.Image | null)[] | null,
    trunkGroup: Phaser.Physics.Arcade.StaticGroup | null,
  ): void {
    this.rockGroup   = group;
    this.rockObjects = objects;
    this.trunkGroup  = trunkGroup;
  }

  /**
   * Registriert einen Callback, der bei jedem Projektil-Felsen-Treffer (Host)
   * aufgerufen wird. Gibt den Index in layout.rocks[] weiter.
   */
  setRockHitCallback(cb: (rockId: number, damage: number, attackerId: string) => void): void {
    this.onRockHit = cb;
  }

  /**
   * Setzt die StaticGroup des Zugs für Projektil-Kollision (Host-only).
   * null = kein Zug aktiv (deaktiviert die Kollision).
   */
  setTrainGroup(group: Phaser.Physics.Arcade.StaticGroup | null): void {
    this.trainGroup = group;
  }

  /**
   * Registriert einen Callback, der bei jedem Projektil-Zug-Treffer aufgerufen wird.
   * null = kein Handler (deaktiviert den Callback ohne die Kollision zu entfernen).
   */
  setTrainHitCallback(cb: ((damage: number, attackerId: string) => void) | null): void {
    this.onTrainHit = cb;
  }

  /**
   * Injiziert den BulletRenderer für verbesserte Bullet-Darstellung.
   * null = deaktiviert (Fallback auf einfache Shapes).
   */
  setBulletRenderer(renderer: BulletRenderer | null): void {
    this.bulletRenderer = renderer;
  }

  /**
   * Injiziert den FlameRenderer für Flammenwerfer-Darstellung.
   * null = deaktiviert.
   */
  setFlameRenderer(renderer: FlameRenderer | null): void {
    this.flameRenderer = renderer;
  }

  /** Injiziert den BfgRenderer für BFG-Projektil-Darstellung. */
  setBfgRenderer(renderer: BfgRenderer | null): void {
    this.bfgRenderer = renderer;
  }

  /** Injiziert den EnergyBallRenderer fuer ASMD-Energieprojektile. */
  setEnergyBallRenderer(renderer: EnergyBallRenderer | null): void {
    this.energyBallRenderer = renderer;
  }

  /** Injiziert den HydraRenderer fuer Hydra-Projektile. */
  setHydraRenderer(renderer: HydraRenderer | null): void {
    this.hydraRenderer = renderer;
  }

  /** Injiziert den GaussRenderer fuer elektrische Projektil-Overlays. */
  setGaussRenderer(renderer: GaussRenderer | null): void {
    this.gaussRenderer = renderer;
  }

  /** Injiziert den GrenadeRenderer fuer klassische Granaten. */
  setGrenadeRenderer(renderer: GrenadeRenderer | null): void {
    this.grenadeRenderer = renderer;
  }

  /** Injiziert den HolyGrenadeRenderer fuer die Heilige Handgranate. */
  setHolyGrenadeRenderer(renderer: HolyGrenadeRenderer | null): void {
    this.holyGrenadeRenderer = renderer;
  }

  /** Injiziert den RocketRenderer fuer Raketen-Visualisierung. */
  setRocketRenderer(renderer: RocketRenderer | null): void {
    this.rocketRenderer = renderer;
  }

  /** Injiziert den SporeRenderer fuer Sporen-Projektile. */
  setSporeRenderer(renderer: SporeRenderer | null): void {
    this.sporeRenderer = renderer;
  }

  /** Injiziert den TranslocatorPuckRenderer. */
  setTranslocatorPuckRenderer(renderer: import('../effects/TranslocatorPuckRenderer').TranslocatorPuckRenderer | null): void {
    this.translocatorPuckRenderer = renderer;
  }

  /** Injiziert den TracerRenderer für data-driven Leuchtlinien. */
  setTracerRenderer(renderer: TracerRenderer | null): void {
    this.tracerRenderer = renderer;
  }

  /** Injiziert den MuzzleFlashRenderer fuer lokale Spawn-Effekte. */
  setMuzzleFlashRenderer(renderer: MuzzleFlashRenderer | null): void {
    this.muzzleFlashRenderer = renderer;
  }

  setAudioSystem(system: GameAudioSystem | null): void {
    this.audioSystem = system;
  }

  setOwnerPositionProvider(provider: ((ownerId: string) => { x: number; y: number } | null) | null): void {
    this.ownerPositionProvider = provider;
  }

  /** Registriert den Callback für BFG-Laser-Salven (Host-only). */
  setBfgLaserCallback(cb: ((proj: TrackedProjectile) => void) | null): void {
    this.bfgLaserCallback = cb;
  }

  setProjectileImpactCallback(cb: ((proj: TrackedProjectile, x: number, y: number) => void) | null): void {
    this.projectileImpactCallback = cb;
  }

  /** Registriert die Host-seitige Zielquelle für Homing-Projektile. */
  setHomingTargetProvider(cb: ((config: ProjectileHomingConfig, ownerId: string) => HomingTargetCandidate[]) | null): void {
    this.homingTargetProvider = cb;
  }

  /** Registriert die Host-seitige Line-of-Sight-Prüfung für Homing-Projektile. */
  setHomingLineOfSightChecker(cb: ((sx: number, sy: number, ex: number, ey: number) => boolean) | null): void {
    this.homingLineOfSightChecker = cb;
  }

  // ── Host ──────────────────────────────────────────────────────────────────

  /**
   * Spawnt ein Projektil mit der übergebenen Konfiguration.
   * Granaten (isGrenade=true) haben keine Welt-/Hindernis-Kollision
   * und explodieren nach fuseTime ms.
   */
  spawnProjectile(
    x:       number,
    y:       number,
    angle:   number,
    ownerId: string,
    cfg:     ProjectileSpawnConfig,
  ): number {
    const id = this.nextId++;

    const isBall   = cfg.projectileStyle === 'ball';
    const isEnergyBall = cfg.projectileStyle === 'energy_ball';
    const isHydra = cfg.projectileStyle === 'hydra';
    const isSpore = cfg.projectileStyle === 'spore';
    const isBullet = cfg.projectileStyle === 'bullet';
    const isFlame  = cfg.projectileStyle === 'flame';
    const isBfg    = cfg.projectileStyle === 'bfg';
    const isAwp    = cfg.projectileStyle === 'awp';
    const isGauss  = cfg.projectileStyle === 'gauss';
    const isGrenadeVisual = cfg.projectileStyle === 'grenade';
    const isHolyGrenade = cfg.projectileStyle === 'holy_grenade';
    const isRocket = cfg.projectileStyle === 'rocket';
    const isTranslocatorPuck = cfg.projectileStyle === 'translocator_puck';

    // Physik-Shape: für 'bullet'/'flame'/'awp' unsichtbar (nur Kollisions-Body)
    const sprite: Phaser.GameObjects.Shape = (isBall || isEnergyBall || isHydra || isSpore)
      ? this.scene.add.circle(x, y, cfg.size / 2, cfg.color)
      : this.scene.add.rectangle(x, y, cfg.size, cfg.size, cfg.color);
    sprite.setDepth(DEPTH.PROJECTILES);

    if (isBullet && this.bulletRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.bulletRenderer.createVisual(
        id,
        x,
        y,
        cfg.size,
        cfg.color,
        resolveBulletVisualPreset(cfg.projectileStyle, cfg.bulletVisualPreset),
        cfg.ownerColor ?? cfg.color,
      );
    }

    // AWP-Projektile sind unsichtbar (Rendering übernimmt BulletRenderer mit AWP-Stil)
    if ((isAwp || isGauss) && this.bulletRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.bulletRenderer.createVisual(
        id,
        x,
        y,
        cfg.size,
        cfg.color,
        resolveBulletVisualPreset(cfg.projectileStyle, cfg.bulletVisualPreset),
        cfg.ownerColor ?? cfg.color,
      );
    }

    if (isGauss && this.gaussRenderer) {
      this.gaussRenderer.createVisual(id, x, y, cfg.size, cfg.color);
    }

    if (isRocket && this.rocketRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.rocketRenderer.createVisual(
        id,
        x,
        y,
        cfg.size,
        cfg.color,
        cfg.ownerColor ?? cfg.color,
        cfg.smokeTrailColor ?? cfg.color,
      );
    }

    if (isSpore && this.sporeRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.sporeRenderer.createVisual(id, x, y, cfg.size, cfg.color);
    }

    if (isEnergyBall && this.energyBallRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.energyBallRenderer.createVisual(id, x, y, cfg.size, cfg.color, cfg.energyBallVariant);
    }

    if (isHydra && this.hydraRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.hydraRenderer.createVisual(id, x, y, cfg.size, cfg.color);
    }

    if (isGrenadeVisual && this.grenadeRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.grenadeRenderer.createVisual(id, x, y, cfg.size, cfg.grenadeVisualPreset ?? 'he', cfg.ownerColor ?? cfg.color);
    }

    if (isHolyGrenade && this.holyGrenadeRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.holyGrenadeRenderer.createVisual(id, x, y, cfg.size);
    }

    if (isTranslocatorPuck && this.translocatorPuckRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.translocatorPuckRenderer.createVisual(id, x, y, cfg.ownerColor ?? cfg.color);
    }

    // Flame-Hitboxen sind unsichtbar (Rendering übernimmt FlameRenderer auf Client)
    if (isFlame) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
    }

    // BFG-Projektile sind unsichtbar (Rendering übernimmt BfgRenderer)
    if (isBfg) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
    }

    this.scene.physics.add.existing(sprite);

    const body = sprite.body as Phaser.Physics.Arcade.Body;

    body.setVelocity(
      Math.cos(angle) * cfg.speed,
      Math.sin(angle) * cfg.speed,
    );

    // Anti-Tunneling: Body in Flugrichtung verlängern (proportional zur
    // Geschwindigkeitskomponente je Achse). Verhindert, dass kleine Projektile
    // an Nahtstellen zwischen benachbarten 32×32-Fels-Bodies durchrutschen.
    if (!isFlame && !isBfg && !cfg.isGrenade && cfg.size < MIN_BODY_LEN) {
      const vx = Math.abs(Math.cos(angle));
      const vy = Math.abs(Math.sin(angle));
      const bodyW = Math.max(cfg.size, vx * MIN_BODY_LEN);
      const bodyH = Math.max(cfg.size, vy * MIN_BODY_LEN);
      body.setSize(bodyW, bodyH);
      body.setOffset((cfg.size - bodyW) / 2, (cfg.size - bodyH) / 2);
    }

    const tracked: TrackedProjectile = {
      id,
      sprite,
      body,
      lastX:          x,
      lastY:          y,
      bounceCount:    cfg.initialBounceCount ?? 0,
      createdAt:      Date.now(),
      ownerId,
      color:          cfg.color,
      allowTeamDamage: cfg.allowTeamDamage,
      ownerColor:     cfg.ownerColor,
      boundsListener: () => {},
      colliders:      [],
      damage:         cfg.damage,
      lifetime:       cfg.lifetime,
      maxBounces:     cfg.maxBounces,
      isGrenade:      cfg.isGrenade,
      adrenalinGain:  cfg.adrenalinGain,
      weaponName:     cfg.weaponName ?? 'Waffe',
      explosion:      cfg.explosion,
      impactCloud:    cfg.impactCloud,
      homing:         cfg.homing,
      smokeTrailColor: cfg.smokeTrailColor,
      lockedTargetId: null,
      fuseTime:        cfg.fuseTime,
      grenadeEffect:   cfg.grenadeEffect,
      projectileStyle: cfg.projectileStyle,
      bulletVisualPreset: cfg.bulletVisualPreset,
      grenadeVisualPreset: cfg.grenadeVisualPreset,
      energyBallVariant: cfg.energyBallVariant,
      tracerConfig:    cfg.tracerConfig,
      detonable:       cfg.detonable,
      detonator:       cfg.detonator,
      rockDamageMult:  cfg.rockDamageMult,
      trainDamageMult: cfg.trainDamageMult,
      sourceSlot:      cfg.sourceSlot,
      shotAudioKey:    cfg.shotAudioKey,
      shotAudioVolume: cfg.shotAudioVolume,
      splitCount:      cfg.splitCount,
      splitSpread:     cfg.splitSpread,
      splitFactor:     cfg.splitFactor,
      remainingRangePx: cfg.remainingRangePx,
      suppressSpawnFx: cfg.suppressSpawnFx,
      // Flammenwerfer-Felder
      isFlame:         cfg.isFlame,
      hitboxGrowRate:  cfg.hitboxGrowRate,
      hitboxMaxSize:   cfg.hitboxMaxSize,
      velocityDecay:   cfg.velocityDecay,
      burnDurationMs:    cfg.burnDurationMs,
      burnDamagePerTick: cfg.burnDamagePerTick,
      burnTickIntervalMs: cfg.burnTickIntervalMs,
      initialSpeed:    cfg.speed,
      // Granaten-Countdown
      lastCountdownEmitted: null,
      // BFG-Felder
      isBfg:            cfg.isBfg,
      bfgLaserRadius:   cfg.bfgLaserRadius,
      bfgLaserDamage:   cfg.bfgLaserDamage,
      bfgLaserInterval: cfg.bfgLaserInterval,
      // Anti-Tunneling
      originalBodySize: cfg.size < MIN_BODY_LEN && !isFlame && !isBfg && !isGauss && !cfg.isGrenade
        ? cfg.size : undefined,

      // Erweiterte Flugphysik
      frictionDelayMs: cfg.frictionDelayMs,
      airFrictionDecayPerSec: cfg.airFrictionDecayPerSec,
      bounceFrictionMultiplier: cfg.bounceFrictionMultiplier,
      stopSpeedThreshold: cfg.stopSpeedThreshold,
      frictionActivated: false,
    };

    // Phaser-Damping für Air-Friction vorbereiten
    if (cfg.airFrictionDecayPerSec !== undefined) {
      body.useDamping = true;
      // Drag erst nach frictionDelayMs aktivieren; bis dahin kein Luftwiderstand (Faktor 1)
      if (!cfg.frictionDelayMs || cfg.frictionDelayMs <= 0) {
        body.setDrag(cfg.airFrictionDecayPerSec, cfg.airFrictionDecayPerSec);
        tracked.frictionActivated = true;
      } else {
        body.setDrag(1, 1);
      }
    }

    if (isBfg || isGauss) {
      // BFG: Welt-Bounds zerstören das Projektil; Felsen/Zug werden per Overlap beschädigt,
      // das Projektil fliegt aber durch alles durch (kein physischer Stopp).
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      const bfgBoundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        tracked.bounceCount = tracked.maxBounces + 1; // zum Entfernen markieren
      };
      tracked.boundsListener = bfgBoundsListener;
      this.scene.physics.world.on('worldbounds', bfgBoundsListener);

      // Felsen: Overlap → beschädigt Fels, Projektil fliegt weiter
      if (this.rockGroup) {
        const rockObjects = this.rockObjects;
        const onHit       = this.onRockHit;
        const c = this.scene.physics.add.overlap(sprite, this.rockGroup, (_proj, rockGO) => {
          if (!rockObjects || !onHit) return;
            if (isGauss && !tracked.gaussHitRocks) tracked.gaussHitRocks = new Set();
            if (!isGauss && !tracked.bfgHitRocks) tracked.bfgHitRocks = new Set();
          const idx = rockObjects.indexOf(rockGO as Phaser.GameObjects.Image);
          const hitSet = isGauss ? tracked.gaussHitRocks : tracked.bfgHitRocks;
          if (idx !== -1 && hitSet && !hitSet.has(idx)) {
            hitSet.add(idx);
            const rockMult = tracked.rockDamageMult ?? 1;
            onHit(idx, tracked.damage * rockMult, tracked.ownerId);
          }
        });
        tracked.colliders.push(c);
      }

      // Zug: Overlap → beschädigt Zug, Projektil fliegt weiter
      if (this.trainGroup) {
        const onTrainHit = this.onTrainHit;
        const c = this.scene.physics.add.overlap(sprite, this.trainGroup, () => {
          if (isGauss ? tracked.gaussHitTrain : tracked.bfgHitTrain) return;
          if (isGauss) tracked.gaussHitTrain = true;
          else tracked.bfgHitTrain = true;
          const trainMult = tracked.trainDamageMult ?? 1;
          onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
        });
        tracked.colliders.push(c);
      }
      // Trunks: kein Collider/Overlap – Projektil fliegt einfach durch

      // BfgRenderer-Visual erstellen (Host rendert ebenfalls)
      if (isBfg && this.bfgRenderer) {
        this.bfgRenderer.createVisual(id, x, y, cfg.size);
      }
    } else if (cfg.impactCloud && cfg.maxBounces === 0) {
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      body.setBounce(0, 0);
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        this.emitProjectileImpact(tracked, tracked.sprite.x, tracked.sprite.y);
        this.queueDestroyProjectile(tracked);
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      if (this.rockGroup) {
        const c = this.scene.physics.add.collider(sprite, this.rockGroup, () => {
          this.emitProjectileImpact(tracked, tracked.sprite.x, tracked.sprite.y);
          this.queueDestroyProjectile(tracked);
        });
        tracked.colliders.push(c);
      }
      if (this.trunkGroup) {
        const c = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
          this.emitProjectileImpact(tracked, tracked.sprite.x, tracked.sprite.y);
          this.queueDestroyProjectile(tracked);
        });
        tracked.colliders.push(c);
      }
      if (this.trainGroup) {
        const onTrainHit = this.onTrainHit;
        const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
          const trainMult = tracked.trainDamageMult ?? 1;
          if (trainMult !== 0 && tracked.damage > 0) {
            onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
          }
          this.emitProjectileImpact(tracked, tracked.sprite.x, tracked.sprite.y);
          this.queueDestroyProjectile(tracked);
        });
        tracked.colliders.push(c);
      }
    } else if (cfg.explosion && cfg.maxBounces === 0) {
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      body.setBounce(0, 0);
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        this.queueProjectileExplosion(tracked);
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      if (this.rockGroup) {
        const c = this.scene.physics.add.collider(sprite, this.rockGroup, () => {
          this.queueProjectileExplosion(tracked);
        });
        tracked.colliders.push(c);
      }
      if (this.trunkGroup) {
        const c = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
          this.queueProjectileExplosion(tracked);
        });
        tracked.colliders.push(c);
      }
      if (this.trainGroup) {
        const onTrainHit = this.onTrainHit;
        const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
          const trainMult = tracked.trainDamageMult ?? 1;
          if (trainMult !== 0 && tracked.damage > 0) {
            onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
          }
          this.queueProjectileExplosion(tracked);
        });
        tracked.colliders.push(c);
      }
    } else if (isFlame) {
      // Flammen: kein Bounce, Arena-Bounds und Hindernisse stoppen die Hitbox;
      // sie verweilt dann für die restliche Lifetime an der Aufprallstelle.
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        // Flamme an Wand → anhalten (Lifetime bestimmt weiterlaufend die Lebensdauer)
        body.setVelocity(0, 0);
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      this.setupFlameColliders(sprite, body, tracked);
    } else if (!cfg.isGrenade || cfg.maxBounces > 0) {
      // Bounce-Physik: für normale Projektile immer; für Granaten nur wenn maxBounces > 0
      this.setupBouncePhysics(sprite, body, tracked, !cfg.isGrenade);
    } else if (cfg.isGrenade && cfg.maxBounces === 0) {
      // Granate ohne Bounces (z.B. Heilige Handgranate): Wand-Kollision, aber kein Abprallen.
      // Bleibt an der Aufprallstelle liegen und explodiert nach fuseTime.
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      body.setBounce(0, 0);
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        body.setVelocity(0, 0);
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      // Fels-/Trunk-/Zug-Kollision: Granate bleibt stecken
      if (this.rockGroup) {
        const c = this.scene.physics.add.collider(sprite, this.rockGroup, () => {
          body.setVelocity(0, 0);
        });
        tracked.colliders.push(c);
      }
      if (this.trunkGroup) {
        const c = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
          body.setVelocity(0, 0);
        });
        tracked.colliders.push(c);
      }
      if (this.trainGroup) {
        const onTrainHit = this.onTrainHit;
        const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
          body.setVelocity(0, 0);
          const trainMult = tracked.trainDamageMult ?? 1;
          if (trainMult !== 0) onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
        });
        tracked.colliders.push(c);
      }
    }

    // Tracer-Leuchtlinie (optional, data-driven via tracerConfig)
    if (cfg.tracerConfig && this.tracerRenderer) {
      this.tracerRenderer.createTracer(id, x, y, cfg.tracerConfig, cfg.ownerColor ?? cfg.color);
    }

    if (!cfg.suppressSpawnFx) {
      const muzzleOrigin = getTopDownMuzzleOrigin(x, y, angle);
      this.muzzleFlashRenderer?.playProjectileFlash(
        muzzleOrigin.x,
        muzzleOrigin.y,
        Math.cos(angle) * cfg.speed,
        Math.sin(angle) * cfg.speed,
        cfg.projectileStyle,
        cfg.bulletVisualPreset,
        cfg.energyBallVariant,
        cfg.ownerColor ?? cfg.color,
      );
      this.audioSystem?.playSound(cfg.shotAudioKey, muzzleOrigin.x, muzzleOrigin.y, ownerId, cfg.shotAudioVolume);
    }

    this.projectiles.push(tracked);
    return id;
  }

  /**
   * Richtet Fels-/Trunk-/Zug-Kollision für Flammen-Hitboxen ein.
   * Felsen und Trunks stoppen die Flamme physisch (collider, kein Bounce);
   * sie verweilt dann für ihre restliche Lifetime an der Aufprallstelle.
   * Der Zug zerstört die Flamme sofort und erhält Schaden.
   */
  private setupFlameColliders(
    sprite:  Phaser.GameObjects.Shape,
    body:    Phaser.Physics.Arcade.Body,
    tracked: TrackedProjectile,
  ): void {
    // Kein Abprallen: Flamme bleibt an der Aufprallstelle stehen
    body.setBounce(0, 0);

    if (this.rockGroup) {
      // collider statt overlap: Phaser stoppt den Body physisch am Felsen
      const c = this.scene.physics.add.collider(sprite, this.rockGroup);
      tracked.colliders.push(c);
    }
    if (this.trunkGroup) {
      const c = this.scene.physics.add.collider(sprite, this.trunkGroup);
      tracked.colliders.push(c);
    }
    if (this.trainGroup) {
      // Zug: Flamme verursacht genau einmal Schaden und verschwindet sofort.
      const onTrainHit = this.onTrainHit;
      const c = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
        if (tracked.pendingDestroy) return;
        const trainMult = tracked.trainDamageMult ?? 1;
        if (trainMult !== 0) onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
        this.queueDestroyProjectile(tracked);
      });
      tracked.colliders.push(c);
    }
  }

  /**
   * Richtet Welt- und Hindernis-Kollision mit physikalischem Abprallen ein.
   * Wird von normalen Projektilen und bouncenden Granaten (maxBounces > 0) genutzt.
   *
   * @param applyRockDamage – true für normale Projektile (Felstreffer-Schaden);
   *                          false für Granaten (kein Felstrefferschaden beim Abprallen)
   */
  private setupBouncePhysics(
    sprite:          Phaser.GameObjects.Shape,
    body:            Phaser.Physics.Arcade.Body,
    tracked:         TrackedProjectile,
    applyRockDamage: boolean,
  ): void {
    body.setCollideWorldBounds(true);
    body.onWorldBounds = true;
    // Elastischer Bounce (Richtungsumkehr durch Phaser); Geschwindigkeitsreduktion
    // erfolgt manuell über applyBounceFriction, damit die GESAMTE Geschwindigkeit
    // (nicht nur die Normalkomponente) mit dem Multiplikator reduziert wird.
    body.setBounce(1, 1);

    const isTranslocatorPuck = tracked.projectileStyle === 'translocator_puck';

    // Hilfsfunktion: reduziert bei jedem Abprallen die Gesamtgeschwindigkeit
    const applyBounceFriction = () => {
      const mult = tracked.bounceFrictionMultiplier;
      if (mult !== undefined && mult < 1) {
        body.velocity.x *= mult;
        body.velocity.y *= mult;
      }
    };

    const isBullet     = tracked.projectileStyle === 'bullet';
    const isAwp        = tracked.projectileStyle === 'awp';
    const isGauss      = tracked.projectileStyle === 'gauss';
    const renderer     = this.bulletRenderer;

    const playImpact = (bx: number, by: number, bvx: number, bvy: number, col: number) => {
      if ((isBullet || isAwp || isGauss) && renderer) renderer.playImpactSparks(tracked.id, bx, by, bvx, bvy, col);
    };

    const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
      if (hitBody !== body) return;
      applyBounceFriction();
      const impact = this.getProjectileBodyCenter(tracked);
      if (tracked.projectileStyle === 'hydra') {
        if (this.trySplitHydraProjectile(tracked, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
        tracked.bounceCount = tracked.maxBounces + 1;
        body.reset(impact.x, impact.y);
        this.queueDestroyProjectile(tracked);
        return;
      }
      tracked.bounceCount++;
      // Funken an Arena-Wand: Velocity ist nach Bounce bereits reflektiert
      if (isBullet || isAwp || isGauss) {
        playImpact(
          body.x + body.halfWidth, body.y + body.halfHeight,
          body.velocity.x, body.velocity.y,
          tracked.color,
        );
      }
      // Sofort stoppen, damit kein weiteres Objekt vor hostUpdate getroffen wird
      if (tracked.bounceCount > tracked.maxBounces) {
        body.setVelocity(0, 0);
        body.enable = false;
      }
    };
    tracked.boundsListener = boundsListener;
    this.scene.physics.world.on('worldbounds', boundsListener);

    if (this.rockGroup) {
      const rockObjects = this.rockObjects;
      const onHit       = this.onRockHit;
      const rockCollider = this.scene.physics.add.collider(sprite, this.rockGroup, (_proj, rockGO) => {
        const idx = rockObjects?.indexOf(rockGO as Phaser.GameObjects.Image) ?? -1;
        if (tracked.bounceProcessedThisStep) {
          // Phasers zweite Velocity-Spiegelung rückgängig machen, damit keine Doppelumkehr entsteht
          if (tracked.velocityAfterFirstBounce) {
            body.velocity.x = tracked.velocityAfterFirstBounce.x;
            body.velocity.y = tracked.velocityAfterFirstBounce.y;
          }
          return;
        }
        tracked.bounceProcessedThisStep = true;
        applyBounceFriction();
        tracked.velocityAfterFirstBounce = { x: body.velocity.x, y: body.velocity.y };
        const impact = this.resolveObstacleImpactPoint(tracked, rockGO as Phaser.GameObjects.GameObject);
        // Funken bei Fels-Aufprall
        if (isBullet || isAwp || isGauss) {
          playImpact(
            body.x + body.halfWidth, body.y + body.halfHeight,
            body.velocity.x, body.velocity.y,
            tracked.color,
          );
        }
        if (applyRockDamage && rockObjects && onHit) {
          const rockMult = tracked.rockDamageMult ?? 1;
          if (rockMult !== 0 && idx !== -1) {
            onHit(idx, tracked.damage * rockMult, tracked.ownerId);
          }
        }
        if (tracked.projectileStyle === 'hydra') {
          if (this.trySplitHydraProjectile(tracked, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
          tracked.bounceCount = tracked.maxBounces + 1;
          body.reset(impact.x, impact.y);
          this.queueDestroyProjectile(tracked);
          return;
        }
        tracked.bounceCount++;
        // Sofort stoppen, damit kein weiteres Objekt vor hostUpdate getroffen wird
        if (tracked.bounceCount > tracked.maxBounces) {
          body.setVelocity(0, 0);
          body.enable = false;
        }
      });
      tracked.colliders.push(rockCollider);
    }

    if (this.trunkGroup) {
      const trunkCollider = this.scene.physics.add.collider(sprite, this.trunkGroup, (_proj, trunkGO) => {
        if (tracked.bounceProcessedThisStep) {
          if (tracked.velocityAfterFirstBounce) {
            body.velocity.x = tracked.velocityAfterFirstBounce.x;
            body.velocity.y = tracked.velocityAfterFirstBounce.y;
          }
          return;
        }
        tracked.bounceProcessedThisStep = true;
        applyBounceFriction();
        tracked.velocityAfterFirstBounce = { x: body.velocity.x, y: body.velocity.y };
        const impact = this.resolveObstacleImpactPoint(tracked, trunkGO as Phaser.GameObjects.GameObject);
        // Funken bei Baumstamm-Aufprall
        if (isBullet || isAwp || isGauss) {
          playImpact(
            body.x + body.halfWidth, body.y + body.halfHeight,
            body.velocity.x, body.velocity.y,
            tracked.color,
          );
        }
        if (tracked.projectileStyle === 'hydra') {
          if (this.trySplitHydraProjectile(tracked, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
          tracked.bounceCount = tracked.maxBounces + 1;
          body.reset(impact.x, impact.y);
          this.queueDestroyProjectile(tracked);
          return;
        }
        tracked.bounceCount++;
        // Sofort stoppen, damit kein weiteres Objekt vor hostUpdate getroffen wird
        if (tracked.bounceCount > tracked.maxBounces) {
          body.setVelocity(0, 0);
          body.enable = false;
        }
      });
      tracked.colliders.push(trunkCollider);
    }

    if (this.trainGroup) {
      const onTrainHit = this.onTrainHit;
      const trainCollider = this.scene.physics.add.collider(sprite, this.trainGroup, (_proj, trainGO) => {
        if (tracked.bounceProcessedThisStep) {
          if (tracked.velocityAfterFirstBounce) {
            body.velocity.x = tracked.velocityAfterFirstBounce.x;
            body.velocity.y = tracked.velocityAfterFirstBounce.y;
          }
          return;
        }
        tracked.bounceProcessedThisStep = true;
        const impact = this.resolveObstacleImpactPoint(tracked, trainGO as Phaser.GameObjects.GameObject);
        // Translocator prallt am Zug ab ohne Schaden
        if (!isTranslocatorPuck) {
          const trainMult = tracked.trainDamageMult ?? 1;
          if (trainMult !== 0) {
            onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
          }
        }
        // Funken bei Zug-Aufprall
        if (isBullet || isAwp || isGauss) {
          playImpact(
            body.x + body.halfWidth, body.y + body.halfHeight,
            body.velocity.x, body.velocity.y,
            tracked.color,
          );
        }
        applyBounceFriction();
        tracked.velocityAfterFirstBounce = { x: body.velocity.x, y: body.velocity.y };
        if (tracked.projectileStyle === 'hydra') {
          if (this.trySplitHydraProjectile(tracked, impact.x, impact.y, body.velocity.x, body.velocity.y)) return;
          tracked.bounceCount = tracked.maxBounces + 1;
          body.reset(impact.x, impact.y);
          this.queueDestroyProjectile(tracked);
          return;
        }
        tracked.bounceCount++;
        // Sofort stoppen, damit kein weiteres Objekt vor hostUpdate getroffen wird
        if (tracked.bounceCount > tracked.maxBounces) {
          body.setVelocity(0, 0);
          body.enable = false;
        }
      });
      tracked.colliders.push(trainCollider);
    }
  }

  /**
   * Host: Flammen-Hitbox pro Frame wachsen lassen und verlangsamen.
   * Wird nur für Projektile mit `isFlame === true` aufgerufen.
   */
  private updateFlameHitbox(proj: TrackedProjectile, deltaS: number): void {
    const growRate = proj.hitboxGrowRate ?? 0;
    const maxSize  = proj.hitboxMaxSize ?? proj.sprite.width;
    const decay    = proj.velocityDecay ?? 1;

    // 1. Wachstum: Nur die visuelle Sprite-Größe vergrößern – der Physik-Body bleibt
    // bei seiner Startgröße (hitboxStartSize). Würde der Body mitgewachsen, würde sein
    // seitlich wachsender Rand benachbarte Felsen/Trunks und Arena-Wände treffen,
    // obwohl der Flugpfad der Flamme frei ist → vorzeitiger Tod und positionsabhängige
    // Reichweite. CombatSystem nutzt sprite.getBounds() für Spielertreffer, das mit
    // displayWidth wächst → die wachsende Trefferzone funktioniert korrekt.
    const curSize = proj.sprite.displayWidth;
    if (curSize < maxSize) {
      const newSize = Math.min(maxSize, curSize + growRate * deltaS);
      // Shape-Dimension aktualisieren (für SyncedProjectile.size und CombatSystem-Bounds)
      proj.sprite.setDisplaySize(newSize, newSize);
    }

    // 2. Verlangsamung: Geschwindigkeit exponentiell abbauen
    if (decay < 1) {
      const factor = Math.pow(decay, deltaS);
      proj.body.setVelocity(
        proj.body.velocity.x * factor,
        proj.body.velocity.y * factor,
      );
    }
  }

  private shouldUseContinuousRockCollision(proj: TrackedProjectile): boolean {
    return (proj.projectileStyle === 'bullet' || proj.projectileStyle === 'awp')
      && !proj.isGrenade
      && !proj.isFlame
      && !proj.isBfg
      && !proj.pendingDestroy
      && !proj.bounceProcessedThisStep
      && !!this.rockObjects;
  }

  private resolveContinuousRockCollision(proj: TrackedProjectile): void {
    if (!this.rockObjects) return;

    const line = new Phaser.Geom.Line(proj.lastX, proj.lastY, proj.sprite.x, proj.sprite.y);
    const segmentLength = Phaser.Geom.Line.Length(line);
    if (segmentLength <= 0.5) return;

    let bestRockIndex = -1;
    let bestRect: Phaser.Geom.Rectangle | null = null;
    let bestHit: { distance: number; x: number; y: number } | null = null;

    for (let i = 0; i < this.rockObjects.length; i++) {
      const rock = this.rockObjects[i];
      if (!rock?.active) continue;
      const rect = rock.getBounds();
      const hit = this.findNearestRectangleHit(line, rect);
      if (!hit) continue;
      if (!bestHit || hit.distance < bestHit.distance) {
        bestHit = hit;
        bestRockIndex = i;
        bestRect = rect;
      }
    }

    if (!bestHit || !bestRect || bestRockIndex < 0) return;

    let nextVx = proj.body.velocity.x;
    let nextVy = proj.body.velocity.y;
    const normal = this.getRectangleImpactNormal(bestRect, bestHit.x, bestHit.y);

    if (Math.abs(normal.x) > 0.001) nextVx *= -1;
    if (Math.abs(normal.y) > 0.001) nextVy *= -1;

    const frictionMultiplier = proj.bounceFrictionMultiplier;
    if (frictionMultiplier !== undefined && frictionMultiplier < 1) {
      nextVx *= frictionMultiplier;
      nextVy *= frictionMultiplier;
    }

    proj.bounceCount++;

    const rockMult = proj.rockDamageMult ?? 1;
    if (rockMult !== 0) {
      this.onRockHit?.(bestRockIndex, proj.damage * rockMult, proj.ownerId);
    }

    this.bulletRenderer?.playImpactSparks(proj.id, bestHit.x, bestHit.y, nextVx, nextVy, proj.color);

    if (proj.bounceCount > proj.maxBounces) {
      proj.body.reset(bestHit.x, bestHit.y);
      proj.body.setVelocity(0, 0);
      proj.body.enable = false;
      return;
    }

    const normalLength = Math.hypot(normal.x, normal.y) || 1;
    const offsetDistance = Math.max(proj.sprite.displayWidth * 0.5 + 0.5, 1);
    const resolvedX = bestHit.x + (normal.x / normalLength) * offsetDistance;
    const resolvedY = bestHit.y + (normal.y / normalLength) * offsetDistance;

    proj.body.reset(resolvedX, resolvedY);
    proj.body.setVelocity(nextVx, nextVy);
  }

  private getRectangleImpactNormal(
    rect: Phaser.Geom.Rectangle,
    x: number,
    y: number,
  ): { x: number; y: number } {
    const distances = [
      { axis: 'left', value: Math.abs(x - rect.left) },
      { axis: 'right', value: Math.abs(x - rect.right) },
      { axis: 'top', value: Math.abs(y - rect.top) },
      { axis: 'bottom', value: Math.abs(y - rect.bottom) },
    ] as const;

    const minDistance = Math.min(...distances.map((entry) => entry.value));
    const epsilon = 0.75;
    let nx = 0;
    let ny = 0;

    for (const entry of distances) {
      if (entry.value > minDistance + epsilon) continue;
      switch (entry.axis) {
        case 'left':
          nx -= 1;
          break;
        case 'right':
          nx += 1;
          break;
        case 'top':
          ny -= 1;
          break;
        case 'bottom':
          ny += 1;
          break;
      }
    }

    if (nx === 0 && ny === 0) {
      nx = projFallbackSign(x - rect.centerX);
      ny = projFallbackSign(y - rect.centerY);
    }

    return { x: nx, y: ny };
  }

  private findNearestRectangleHit(
    line: Phaser.Geom.Line,
    rect: Phaser.Geom.Rectangle,
  ): { distance: number; x: number; y: number } | null {
    const points = Phaser.Geom.Intersects.GetLineToRectangle(line, rect, this.scratchPoints);
    let bestHit: { distance: number; x: number; y: number } | null = null;

    for (const point of points) {
      const distance = Phaser.Math.Distance.Between(line.x1, line.y1, point.x, point.y);
      if (distance <= 0.01) continue;
      if (!bestHit || distance < bestHit.distance) {
        bestHit = { distance, x: point.x, y: point.y };
      }
    }

    points.length = 0;
    return bestHit;
  }

  private getProjectileBodyCenter(proj: TrackedProjectile): { x: number; y: number } {
    return {
      x: proj.body.x + proj.body.halfWidth,
      y: proj.body.y + proj.body.halfHeight,
    };
  }

  private resolveObstacleImpactPoint(
    proj: TrackedProjectile,
    obstacle?: Phaser.GameObjects.GameObject | null,
  ): { x: number; y: number } {
    const fallback = this.getProjectileBodyCenter(proj);
    if (!obstacle || !('getBounds' in obstacle) || typeof obstacle.getBounds !== 'function') {
      return fallback;
    }

    const line = new Phaser.Geom.Line(proj.lastX, proj.lastY, proj.sprite.x, proj.sprite.y);
    const hit = this.findNearestRectangleHit(line, obstacle.getBounds());
    return hit ? { x: hit.x, y: hit.y } : fallback;
  }

  private getHydraSplitAngles(baseAngle: number, splitCount: number, splitSpreadDeg: number): number[] {
    if (splitCount <= 0) return [];

    const half = Math.floor(splitCount / 2);
    const offsets: number[] = [];
    if (splitCount % 2 === 1) {
      for (let index = -half; index <= half; index++) {
        offsets.push(index * splitSpreadDeg);
      }
    } else {
      for (let index = -half; index <= -1; index++) {
        offsets.push(index * splitSpreadDeg);
      }
      for (let index = 1; index <= half; index++) {
        offsets.push(index * splitSpreadDeg);
      }
    }

    return offsets.map((offsetDeg) => baseAngle + Phaser.Math.DegToRad(offsetDeg));
  }

  private getRemainingRangeAfterImpact(proj: TrackedProjectile, impactX: number, impactY: number): number {
    const baseRange = proj.remainingRangePx ?? (Math.max(proj.initialSpeed ?? proj.body.velocity.length(), 0) * proj.lifetime) / 1000;
    const impactDistance = Phaser.Math.Distance.Between(proj.lastX, proj.lastY, impactX, impactY);
    return Math.max(0, baseRange - impactDistance);
  }

  private trySplitHydraProjectile(
    proj: TrackedProjectile,
    impactX: number,
    impactY: number,
    outgoingVx: number,
    outgoingVy: number,
  ): boolean {
    if (proj.projectileStyle !== 'hydra') return false;

    const splitCount = Math.max(0, Math.floor(proj.splitCount ?? 0));
    if (splitCount <= 0) return false;

    const nextBounceCount = proj.bounceCount + 1;
    if (nextBounceCount > proj.maxBounces) return false;

    const outgoingSpeed = Math.hypot(outgoingVx, outgoingVy);
    if (outgoingSpeed <= 0.001) return false;

    const remainingRangePx = this.getRemainingRangeAfterImpact(proj, impactX, impactY);
    if (remainingRangePx <= 0.5) return false;

    const splitSpread = proj.splitSpread ?? 0;
    const childAngles = this.getHydraSplitAngles(Math.atan2(outgoingVy, outgoingVx), splitCount, splitSpread);
    if (childAngles.length === 0) return false;

    const splitFactor = proj.splitFactor ?? 1;
    const childSize = Math.max(4, (proj.sprite.displayWidth / splitCount) * splitFactor);
    const childDamage = Math.max(1, (proj.damage / splitCount) * splitFactor);
    const childAdrenalinGain = Math.max(0, (proj.adrenalinGain / splitCount) * splitFactor);
    const childLifetime = (remainingRangePx / outgoingSpeed) * 1000;

    proj.pendingHydraSplit = {
      x: impactX,
      y: impactY,
      angles: childAngles,
    };
    this.queueDestroyProjectile(proj);

    for (const childAngle of childAngles) {
      this.spawnProjectile(impactX, impactY, childAngle, proj.ownerId, {
        speed: outgoingSpeed,
        size: childSize,
        damage: childDamage,
        color: proj.color,
        allowTeamDamage: proj.allowTeamDamage,
        ownerColor: proj.ownerColor,
        lifetime: childLifetime,
        maxBounces: proj.maxBounces,
        isGrenade: proj.isGrenade,
        adrenalinGain: childAdrenalinGain,
        weaponName: proj.weaponName,
        explosion: proj.explosion,
        impactCloud: proj.impactCloud,
        homing: proj.homing,
        smokeTrailColor: proj.smokeTrailColor,
        fuseTime: proj.fuseTime,
        grenadeEffect: proj.grenadeEffect,
        projectileStyle: proj.projectileStyle,
        bulletVisualPreset: proj.bulletVisualPreset,
        grenadeVisualPreset: proj.grenadeVisualPreset,
        energyBallVariant: proj.energyBallVariant,
        tracerConfig: proj.tracerConfig,
        detonable: proj.detonable,
        detonator: proj.detonator,
        rockDamageMult: proj.rockDamageMult,
        trainDamageMult: proj.trainDamageMult,
        isFlame: proj.isFlame,
        hitboxGrowRate: proj.hitboxGrowRate,
        hitboxMaxSize: proj.hitboxMaxSize,
        velocityDecay: proj.velocityDecay,
        burnDurationMs: proj.burnDurationMs,
        burnDamagePerTick: proj.burnDamagePerTick,
        burnTickIntervalMs: proj.burnTickIntervalMs,
        isBfg: proj.isBfg,
        bfgLaserRadius: proj.bfgLaserRadius,
        bfgLaserDamage: proj.bfgLaserDamage,
        bfgLaserInterval: proj.bfgLaserInterval,
        frictionDelayMs: proj.frictionDelayMs,
        airFrictionDecayPerSec: proj.airFrictionDecayPerSec,
        bounceFrictionMultiplier: proj.bounceFrictionMultiplier,
        stopSpeedThreshold: proj.stopSpeedThreshold,
        sourceSlot: proj.sourceSlot,
        shotAudioKey: proj.shotAudioKey,
        shotAudioVolume: proj.shotAudioVolume,
        splitCount: proj.splitCount,
        splitSpread: proj.splitSpread,
        splitFactor: proj.splitFactor,
        initialBounceCount: nextBounceCount,
        remainingRangePx,
        suppressSpawnFx: true,
      });
    }

    return true;
  }

  /**
   * Markiert ein Projektil zur sofortigen Entfernung aus Host-Logik und Phaser-Kollision.
   * Das eigentliche Cleanup erfolgt gesammelt im nächsten hostUpdate().
   */
  private queueDestroyProjectile(proj: TrackedProjectile): void {
    if (proj.pendingDestroy) return;
    proj.pendingDestroy = true;
    proj.body.setVelocity(0, 0);
    proj.body.enable = false;
  }

  private destroyTrackedProjectile(proj: TrackedProjectile): void {
    const destroyX = proj.pendingHydraSplit?.x ?? proj.sprite.x;
    const destroyY = proj.pendingHydraSplit?.y ?? proj.sprite.y;
    const destroyScale = proj.sprite.displayWidth / 16;
    this.scene.physics.world.off('worldbounds', proj.boundsListener);
    for (const c of proj.colliders) c.destroy();
    proj.sprite.destroy();
    this.bulletRenderer?.destroyVisual(proj.id);
    this.tracerRenderer?.destroyTracer(proj.id);
    this.flameRenderer?.destroyVisual(proj.id);
    this.bfgRenderer?.destroyVisual(proj.id);
    this.gaussRenderer?.destroyVisual(proj.id);
    if (proj.projectileStyle === 'energy_ball') {
      this.energyBallRenderer?.playImpact(destroyX, destroyY, proj.color, proj.energyBallVariant, destroyScale);
    }
    if (proj.projectileStyle === 'hydra') {
      if (proj.pendingHydraSplit) {
        this.hydraRenderer?.playSplitImpact(destroyX, destroyY, proj.color, proj.pendingHydraSplit.angles, destroyScale);
      } else {
        this.hydraRenderer?.playImpact(destroyX, destroyY, proj.color, Math.max(destroyScale, 0.95));
      }
    }
    if (proj.projectileStyle === 'spore') {
      this.sporeRenderer?.playImpact(destroyX, destroyY, proj.color, Math.max(destroyScale, 0.9));
    }
    this.hydraRenderer?.destroyVisual(proj.id);
    this.energyBallRenderer?.destroyVisual(proj.id);
    this.grenadeRenderer?.destroyVisual(proj.id);
    this.holyGrenadeRenderer?.destroyVisual(proj.id);
    this.rocketRenderer?.destroyVisual(proj.id);
    this.sporeRenderer?.destroyVisual(proj.id);
    this.translocatorPuckRenderer?.destroyVisual(proj.id);
  }

  private queueProjectileExplosion(proj: TrackedProjectile): void {
    if (proj.pendingExplosion || !proj.explosion) return;
    proj.pendingExplosion = true;
    this.pendingProjectileExplosions.push({
      x: proj.sprite.x,
      y: proj.sprite.y,
      ownerId: proj.ownerId,
      effect: proj.explosion,
      sourceSlot: proj.sourceSlot,
      weaponName: proj.weaponName,
    });
    this.queueDestroyProjectile(proj);
  }

  private emitProjectileImpact(proj: TrackedProjectile, x: number, y: number): void {
    this.projectileImpactCallback?.(proj, x, y);
  }

  private updateHomingProjectile(proj: TrackedProjectile, now: number): void {
    const homing = proj.homing;
    if (!homing || !this.homingTargetProvider) return;
    if (now - proj.createdAt < homing.acquireDelayMs) return;

    const lastSearchAt = proj.lastHomingSearchAt ?? 0;
    if (lastSearchAt > 0 && now - lastSearchAt < homing.retargetIntervalMs) return;
    proj.lastHomingSearchAt = now;

    const target = this.selectHomingTarget(proj, homing);
    if (!target) {
      proj.lockedTargetId = null;
      proj.lockedTargetType = undefined;
      return;
    }

    proj.lockedTargetId = target.id;
    proj.lockedTargetType = target.type;

    const currentSpeed = proj.body.velocity.length();
    if (currentSpeed <= 0.001) return;

    const currentAngle = Math.atan2(proj.body.velocity.y, proj.body.velocity.x);
    const targetAngle = Phaser.Math.Angle.Between(proj.sprite.x, proj.sprite.y, target.x, target.y);
    const maxTurn = Phaser.Math.DegToRad(homing.maxTurnDegreesPerStep);
    const angleDelta = Phaser.Math.Angle.Wrap(targetAngle - currentAngle);
    const nextAngle = currentAngle + Phaser.Math.Clamp(angleDelta, -maxTurn, maxTurn);

    proj.body.setVelocity(
      Math.cos(nextAngle) * currentSpeed,
      Math.sin(nextAngle) * currentSpeed,
    );
  }

  private selectHomingTarget(proj: TrackedProjectile, homing: ProjectileHomingConfig): HomingTargetCandidate | null {
    if (!this.homingTargetProvider) return null;

    const targetTypes = homing.targetTypes ?? DEFAULT_HOMING_TARGET_TYPES;
    const requireLineOfSight = homing.requireLineOfSight === true;
    const excludeOwner = homing.excludeOwner !== false;
    const searchRadius = Math.max(1, homing.searchRadius);
    const distanceWeight = Math.max(0, homing.distanceWeight ?? 1);
    const forwardWeight = Math.max(0, homing.forwardWeight ?? 1);
    const velocity = proj.body.velocity;
    const speed = velocity.length();
    const dirX = speed > 0.001 ? velocity.x / speed : 0;
    const dirY = speed > 0.001 ? velocity.y / speed : 0;

    const candidates = this.homingTargetProvider(homing, proj.ownerId).filter(candidate => {
      if (!targetTypes.includes(candidate.type)) return false;
      if (excludeOwner && candidate.id === proj.ownerId) return false;

      const distance = Phaser.Math.Distance.Between(proj.sprite.x, proj.sprite.y, candidate.x, candidate.y);
      if (distance > searchRadius) return false;
      if (requireLineOfSight && this.homingLineOfSightChecker) {
        return this.homingLineOfSightChecker(proj.sprite.x, proj.sprite.y, candidate.x, candidate.y);
      }
      return true;
    });

    if (candidates.length === 0) return null;

    if (proj.lockedTargetId) {
      const locked = candidates.find(candidate => candidate.id === proj.lockedTargetId && candidate.type === proj.lockedTargetType);
      if (locked) return locked;
    }

    let bestTarget: HomingTargetCandidate | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const candidate of candidates) {
      const distance = Phaser.Math.Distance.Between(proj.sprite.x, proj.sprite.y, candidate.x, candidate.y);
      const distanceScore = 1 - Phaser.Math.Clamp(distance / searchRadius, 0, 1);
      let forwardScore = 0.5;

      if (speed > 0.001) {
        const toTargetX = (candidate.x - proj.sprite.x) / distance;
        const toTargetY = (candidate.y - proj.sprite.y) / distance;
        forwardScore = Phaser.Math.Clamp((dirX * toTargetX + dirY * toTargetY + 1) * 0.5, 0, 1);
      }

      const score = distanceScore * distanceWeight + forwardScore * forwardWeight;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = candidate;
      }
    }

    return bestTarget;
  }

  /**
   * Host: Snapshot der aktiven Projektile (für Kollisionserkennung im CombatSystem).
   */
  getActiveProjectiles(): readonly TrackedProjectile[] {
    return this.projectiles.filter(proj => !proj.pendingDestroy);
  }

  /**
   * Host: Gibt ein aktives Projektil anhand seiner ID zurück.
   */
  getProjectileById(id: number): TrackedProjectile | undefined {
    return this.projectiles.find(p => p.id === id && !p.pendingDestroy);
  }

  getShadowSamples(): ShadowProjectileSample[] {
    if (this.projectiles.length > 0) {
      return this.projectiles
        .filter((projectile) => projectile.sprite.active && !projectile.pendingDestroy)
        .map((projectile) => ({
          id: projectile.id,
          x: projectile.sprite.x,
          y: projectile.sprite.y,
          size: Math.max(projectile.sprite.displayWidth, projectile.sprite.displayHeight),
          style: projectile.projectileStyle,
        }));
    }

    const now = performance.now();
    const samples: ShadowProjectileSample[] = [];
    for (const [id, state] of this.clientProjStates) {
      const extrapolated = this.extrapolateClientProjectileState(state, now);
      if (!extrapolated) continue;
      samples.push({
        id,
        x: extrapolated.x,
        y: extrapolated.y,
        size: state.size,
        style: state.style as ProjectileStyle | undefined,
      });
    }
    return samples;
  }

  /**
   * Host: Einzelnes Projektil sofort zerstören (z.B. nach Spielertreffer).
   */
  destroyProjectile(id: number): void {
    const idx = this.projectiles.findIndex(p => p.id === id);
    if (idx === -1) return;
    const proj = this.projectiles[idx];
    this.destroyTrackedProjectile(proj);
    this.projectiles.splice(idx, 1);
  }

  triggerProjectileExplosion(id: number): boolean {
    const proj = this.projectiles.find(p => p.id === id && !p.pendingDestroy);
    if (!proj?.explosion) return false;
    this.queueProjectileExplosion(proj);
    return true;
  }

  /**
   * Zerstört alle aktiven Projektile und ihre Collider.
   * Muss vor ArenaBuilder.destroyDynamic() aufgerufen werden.
   */
  destroyAll(): void {
    for (const proj of this.projectiles) {
      this.destroyTrackedProjectile(proj);
    }
    this.projectiles = [];
    this.bulletRenderer?.destroyAll();
    this.tracerRenderer?.destroyAll();
    this.flameRenderer?.destroyAll();
    this.bfgRenderer?.destroyAll();
    this.gaussRenderer?.destroyAll();
    this.energyBallRenderer?.destroyAll();
    this.hydraRenderer?.destroyAll();
    this.grenadeRenderer?.destroyAll();
    this.holyGrenadeRenderer?.destroyAll();
    this.rocketRenderer?.destroyAll();
    this.sporeRenderer?.destroyAll();
    this.translocatorPuckRenderer?.destroyAll();
    this.pendingProjectileExplosions = [];
    for (const sprite of this.clientVisuals.values()) sprite.destroy();
    this.clientVisuals.clear();
    this.clientProjStates.clear();
  }

  /**
   * Host: Abgelaufene/explodierte Projektile entfernen, aktuelle Positionen zurückgeben.
   * Granaten die ihre fuseTime erreicht haben werden als ExplodedGrenade zurückgegeben.
   */
  hostUpdate(deltaMs = 16.67): {
    synced: SyncedProjectile[];
    explodedProjectiles: ExplodedProjectile[];
    explodedGrenades: ExplodedGrenade[];
    countdownEvents: Array<{ x: number; y: number; value: number }>;
  } {
    const now              = Date.now();
    const explodedProjectiles = this.pendingProjectileExplosions.splice(0);
    const explodedGrenades: ExplodedGrenade[] = [];
    const countdownEvents: Array<{ x: number; y: number; value: number }> = [];
    const renderer         = this.bulletRenderer;

    this.projectiles = this.projectiles.filter(proj => {
      if (proj.pendingDestroy) {
        this.destroyTrackedProjectile(proj);
        return false;
      }

      const age = now - proj.createdAt;

      if (proj.isGrenade) {
        // Granate explodiert nach fuseTime ODER wenn Abprall-Limit erreicht
        const fuseExpired = age >= proj.fuseTime!;
        const bouncedOut  = proj.maxBounces > 0 && proj.bounceCount >= proj.maxBounces;
        if ((fuseExpired || bouncedOut) && proj.grenadeEffect) {
          explodedGrenades.push({
            x:      proj.sprite.x,
            y:      proj.sprite.y,
            ownerId: proj.ownerId,
            effect: proj.grenadeEffect,
          });
          this.scene.physics.world.off('worldbounds', proj.boundsListener);
          for (const c of proj.colliders) c.destroy();
          proj.sprite.destroy();
          return false;
        }

        // Countdown-Emission für Granaten mit langer Zündzeit (≥ 1500ms)
        const fuseTime = proj.fuseTime ?? 0;
        if (fuseTime >= 1500) {
          const remainingSeconds = Math.max(0, Math.ceil((fuseTime - age) / 1000));
          if (remainingSeconds > 0 && proj.lastCountdownEmitted !== remainingSeconds) {
            proj.lastCountdownEmitted = remainingSeconds;
            countdownEvents.push({ x: proj.sprite.x, y: proj.sprite.y, value: remainingSeconds });
          }
        }

        // Erweiterte Flugphysik (Air Friction) – Phaser-Damping nach Delay aktivieren
        if (proj.airFrictionDecayPerSec !== undefined && !proj.frictionActivated) {
          if (proj.frictionDelayMs === undefined || age >= proj.frictionDelayMs) {
            proj.body.setDrag(proj.airFrictionDecayPerSec, proj.airFrictionDecayPerSec);
            proj.frictionActivated = true;
          }
        }
        // Stop-Threshold: unter Mindestgeschwindigkeit komplett anhalten
        if (proj.frictionActivated && proj.stopSpeedThreshold !== undefined) {
          const speedSq = proj.body.velocity.lengthSq();
          if (speedSq > 0 && speedSq < proj.stopSpeedThreshold * proj.stopSpeedThreshold) {
            proj.body.setVelocity(0, 0);
          }
        }

        proj.bounceProcessedThisStep = false;
        proj.velocityAfterFirstBounce = undefined;

        return true;
      } else {
        if (proj.remainingRangePx !== undefined) {
          const traveledDistance = Phaser.Math.Distance.Between(proj.lastX, proj.lastY, proj.sprite.x, proj.sprite.y);
          if (traveledDistance > 0.01) {
            proj.remainingRangePx = Math.max(0, proj.remainingRangePx - traveledDistance);
          }
        }

        // Normales Projektil: Lifetime oder Max-Bounces
        if (age > proj.lifetime && proj.explosion) {
          explodedProjectiles.push({
            x: proj.sprite.x,
            y: proj.sprite.y,
            ownerId: proj.ownerId,
            effect: proj.explosion,
          });
          this.destroyTrackedProjectile(proj);
          return false;
        }

        if (age > proj.lifetime && proj.impactCloud) {
          this.emitProjectileImpact(proj, proj.sprite.x, proj.sprite.y);
          this.destroyTrackedProjectile(proj);
          return false;
        }

        if (this.shouldUseContinuousRockCollision(proj)) {
          this.resolveContinuousRockCollision(proj);
          if (proj.pendingDestroy) {
            this.destroyTrackedProjectile(proj);
            return false;
          }
        }

        const rangeDepleted = proj.remainingRangePx !== undefined && proj.remainingRangePx <= 0.5;
        const dead = age > proj.lifetime || rangeDepleted || proj.bounceCount > proj.maxBounces;
        if (dead) {
          this.destroyTrackedProjectile(proj);
        } else if (proj.isFlame) {
          // Flammen-Hitbox: wachsen + verlangsamen
          this.updateFlameHitbox(proj, deltaMs / 1000);
        } else if (proj.isBfg) {
          // BFG: Laser-Salven in regelmäßigen Intervallen abfeuern
          const bfgNow = Date.now();
          const interval = proj.bfgLaserInterval ?? 100;
          if (!proj.lastBfgLaserAt || bfgNow - proj.lastBfgLaserAt >= interval) {
            proj.lastBfgLaserAt = bfgNow;
            this.bfgLaserCallback?.(proj);
          }
        } else if (proj.homing) {
          this.updateHomingProjectile(proj, now);
        }

        // Erweiterte Flugphysik (Air Friction) – Phaser-Damping nach Delay aktivieren
        if (proj.airFrictionDecayPerSec !== undefined && !proj.frictionActivated) {
          if (proj.frictionDelayMs === undefined || age >= proj.frictionDelayMs) {
            proj.body.setDrag(proj.airFrictionDecayPerSec, proj.airFrictionDecayPerSec);
            proj.frictionActivated = true;
          }
        }
        // Stop-Threshold: unter Mindestgeschwindigkeit komplett anhalten
        if (proj.frictionActivated && proj.stopSpeedThreshold !== undefined) {
          const speedSq = proj.body.velocity.lengthSq();
          if (speedSq > 0 && speedSq < proj.stopSpeedThreshold * proj.stopSpeedThreshold) {
            proj.body.setVelocity(0, 0);
          }
        }

        // Anti-Tunneling: Body-Ausrichtung nach Bounce aktualisieren
        if (proj.originalBodySize !== undefined) {
          const pvx = Math.abs(proj.body.velocity.x);
          const pvy = Math.abs(proj.body.velocity.y);
          const spd = Math.sqrt(pvx * pvx + pvy * pvy);
          if (spd > 1) {
            const orig = proj.originalBodySize;
            const bw = Math.max(orig, (pvx / spd) * MIN_BODY_LEN);
            const bh = Math.max(orig, (pvy / spd) * MIN_BODY_LEN);
            proj.body.setSize(bw, bh);
            proj.body.setOffset((orig - bw) / 2, (orig - bh) / 2);
          }
        }

        proj.lastX = proj.sprite.x;
        proj.lastY = proj.sprite.y;
        proj.bounceProcessedThisStep = false;
        proj.velocityAfterFirstBounce = undefined;

        return !dead;
      }
    });

    // BulletRenderer-Visuals an Physik-Body synchronisieren (Bullet + AWP)
    if (renderer) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'bullet' || proj.projectileStyle === 'awp' || proj.projectileStyle === 'gauss') {
          renderer.syncToBody(
            proj.id, proj.sprite.x, proj.sprite.y,
            proj.body.velocity.x, proj.body.velocity.y,
          );
        }
      }
      // Verwaiste Bullet/AWP-Visuals entfernen
      const activeBulletIds = new Set(
        this.projectiles.filter(p => p.projectileStyle === 'bullet' || p.projectileStyle === 'awp' || p.projectileStyle === 'gauss').map(p => p.id),
      );
      for (const id of renderer.getActiveIds()) {
        if (!activeBulletIds.has(id)) renderer.destroyVisual(id);
      }
    }

    // FlameRenderer-Visuals an Physik-Body synchronisieren (Host rendert ebenfalls)
    const flames = this.flameRenderer;
    if (flames) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'flame') {
          if (!flames.has(proj.id)) {
            flames.createVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.sprite.displayWidth);
          }
          flames.updateVisual(
            proj.id, proj.sprite.x, proj.sprite.y,
            proj.sprite.displayWidth, proj.body.velocity.x, proj.body.velocity.y,
          );
        }
      }
      // Verwaiste Flame-Visuals entfernen (Projektil wurde zerstört)
      const activeFlameIds = new Set(
        this.projectiles.filter(p => p.projectileStyle === 'flame').map(p => p.id),
      );
      for (const id of flames.getActiveIds()) {
        if (!activeFlameIds.has(id)) flames.destroyVisual(id);
      }
    }

    // BfgRenderer-Visuals an Physik-Body synchronisieren (Host rendert ebenfalls)
    const bfgR = this.bfgRenderer;
    if (bfgR) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'bfg') {
          if (!bfgR.has(proj.id)) {
            bfgR.createVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.sprite.displayWidth);
          }
          bfgR.updateVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.sprite.displayWidth);
        }
      }
      // Verwaiste BFG-Visuals entfernen
      const activeBfgIds = new Set(
        this.projectiles.filter(p => p.projectileStyle === 'bfg').map(p => p.id),
      );
      for (const id of bfgR.getActiveIds()) {
        if (!activeBfgIds.has(id)) bfgR.destroyVisual(id);
      }
    }

    const gaussR = this.gaussRenderer;
    if (gaussR) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'gauss') {
          if (!gaussR.has(proj.id)) {
            gaussR.createVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.sprite.displayWidth, proj.color);
          }
          gaussR.updateVisual(
            proj.id,
            proj.sprite.x,
            proj.sprite.y,
            proj.sprite.displayWidth,
            proj.body.velocity.x,
            proj.body.velocity.y,
            proj.color,
          );
        }
      }
      const activeGaussIds = new Set(
        this.projectiles.filter(p => p.projectileStyle === 'gauss').map(p => p.id),
      );
      for (const id of gaussR.getActiveIds()) {
        if (!activeGaussIds.has(id)) gaussR.destroyVisual(id);
      }
    }

    const energyBallR = this.energyBallRenderer;
    if (energyBallR) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'energy_ball') {
          if (!energyBallR.has(proj.id)) {
            energyBallR.createVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.sprite.displayWidth, proj.color, proj.energyBallVariant);
          }
          energyBallR.updateVisual(
            proj.id,
            proj.sprite.x,
            proj.sprite.y,
            proj.sprite.displayWidth,
            proj.body.velocity.x,
            proj.body.velocity.y,
            proj.color,
            proj.energyBallVariant,
          );
        }
      }
      const activeEnergyBallIds = new Set(
        this.projectiles.filter(p => p.projectileStyle === 'energy_ball').map(p => p.id),
      );
      for (const id of energyBallR.getActiveIds()) {
        if (!activeEnergyBallIds.has(id)) energyBallR.destroyVisual(id);
      }
    }

    const hydraR = this.hydraRenderer;
    if (hydraR) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'hydra') {
          if (!hydraR.has(proj.id)) {
            hydraR.createVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.sprite.displayWidth, proj.color);
          }
          hydraR.updateVisual(
            proj.id,
            proj.sprite.x,
            proj.sprite.y,
            proj.sprite.displayWidth,
            proj.body.velocity.x,
            proj.body.velocity.y,
            proj.color,
          );
        }
      }
      const activeHydraIds = new Set(
        this.projectiles.filter(p => p.projectileStyle === 'hydra').map(p => p.id),
      );
      for (const id of hydraR.getActiveIds()) {
        if (!activeHydraIds.has(id)) hydraR.destroyVisual(id);
      }
    }

    const holyGrenadeR = this.holyGrenadeRenderer;
    if (holyGrenadeR) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'holy_grenade') {
          if (!holyGrenadeR.has(proj.id)) {
            holyGrenadeR.createVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.sprite.displayWidth);
          }
          holyGrenadeR.updateVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.sprite.displayWidth, proj.body.velocity.x, proj.body.velocity.y);
        }
      }
      const activeHolyGrenadeIds = new Set(
        this.projectiles.filter(p => p.projectileStyle === 'holy_grenade').map(p => p.id),
      );
      for (const id of holyGrenadeR.getActiveIds()) {
        if (!activeHolyGrenadeIds.has(id)) holyGrenadeR.destroyVisual(id);
      }
    }

    const rocketR = this.rocketRenderer;
    if (rocketR) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'rocket') {
          if (!rocketR.has(proj.id)) {
            rocketR.createVisual(
              proj.id,
              proj.sprite.x,
              proj.sprite.y,
              proj.sprite.displayWidth,
              proj.color,
              proj.ownerColor ?? proj.color,
              proj.smokeTrailColor ?? proj.color,
            );
          }
          rocketR.updateVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.sprite.displayWidth, proj.body.velocity.x, proj.body.velocity.y);
        }
      }
      const activeRocketIds = new Set(
        this.projectiles.filter(p => p.projectileStyle === 'rocket').map(p => p.id),
      );
      for (const id of rocketR.getActiveIds()) {
        if (!activeRocketIds.has(id)) rocketR.destroyVisual(id);
      }
    }

    const sporeR = this.sporeRenderer;
    if (sporeR) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'spore') {
          if (!sporeR.has(proj.id)) {
            sporeR.createVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.sprite.displayWidth, proj.color);
          }
          sporeR.updateVisual(
            proj.id,
            proj.sprite.x,
            proj.sprite.y,
            proj.sprite.displayWidth,
            proj.body.velocity.x,
            proj.body.velocity.y,
            proj.color,
          );
        }
      }
      const activeSporeIds = new Set(
        this.projectiles.filter(p => p.projectileStyle === 'spore').map(p => p.id),
      );
      for (const id of sporeR.getActiveIds()) {
        if (!activeSporeIds.has(id)) sporeR.destroyVisual(id);
      }
    }

    const grenadeR = this.grenadeRenderer;
    if (grenadeR) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'grenade') {
          if (!grenadeR.has(proj.id)) {
            grenadeR.createVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.sprite.displayWidth, proj.grenadeVisualPreset ?? 'he', proj.ownerColor ?? proj.color);
          }
          grenadeR.updateVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.sprite.displayWidth, proj.body.velocity.x, proj.body.velocity.y);
        }
      }
      const activeGrenadeIds = new Set(
        this.projectiles.filter(p => p.projectileStyle === 'grenade').map(p => p.id),
      );
      for (const id of grenadeR.getActiveIds()) {
        if (!activeGrenadeIds.has(id)) grenadeR.destroyVisual(id);
      }
    }

    // TranslocatorPuckRenderer-Visuals an Physik-Body synchronisieren (Host rendert ebenfalls)
    const tlPuckR = this.translocatorPuckRenderer;
    if (tlPuckR) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'translocator_puck') {
          if (!tlPuckR.has(proj.id)) {
            tlPuckR.createVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.ownerColor ?? proj.color);
          }
          tlPuckR.updateVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.ownerColor ?? proj.color);
        }
      }
      const activePuckIds = new Set(
        this.projectiles.filter(p => p.projectileStyle === 'translocator_puck').map(p => p.id),
      );
      for (const id of tlPuckR.getActiveIds()) {
        if (!activePuckIds.has(id)) tlPuckR.destroyVisual(id);
      }
    }

    // TracerRenderer-Visuals aktualisieren (Host rendert Tracer ebenfalls)
    const tracerR = this.tracerRenderer;
    if (tracerR) {
      for (const proj of this.projectiles) {
        if (proj.tracerConfig) {
          tracerR.updateTracer(proj.id, proj.sprite.x, proj.sprite.y,
            proj.body.velocity.x, proj.body.velocity.y);
        }
      }
      // Verwaiste Tracer-Visuals entfernen
      const activeTracerIds = new Set(
        this.projectiles.filter(p => p.tracerConfig).map(p => p.id),
      );
      for (const id of tracerR.getActiveIds()) {
        if (!activeTracerIds.has(id)) tracerR.destroyTracer(id);
      }
    }

    const synced: SyncedProjectile[] = this.projectiles.map(p => ({
      id:     p.id,
      ownerId: p.ownerId,
      x:      Math.round(p.sprite.x),
      y:      Math.round(p.sprite.y),
      vx:     Math.round(p.body.velocity.x),
      vy:     Math.round(p.body.velocity.y),
      size:   Math.round(p.sprite.displayWidth),
      color:  p.color,
      allowTeamDamage: p.allowTeamDamage,
      ownerColor: p.ownerColor,
      smokeTrailColor: p.smokeTrailColor,
      style:  p.projectileStyle,
      bulletVisualPreset: p.bulletVisualPreset,
      grenadeVisualPreset: p.grenadeVisualPreset,
      energyBallVariant: p.energyBallVariant,
      tracer: p.tracerConfig,
      shotAudioKey: p.shotAudioKey,
      shotAudioVolume: p.shotAudioVolume,
      suppressSpawnFx: p.suppressSpawnFx,
    }));

    return { synced, explodedProjectiles, explodedGrenades, countdownEvents };
  }

  // ── Client ────────────────────────────────────────────────────────────────

  /**
   * Client: Empfängt neue Server-Snapshots und speichert den State für Extrapolation.
   * Erstellt/entfernt visuelle Sprites. Positionsupdate passiert in clientExtrapolate().
   */
  clientSyncVisuals(data: SyncedProjectile[], localPlayerId?: string): void {
    const now       = performance.now();
    const activeIds = new Set(data.map(d => d.id));
    const renderer  = this.bulletRenderer;
    const flames    = this.flameRenderer;
    const rockets   = this.rocketRenderer;
    const spores = this.sporeRenderer;
    const energyBalls = this.energyBallRenderer;
    const hydras = this.hydraRenderer;
    const grenades = this.grenadeRenderer;
    const holyGrenades = this.holyGrenadeRenderer;
    const tlPucks = this.translocatorPuckRenderer;
    const incomingHydras = data.filter((proj) => proj.style === 'hydra');
    const newIncomingHydraIds = new Set(
      incomingHydras
        .filter((proj) => !this.clientProjStates.has(proj.id))
        .map((proj) => proj.id),
    );

    // Verwaiste Visuals und States entfernen
    for (const [id, sprite] of this.clientVisuals) {
      if (!activeIds.has(id)) {
        sprite.destroy();
        this.clientVisuals.delete(id);
        this.clientProjStates.delete(id);
      }
    }
    if (renderer) {
      for (const id of renderer.getActiveIds()) {
        if (!activeIds.has(id)) {
          renderer.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (flames) {
      for (const id of flames.getActiveIds()) {
        if (!activeIds.has(id)) {
          flames.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (rockets) {
      for (const id of rockets.getActiveIds()) {
        if (!activeIds.has(id)) {
          rockets.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (spores) {
      for (const id of spores.getActiveIds()) {
        if (!activeIds.has(id)) {
          const state = this.clientProjStates.get(id);
          if (state?.style === 'spore') {
            spores.playImpact(state.serverX, state.serverY, state.color, Math.max(state.size / 16, 0.9));
          }
          spores.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (energyBalls) {
      for (const id of energyBalls.getActiveIds()) {
        if (!activeIds.has(id)) {
          const state = this.clientProjStates.get(id);
          if (state?.style === 'energy_ball') {
            energyBalls.playImpact(state.serverX, state.serverY, state.color, state.energyBallVariant, state.size / 16);
          }
          energyBalls.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (hydras) {
      for (const id of hydras.getActiveIds()) {
        if (!activeIds.has(id)) {
          const state = this.clientProjStates.get(id);
          if (state?.style === 'hydra') {
            const splitChildren = incomingHydras
              .filter((proj) => newIncomingHydraIds.has(proj.id) && proj.suppressSpawnFx)
              .filter((proj) => proj.color === state.color)
              .filter((proj) => Phaser.Math.Distance.Between(state.serverX, state.serverY, proj.x, proj.y) <= Math.max(state.size * 1.5, 22))
              .map((proj) => Math.atan2(proj.vy, proj.vx));
            if (splitChildren.length > 0) {
              hydras.playSplitImpact(state.serverX, state.serverY, state.color, splitChildren, Math.max(state.size / 16, 0.95));
            } else {
              hydras.playImpact(state.serverX, state.serverY, state.color, Math.max(state.size / 16, 0.95));
            }
          }
          hydras.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (grenades) {
      for (const id of grenades.getActiveIds()) {
        if (!activeIds.has(id)) {
          grenades.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (holyGrenades) {
      for (const id of holyGrenades.getActiveIds()) {
        if (!activeIds.has(id)) {
          holyGrenades.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (tlPucks) {
      for (const id of tlPucks.getActiveIds()) {
        if (!activeIds.has(id)) {
          tlPucks.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    const bfgR = this.bfgRenderer;
    if (bfgR) {
      for (const id of bfgR.getActiveIds()) {
        if (!activeIds.has(id)) {
          bfgR.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    const tracerRc = this.tracerRenderer;
    if (tracerRc) {
      for (const id of tracerRc.getActiveIds()) {
        if (!activeIds.has(id)) tracerRc.destroyTracer(id);
      }
    }

    // Server-State aktualisieren und neue Visuals erstellen
    for (const proj of data) {
      const isBullet = proj.style === 'bullet';
      const isFlame  = proj.style === 'flame';
      const isEnergyBallP = proj.style === 'energy_ball';
      const isHydraP = proj.style === 'hydra';
      const isSporeP = proj.style === 'spore';
      const isBfgP   = proj.style === 'bfg';
      const isHolyGrenadeP = proj.style === 'holy_grenade';
      const isAwpP   = proj.style === 'awp';
      const isGaussP = proj.style === 'gauss';
      const isRocket = proj.style === 'rocket';
      const isGrenadeP = proj.style === 'grenade';
      const bulletPreset = resolveBulletVisualPreset(proj.style, proj.bulletVisualPreset);

      // Bounce-Erkennung: Velocity-Richtungswechsel zwischen zwei Server-Snapshots
      const prev = this.clientProjStates.get(proj.id);
      const velocityFlipped = prev && (isBullet || isAwpP || isGaussP) &&
        (prev.vx * proj.vx < -1 || prev.vy * proj.vy < -1);
      // Tracer-Spawn nach Abpraller zurücksetzen (vor dem Tracer-Update weiter unten)
      if (velocityFlipped && tracerRc && tracerRc.has(proj.id)) {
        tracerRc.notifyBounce(proj.id, proj.x, proj.y);
      }

      // Extrapolations-State speichern/aktualisieren
      this.clientProjStates.set(proj.id, {
        serverX: proj.x,
        serverY: proj.y,
        vx: proj.vx,
        vy: proj.vy,
        size: proj.size,
        color: proj.color,
        receivedAt: now,
        style: proj.style,
        bulletVisualPreset: proj.bulletVisualPreset,
        grenadeVisualPreset: proj.grenadeVisualPreset,
        energyBallVariant: proj.energyBallVariant,
        ownerColor: proj.ownerColor,
        isFlame,
      });

      if (!prev && !proj.suppressSpawnFx) {
        const ownerPos = this.ownerPositionProvider?.(proj.ownerId) ?? null;
        const flashOrigin = ownerPos
          ? getTopDownMuzzleOriginFromVector(ownerPos.x, ownerPos.y, proj.vx, proj.vy)
          : getTopDownMuzzleOriginFromVector(
              proj.x - (Math.hypot(proj.vx, proj.vy) > 0.0001 ? (proj.vx / Math.hypot(proj.vx, proj.vy)) * MUZZLE_PROJECTILE_FALLBACK_BACKTRACK : 0),
              proj.y - (Math.hypot(proj.vx, proj.vy) > 0.0001 ? (proj.vy / Math.hypot(proj.vx, proj.vy)) * MUZZLE_PROJECTILE_FALLBACK_BACKTRACK : 0),
              proj.vx,
              proj.vy,
            );
        this.muzzleFlashRenderer?.playProjectileFlash(
          flashOrigin.x,
          flashOrigin.y,
          proj.vx,
          proj.vy,
          proj.style as ProjectileStyle | undefined,
          proj.bulletVisualPreset,
          proj.energyBallVariant,
          proj.ownerColor ?? proj.color,
        );
        // Kein Audio für eigene Waffen-Projektile – Prediction in ClientUpdateCoordinator hat es schon abgespielt.
        // Granaten haben keine Prediction, daher hier immer abspielen.
        // Utility-Projektile haben keine Prediction → Audio immer abspielen.
        const isUtilityProjectile = proj.style === 'grenade' || proj.style === 'holy_grenade' || proj.style === 'bfg';
        if (proj.ownerId !== localPlayerId || isUtilityProjectile) {
          this.audioSystem?.playSound(proj.shotAudioKey, flashOrigin.x, flashOrigin.y, proj.ownerId, proj.shotAudioVolume);
        }
      }

      if (isBfgP && bfgR) {
        if (!bfgR.has(proj.id)) {
          bfgR.createVisual(proj.id, proj.x, proj.y, proj.size);
        }
        bfgR.updateVisual(proj.id, proj.x, proj.y, proj.size);
      } else if (isHolyGrenadeP && holyGrenades) {
        if (!holyGrenades.has(proj.id)) {
          holyGrenades.createVisual(proj.id, proj.x, proj.y, proj.size);
        }
        holyGrenades.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if (isEnergyBallP && energyBalls) {
        if (!energyBalls.has(proj.id)) {
          energyBalls.createVisual(proj.id, proj.x, proj.y, proj.size, proj.color, proj.energyBallVariant);
        }
        energyBalls.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy, proj.color, proj.energyBallVariant);
      } else if (isHydraP && hydras) {
        if (!hydras.has(proj.id)) {
          hydras.createVisual(proj.id, proj.x, proj.y, proj.size, proj.color);
        }
        hydras.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy, proj.color);
      } else if (isSporeP && spores) {
        if (!spores.has(proj.id)) {
          spores.createVisual(proj.id, proj.x, proj.y, proj.size, proj.color);
        }
        spores.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy, proj.color);
      } else if (isGrenadeP && grenades) {
        if (!grenades.has(proj.id)) {
          grenades.createVisual(proj.id, proj.x, proj.y, proj.size, proj.grenadeVisualPreset ?? 'he', proj.ownerColor ?? proj.color);
        }
        grenades.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if (proj.style === 'translocator_puck' && tlPucks) {
        if (!tlPucks.has(proj.id)) {
          tlPucks.createVisual(proj.id, proj.x, proj.y, proj.ownerColor ?? proj.color);
        }
        tlPucks.updateVisual(proj.id, proj.x, proj.y, proj.ownerColor ?? proj.color);
      } else if (isRocket && rockets) {
        if (!rockets.has(proj.id)) {
          rockets.createVisual(
            proj.id,
            proj.x,
            proj.y,
            proj.size,
            proj.color,
            proj.ownerColor ?? proj.color,
            proj.smokeTrailColor ?? proj.color,
          );
        }
        rockets.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if (isFlame && flames) {
        if (!flames.has(proj.id)) {
          flames.createVisual(proj.id, proj.x, proj.y, proj.size);
        }
        flames.updateVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if ((isAwpP || isGaussP) && renderer) {
        if (!renderer.has(proj.id)) {
          renderer.createVisual(proj.id, proj.x, proj.y, proj.size, proj.color, bulletPreset, proj.ownerColor ?? proj.color);
        }
        renderer.syncToBody(proj.id, proj.x, proj.y, proj.vx, proj.vy);
        if (velocityFlipped) {
          renderer.playImpactSparks(proj.id, proj.x, proj.y, proj.vx, proj.vy, proj.color);
        }
      } else if (isBullet && renderer) {
        if (!renderer.has(proj.id)) {
          renderer.createVisual(proj.id, proj.x, proj.y, proj.size, proj.color, bulletPreset, proj.ownerColor ?? proj.color);
        }
        renderer.updatePosition(proj.id, proj.x, proj.y, proj.vx, proj.vy);
        if (velocityFlipped) {
          renderer.playImpactSparks(proj.id, proj.x, proj.y, proj.vx, proj.vy, proj.color);
        }
      } else {
        const existing = this.clientVisuals.get(proj.id);
        if (!existing) {
          const isBall = proj.style === 'ball' || proj.style === 'hydra';
          const sprite: Phaser.GameObjects.Shape = isBall
            ? this.scene.add.circle(proj.x, proj.y, proj.size / 2, proj.color)
            : this.scene.add.rectangle(proj.x, proj.y, proj.size, proj.size, proj.color);
          sprite.setDepth(DEPTH.PROJECTILES);
          this.clientVisuals.set(proj.id, sprite);
        } else {
          existing.setPosition(proj.x, proj.y);
        }
      }

      // Tracer (unabhängig vom Renderer-Typ, data-driven via proj.tracer)
      if (proj.tracer && tracerRc) {
        if (!tracerRc.has(proj.id)) {
          tracerRc.createTracer(proj.id, proj.x, proj.y, proj.tracer, proj.ownerColor ?? proj.color);
        }
        tracerRc.updateTracer(proj.id, proj.x, proj.y, proj.vx, proj.vy);
      }
    }
  }

  /**
   * Client: Extrapoliert Projektil-Positionen zwischen Netzwerk-Ticks.
   * Wird jeden Render-Frame aufgerufen (unabhängig von der Netzwerk-Tick-Rate).
   *
   * Bullets/Balls: Lineare Extrapolation (konstante Velocity).
   * Flames: Exponentielle Velocity-Decay (gleiche Formel wie Host).
   */
  clientExtrapolate(): void {
    const now      = performance.now();
    const renderer = this.bulletRenderer;
    const flames   = this.flameRenderer;

    for (const [id, state] of this.clientProjStates) {
      const extrapolated = this.extrapolateClientProjectileState(state, now);
      if (!extrapolated) continue;

      const { x: ex, y: ey, velocityX, velocityY } = extrapolated;

      const bfgRe = this.bfgRenderer;
      if (state.style === 'bfg' && bfgRe && bfgRe.has(id)) {
        bfgRe.updateVisual(id, ex, ey, state.size);
      } else if (state.style === 'gauss' && this.gaussRenderer?.has(id)) {
        this.gaussRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY, state.color);
      } else if (state.style === 'grenade' && this.grenadeRenderer?.has(id)) {
        this.grenadeRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY);
      } else if (state.style === 'holy_grenade' && this.holyGrenadeRenderer?.has(id)) {
        this.holyGrenadeRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY);
      } else if (state.style === 'energy_ball' && this.energyBallRenderer?.has(id)) {
        this.energyBallRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY, state.color, state.energyBallVariant);
      } else if (state.style === 'hydra' && this.hydraRenderer?.has(id)) {
        this.hydraRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY, state.color);
      } else if (state.style === 'spore' && this.sporeRenderer?.has(id)) {
        this.sporeRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY, state.color);
      } else if (state.style === 'translocator_puck' && this.translocatorPuckRenderer?.has(id)) {
        this.translocatorPuckRenderer.updateVisual(id, ex, ey, state.ownerColor ?? state.color);
      } else if (state.style === 'rocket' && this.rocketRenderer?.has(id)) {
        this.rocketRenderer.updateVisual(id, ex, ey, state.size, velocityX, velocityY);
      } else if (state.style === 'flame' && flames && flames.has(id)) {
        flames.updateVisual(id, ex, ey, state.size, velocityX, velocityY);
      } else if ((state.style === 'awp' || state.style === 'gauss') && renderer && renderer.has(id)) {
        renderer.syncToBody(id, ex, ey, velocityX, velocityY);
      } else if (state.style === 'bullet' && renderer && renderer.has(id)) {
        renderer.updatePosition(id, ex, ey, velocityX, velocityY);
      } else {
        const sprite = this.clientVisuals.get(id);
        if (sprite) sprite.setPosition(ex, ey);
      }

      // Tracer: unabhängig vom Renderer, wenn vorhanden
      const tracerRe = this.tracerRenderer;
      if (tracerRe && tracerRe.has(id)) {
        tracerRe.updateTracer(id, ex, ey, velocityX, velocityY);
      }
    }
  }

  private extrapolateClientProjectileState(
    state: ClientProjectileState,
    now: number,
  ): { x: number; y: number; velocityX: number; velocityY: number } | null {
    const dt = (now - state.receivedAt) / 1000;
    if (dt <= 0) return null;

    if (state.isFlame) {
      const decay = 0.82;
      const lnDecay = Math.log(decay);
      const integralFactor = (1 - Math.pow(decay, dt)) / (-lnDecay);
      const decayFactor = Math.pow(decay, dt);
      return {
        x: state.serverX + state.vx * integralFactor,
        y: state.serverY + state.vy * integralFactor,
        velocityX: state.vx * decayFactor,
        velocityY: state.vy * decayFactor,
      };
    }

    return {
      x: state.serverX + state.vx * dt,
      y: state.serverY + state.vy * dt,
      velocityX: state.vx,
      velocityY: state.vy,
    };
  }
}

function projFallbackSign(value: number): number {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}
