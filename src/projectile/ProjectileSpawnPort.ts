import type { ProjectileSpawnRequest } from './ProjectileSpawnRequest';

/** Stabile Identität eines autoritativen Projectiles innerhalb einer World-Revision. */
export type ProjectileId = number;

/**
 * Ergebnis eines Spawn-Auftrags.
 *
 * `null` bedeutet, dass die Senke den Auftrag nicht ausgeführt hat und kein Projectile entstanden
 * ist. Ein erfolgreicher Spawn liefert immer die neue {@link ProjectileId}.
 */
export type ProjectileSpawnResult = ProjectileId | null;

/**
 * Fachliche Grenze zwischen aufgelöster Weapon-/Ability-Execution und der Projectile-Runtime.
 *
 * Oberhalb dieser Grenze liegen Loadout, Ressourcen, Readiness und Quellenverhalten; unterhalb
 * liegen Identity, Flight, Collision und Wirkung. Der Port nimmt ausschließlich einen bereits
 * aufgelösten {@link ProjectileSpawnRequest} entgegen – keine `WeaponConfig`, keinen Loadout-Zugriff
 * und keine Presentation-Entscheidung.
 */
export interface ProjectileSpawnPort {
  spawnProjectile(request: ProjectileSpawnRequest): ProjectileSpawnResult;
}
