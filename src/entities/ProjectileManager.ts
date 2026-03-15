import Phaser from 'phaser';
import { DEPTH } from '../config';
import type { TrackedProjectile, SyncedProjectile, ExplodedGrenade, ProjectileSpawnConfig } from '../types';

export class ProjectileManager {
  private scene:       Phaser.Scene;
  private projectiles: TrackedProjectile[] = [];        // Host: Physik-Projektile
  private clientVisuals = new Map<number, Phaser.GameObjects.Rectangle>(); // Client: Visuals
  private nextId        = 0;

  // ── Obstacle-Gruppen (werden nach Arena-Aufbau injiziert) ─────────────────
  private rockGroup:   Phaser.Physics.Arcade.StaticGroup | null = null;
  private rockObjects: (Phaser.GameObjects.Rectangle | null)[] | null = null;
  private trunkGroup:  Phaser.Physics.Arcade.StaticGroup | null = null;
  private onRockHit:   ((rockId: number, damage: number) => void) | null = null;

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
    const id     = this.nextId++;
    const sprite = this.scene.add.rectangle(x, y, cfg.size, cfg.size, cfg.color);
    sprite.setDepth(DEPTH.PROJECTILES);
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
      boundsListener: () => {},
      colliders:      [],
      damage:         cfg.damage,
      lifetime:       cfg.lifetime,
      maxBounces:     cfg.maxBounces,
      isGrenade:      cfg.isGrenade,
      adrenalinGain:  cfg.adrenalinGain,
      weaponName:     cfg.weaponName ?? 'Waffe',
      fuseTime:       cfg.fuseTime,
      grenadeEffect:  cfg.grenadeEffect,
      detonable:      cfg.detonable,
      detonator:      cfg.detonator,
    };

    // Bounce-Physik: für normale Projektile immer; für Granaten nur wenn maxBounces > 0
    if (!cfg.isGrenade || cfg.maxBounces > 0) {
      this.setupBouncePhysics(sprite, body, tracked, !cfg.isGrenade);
    }

    this.projectiles.push(tracked);
  }

  /**
   * Richtet Welt- und Hindernis-Kollision mit physikalischem Abprallen ein.
   * Wird von normalen Projektilen und bouncenden Granaten (maxBounces > 0) genutzt.
   *
   * @param applyRockDamage – true für normale Projektile (Felstreffer-Schaden);
   *                          false für Granaten (kein Felstrefferschaden beim Abprallen)
   */
  private setupBouncePhysics(
    sprite:          Phaser.GameObjects.Rectangle,
    body:            Phaser.Physics.Arcade.Body,
    tracked:         TrackedProjectile,
    applyRockDamage: boolean,
  ): void {
    body.setCollideWorldBounds(true);
    body.onWorldBounds = true;
    body.setBounce(1, 1);

    const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
      if (hitBody === body) tracked.bounceCount++;
    };
    tracked.boundsListener = boundsListener;
    this.scene.physics.world.on('worldbounds', boundsListener);

    if (this.rockGroup) {
      const rockObjects = this.rockObjects;
      const onHit       = this.onRockHit;
      const rockCollider = this.scene.physics.add.collider(sprite, this.rockGroup, (_proj, rockGO) => {
        tracked.bounceCount++;
        if (!applyRockDamage || !rockObjects || !onHit) return;
        const idx = rockObjects.indexOf(rockGO as Phaser.GameObjects.Rectangle);
        if (idx !== -1) onHit(idx, tracked.damage);
      });
      tracked.colliders.push(rockCollider);
    }

    if (this.trunkGroup) {
      const trunkCollider = this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
        tracked.bounceCount++;
      });
      tracked.colliders.push(trunkCollider);
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
    for (const sprite of this.clientVisuals.values()) sprite.destroy();
    this.clientVisuals.clear();
  }

  /**
   * Host: Abgelaufene/explodierte Projektile entfernen, aktuelle Positionen zurückgeben.
   * Granaten die ihre fuseTime erreicht haben werden als ExplodedGrenade zurückgegeben.
   */
  hostUpdate(): { synced: SyncedProjectile[]; explodedGrenades: ExplodedGrenade[] } {
    const now              = Date.now();
    const explodedGrenades: ExplodedGrenade[] = [];

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
        }
        return !dead;
      }
    });

    const synced: SyncedProjectile[] = this.projectiles.map(p => ({
      id:    p.id,
      x:     p.sprite.x,
      y:     p.sprite.y,
      size:  p.sprite.width,
      color: p.sprite.fillColor,
    }));

    return { synced, explodedGrenades };
  }

  // ── Client ────────────────────────────────────────────────────────────────

  /**
   * Client: Visuelle Projektil-Sprites anhand der vom Host empfangenen Daten
   * erstellen, verschieben oder entfernen. Keine Physik auf Client-Seite.
   */
  clientSyncVisuals(data: SyncedProjectile[]): void {
    const activeIds = new Set(data.map(d => d.id));

    for (const [id, sprite] of this.clientVisuals) {
      if (!activeIds.has(id)) {
        sprite.destroy();
        this.clientVisuals.delete(id);
      }
    }

    for (const proj of data) {
      const existing = this.clientVisuals.get(proj.id);
      if (!existing) {
        const sprite = this.scene.add.rectangle(proj.x, proj.y, proj.size, proj.size, proj.color);
        sprite.setDepth(DEPTH.PROJECTILES);
        this.clientVisuals.set(proj.id, sprite);
      } else {
        existing.setPosition(proj.x, proj.y);
      }
    }
  }
}
