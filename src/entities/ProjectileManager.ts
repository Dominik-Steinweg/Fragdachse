import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { TrackedProjectile, SyncedProjectile, ExplodedGrenade, ProjectileSpawnConfig } from '../types';
import type { BulletRenderer } from '../effects/BulletRenderer';
import type { FlameRenderer }  from '../effects/FlameRenderer';
import type { BfgRenderer }    from '../effects/BfgRenderer';
import type { AwpRenderer }    from '../effects/AwpRenderer';

/** Client-seitiger Projektil-State für Extrapolation zwischen Netzwerk-Ticks. */
interface ClientProjectileState {
  serverX: number;
  serverY: number;
  vx: number;
  vy: number;
  size: number;
  receivedAt: number;
  style?: string;
  // Flammenwerfer-Decay: velocity nimmt exponentiell ab
  isFlame: boolean;
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

  // ── AWP-Renderer (Rauchspur + Enhanced Bullet) ───────────────────────────
  private awpRenderer: AwpRenderer | null = null;

  // ── BFG Laser-Callback (Host-only, injiziert von ArenaScene) ────────────
  private bfgLaserCallback: ((proj: TrackedProjectile) => void) | null = null;

  // ── Obstacle-Gruppen (werden nach Arena-Aufbau injiziert) ─────────────────
  private rockGroup:   Phaser.Physics.Arcade.StaticGroup | null = null;
  private rockObjects: (Phaser.GameObjects.Rectangle | null)[] | null = null;
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
    objects:    (Phaser.GameObjects.Rectangle | null)[] | null,
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

  /** Injiziert den AwpRenderer für AWP-Projektil-Darstellung (Rauchspur). */
  setAwpRenderer(renderer: AwpRenderer | null): void {
    this.awpRenderer = renderer;
  }

  /** Registriert den Callback für BFG-Laser-Salven (Host-only). */
  setBfgLaserCallback(cb: ((proj: TrackedProjectile) => void) | null): void {
    this.bfgLaserCallback = cb;
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
  ): void {
    const id = this.nextId++;

    const isBall   = cfg.projectileStyle === 'ball';
    const isBullet = cfg.projectileStyle === 'bullet';
    const isFlame  = cfg.projectileStyle === 'flame';
    const isBfg    = cfg.projectileStyle === 'bfg';
    const isAwp    = cfg.projectileStyle === 'awp';

    // Physik-Shape: für 'bullet'/'flame'/'awp' unsichtbar (nur Kollisions-Body)
    const sprite: Phaser.GameObjects.Shape = isBall
      ? this.scene.add.circle(x, y, cfg.size / 2, cfg.color)
      : this.scene.add.rectangle(x, y, cfg.size, cfg.size, cfg.color);
    sprite.setDepth(DEPTH.PROJECTILES);

    if (isBullet && this.bulletRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.bulletRenderer.createBullet(id, x, y, cfg.size, cfg.color);
    }

    // AWP-Projektile sind unsichtbar (Rendering übernimmt AwpRenderer mit Rauchspur)
    if (isAwp && this.awpRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.awpRenderer.createVisual(id, x, y, cfg.size, cfg.color);
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

    const tracked: TrackedProjectile = {
      id,
      sprite,
      body,
      bounceCount:    0,
      createdAt:      Date.now(),
      ownerId,
      color:          cfg.color,
      boundsListener: () => {},
      colliders:      [],
      damage:         cfg.damage,
      lifetime:       cfg.lifetime,
      maxBounces:     cfg.maxBounces,
      isGrenade:      cfg.isGrenade,
      adrenalinGain:  cfg.adrenalinGain,
      weaponName:     cfg.weaponName ?? 'Waffe',
      fuseTime:        cfg.fuseTime,
      grenadeEffect:   cfg.grenadeEffect,
      projectileStyle: cfg.projectileStyle,
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
    };

    if (isBfg) {
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
          if (!tracked.bfgHitRocks) tracked.bfgHitRocks = new Set();
          const idx = rockObjects.indexOf(rockGO as Phaser.GameObjects.Rectangle);
          if (idx !== -1 && !tracked.bfgHitRocks.has(idx)) {
            tracked.bfgHitRocks.add(idx);
            onHit(idx, tracked.damage);
          }
        });
        tracked.colliders.push(c);
      }

