import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { TrackedProjectile, SyncedProjectile, ExplodedGrenade, ProjectileSpawnConfig } from '../types';
import type { BulletRenderer } from '../effects/BulletRenderer';
import type { FlameRenderer } from '../effects/FlameRenderer';

export class ProjectileManager {
  private scene:       Phaser.Scene;
  private projectiles: TrackedProjectile[] = [];        // Host: Physik-Projektile
  private clientVisuals = new Map<number, Phaser.GameObjects.Shape>(); // Client: Visuals (ball-Stil)
  private nextId        = 0;

  // ── Bullet-Renderer (Enhanced Bullet Visuals) ─────────────────────────────
  private bulletRenderer: BulletRenderer | null = null;

  // ── Flame-Renderer (Flammenwerfer-Partikel) ───────────────────────────────
  private flameRenderer: FlameRenderer | null = null;

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

    // Physik-Shape: für 'bullet'/'flame' unsichtbar (nur Kollisions-Body)
    const sprite: Phaser.GameObjects.Shape = isBall
      ? this.scene.add.circle(x, y, cfg.size / 2, cfg.color)
      : this.scene.add.rectangle(x, y, cfg.size, cfg.size, cfg.color);
    sprite.setDepth(DEPTH.PROJECTILES);

    if (isBullet && this.bulletRenderer) {
      sprite.setVisible(false);
      sprite.setAlpha(0);
      this.bulletRenderer.createBullet(id, x, y, cfg.size, cfg.color);
    }

    // Flame-Hitboxen sind unsichtbar (Rendering übernimmt FlameRenderer auf Client)
    if (isFlame) {
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
    };

    if (isFlame) {
      // Flammen: kein Bounce, keine World-Bounds-Kollision;
      // Felsen-/Trunk-Kontakt zerstört die Hitbox sofort.
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
        if (hitBody !== body) return;
        // Flamme an Wand → sofort löschen (bounceCount triggert Destroy im hostUpdate)
        tracked.bounceCount = tracked.maxBounces;
      };
      tracked.boundsListener = boundsListener;
      this.scene.physics.world.on('worldbounds', boundsListener);

