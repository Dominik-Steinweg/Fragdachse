import { fakeEntity } from '../fakeEntity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: {
    NORMAL: 0,
    ADD: 1,
  },
  // Der ProjectileManager legt Scratch-Geometrie schon im Feld-Initialisierer an.
  Geom: {
    Rectangle: class {
      x = 0; y = 0; width = 0; height = 0;
      get left() { return this.x; }
      get right() { return this.x + this.width; }
      get top() { return this.y; }
      get bottom() { return this.y + this.height; }
      get centerX() { return this.x + this.width / 2; }
      get centerY() { return this.y + this.height / 2; }
      setTo(x: number, y: number, width: number, height: number) {
        this.x = x; this.y = y; this.width = width; this.height = height;
        return this;
      }
    },
    Line: class {
      constructor(
        public x1: number,
        public y1: number,
        public x2: number,
        public y2: number,
      ) {}
      static Length(line: { x1: number; y1: number; x2: number; y2: number }) {
        return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
      }
    },
    Intersects: {
      GetLineToRectangle: (_line: unknown, _rect: unknown, scratch: Array<{ x: number; y: number }>) => {
        scratch.push({ x: 4, y: 16 });
        return scratch;
      },
    },
  },
  Math: {
    Easing: {
      Quadratic: {
        Out: (value: number) => value,
      },
    },
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
    FloatBetween: (min: number, max: number) => (min + max) / 2,
  },
}));