      // Zug: Overlap → beschädigt Zug, Projektil fliegt weiter
      if (this.trainGroup) {
        const onTrainHit = this.onTrainHit;
        const c = this.scene.physics.add.overlap(sprite, this.trainGroup, () => {
          if (tracked.bfgHitTrain) return;
          tracked.bfgHitTrain = true;
          onTrainHit?.(tracked.damage, tracked.ownerId);
        });
        tracked.colliders.push(c);
      }
      // Trunks: kein Collider/Overlap – Projektil fliegt einfach durch

      // BfgRenderer-Visual erstellen (Host rendert ebenfalls)
      if (this.bfgRenderer) {
        this.bfgRenderer.createVisual(id, x, y, cfg.size);
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

    this.projectiles.push(tracked);
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
      // Zug: Flamme wird sofort zerstört (bewegliches Objekt – kein Lingern sinnvoll)
      const onTrainHit = this.onTrainHit;
      const c = this.scene.physics.add.overlap(sprite, this.trainGroup, () => {
        const trainMult = tracked.trainDamageMult ?? 1;
        if (trainMult !== 0) onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
        tracked.bounceCount = tracked.maxBounces;
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
    body.setBounce(1, 1);

    const isBullet     = tracked.projectileStyle === 'bullet';
    const isAwp        = tracked.projectileStyle === 'awp';
    const renderer     = this.bulletRenderer;
    const awpR         = this.awpRenderer;

    const playImpact = (bx: number, by: number, bvx: number, bvy: number, col: number) => {
      if (isAwp && awpR)     awpR.playImpactSparks(bx, by, bvx, bvy, col);
      else if (isBullet && renderer) renderer.playImpactSparks(bx, by, bvx, bvy, col);
    };

    const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
      if (hitBody !== body) return;
      tracked.bounceCount++;
      // Funken an Arena-Wand: Velocity ist nach Bounce bereits reflektiert
      if (isBullet || isAwp) {
        playImpact(
          body.x + body.halfWidth, body.y + body.halfHeight,
          body.velocity.x, body.velocity.y,
          tracked.color,
        );
      }
    };
    tracked.boundsListener = boundsListener;
    this.scene.physics.world.on('worldbounds', boundsListener);

    if (this.rockGroup) {
      const rockObjects = this.rockObjects;
      const onHit       = this.onRockHit;
      const rockCollider = this.scene.physics.add.collider(sprite, this.rockGroup, (_proj, rockGO) => {
        tracked.bounceCount++;
        // Funken bei Fels-Aufprall
        if (isBullet || isAwp) {
          playImpact(
            body.x + body.halfWidth, body.y + body.halfHeight,
            body.velocity.x, body.velocity.y,
            tracked.color,
          );
        }
        if (!applyRockDamage || !rockObjects || !onHit) return;
        const rockMult = tracked.rockDamageMult ?? 1;
        if (rockMult === 0) return;
        const idx = rockObjects.indexOf(rockGO as Phaser.GameObjects.Rectangle);
        if (idx !== -1) onHit(idx, tracked.damage * rockMult);
      });
      tracked.colliders.push(rockCollider);
    }

    if (this.trunkGroup) {
      const trunkCollider = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
        tracked.bounceCount++;
        // Funken bei Baumstamm-Aufprall
        if (isBullet || isAwp) {
          playImpact(
            body.x + body.halfWidth, body.y + body.halfHeight,
            body.velocity.x, body.velocity.y,
            tracked.color,
          );
        }
      });
      tracked.colliders.push(trunkCollider);
    }

