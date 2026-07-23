import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: {
    ADD: 1,
  },
  Math: {
    Easing: {
      Quadratic: {
        Out: (value: number) => value,
      },
    },
  },
}));

import * as Phaser from 'phaser';
import { RocketRenderer } from '../src/effects/RocketRenderer';
import { ProjectileManager } from '../src/entities/ProjectileManager';
import type { TrackedProjectile } from '../src/types';

interface SmokeEmitterConfig {
  reserve: number;
  maxParticles: number;
  maxAliveParticles: number;
  scale: {
    onEmit: (particle?: Phaser.GameObjects.Particles.Particle) => number;
    onUpdate: (
      particle: Phaser.GameObjects.Particles.Particle,
      key: string,
      t: number,
    ) => number;
  };
  tint: {
    onEmit: () => number;
  };
}

describe('projectile performance paths', () => {
  it('reuses one reserved particle emitter for all rocket smoke puffs', () => {
    const emissions: Array<{ x: number; y: number; scale: number; tint: number; scaleAtHalfLife: number }> = [];
    let config: SmokeEmitterConfig | null = null;
    const emitter = {
      setDepth: vi.fn().mockReturnThis(),
      emitParticleAt: vi.fn((x: number, y: number) => {
        const particle = {} as Phaser.GameObjects.Particles.Particle;
        const currentConfig = config!;
        const scale = currentConfig.scale.onEmit(particle);
        emissions.push({
          x,
          y,
          scale,
          tint: currentConfig.tint.onEmit(),
          scaleAtHalfLife: currentConfig.scale.onUpdate(particle, 'scaleX', 0.5),
        });
      }),
      killAll: vi.fn(),
    };
    const particles = vi.fn((
      _x: number,
      _y: number,
      _texture: string,
      emitterConfig: SmokeEmitterConfig,
    ) => {
      config = emitterConfig;
      return emitter;
    });
    const scene = {
      add: { particles },
    } as unknown as Phaser.Scene;
    const renderer = new RocketRenderer(scene);
    const internals = renderer as unknown as {
      spawnSmokePuff: (x: number, y: number, size: number, color: number) => void;
    };

    internals.spawnSmokePuff(10, 20, 6, 0x123456);
    internals.spawnSmokePuff(30, 40, 28, 0xabcdef);

    expect(particles).toHaveBeenCalledTimes(1);
    expect(config).toMatchObject({
      reserve: 256,
      maxParticles: 640,
      maxAliveParticles: 640,
    });
    expect(emissions).toEqual([
      { x: 10, y: 20, scale: 0.28, tint: 0x123456, scaleAtHalfLife: 0.462 },
      { x: 30, y: 40, scale: 1, tint: 0xabcdef, scaleAtHalfLife: 1.65 },
    ]);

    renderer.destroyAll();
    expect(emitter.killAll).toHaveBeenCalledOnce();
  });

  it('keeps an allocation-free active view and removes destroyed projectiles centrally', () => {
    const scene = {
      physics: {
        world: {
          off: vi.fn(),
        },
      },
    } as unknown as Phaser.Scene;
    const manager = new ProjectileManager(scene);
    const internals = manager as unknown as {
      projectiles: TrackedProjectile[];
      activeProjectiles: Set<TrackedProjectile>;
      projectilesById: Map<number, TrackedProjectile>;
    };
    const sprites = [7, 8].map((id) => ({
      id,
      sprite: {
        x: 10,
        y: 20,
        displayWidth: 8,
        destroy: vi.fn(),
      },
      body: {},
      boundsListener: vi.fn(),
      colliders: [],
    } as unknown as TrackedProjectile));
    for (const tracked of sprites) {
      internals.projectiles.push(tracked);
      internals.activeProjectiles.add(tracked);
      internals.projectilesById.set(tracked.id, tracked);
    }

    const firstView = manager.getActiveProjectiles();
    expect(manager.getActiveProjectiles()).toBe(firstView);
    expect(manager.getProjectileById(7)).toBe(sprites[0]);

    const visitedIds: number[] = [];
    for (const projectile of firstView) {
      visitedIds.push(projectile.id);
      manager.destroyProjectile(projectile.id);
    }

    expect(visitedIds).toEqual([7, 8]);
    expect(firstView.size).toBe(0);
    expect(manager.getProjectileById(7)).toBeUndefined();
    expect(sprites[0].sprite.destroy).toHaveBeenCalledOnce();
    expect(sprites[1].sprite.destroy).toHaveBeenCalledOnce();
  });
});
