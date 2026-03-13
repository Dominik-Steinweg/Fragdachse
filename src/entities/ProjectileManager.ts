import Phaser from 'phaser';
import {
  PROJECTILE_SIZE, PROJECTILE_SPEED,
  PROJECTILE_LIFETIME_MS, PROJECTILE_MAX_BOUNCES,
  DEPTH, COLORS,
} from '../config';
import type { TrackedProjectile, SyncedProjectile } from '../types';

export class ProjectileManager {
  private scene:          Phaser.Scene;
  private rockGroup:      Phaser.Physics.Arcade.StaticGroup;
  private projectiles:    TrackedProjectile[] = [];        // Host: Physik-Projektile
  private clientVisuals = new Map<number, Phaser.GameObjects.Rectangle>(); // Client: Visuals
  private nextId        = 0;

  constructor(scene: Phaser.Scene, rockGroup: Phaser.Physics.Arcade.StaticGroup) {
    this.scene     = scene;
    this.rockGroup = rockGroup;
  }

  // ── Host ──────────────────────────────────────────────────────────────────

  spawnProjectile(x: number, y: number, angle: number, ownerId: string): void {
    const id     = this.nextId++;
    const sprite = this.scene.add.rectangle(x, y, PROJECTILE_SIZE, PROJECTILE_SIZE, COLORS.PROJECTILE);
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

    const tracked: TrackedProjectile = { id, sprite, body, bounceCount: 0, createdAt: Date.now(), ownerId };
    this.projectiles.push(tracked);

    this.scene.physics.world.on('worldbounds', (hitBody: Phaser.Physics.Arcade.Body) => {
      if (hitBody === body) tracked.bounceCount++;
    });
    this.scene.physics.add.collider(sprite, this.rockGroup, () => { tracked.bounceCount++; });
  }

  /**
   * Host: Snapshot der aktiven Projektile (für Kollisionserkennung im CombatSystem).
   * Gibt eine Kopie zurück, damit Iteration während destroyProjectile() sicher ist.
   */
  getActiveProjectiles(): readonly TrackedProjectile[] {
    return [...this.projectiles];
  }

  /**
   * Host: Einzelnes Projektil sofort zerstören (z.B. nach Spielertreffer).
   * Sicher aufzurufen während der Iteration über getActiveProjectiles().
   */
  destroyProjectile(id: number): void {
    const idx = this.projectiles.findIndex(p => p.id === id);
    if (idx === -1) return;
    this.projectiles[idx].sprite.destroy();
    this.projectiles.splice(idx, 1);
  }

  /**
   * Host: Abgelaufene Projektile entfernen, aktuelle Positionen zurückgeben.
   * Rückgabe wird direkt an NetworkBridge.publishGameState() weitergegeben.
   */
  hostUpdate(): SyncedProjectile[] {
    const now = Date.now();
    this.projectiles = this.projectiles.filter(proj => {
      const dead =
        now - proj.createdAt > PROJECTILE_LIFETIME_MS ||
        proj.bounceCount >= PROJECTILE_MAX_BOUNCES;
      if (dead) proj.sprite.destroy();
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

    // Sprites für nicht mehr existierende Projektile entfernen
    for (const [id, sprite] of this.clientVisuals) {
      if (!activeIds.has(id)) {
        sprite.destroy();
        this.clientVisuals.delete(id);
      }
    }

    // Neue Sprites anlegen oder bestehende verschieben
    for (const proj of data) {
      const existing = this.clientVisuals.get(proj.id);
      if (!existing) {
        const sprite = this.scene.add.rectangle(
          proj.x, proj.y, PROJECTILE_SIZE, PROJECTILE_SIZE, COLORS.PROJECTILE,
        );
        sprite.setDepth(DEPTH.PROJECTILES);
        this.clientVisuals.set(proj.id, sprite);
      } else {
        existing.setPosition(proj.x, proj.y);
      }
    }
  }
}