    if (this.trainGroup) {
      const onTrainHit = this.onTrainHit;
      const trainCollider = this.scene.physics.add.collider(sprite, this.trainGroup, () => {
        const trainMult = tracked.trainDamageMult ?? 1;
        if (trainMult !== 0) {
          onTrainHit?.(tracked.damage * trainMult, tracked.ownerId);
        }
        // Funken bei Zug-Aufprall
        if (isBullet || isAwp) {
          playImpact(
            body.x + body.halfWidth, body.y + body.halfHeight,
            body.velocity.x, body.velocity.y,
            tracked.color,
          );
        }
        tracked.bounceCount++;
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
   * Host: Snapshot der aktiven Projektile (für Kollisionserkennung im CombatSystem).
   */
  getActiveProjectiles(): readonly TrackedProjectile[] {
    return [...this.projectiles];
  }

  /**
   * Host: Einzelnes Projektil sofort zerstören (z.B. nach Spielertreffer).
   */
  destroyProjectile(id: number): void {
    const idx = this.projectiles.findIndex(p => p.id === id);
    if (idx === -1) return;
    const proj = this.projectiles[idx];
    this.scene.physics.world.off('worldbounds', proj.boundsListener);
    for (const c of proj.colliders) c.destroy();
    proj.sprite.destroy();
    this.bulletRenderer?.destroyBullet(proj.id);
    this.awpRenderer?.destroyVisual(proj.id);
    this.flameRenderer?.destroyFlameVisual(proj.id);
    this.bfgRenderer?.destroyVisual(proj.id);
    this.projectiles.splice(idx, 1);
  }

  /**
   * Zerstört alle aktiven Projektile und ihre Collider.
   * Muss vor ArenaBuilder.destroyDynamic() aufgerufen werden.
   */
  destroyAll(): void {
    for (const proj of this.projectiles) {
      this.scene.physics.world.off('worldbounds', proj.boundsListener);
      for (const c of proj.colliders) c.destroy();
      proj.sprite.destroy();
    }
    this.projectiles = [];
    this.bulletRenderer?.destroyAll();
    this.awpRenderer?.destroyAll();
    this.flameRenderer?.destroyAll();
    this.bfgRenderer?.destroyAll();
    for (const sprite of this.clientVisuals.values()) sprite.destroy();
    this.clientVisuals.clear();
  }

  /**
   * Host: Abgelaufene/explodierte Projektile entfernen, aktuelle Positionen zurückgeben.
   * Granaten die ihre fuseTime erreicht haben werden als ExplodedGrenade zurückgegeben.
   */
  hostUpdate(deltaMs = 16.67): {
    synced: SyncedProjectile[];
    explodedGrenades: ExplodedGrenade[];
    countdownEvents: Array<{ x: number; y: number; value: number }>;
  } {
    const now              = Date.now();
    const explodedGrenades: ExplodedGrenade[] = [];
    const countdownEvents: Array<{ x: number; y: number; value: number }> = [];
    const renderer         = this.bulletRenderer;

    this.projectiles = this.projectiles.filter(proj => {
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

        return true;
      } else {
        // Normales Projektil: Lifetime oder Max-Bounces
        const dead = age > proj.lifetime || proj.bounceCount > proj.maxBounces;
        if (dead) {
          this.scene.physics.world.off('worldbounds', proj.boundsListener);
          for (const c of proj.colliders) c.destroy();
          proj.sprite.destroy();
          renderer?.destroyBullet(proj.id);
          this.awpRenderer?.destroyVisual(proj.id);
          this.flameRenderer?.destroyFlameVisual(proj.id);
          this.bfgRenderer?.destroyVisual(proj.id);
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
        }
        return !dead;
      }
    });

    // BulletRenderer-Visuals an Physik-Body synchronisieren
    if (renderer) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'bullet') {
          renderer.syncBulletToBody(
            proj.id, proj.sprite.x, proj.sprite.y,
            proj.body.velocity.x, proj.body.velocity.y,
          );
        }
      }
    }

