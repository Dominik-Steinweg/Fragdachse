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
  private onRockHit:   ((rockId: number) => void) | null = null;

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
  setRockHitCallback(cb: (rockId: number) => void): void {
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

    if (cfg.isGrenade) {
      // Granaten fliegen durch alles – keine Welt-/Hindernis-Kollision
      body.setCollideWorldBounds(false);
    } else {
      body.setCollideWorldBounds(true);
      body.onWorldBounds = true;
      body.setBounce(1, 1);
    }

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
      damage:         cfg.damage,
      lifetime:       cfg.lifetime,
      maxBounces:     cfg.maxBounces,
      isGrenade:      cfg.isGrenade,
      fuseTime:       cfg.fuseTime,
      aoeRadius:      cfg.aoeRadius,
      aoeDamage:      cfg.aoeDamage,
    };

    const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
      if (hitBody === body) tracked.bounceCount++;
    };
    tracked.boundsListener = boundsListener;
    this.projectiles.push(tracked);
    this.scene.physics.world.on('worldbounds', boundsListener);

    // Rock/Trunk-Collider NUR für normale Projektile (nicht Granaten)
    if (!cfg.isGrenade) {
      if (this.rockGroup) {
        const rockObjects = this.rockObjects;
        const onHit       = this.onRockHit;
        this.scene.physics.add.collider(sprite, this.rockGroup, (_proj, rockGO) => {
          tracked.bounceCount++;
          if (!rockObjects || !onHit) return;
          const idx = rockObjects.indexOf(rockGO as Phaser.GameObjects.Rectangle);
          if (idx !== -1) onHit(idx);
        });
      }

      if (this.trunkGroup) {
        this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
          tracked.bounceCount++;
        });
      }
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
    proj.sprite.destroy();
    this.projectiles.splice(idx, 1);
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
        // Granate: explodiert nach fuseTime
        if (age >= proj.fuseTime!) {
          explodedGrenades.push({
            x:         proj.sprite.x,
            y:         proj.sprite.y,
            aoeRadius: proj.aoeRadius!,
            aoeDamage: proj.aoeDamage!,
            ownerId:   proj.ownerId,
          });
          this.scene.physics.world.off('worldbounds', proj.boundsListener);
          proj.sprite.destroy();
          return false;
        }
        return true;
      } else {
        // Normales Projektil: Lifetime oder Max-Bounces
        const dead = age > proj.lifetime || proj.bounceCount >= proj.maxBounces;
        if (dead) {
          this.scene.physics.world.off('worldbounds', proj.boundsListener);
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
