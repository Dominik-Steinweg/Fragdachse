import type { ProjectileHomingConfig } from '../types';
import type { CombatSource, CombatTargetRef } from '../combat/CombatScope';
import { combatTargetInstanceKey } from '../combat/CombatScope';

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
    return state && now < state.expiresAt ? state : undefined;
  }

  /** Physical expiry is confined to the named periodic step. */
  prune(now: number): string[] {
    const removed: string[] = [];
    for (const [enemyId, state] of this.states) {
      if (now < state.expiresAt) continue;
      this.states.delete(enemyId);
      removed.push(enemyId);
    }
    return removed;
  }

  clear(enemyId: string): void {
    this.states.delete(enemyId);
  }

  clearAll(): void {
    this.states.clear();
  }
}

export interface PlasmaSwarmDirectContact {
  readonly target: CombatTargetRef;
  readonly source: CombatSource;
  readonly nowMs: number;
  readonly random: () => number;
}

export interface PlasmaSwarmContactOutcome {
  readonly stacks: number;
  readonly shouldProc: boolean;
}

export interface PlasmaSwarmMechanicPort {
  registerDirectContact(request: PlasmaSwarmDirectContact): PlasmaSwarmContactOutcome | null;
  advance(nowMs: number): void;
  clearTarget(target: CombatTargetRef): void;
  clearTargetId(enemyId: string): void;
  clear(): void;
}

/** Target-wide Plasma charges owned by the mechanic, never by a shooter or Damage core. */
export class PlasmaSwarmReactionSystem implements PlasmaSwarmMechanicPort {
  private readonly tracker = new PlasmaChargeTracker();
  private readonly targets = new Map<string, CombatTargetRef>();

  constructor(private readonly projectStacks: (target: CombatTargetRef, stacks: number) => void) {}

  registerDirectContact(request: PlasmaSwarmDirectContact): PlasmaSwarmContactOutcome | null {
    if (request.target.kind !== 'enemy'
      || request.source.lineage?.plasmaSwarmChild === true
      || !Number.isFinite(request.nowMs)) return null;
    const key = combatTargetInstanceKey(request.target);
    const charge = this.tracker.addHit(key, request.nowMs);
    this.targets.set(key, request.target);
    this.projectStacks(request.target, charge.stacks);
    return Object.freeze({
      stacks: charge.stacks,
      shouldProc: resolvePlasmaSwarmProjectileCount(
        charge.stacks * PLASMA_SWARM_CHANCE_PER_STACK_PERCENT,
        request.random,
      ) > 0,
    });
  }

  read(target: CombatTargetRef, nowMs: number): PlasmaChargeState | undefined {
    return this.tracker.getState(combatTargetInstanceKey(target), nowMs);
  }

  advance(nowMs: number): void {
    for (const key of this.tracker.prune(nowMs)) {
      const target = this.targets.get(key);
      if (target) this.projectStacks(target, 0);
      this.targets.delete(key);
    }
  }

  clearTarget(target: CombatTargetRef): void {
    const key = combatTargetInstanceKey(target);
    this.tracker.clear(key);
    this.targets.delete(key);
    this.projectStacks(target, 0);
  }

  clearTargetId(enemyId: string): void {
    for (const [key, target] of this.targets) {
      if (target.kind !== 'enemy' || target.id !== enemyId) continue;
      this.tracker.clear(key);
      this.targets.delete(key);
      this.projectStacks(target, 0);
    }
  }

  clear(): void {
    for (const target of this.targets.values()) this.projectStacks(target, 0);
    this.tracker.clearAll();
    this.targets.clear();
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
