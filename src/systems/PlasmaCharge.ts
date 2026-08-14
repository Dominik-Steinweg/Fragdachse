import type { ProjectileHomingConfig } from '../types';

export const PLASMA_CHARGE_DURATION_MS = 2_000;
export const PLASMA_CHARGE_MAX_STACKS = 10;
export const PLASMA_SWARM_CHANCE_PER_STACK_PERCENT = 2;
export const PLASMA_SWARM_BASE_PROJECTILE_COUNT = 4;
export const PLASMA_SWARM_BASE_EXPLOSION_RADIUS = 30;
export const PLASMA_SWARM_BASE_EXPLOSION_DAMAGE = 10;
export const PLASMA_SWARM_EXPLOSION_DURATION_MS = 2_000;
export const PLASMA_SWARM_PROJECTILE_DAMAGE_MULTIPLIER = 0.5;
export const PLASMA_SWARM_PROJECTILE_SIZE_MULTIPLIER = 0.5;
export const PLASMA_SWARM_PROJECTILE_SPEED_MULTIPLIER = 0.5;
export const PLASMA_SWARM_HOMING_TURN_MULTIPLIER = 2;

export interface PlasmaSwarmProjectileProfile {
  readonly damage: number;
  readonly size: number;
  readonly speed: number;
  readonly range: number;
}

/** Applies swarm multipliers after the normal, already-upgraded Plasma values are resolved. */
export function resolvePlasmaSwarmProjectileProfile(
  normal: PlasmaSwarmProjectileProfile,
): PlasmaSwarmProjectileProfile {
  return {
    damage: normal.damage * PLASMA_SWARM_PROJECTILE_DAMAGE_MULTIPLIER,
    size: normal.size * PLASMA_SWARM_PROJECTILE_SIZE_MULTIPLIER,
    speed: normal.speed * PLASMA_SWARM_PROJECTILE_SPEED_MULTIPLIER,
    range: normal.range,
  };
}

/** Swarm shots inherit upgraded Plasma homing and turn twice as strongly as the primary shot. */
export function resolvePlasmaSwarmHoming(
  homing: ProjectileHomingConfig | undefined,
): ProjectileHomingConfig | undefined {
  if (!homing) return undefined;
  return {
    ...homing,
    maxTurnDegreesPerStep: homing.maxTurnDegreesPerStep * PLASMA_SWARM_HOMING_TURN_MULTIPLIER,
  };
}

export interface PlasmaChargeState {
  readonly stacks: number;
  readonly expiresAt: number;
}

export interface PlasmaSwarmSourceFlags {
  readonly plasmaSwarmEnabled?: boolean;
  readonly plasmaSwarmProjectile?: boolean;
}

/** Host-only state for the short-lived, stackable Plasma Gun status. */
export class PlasmaChargeTracker {
  private readonly states = new Map<string, PlasmaChargeState>();

  addHit(enemyId: string, now: number): PlasmaChargeState {
    const previous = this.getState(enemyId, now);
    const next: PlasmaChargeState = {
      stacks: Math.min(PLASMA_CHARGE_MAX_STACKS, (previous?.stacks ?? 0) + 1),
      // A hit refreshes the lifetime of every active stack as one group.
      expiresAt: now + PLASMA_CHARGE_DURATION_MS,
    };
    this.states.set(enemyId, next);
    return next;
  }

  getState(enemyId: string, now: number): PlasmaChargeState | undefined {
    const state = this.states.get(enemyId);
    if (!state) return undefined;
    if (now >= state.expiresAt) {
      this.states.delete(enemyId);
      return undefined;
    }
    return state;
  }

  clear(enemyId: string): void {
    this.states.delete(enemyId);
  }

  clearAll(): void {
    this.states.clear();
  }
}

/** Resolves one capped swarm proc chance; a primary hit can create at most one proc. */
export function resolvePlasmaSwarmProjectileCount(
  chancePercent: number,
  random = Math.random,
): number {
  const clampedChance = Math.min(100, Math.max(0, chancePercent));
  return clampedChance >= 100 || random() < clampedChance / 100 ? 1 : 0;
}

export function resolvePlasmaSwarmRadialAngles(
  projectileCount: number,
  random = Math.random,
): number[] {
  const count = Math.max(0, Math.floor(projectileCount));
  if (count <= 0) return [];
  const offset = random() * Math.PI * 2;
  return Array.from({ length: count }, (_, index) => offset + (index * Math.PI * 2) / count);
}

export function canTriggerPlasmaSwarm(source: PlasmaSwarmSourceFlags | undefined): boolean {
  return source?.plasmaSwarmEnabled === true && source.plasmaSwarmProjectile !== true;
}

/**
 * Prevents a swarm projectile from being consumed by the enemy it spawned inside.
 * The guard is cleared by the collision loop once the projectile has left that hitbox.
 */
export function shouldIgnorePlasmaSwarmOriginHit(
  source: PlasmaSwarmSourceFlags | undefined,
  originEnemyId: string | undefined,
  targetEnemyId: string,
  hasExitedOrigin: boolean,
): boolean {
  return source?.plasmaSwarmProjectile === true
    && originEnemyId === targetEnemyId
    && !hasExitedOrigin;
}