      this.setupFlameColliders(sprite, body, tracked);
    } else if (!cfg.isGrenade || cfg.maxBounces > 0) {
      // Bounce-Physik: für normale Projektile immer; für Granaten nur wenn maxBounces > 0
      this.setupBouncePhysics(sprite, body, tracked, !cfg.isGrenade);
    }

    this.projectiles.push(tracked);
  }

  /**
   * Richtet Fels-/Trunk-Kollision für Flammen-Hitboxen ein.
   * Flammen prallen NICHT ab, sondern werden bei Kontakt sofort zerstört.
   */
  private setupFlameColliders(
    sprite:  Phaser.GameObjects.Shape,
    body:    Phaser.Physics.Arcade.Body,
    tracked: TrackedProjectile,
  ): void {
    // Kein Bounce: Flammen prallen nicht ab
    body.setBounce(0, 0);

    // Flammen passieren Felsen und Baumstümpfe (rockDamageMult = 0, Feuer fließt über Hindernisse).
    // Nur der Zug blockiert die Flamme, da er Schaden nehmen kann (trainDamageMult > 0).
    if (this.trainGroup) {
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
    const renderer     = this.bulletRenderer;

    const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
      if (hitBody !== body) return;
      tracked.bounceCount++;
      // Funken an Arena-Wand: Velocity ist nach Bounce bereits reflektiert
      if (isBullet && renderer) {
        renderer.playImpactSparks(
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
        if (isBullet && renderer) {
          renderer.playImpactSparks(
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
        if (isBullet && renderer) {
          renderer.playImpactSparks(
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
        if (isBullet && renderer) {
          renderer.playImpactSparks(
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

    // 1. Wachstum: Body-Größe vergrößern
    const curSize = proj.sprite.displayWidth;
    if (curSize < maxSize) {
      const newSize = Math.min(maxSize, curSize + growRate * deltaS);
      proj.body.setSize(newSize, newSize);
      proj.body.setOffset(0, 0);
      // Shape-Dimension aktualisieren (für SyncedProjectile.size)
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
    this.flameRenderer?.destroyFlameVisual(proj.id);
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
    this.flameRenderer?.destroyAll();
    for (const sprite of this.clientVisuals.values()) sprite.destroy();
    this.clientVisuals.clear();
  }

  /**
   * Host: Abgelaufene/explodierte Projektile entfernen, aktuelle Positionen zurückgeben.
   * Granaten die ihre fuseTime erreicht haben werden als ExplodedGrenade zurückgegeben.
   */
  hostUpdate(deltaMs = 16.67): { synced: SyncedProjectile[]; explodedGrenades: ExplodedGrenade[] } {
    const now              = Date.now();
    const explodedGrenades: ExplodedGrenade[] = [];
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
        return true;
      } else {
        // Normales Projektil: Lifetime oder Max-Bounces
        const dead = age > proj.lifetime || proj.bounceCount >= proj.maxBounces;
        if (dead) {
          this.scene.physics.world.off('worldbounds', proj.boundsListener);
          for (const c of proj.colliders) c.destroy();
          proj.sprite.destroy();
          renderer?.destroyBullet(proj.id);
          this.flameRenderer?.destroyFlameVisual(proj.id);
        } else if (proj.isFlame) {
          // Flammen-Hitbox: wachsen + verlangsamen
          this.updateFlameHitbox(proj, deltaMs / 1000);
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

    const synced: SyncedProjectile[] = this.projectiles.map(p => ({
      id:    p.id,
      x:     p.sprite.x,
      y:     p.sprite.y,
      vx:    p.body.velocity.x,
      vy:    p.body.velocity.y,
      size:  p.sprite.displayWidth,
      color: p.color,
      style: p.projectileStyle,
    }));

    return { synced, explodedGrenades };
  }

  // ── Client ────────────────────────────────────────────────────────────────

  /**
   * Client: Visuelle Projektil-Sprites anhand der vom Host empfangenen Daten
   * erstellen, verschieben oder entfernen. Keine Physik auf Client-Seite.
   * Bullet-Stil wird über BulletRenderer gerendert (Trail + Sparks),
   * Ball-Stil verwendet weiterhin einfache Phaser-Circle-Shapes.
   */
  clientSyncVisuals(data: SyncedProjectile[]): void {
    const activeIds = new Set(data.map(d => d.id));
    const renderer  = this.bulletRenderer;
    const flames    = this.flameRenderer;

    // Verwaiste Visuals entfernen
    for (const [id, sprite] of this.clientVisuals) {
      if (!activeIds.has(id)) {
        sprite.destroy();
        this.clientVisuals.delete(id);
      }
    }
    // Verwaiste BulletRenderer-Visuals entfernen
    if (renderer) {
      for (const id of renderer.getActiveIds()) {
        if (!activeIds.has(id)) renderer.destroyBullet(id);
      }
    }
    // Verwaiste FlameRenderer-Visuals entfernen
    if (flames) {
      for (const id of flames.getActiveIds()) {
        if (!activeIds.has(id)) flames.destroyFlameVisual(id);
      }
    }

    for (const proj of data) {
      const isBullet = proj.style === 'bullet';
      const isFlame  = proj.style === 'flame';

      if (isFlame && flames) {
        // Flame-Stil: FlameRenderer übernimmt Partikel-Rendering
        if (!flames.has(proj.id)) {
          flames.createFlameVisual(proj.id, proj.x, proj.y, proj.size);
        }
        flames.updateFlameVisual(proj.id, proj.x, proj.y, proj.size, proj.vx, proj.vy);
      } else if (isBullet && renderer) {
        // Bullet-Stil: BulletRenderer übernimmt Rendering
        if (!renderer.has(proj.id)) {
          renderer.createBullet(proj.id, proj.x, proj.y, proj.size, proj.color);
        }
        const bounced = renderer.updateBulletPosition(proj.id, proj.x, proj.y, proj.vx, proj.vy);
        if (bounced) {
          renderer.playImpactSparks(proj.x, proj.y, proj.vx, proj.vy, proj.color);
        }
        // Kein clientVisuals-Map-Eintrag für Bullets (BulletRenderer verwaltet sie)
      } else {
        // Ball- oder Legacy-Stil: einfache Shapes
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
}
