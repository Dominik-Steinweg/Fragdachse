import * as Phaser from 'phaser';
import type { ProjectileSpawnConfig, ProjectileStyle } from '../types';
import type {
  ProjectilePresentationDespawnState,
} from './ProjectilePresentationRuntime';

/**
 * Narrow visual seam used by the Phaser physics binding.
 *
 * The binding may announce visual lifecycle events, but it does not own the
 * presentation runtime, renderer instances, audio, or client replica.
 */
export interface ProjectilePresentationPort {
  registerFallbackShape(sprite: Phaser.GameObjects.Shape): void;
  createSpawnRendererVisuals(
    id: number,
    sprite: Phaser.GameObjects.Shape,
    x: number,
    y: number,
    cfg: ProjectileSpawnConfig,
  ): void;
  createBfgVisual(id: number, x: number, y: number, size: number): void;
  createSpawnFeedback(
    id: number,
    tracerX: number,
    tracerY: number,
    muzzleX: number,
    muzzleY: number,
    angle: number,
    ownerId: string,
    cfg: ProjectileSpawnConfig,
  ): void;
  playBounceImpact(
    id: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    color: number,
    style?: ProjectileStyle,
  ): void;
  destroyProjectileVisuals(projectile: ProjectilePresentationDespawnState): void;
}

/** No-op seam for physics-only tests and headless bindings. */
export const EMPTY_PROJECTILE_PRESENTATION: ProjectilePresentationPort = {
  registerFallbackShape: () => {},
  createSpawnRendererVisuals: () => {},
  createBfgVisual: () => {},
  createSpawnFeedback: () => {},
  playBounceImpact: () => {},
  destroyProjectileVisuals: () => {},
};