import * as Phaser from 'phaser';
import { RocketRenderer } from '../../src/effects/RocketRenderer';
import { GpuVfxSystem } from '../../src/effects/gpu/GpuVfxSystem';
import { evaluateFakeAnimation, findFakeLane, makeFakeGpuVfxScene } from '../fakeGpuVfxScene';
import { ProjectileManager } from '../../src/entities/ProjectileManager';
import type { TrackedProjectile } from '../../src/types';

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

  it('skips only the supporting rock for a turret projectile', () => {
    type ColliderCallback = (object1: unknown, object2: unknown) => void;
    type ProcessCallback = (object1: unknown, object2: unknown) => boolean;
    const ownRock = {} as Phaser.GameObjects.Image;
    const otherRock = {} as Phaser.GameObjects.Image;
    const processCallbacks: ProcessCallback[] = [];
    const scene = {
      physics: {
        add: {
          collider: vi.fn((_left: unknown, _right: unknown, callback?: ColliderCallback, process?: ProcessCallback) => {
            if (process) processCallbacks.push(process);
            return { destroy: vi.fn() } as unknown as Phaser.Physics.Arcade.Collider;
          }),
        },
      },
    } as unknown as Phaser.Scene;
    const manager = new ProjectileManager(scene);
    manager.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, [ownRock, otherRock], null);

    const body = { setBounce: vi.fn() } as unknown as Phaser.Physics.Arcade.Body;
    const tracked = {
      ignoreRockIndex: 0,
      pendingDestroy: false,
      body,
      colliders: [],
    } as unknown as TrackedProjectile;

    (manager as unknown as { setupFlameColliders: (sprite: unknown, body: unknown, tracked: TrackedProjectile) => void })
      .setupFlameColliders({}, body, tracked);

    expect(processCallbacks).toHaveLength(1);
    expect(processCallbacks[0]?.({}, ownRock)).toBe(false);
    expect(processCallbacks[0]?.({}, otherRock)).toBe(true);
  });

  it('skips only the supporting rock in continuous bullet collision', () => {
    const ownRock = { active: true, getBounds: () => ({ left: 0, top: 0, right: 32, bottom: 32 }) };
    const otherRock = { active: true, getBounds: () => ({ left: 0, top: 0, right: 32, bottom: 32 }) };
    const manager = new ProjectileManager({} as Phaser.Scene);
    manager.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, [ownRock, otherRock], null);

    const body = {
      velocity: { x: 100, y: 0 },
      reset: vi.fn(),
      setVelocity: vi.fn(),
      enable: true,
    } as unknown as Phaser.Physics.Arcade.Body;
    const tracked = fakeEntity({ ignoreRockIndex: 0,
      lastX: 1,
      lastY: 16, x: 2, y: 16, displayWidth: 5, body,
      bounceCount: 0,
      maxBounces: 0,
      damage: 7,
      ownerId: 'turret-owner',
      color: 0xffffff,
      pendingDestroy: false,
      bounceProcessedThisStep: false,
      penetratesRocks: false,
      projectileStyle: 'bullet',
      isGrenade: false,
      isFlame: false,
      isBfg: false,
      colliders: [] }) as unknown as TrackedProjectile;
    const rockHits: number[] = [];
    manager.setRockHitCallback((rockId) => rockHits.push(rockId));

    (manager as unknown as { resolveContinuousRockCollision: (projectile: TrackedProjectile) => void })
      .resolveContinuousRockCollision(tracked);

    expect(rockHits).toEqual([1]);
    expect(body.reset).toHaveBeenCalled();
    expect(body.enable).toBe(false);
  });

  it('clears a flame obstacle-hit set during projectile cleanup', () => {
    const scene = {
      physics: { world: { off: vi.fn() } },
    } as unknown as Phaser.Scene;
    const manager = new ProjectileManager(scene);
    const tracked = fakeEntity({ id: 1, x: 0, y: 0, displayWidth: 16, destroy: vi.fn(), body: {},
      boundsListener: vi.fn(),
      colliders: [],
      hitObstacleIds: new Set([4]),
      hitBaseIds: new Set(['enemy-base']) }) as unknown as TrackedProjectile;

    (manager as unknown as { destroyTrackedProjectile: (projectile: TrackedProjectile) => void })
      .destroyTrackedProjectile(tracked);

    expect(tracked.hitObstacleIds).toEqual(new Set());
    expect(tracked.hitBaseIds).toEqual(new Set());
  });

  it('reuses one shared gpu lane for all rocket smoke puffs', () => {
    // Der Smoke laeuft nicht mehr ueber einen `ParticleEmitter`, sondern ueber einen geteilten
    // SpriteGPULayer. Die Puff-Charakteristik bleibt: dynamischer Startscale aus der
    // Raketengroesse, Tint je Puff, Wachstum auf `startScale * (1 + Quad.easeOut(t) * 1.3)`
    // und eine Alphakurve 0.95 -> 0. Die Kurven liegen jetzt im Shader, nicht in Callbacks.
    const scene = makeFakeGpuVfxScene();
    const system = new GpuVfxSystem(scene as never);
    const renderer = new RocketRenderer(scene as never);
    renderer.generateTextures();
    renderer.registerGpuVfx(system);
    const internals = renderer as unknown as {
      spawnSmokePuff: (x: number, y: number, size: number, color: number) => void;
    };

    internals.spawnSmokePuff(10, 20, 6, 0x123456);
    internals.spawnSmokePuff(30, 40, 28, 0xabcdef);

    // Eine Lane fuer allen Rauch; alle Lanes teilen sich den Atlas.
    const smoke = [findFakeLane(scene, 'rocket-smoke')];
    expect(scene.emitters).toHaveLength(0);
    // Entspricht dem bisherigen `maxAliveParticles: 640`.
    expect(smoke[0].size).toBe(640);
    expect(smoke[0].members.every((member) => member.frame === 'rocket-smoke')).toBe(true);

    const [small, large] = smoke[0].members;
    // Bisher: `startScale * (1 + Quadratic.Out(t) * 1.3)` mit `startScale = max(size/28, 0.28)`.
    const legacyScale = (startScale: number, t: number) => startScale * (1 + t * (2 - t) * 1.3);

    expect(small.scaleX.ease).toBe('Quad.easeOut');
    expect(evaluateFakeAnimation(small.scaleX, 0)).toBeCloseTo(legacyScale(0.28, 0), 10);
    expect(evaluateFakeAnimation(small.scaleX, 0.5)).toBeCloseTo(legacyScale(0.28, 0.5), 10);
    expect(small.x.base).toBe(10);
    expect(small.y.base).toBe(20);
    expect(small.tint).toBe(0x123456);

    // Groesse 28 ergibt startScale 1, die Wachstums-Amplitude wird damit > 1 – genau der Fall,
    // in dem der Shader ohne Basiskorrektur `floor(amplitude) * amplitude` danebenlegen wuerde.
    expect(evaluateFakeAnimation(large.scaleX, 0)).toBeCloseTo(legacyScale(1, 0), 10);
    expect(evaluateFakeAnimation(large.scaleX, 0.5)).toBeCloseTo(legacyScale(1, 0.5), 10);
    expect(large.x.base).toBe(30);
    expect(large.y.base).toBe(40);
    expect(large.tint).toBe(0xabcdef);

    // Alpha 0.95 -> 0 auf derselben Quad-Kurve, ueber die volle Lebenszeit.
    expect(evaluateFakeAnimation(small.alpha, 0)).toBeCloseTo(0.95, 10);
    expect(evaluateFakeAnimation(small.alpha, 0.5)).toBeCloseTo(0.95 - 0.95 * 0.75, 10);
    expect(small.alpha.duration).toBe(1000);
    expect(small.scaleX.duration).toBe(1000);

    renderer.destroyAll();
    expect(smoke[0].patched).toHaveLength(2);
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
    const sprites = [7, 8].map((id) => (fakeEntity({ id, x: 10,
        y: 20,
        displayWidth: 8,
        destroy: vi.fn(), body: {},
      boundsListener: vi.fn(),
      colliders: [] }) as unknown as TrackedProjectile));
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