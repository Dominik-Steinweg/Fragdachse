import type { TimeBubbleEffectConfig } from '../types';
import type { ProjectileFocusRequest } from '../projectile/ProjectileExternalInteractionPort';

/** Composition connects the utility lifetime to bubble and projectile authorities. */
export interface TimeBubbleUtilityPort {
  create(ownerId: string, x: number, y: number, effect: TimeBubbleEffectConfig, now: number): number;
  collapse(bubbleId: number, request: Omit<ProjectileFocusRequest, 'x' | 'y' | 'radius'>): boolean;
  remove(bubbleId: number): void;
  discardProjectile(projectileId: number): void;
}
