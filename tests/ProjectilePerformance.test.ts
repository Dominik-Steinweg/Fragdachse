import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: {
    ADD: 1,
  },
  // Der ProjectileManager legt Scratch-Geometrie schon im Feld-Initialisierer an.
  Geom: {
    Rectangle: class {
      x = 0; y = 0; width = 0; height = 0;
      setTo(x: number, y: number, width: number, height: number) {
        this.x = x; this.y = y; this.width = width; this.height = height;
        return this;
      }
    },
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
  it('damages each obstacle once per flame and uses kind-specific rock scaling', () => {
    type ColliderCallback = (object1: unknown, object2: unknown) => void;
    const rock = {} as Phaser.GameObjects.Image;
    const callbacks: ColliderCallback[] = [];
    const scene = {
      physics: {
        add: {
          collider: vi.fn((_left: unknown, _right: unknown, callback?: ColliderCallback) => {
            if (callback) callbacks.push(callback);
            return { destroy: vi.fn() } as unknown as Phaser.Physics.Arcade.Collider;
          }),
        },
      },
    } as unknown as Phaser.Scene;
    const manager = new ProjectileManager(scene);
    manager.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, [rock], null);

    const body = { setBounce: vi.fn(), setVelocity: vi.fn() } as unknown as Phaser.Physics.Arcade.Body;
    const makeTracked = (multiplier: number): TrackedProjectile => ({
      ownerId: 'flame-owner',
      damage: 20,
      rockDamageMult: multiplier,
      body,
      pendingDestroy: false,
      hitObstacleIds: new Set<number>(),
      colliders: [],
    } as unknown as TrackedProjectile);

    const rockHits: Array<{ id: number; damage: number; ownerId: string }> = [];
    manager.setRockHitCallback((rockId, damage, ownerId) => rockHits.push({ id: rockId, damage, ownerId }));

    const staticRockFlame = makeTracked(0);
    manager.setObstacleKindResolver(() => undefined);
    (manager as unknown as { setupFlameColliders: (sprite: unknown, body: unknown, tracked: TrackedProjectile) => void })
      .setupFlameColliders({}, body, staticRockFlame);
    callbacks.shift()?.({}, rock);
    callbacks.shift()?.({}, rock);
    expect(rockHits).toEqual([]);
    expect(body.setBounce).toHaveBeenCalledWith(0, 0);

    const turretFlame = makeTracked(0);
    manager.setObstacleKindResolver(() => 'turret');
    (manager as unknown as { setupFlameColliders: (sprite: unknown, body: unknown, tracked: TrackedProjectile) => void })
      .setupFlameColliders({}, body, turretFlame);
    callbacks.shift()?.({}, rock);
    callbacks.shift()?.({}, rock);
    expect(rockHits).toEqual([{ id: 0, damage: 20, ownerId: 'flame-owner' }]);

    const secondFlame = makeTracked(0.25);
    manager.setObstacleKindResolver(() => undefined);
    (manager as unknown as { setupFlameColliders: (sprite: unknown, body: unknown, tracked: TrackedProjectile) => void })
      .setupFlameColliders({}, body, secondFlame);
    callbacks.shift()?.({}, rock);
    expect(rockHits).toHaveLength(2);
    expect(rockHits[1]).toMatchObject({ id: 0, damage: 5 });
  });

  it('damages a multi-cell hostile base once per flame, even with zero rock damage', () => {
    type ColliderCallback = (object1: unknown, object2: unknown) => void;
    const callbacks: ColliderCallback[] = [];
    const scene = {
      physics: {
        add: {
          collider: vi.fn((_left: unknown, _right: unknown, callback?: ColliderCallback) => {
            if (callback) callbacks.push(callback);
            return { destroy: vi.fn() } as unknown as Phaser.Physics.Arcade.Collider;
          }),
        },
      },
    } as unknown as Phaser.Scene;
    const manager = new ProjectileManager(scene);
    manager.setBaseGroup({} as Phaser.Physics.Arcade.StaticGroup);

    const body = { setBounce: vi.fn(), setVelocity: vi.fn() } as unknown as Phaser.Physics.Arcade.Body;
    const tracked = {
      ownerId: 'flame-owner',
      damage: 20,
      rockDamageMult: 0,
      body,
      pendingDestroy: false,
      colliders: [],
    } as unknown as TrackedProjectile;
    const baseCell = (baseId: string) => ({
      getData: vi.fn((key: string) => key === 'baseId' ? baseId : undefined),
    }) as unknown as Phaser.GameObjects.GameObject;
    const baseHits: Array<{ baseId: string; damage: number; attackerId: string; projectile?: TrackedProjectile }> = [];
    manager.setBaseHitCallback((baseId, damage, attackerId, projectile) => {
      baseHits.push({ baseId, damage, attackerId, projectile });
    });

    (manager as unknown as { setupFlameColliders: (sprite: unknown, body: unknown, tracked: TrackedProjectile) => void })
      .setupFlameColliders({}, body, tracked);

    // Two different cells expose the same logical base ID.
    callbacks[0]?.({}, baseCell('enemy-base'));
    callbacks[0]?.({}, baseCell('enemy-base'));

    expect(baseHits).toHaveLength(1);
    expect(baseHits[0]).toMatchObject({
      baseId: 'enemy-base',
      damage: 20,
      attackerId: 'flame-owner',
      projectile: tracked,
    });
    expect(body.setVelocity).toHaveBeenCalledWith(0, 0);
  });

  it('clears a flame obstacle-hit set during projectile cleanup', () => {
    const scene = {
      physics: { world: { off: vi.fn() } },
    } as unknown as Phaser.Scene;
    const manager = new ProjectileManager(scene);
    const tracked = {
      id: 1,
      sprite: { x: 0, y: 0, displayWidth: 16, destroy: vi.fn() },
      body: {},
      boundsListener: vi.fn(),
      colliders: [],
      hitObstacleIds: new Set([4]),
      hitBaseIds: new Set(['enemy-base']),
    } as unknown as TrackedProjectile;

    (manager as unknown as { destroyTrackedProjectile: (projectile: TrackedProjectile) => void })
      .destroyTrackedProjectile(tracked);

    expect(tracked.hitObstacleIds).toEqual(new Set());
    expect(tracked.hitBaseIds).toEqual(new Set());
  });

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
