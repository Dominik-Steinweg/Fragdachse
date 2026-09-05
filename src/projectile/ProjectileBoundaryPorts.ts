import * as Phaser from 'phaser';
import type { RockPhysicsProxy } from '../arena/rocks/RockPhysicsProxy';
import type { ArenaObstacleIndex } from '../systems/ArenaObstacleIndex';
import type {
  ProjectileFlameExpiryEvent,
  ProjectileImpactSource,
  ProjectileLifecycleOutcome,
} from './ProjectileGameplayPort';
import type { ProjectileExplosionRequest } from './ProjectileExplosionPort';
import type { SupportProjectileImpact } from '../types';
import type {
  HomingLineOfFireChecker,
  HomingTargetProvider,
} from '../entities/ProjectileHomingController';
import type { ProjectilePlasmaSwarmImpact } from './ProjectileCombatPort';

/** World geometry capability required by the technical Projectile PhysicsBinding. */
export interface ProjectileGeometryBindingPort {
  setRockGroup(
    group: Phaser.Physics.Arcade.StaticGroup | null,
    objects: (RockPhysicsProxy | null)[] | null,
    trunkGroup: Phaser.Physics.Arcade.StaticGroup | null,
  ): void;
  setBaseGroup(group: Phaser.Physics.Arcade.StaticGroup | null): void;
  setObstacleIndex(index: ArenaObstacleIndex | null): void;
}

/** Train-only geometry and domain-contact capability. */
export interface ProjectileTrainBindingPort {
  setTrainGroup(group: Phaser.Physics.Arcade.StaticGroup | null): void;
  setTrainHitCallback(callback: ((damage: number, attackerId: string) => void) | null): void;
}

/** World-owned effects produced by a projectile contact. */
export interface ProjectileWorldImpactBindingPort {
  setRockHitCallback(callback: ((rockId: number, damage: number, attackerId: string) => void) | null): void;
  setObstacleKindResolver(resolver: ((rockId: number) => import('../types').PlaceableKind | undefined) | null): void;
  setBaseHitCallback(callback: ((baseId: string, damage: number, attackerId: string, projectile?: ProjectileImpactSource) => void) | null): void;
  setSupportImpactCallback(callback: ((projectile: ProjectileImpactSource, impact: SupportProjectileImpact) => void) | null): void;
}

/** Lifecycle and passive effect outputs consumed by the World/Activity composition. */
export interface ProjectileLifecycleEventsBindingPort {
  setNaturalFlameExpiryCallback(callback: ((projectile: ProjectileFlameExpiryEvent) => void) | null): void;
  setProjectileImpactCallback(callback: ((projectile: ProjectileImpactSource) => void) | null): void;
  setProjectileResolvedCallback(callback: ((outcome: ProjectileLifecycleOutcome) => void) | null): void;
  setMiniRocketDestroyedCallback(callback: ((projectile: ProjectileImpactSource) => void) | null): void;
  setStandaloneExplosionRequestCallback(callback: ((request: ProjectileExplosionRequest) => void) | null): void;
  setProximityPulseCallback(callback: ((projectile: ProjectileImpactSource) => void) | null): void;
}

/** Host time-field capability for the movement core. */
export interface ProjectileTimeFieldBindingPort {
  setTimeBubbleFactorProvider(provider: ((x: number, y: number, now: number, ownerId?: string) => number) | null): void;
}

/** Homing's two host-provided read capabilities. */
export interface ProjectileHomingBindingPort {
  setHomingTargetProvider(provider: HomingTargetProvider | null): void;
  setHomingLineOfFireChecker(checker: HomingLineOfFireChecker | null): void;
}

/** Semantic owner input for the Plasma swarm reaction. */
export interface ProjectileSwarmReactionPort {
  applyPlasmaSwarmImpact(impact: ProjectilePlasmaSwarmImpact): void;
}
