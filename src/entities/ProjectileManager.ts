import Phaser from 'phaser';
import { DEPTH, MUZZLE_PROJECTILE_FALLBACK_BACKTRACK, getTopDownMuzzleOrigin, getTopDownMuzzleOriginFromVector } from '../config';
import type { BulletVisualPreset, GrenadeVisualPreset, TrackedProjectile, SyncedProjectile, ExplodedGrenade, ExplodedProjectile, ProjectileSpawnConfig, ProjectileHomingConfig, HomingTargetType, EnergyBallVariant, ProjectileStyle } from '../types';
import type { BulletRenderer }  from '../effects/BulletRenderer';
import type { FlameRenderer }   from '../effects/FlameRenderer';
import type { BfgRenderer }     from '../effects/BfgRenderer';
import type { EnergyBallRenderer } from '../effects/EnergyBallRenderer';
import type { GaussRenderer }   from '../effects/GaussRenderer';
import type { GrenadeRenderer } from '../effects/GrenadeRenderer';
import type { HolyGrenadeRenderer } from '../effects/HolyGrenadeRenderer';
import type { MuzzleFlashRenderer } from '../effects/MuzzleFlashRenderer';
import type { RocketRenderer }  from '../effects/RocketRenderer';
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

  // ── Gauss-Renderer (elektrische Overlay-Visuals) ───────────────────────
  private gaussRenderer: GaussRenderer | null = null;

  // ── Grenade-Renderer (HE/Smoke/Molotov) ────────────────────────────────
  private grenadeRenderer: GrenadeRenderer | null = null;

  // ── Holy-Grenade-Renderer (goldene Granate mit Kreuzstift) ─────────────
  private holyGrenadeRenderer: HolyGrenadeRenderer | null = null;

  // ── Rocket-Renderer (Raketenkörper + Rauchspur) ────────────────────────
  private rocketRenderer: RocketRenderer | null = null;

  // ── Translocator-Puck-Renderer ──────────────────────────────────────────
  private translocatorPuckRenderer: import('../effects/TranslocatorPuckRenderer').TranslocatorPuckRenderer | null = null;


  // ── Tracer-Renderer (data-driven Leuchtlinien, alle Projektilstile) ───────
  private tracerRenderer: TracerRenderer | null = null;

  // ── MuzzleFlash-Renderer (lokales Schuss-Feedback, kein Netzstate) ───────
  private muzzleFlashRenderer: MuzzleFlashRenderer | null = null;
  private ownerPositionProvider: ((ownerId: string) => { x: number; y: number } | null) | null = null;

  // ── BFG Laser-Callback (Host-only, injiziert von ArenaScene) ────────────
  private bfgLaserCallback: ((proj: TrackedProjectile) => void) | null = null;

  // ── Homing-Zielsuche (Host-only, injiziert von ArenaScene) ──────────────
  private homingTargetProvider: ((config: ProjectileHomingConfig, ownerId: string) => HomingTargetCandidate[]) | null = null;
  private homingLineOfSightChecker: ((sx: number, sy: number, ex: number, ey: number) => boolean) | null = null;

  // ── Host: gepufferte Explosionen explosiver Projektile ──────────────────
  private pendingProjectileExplosions: ExplodedProjectile[] = [];

  // ── Obstacle-Gruppen (werden nach Arena-Aufbau injiziert) ─────────────────
  private rockGroup:   Phaser.Physics.Arcade.StaticGroup | null = null;
  private rockObjects: (Phaser.GameObjects.Image | null)[] | null = null;
  private trunkGroup:  Phaser.Physics.Arcade.StaticGroup | null = null;
  private onRockHit:   ((rockId: number, damage: number) => void) | null = null;

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
  setRockHitCallback(cb: (rockId: number, damage: number) => void): void {
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

  setOwnerPositionProvider(provider: ((ownerId: string) => { x: number; y: number } | null) | null): void {
    this.ownerPositionProvider = provider;
  }

  /** Registriert den Callback für BFG-Laser-Salven (Host-only). */
  setBfgLaserCallback(cb: ((proj: TrackedProjectile) => void) | null): void {
    this.bfgLaserCallback = cb;
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
    const sprite: Phaser.GameObjects.Shape = (isBall || isEnergyBall)
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

    if (isEnergyBall && this.energyBallRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.energyBallRenderer.createVisual(id, x, y, cfg.size, cfg.color, cfg.energyBallVariant);
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
      bounceCount:    0,
      createdAt:      Date.now(),
      ownerId,
      color:          cfg.color,
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
      // Flammenwerfer-Felder
      isFlame:         cfg.isFlame,
      hitboxGrowRate:  cfg.hitboxGrowRate,
      hitboxMaxSize:   cfg.hitboxMaxSize,
      velocityDecay:   cfg.velocityDecay,
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
            onHit(idx, tracked.damage * rockMult);
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
      tracked.bounceCount++;
      applyBounceFriction();
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
        tracked.bounceCount++;
        applyBounceFriction();
        // Funken bei Fels-Aufprall
        if (isBullet || isAwp || isGauss) {
          playImpact(
            body.x + body.halfWidth, body.y + body.halfHeight,
            body.velocity.x, body.velocity.y,
            tracked.color,
          );
        }
        if (!applyRockDamage || !rockObjects || !onHit) return;
        const rockMult = tracked.rockDamageMult ?? 1;
        if (rockMult === 0) return;
        const idx = rockObjects.indexOf(rockGO as Phaser.GameObjects.Image);
        if (idx !== -1) onHit(idx, tracked.damage * rockMult);
        // Sofort stoppen, damit kein weiteres Objekt vor hostUpdate getroffen wird
        if (tracked.bounceCount > tracked.maxBounces) {
          body.setVelocity(0, 0);
          body.enable = false;
        }
      });
      tracked.colliders.push(rockCollider);
    }

    if (this.trunkGroup) {
      const trunkCollider = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
        tracked.bounceCount++;
        applyBounceFriction();
        // Funken bei Baumstamm-Aufprall
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
      });
      tracked.colliders.push(trunkCollider);
    }

    if (this.trainGroup) {
      const onTrainHit = this.onTrainHit;
      const trainCollider = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
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
        tracked.bounceCount++;
        applyBounceFriction();
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
    this.scene.physics.world.off('worldbounds', proj.boundsListener);
    for (const c of proj.colliders) c.destroy();
    proj.sprite.destroy();
    this.bulletRenderer?.destroyVisual(proj.id);
    this.tracerRenderer?.destroyTracer(proj.id);
    this.flameRenderer?.destroyVisual(proj.id);
    this.bfgRenderer?.destroyVisual(proj.id);
    this.gaussRenderer?.destroyVisual(proj.id);
    if (proj.projectileStyle === 'energy_ball') {
      this.energyBallRenderer?.playImpact(proj.sprite.x, proj.sprite.y, proj.color, proj.energyBallVariant, proj.sprite.displayWidth / 16);
    }
    this.energyBallRenderer?.destroyVisual(proj.id);
    this.grenadeRenderer?.destroyVisual(proj.id);
    this.holyGrenadeRenderer?.destroyVisual(proj.id);
    this.rocketRenderer?.destroyVisual(proj.id);
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
    });
    this.queueDestroyProjectile(proj);
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
    this.grenadeRenderer?.destroyAll();
    this.holyGrenadeRenderer?.destroyAll();
    this.rocketRenderer?.destroyAll();
    this.translocatorPuckRenderer?.destroyAll();
    this.pendingProjectileExplosions = [];
    for (const sprite of this.clientVisuals.values()) sprite.destroy();
    this.clientVisuals.clear();
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

        return true;
      } else {
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

        const dead = age > proj.lifetime || proj.bounceCount > proj.maxBounces;
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
      ownerColor: p.ownerColor,
      smokeTrailColor: p.smokeTrailColor,
      style:  p.projectileStyle,
      bulletVisualPreset: p.bulletVisualPreset,
      grenadeVisualPreset: p.grenadeVisualPreset,
      energyBallVariant: p.energyBallVariant,
      tracer: p.tracerConfig,
    }));

    return { synced, explodedProjectiles, explodedGrenades, countdownEvents };
  }

  // ── Client ────────────────────────────────────────────────────────────────

  /**
   * Client: Empfängt neue Server-Snapshots und speichert den State für Extrapolation.
   * Erstellt/entfernt visuelle Sprites. Positionsupdate passiert in clientExtrapolate().
   */
  clientSyncVisuals(data: SyncedProjectile[]): void {
    const now       = performance.now();
    const activeIds = new Set(data.map(d => d.id));
    const renderer  = this.bulletRenderer;
    const flames    = this.flameRenderer;
    const rockets   = this.rocketRenderer;
    const energyBalls = this.energyBallRenderer;
    const grenades = this.grenadeRenderer;
    const holyGrenades = this.holyGrenadeRenderer;
    const tlPucks = this.translocatorPuckRenderer;

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

      if (!prev) {
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
          const isBall = proj.style === 'ball';
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
      const dt = (now - state.receivedAt) / 1000; // Sekunden seit letztem Server-Update
      if (dt <= 0) continue;

      let ex: number, ey: number;

      if (state.isFlame) {
        // Flammen: exponentielle Velocity-Decay (velocityDecay ≈ 0.82 pro Sekunde)
        // Geschlossene Integralform: pos = serverPos + v₀ * (1 - decay^t) / (-ln(decay))
        const decay = 0.82; // Muss dem Config-Wert entsprechen
        const lnDecay = Math.log(decay); // negativ
        const integralFactor = (1 - Math.pow(decay, dt)) / (-lnDecay);
        ex = state.serverX + state.vx * integralFactor;
        ey = state.serverY + state.vy * integralFactor;
      } else {
        // Bullets/Balls: lineare Extrapolation
        ex = state.serverX + state.vx * dt;
        ey = state.serverY + state.vy * dt;
      }

      const bfgRe = this.bfgRenderer;
      if (state.style === 'bfg' && bfgRe && bfgRe.has(id)) {
        bfgRe.updateVisual(id, ex, ey, state.size);
      } else if (state.style === 'gauss' && this.gaussRenderer?.has(id)) {
        this.gaussRenderer.updateVisual(id, ex, ey, state.size, state.vx, state.vy, state.color);
      } else if (state.style === 'grenade' && this.grenadeRenderer?.has(id)) {
        this.grenadeRenderer.updateVisual(id, ex, ey, state.size, state.vx, state.vy);
      } else if (state.style === 'holy_grenade' && this.holyGrenadeRenderer?.has(id)) {
        this.holyGrenadeRenderer.updateVisual(id, ex, ey, state.size, state.vx, state.vy);
      } else if (state.style === 'energy_ball' && this.energyBallRenderer?.has(id)) {
        this.energyBallRenderer.updateVisual(id, ex, ey, state.size, state.vx, state.vy, state.color, state.energyBallVariant);
      } else if (state.style === 'translocator_puck' && this.translocatorPuckRenderer?.has(id)) {
        this.translocatorPuckRenderer.updateVisual(id, ex, ey, state.ownerColor ?? state.color);
      } else if (state.style === 'rocket' && this.rocketRenderer?.has(id)) {
        this.rocketRenderer.updateVisual(id, ex, ey, state.size, state.vx, state.vy);
      } else if (state.style === 'flame' && flames && flames.has(id)) {
        const decayFactor = Math.pow(0.82, dt);
        flames.updateVisual(id, ex, ey, state.size, state.vx * decayFactor, state.vy * decayFactor);
      } else if ((state.style === 'awp' || state.style === 'gauss') && renderer && renderer.has(id)) {
        renderer.syncToBody(id, ex, ey, state.vx, state.vy);
      } else if (state.style === 'bullet' && renderer && renderer.has(id)) {
        renderer.updatePosition(id, ex, ey, state.vx, state.vy);
      } else {
        const sprite = this.clientVisuals.get(id);
        if (sprite) sprite.setPosition(ex, ey);
      }

      // Tracer: unabhängig vom Renderer, wenn vorhanden
      const tracerRe = this.tracerRenderer;
      if (tracerRe && tracerRe.has(id)) {
        tracerRe.updateTracer(id, ex, ey, state.vx, state.vy);
      }
    }
  }
}