    // AwpRenderer-Visuals an Physik-Body synchronisieren (Host rendert ebenfalls)
    const awpR = this.awpRenderer;
    if (awpR) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'awp') {
          awpR.updateVisual(
            proj.id, proj.sprite.x, proj.sprite.y,
            proj.body.velocity.x, proj.body.velocity.y,
          );
        }
      }
      // Verwaiste AWP-Visuals entfernen (Projektil wurde zerstört)
      const activeAwpIds = new Set(
        this.projectiles.filter(p => p.projectileStyle === 'awp').map(p => p.id),
      );
      for (const id of awpR.getActiveIds()) {
        if (!activeAwpIds.has(id)) awpR.destroyVisual(id);
      }
    }

    // FlameRenderer-Visuals an Physik-Body synchronisieren (Host rendert ebenfalls)
    const flames = this.flameRenderer;
    if (flames) {
      for (const proj of this.projectiles) {
        if (proj.projectileStyle === 'flame') {
          if (!flames.has(proj.id)) {
            flames.createFlameVisual(proj.id, proj.sprite.x, proj.sprite.y, proj.sprite.displayWidth);
          }
          flames.updateFlameVisual(
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
        if (!activeFlameIds.has(id)) flames.destroyFlameVisual(id);
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

    const synced: SyncedProjectile[] = this.projectiles.map(p => ({
      id:    p.id,
      x:     Math.round(p.sprite.x),
      y:     Math.round(p.sprite.y),
      vx:    Math.round(p.body.velocity.x),
      vy:    Math.round(p.body.velocity.y),
      size:  Math.round(p.sprite.displayWidth),
      color: p.color,
      style: p.projectileStyle,
    }));

    return { synced, explodedGrenades, countdownEvents };
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
          renderer.destroyBullet(id);
          this.clientProjStates.delete(id);
        }
      }
    }
    if (flames) {
      for (const id of flames.getActiveIds()) {
        if (!activeIds.has(id)) {
          flames.destroyFlameVisual(id);
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
    const awpR = this.awpRenderer;
    if (awpR) {
      for (const id of awpR.getActiveIds()) {
        if (!activeIds.has(id)) {
          awpR.destroyVisual(id);
          this.clientProjStates.delete(id);
        }
      }
    }

    // Server-State aktualisieren und neue Visuals erstellen
    for (const proj of data) {
      const isBullet = proj.style === 'bullet';
      const isFlame  = proj.style === 'flame';
      const isBfgP   = proj.style === 'bfg';
      const isAwpP   = proj.style === 'awp';

      // Bounce-Erkennung: Velocity-Richtungswechsel zwischen zwei Server-Snapshots
      const prev = this.clientProjStates.get(proj.id);
      const velocityFlipped = prev && (isBullet || isAwpP) &&
        (prev.vx * proj.vx < -1 || prev.vy * proj.vy < -1);

      // Extrapolations-State speichern/aktualisieren
      this.clientProjStates.set(proj.id, {
        serverX: proj.x,
        serverY: proj.y,
        vx: proj.vx,
        vy: proj.vy,
        size: proj.size,
        receivedAt: now,
        style: proj.style,
        isFlame,
      });

      if (isBfgP && bfgR) {
        if (!bfgR.has(proj.id)) {
          bfgR.createVisual(proj.id, proj.x, proj.y, proj.size);
        }
        bfgR.updateVisual(proj.id, proj.x, proj.y, proj.size);
      } else if (isFlame && flames) {
        if (!flames.has(proj.id)) {
          flames.createFlameVisual(proj.id, proj.x, proj.y, proj.size);
        }
        // Sofort auf Server-Position setzen; Extrapolation passiert in clientExtrapolate()
        flames.updateFlameVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if (isAwpP && awpR) {
        if (!awpR.has(proj.id)) {
          awpR.createVisual(proj.id, proj.x, proj.y, proj.size, proj.color);
        }
        awpR.updateVisual(proj.id, proj.x, proj.y, proj.vx, proj.vy);
        if (velocityFlipped) {
          awpR.playImpactSparks(proj.x, proj.y, proj.vx, proj.vy, proj.color);
        }
      } else if (isBullet && renderer) {
        if (!renderer.has(proj.id)) {
          renderer.createBullet(proj.id, proj.x, proj.y, proj.size, proj.color);
        }
        renderer.updateBulletPosition(proj.id, proj.x, proj.y, proj.vx, proj.vy);
        if (velocityFlipped) {
          renderer.playImpactSparks(proj.x, proj.y, proj.vx, proj.vy, proj.color);
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
      const awpRe = this.awpRenderer;
      if (state.style === 'bfg' && bfgRe && bfgRe.has(id)) {
        bfgRe.updateVisual(id, ex, ey, state.size);
      } else if (state.style === 'flame' && flames && flames.has(id)) {
        // Decay-Velocity für Partikel-Orientierung
        const decayFactor = Math.pow(0.82, dt);
        flames.updateFlameVisual(id, ex, ey, state.size, state.vx * decayFactor, state.vy * decayFactor);
      } else if (state.style === 'awp' && awpRe && awpRe.has(id)) {
        awpRe.updateVisual(id, ex, ey, state.vx, state.vy);
      } else if (state.style === 'bullet' && renderer && renderer.has(id)) {
        renderer.updateBulletPosition(id, ex, ey, state.vx, state.vy);
      } else {
        const sprite = this.clientVisuals.get(id);
        if (sprite) sprite.setPosition(ex, ey);
      }
    }
  }
}
