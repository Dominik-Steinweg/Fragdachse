import Phaser from 'phaser';
import {
  PROJECTILE_SIZE, PROJECTILE_SPEED,
  PROJECTILE_LIFETIME_MS, PROJECTILE_MAX_BOUNCES,
  DEPTH, COLORS,
} from '../config';
import type { TrackedProjectile, SyncedProjectile } from '../types';

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

  spawnProjectile(x: number, y: number, angle: number, ownerId: string): void {
    const id     = this.nextId++;
    const sprite = this.scene.add.rectangle(x, y, PROJECTILE_SIZE, PROJECTILE_SIZE, COLORS.GOLD_3);
    sprite.setDepth(DEPTH.PROJECTILES);
    this.scene.physics.add.existing(sprite);

    const body = sprite.body as Phaser.Physics.Arcade.Body;
    body.setCollideWorldBounds(true);
    body.onWorldBounds = true;
    body.setBounce(1, 1);
    body.setVelocity(
      Math.cos(angle) * PROJECTILE_SPEED,
      Math.sin(angle) * PROJECTILE_SPEED,
    );

    const tracked: TrackedProjectile = {
      id, sprite, body, bounceCount: 0, createdAt: Date.now(), ownerId,
      boundsListener: () => {},
    };
    const boundsListener = (hitBody: Phaser.Physics.Arcade.Body) => {
      if (hitBody === body) tracked.bounceCount++;
    };
    tracked.boundsListener = boundsListener;
    this.projectiles.push(tracked);
    this.scene.physics.world.on('worldbounds', boundsListener);

    // Felsen-Collider: Abprallen (physikalisch) + Schaden (Callback)
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

    // Trunk-Collider: nur Abprallen, kein Schaden
    if (this.trunkGroup) {
      this.scene.physics.add.collider(sprite, this.trunkGroup, () => {
        tracked.bounceCount++;
      });
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
   * Host: Abgelaufene Projektile entfernen, aktuelle Positionen zurückgeben.
   */
  hostUpdate(): SyncedProjectile[] {
    const now = Date.now();
    this.projectiles = this.projectiles.filter(proj => {
      const dead =
        now - proj.createdAt > PROJECTILE_LIFETIME_MS ||
        proj.bounceCount >= PROJECTILE_MAX_BOUNCES;
      if (dead) {
        this.scene.physics.world.off('worldbounds', proj.boundsListener);
        proj.sprite.destroy();
      }
      return !dead;
    });
    return this.projectiles.map(p => ({ id: p.id, x: p.sprite.x, y: p.sprite.y }));
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
        const sprite = this.scene.add.rectangle(
          proj.x, proj.y, PROJECTILE_SIZE, PROJECTILE_SIZE, COLORS.GOLD_3,
        );
        sprite.setDepth(DEPTH.PROJECTILES);
        this.clientVisuals.set(proj.id, sprite);
      } else {
        existing.setPosition(proj.x, proj.y);
      }
    }
  }
}
