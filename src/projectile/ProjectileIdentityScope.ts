import type { ProjectileId } from './ProjectileSpawnPort';

/**
 * Monotone Projectile-Identity innerhalb genau einer World-Revision.
 *
 * Der Scope hält bewusst nur die Vergabegrenze, keine Records oder Registry. Er wird vom
 * World-Lifecycle besessen und kann deshalb eine lokale World-Runtime überleben, ohne eine
 * zweite Projectile-Authority einzuführen.
 */
export class ProjectileIdentityScope {
  private nextId = 0;

  constructor(readonly worldRevision: number) {
    if (!Number.isSafeInteger(worldRevision) || worldRevision <= 0) {
      throw new Error(`[ProjectileIdentityScope] Invalid world revision ${worldRevision}`);
    }
  }

  /** Vergibt die nächste noch nie verwendete Projectile-Identity dieser World-Revision. */
  allocate(): ProjectileId {
    if (!Number.isSafeInteger(this.nextId)) {
      throw new Error(
        `[ProjectileIdentityScope] Projectile identity space exhausted for world revision ${this.worldRevision}`,
      );
    }
    return this.nextId++;
  }
}
