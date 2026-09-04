import type { ProjectileProvenance } from './ProjectileSpawnRequest';

/** Host-authoritative movement factor for one projectile at an explicit host time. */
export interface ProjectileTimeFieldPort {
  getMovementFactor(
    x: number,
    y: number,
    nowMs: number,
    provenance: ProjectileProvenance,
  ): number;
}
