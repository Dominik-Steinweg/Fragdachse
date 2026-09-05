/**
 * Explicit spawn policy for the authoritative projectile stages.
 *
 * Collision interactions may intentionally feed a spawned child back into the current collision
 * pass because Plasma Swarm currently relies on that same-frame outcome. Other child/split
 * creation is a next-stage operation; it must not become same-stage merely because a JS
 * collection happens to be live during iteration.
 */
export type ProjectileStageSpawnPolicy = 'same-stage' | 'next-stage';

export const PROJECTILE_STAGE_SPAWN_CONTRACT = {
  collisionInteractionSpawns: 'same-stage',
  childAndSplitSpawns: 'next-stage',
} as const satisfies Record<string, ProjectileStageSpawnPolicy>;
