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
      GetLineToRectangle: (
        line: { x1: number; y1: number; x2: number; y2: number },
        rect: { left: number; right: number; top: number; bottom: number },
        scratch: Array<{ x: number; y: number }>,
      ) => {
        const dx = line.x2 - line.x1;
        const dy = line.y2 - line.y1;
        let enter = 0;
        let exit = 1;
        for (const [origin, delta, min, max] of [
          [line.x1, dx, rect.left, rect.right],
          [line.y1, dy, rect.top, rect.bottom],
        ] as const) {
          if (delta === 0) {
            if (origin < min || origin > max) return scratch;
            continue;
          }
          let near = (min - origin) / delta;
          let far = (max - origin) / delta;
          if (near > far) [near, far] = [far, near];
          enter = Math.max(enter, near);
          exit = Math.min(exit, far);
          if (enter > exit) return scratch;
        }
        scratch.push({ x: line.x1 + dx * enter, y: line.y1 + dy * enter });
        if (exit > enter) scratch.push({ x: line.x1 + dx * exit, y: line.y1 + dy * exit });
        return scratch;
      },
    },
  },
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    DegToRad: (degrees: number) => degrees * Math.PI / 180,
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
      Wrap: (angle: number) => {
        while (angle > Math.PI) angle -= Math.PI * 2;
        while (angle < -Math.PI) angle += Math.PI * 2;
        return angle;
      },
    },
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
import type { ProjectileSpawnConfig, TrackedProjectile } from '../../src/types';
import { WorldProjectileRuntime } from '../../src/projectile/WorldProjectileRuntime';

/**
 * Bindet den Manager an eine echte world-owned Registry und nimmt vorbereitete Records auf.
 *
 * Identity, Aufnahme und Entfernung bleiben beim Owner; der Test liefert nur die Records, die er
 * ohne vollstaendige Phaser-Szene nicht spawnen kann.
 */
function bindProjectileRegistry(
  manager: ProjectileManager,
  records: readonly TrackedProjectile[],
): WorldProjectileRuntime {
  const pending = [...records];
  const runtime = new WorldProjectileRuntime({
    simulation: {
      bindProjectileOwner: (owner) => manager.bindProjectileOwner(owner),
      createProjectile: () => pending.shift() as TrackedProjectile,
      releaseProjectileResources: (record) => manager.releaseProjectileResources(record),
      runLegacyProjectileStage: (deltaMs, nowMs, coreStage) => manager.runLegacyProjectileStage(deltaMs, nowMs, coreStage),
      setProjectileTimeFieldPort: (port) => manager.setProjectileTimeFieldPort(port),
      setHostFrameTime: (nowMs) => manager.setHostFrameTime(nowMs),
      releaseWorldProjectileState: () => manager.releaseWorldProjectileState(),
    },
    hostNowMs: () => 0,
  });
  for (const record of records) {
    runtime.spawnLegacyProjectile(0, 0, 0, record.ownerId, {} as ProjectileSpawnConfig);
  }
  return runtime;
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
    const sprites = [7, 8].map((id) => (fakeEntity({ id, x: 10,
        y: 20,
        displayWidth: 8,
        destroy: vi.fn(), body: {},
      boundsListener: vi.fn(),
      colliders: [] }) as unknown as TrackedProjectile));
    const registry = bindProjectileRegistry(manager, sprites);

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

    // Nach dem World-Teardown bleibt kein Host-Projektil sichtbar und kein Spawn wirksam.
    registry.destroy();
    expect(manager.getActiveProjectiles().size).toBe(0);
    expect(manager.spawnProjectile(0, 0, 0, 'owner', {} as ProjectileSpawnConfig)).toBe(-1);
  });

  it('resolves the nearer obstacle first during a continuous projectile sweep', () => {
    const farRock = {
      active: true,
      getBounds: () => ({ left: 60, top: 8, right: 68, bottom: 24 }),
    };
    const nearRock = {
      active: true,
      getBounds: () => ({ left: 20, top: 8, right: 28, bottom: 24 }),
    };
    const manager = new ProjectileManager({ physics: { world: { off: vi.fn() } } } as unknown as Phaser.Scene);
    manager.setRockGroup(
      {} as Phaser.Physics.Arcade.StaticGroup,
      [farRock, nearRock],
      null,
    );

    const body = {
      velocity: { x: 100, y: 0 },
      reset: vi.fn(),
      setVelocity: vi.fn(),
      enable: true,
    } as unknown as Phaser.Physics.Arcade.Body;
    const projectile = fakeEntity({
      id: 1,
      ownerId: 'shooter',
      lastX: 0,
      lastY: 16,
      x: 100,
      y: 16,
      displayWidth: 4,
      body,
      bounceCount: 0,
      maxBounces: 0,
      damage: 7,
      color: 0xffffff,
      pendingDestroy: false,
      bounceProcessedThisStep: false,
      penetratesRocks: false,
      projectileStyle: 'bullet',
      isGrenade: false,
      isFlame: false,
      isBfg: false,
      colliders: [],
    }) as unknown as TrackedProjectile;
    const rockHits: number[] = [];
    manager.setRockHitCallback((rockId) => rockHits.push(rockId));

    (manager as unknown as { resolveContinuousRockCollision: (projectile: TrackedProjectile) => void })
      .resolveContinuousRockCollision(projectile);

    expect(rockHits).toEqual([1]);
    expect(body.reset).toHaveBeenCalledOnce();
    expect(body.enable).toBe(false);
  });

  it.each(['bfg', 'gauss'] as const)('deduplicates repeated rock and train overlaps for %s', (style) => {
    type OverlapCallback = (object1: unknown, object2: unknown) => void;
    const overlapCallbacks: OverlapCallback[] = [];
    const scene = {
      physics: {
        world: { on: vi.fn(), off: vi.fn() },
        add: {
          overlap: vi.fn((_left: unknown, _right: unknown, callback?: OverlapCallback) => {
            if (callback) overlapCallbacks.push(callback);
            return { destroy: vi.fn() } as unknown as Phaser.Physics.Arcade.Collider;
          }),
        },
      },
    } as unknown as Phaser.Scene;
    const manager = new ProjectileManager(scene);
    const rock = {} as Phaser.GameObjects.Image;
    manager.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, [rock], null);
    manager.setTrainGroup({} as Phaser.Physics.Arcade.StaticGroup);

    const body = {
      velocity: { x: 100, y: 0 },
      setCollideWorldBounds: vi.fn(),
    } as unknown as Phaser.Physics.Arcade.Body;
    const projectile = {
      id: 1,
      ownerId: 'shooter',
      damage: 12,
      body,
      projectileStyle: style,
      colliders: [],
    } as unknown as TrackedProjectile;
    const rockHits: Array<{ id: number; damage: number }> = [];
    const trainHits: number[] = [];
    manager.setRockHitCallback((rockId, damage) => rockHits.push({ id: rockId, damage }));
    manager.setTrainHitCallback((damage) => trainHits.push(damage));

    (manager as unknown as {
      setupProjectileColliders: (
        id: number,
        x: number,
        y: number,
        sprite: unknown,
        body: Phaser.Physics.Arcade.Body,
        tracked: TrackedProjectile,
        cfg: unknown,
      ) => void;
    }).setupProjectileColliders(1, 0, 0, {}, body, projectile, { projectileStyle: style });

    expect(overlapCallbacks).toHaveLength(2);
    overlapCallbacks[0]?.({}, rock);
    overlapCallbacks[0]?.({}, rock);
    overlapCallbacks[1]?.({}, {});
    overlapCallbacks[1]?.({}, {});

    expect(rockHits).toEqual([{ id: 0, damage: 12 }]);
    expect(trainHits).toEqual([12]);
  });

  it('splits Hydra at the impact point and forwards each child through the normal spawn path', () => {
    const manager = new ProjectileManager({ physics: { world: { off: vi.fn() } } } as unknown as Phaser.Scene);
    const spawnedIds = [2, 3];
    const spawn = vi.spyOn(manager, 'spawnProjectile').mockImplementation(() => spawnedIds.shift() ?? 4);
    const body = {
      velocity: {
        x: 100,
        y: 0,
        length: () => 100,
      },
      setVelocity: vi.fn(),
      enable: true,
    } as unknown as Phaser.Physics.Arcade.Body;
    const projectile = fakeEntity({
      id: 1,
      ownerId: 'shooter',
      lastX: 0,
      lastY: 0,
      displayWidth: 10,
      body,
      color: 0x22ccff,
      damage: 20,
      adrenalinGain: 4,
      lifetime: 1_000,
      maxBounces: 2,
      bounceCount: 0,
      splitCount: 2,
      splitSpread: 30,
      splitFactor: 1,
      remainingRangePx: 100,
      initialSpeed: 100,
      timeBubbleFactor: 1,
      pendingDestroy: false,
      colliders: [],
      projectileStyle: 'hydra',
      isGrenade: false,
    }) as unknown as TrackedProjectile;

    const didSplit = (manager as unknown as {
      trySplitHydraProjectile: (
        projectile: TrackedProjectile,
        impactX: number,
        impactY: number,
        outgoingVx: number,
        outgoingVy: number,
      ) => boolean;
    }).trySplitHydraProjectile(projectile, 20, 0, 100, 0);

    expect(didSplit).toBe(true);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(spawn.mock.calls.map((call) => call.slice(0, 4))).toEqual([
      [20, 0, -Math.PI / 6, 'shooter'],
      [20, 0, Math.PI / 6, 'shooter'],
    ]);
    expect(spawn.mock.calls.every((call) => (call[4] as { suppressSpawnFx?: boolean }).suppressSpawnFx === true)).toBe(true);
    expect(projectile.pendingDestroy).toBe(true);
    expect(body.setVelocity).toHaveBeenCalledWith(0, 0);
  });

  it('keeps grenade fuse timing on real time even when projectile time is slowed', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(5_000);
      const sprite = fakeEntity({ id: 1, x: 10, y: 20, displayWidth: 8, destroy: vi.fn() });
      const projectile = {
        id: 1,
        ownerId: 'shooter',
        sprite,
        body: {
          velocity: { x: 0, y: 0 },
          setVelocity: vi.fn(),
        },
        createdAt: 4_600,
        simulatedAgeMs: 0,
        timeBubbleFactor: 0.1,
        isGrenade: true,
        fuseTime: 300,
        grenadeEffect: { type: 'fire' },
        colliders: [],
        boundsListener: vi.fn(),
      } as unknown as TrackedProjectile;
      const manager = new ProjectileManager({ physics: { world: { off: vi.fn() } } } as unknown as Phaser.Scene);
      manager.setTimeBubbleFactorProvider(() => 0.1);
      bindProjectileRegistry(manager, [projectile]);

      const result = manager.hostUpdate(1_000);

      expect(result.explodedGrenades).toHaveLength(1);
      expect(result.explodedGrenades[0]?.effect).toBe(projectile.grenadeEffect);
      expect(projectile.simulatedAgeMs).toBe(100);
      expect(sprite.destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('advances flight lifetime by the explicit time-bubble factor', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(1_000);
      const body = {
        velocity: { x: 100, y: 0 },
        setVelocity: vi.fn((x: number, y: number) => {
          body.velocity.x = x;
          body.velocity.y = y;
        }),
      };
      const sprite = fakeEntity({ id: 1, x: 10, y: 20, displayWidth: 4, destroy: vi.fn() });
      const projectile = {
        id: 1,
        ownerId: 'shooter',
        sprite,
        body,
        createdAt: 1_000,
        lastX: 10,
        lastY: 20,
        simulatedAgeMs: 0,
        timeBubbleFactor: 1,
        lifetime: 100,
        maxBounces: 0,
        bounceCount: 0,
        isGrenade: false,
        pendingDestroy: false,
        colliders: [],
        boundsListener: vi.fn(),
      } as unknown as TrackedProjectile;
      const manager = new ProjectileManager({ physics: { world: { off: vi.fn() } } } as unknown as Phaser.Scene);
      manager.setTimeBubbleFactorProvider(() => 0.5);
      bindProjectileRegistry(manager, [projectile]);

      manager.hostUpdate(100);
      manager.hostUpdate(100);
      expect(projectile.simulatedAgeMs).toBe(100);
      expect(manager.getProjectileById(projectile.id)).toBe(projectile);
      expect(body.velocity.x).toBe(50);

      manager.hostUpdate(1);
      expect(manager.getProjectileById(projectile.id)).toBeUndefined();
      expect(sprite.destroy).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps mini-rocket explosions separated by a coast stage before the next detonation', () => {
    const explosion = {
      radius: 40,
      maxDamage: 20,
      minDamage: 10,
      knockback: 0,
      selfDamageMult: 0,
      damageTarget: 'enemies',
    } as unknown as TrackedProjectile['explosion'];
    const body = {
      velocity: {
        x: 100,
        y: 0,
        length: () => Math.hypot(body.velocity.x, body.velocity.y),
      },
      setVelocity: vi.fn((x: number, y: number) => {
        body.velocity.x = x;
        body.velocity.y = y;
      }),
      enable: true,
    };
    const sprite = fakeEntity({ id: 1, x: 100, y: 20, displayWidth: 8, destroy: vi.fn() });
    const projectile = {
      id: 1,
      ownerId: 'shooter',
      sprite,
      body,
      lastX: 100,
      lastY: 20,
      color: 0xffaa00,
      ownerColor: 0xffffff,
      sourceId: 'weapon.mini_rocket',
      sourceSlot: 'weapon2',
      createdAt: Date.now(),
      lifetime: 2_000,
      maxBounces: 0,
      bounceCount: 0,
      isGrenade: false,
      pendingDestroy: false,
      pendingExplosion: false,
      explosion,
      homing: { acquireDelayMs: 0, searchRadius: 300, retargetIntervalMs: 1, maxTurnDegreesPerStep: 90 },
      miniRocketStageRangePx: 100,
      miniRocketPhase: 'attack',
      miniRocketNextExplosionAtAgeMs: 0,
      miniRocketDeferredExplosion: false,
      miniRocketSpent: false,
      miniRocketHasExploded: false,
      miniRocketReturnEnabled: false,
      multiExplosionsRemaining: 2,
      multiExplosionCoastMs: 50,
      miniRocketExplosionIndex: 0,
      simulatedAgeMs: 100,
      remainingRangePx: 100,
      colliders: [],
      boundsListener: vi.fn(),
    } as unknown as TrackedProjectile;
    const manager = new ProjectileManager({ physics: { world: { off: vi.fn() } } } as unknown as Phaser.Scene);
    bindProjectileRegistry(manager, [projectile]);

    expect(manager.triggerProjectileExplosion(projectile.id, 'enemies:target')).toBe(true);
    const first = manager.hostUpdate(0);
    expect(first.explodedProjectiles).toHaveLength(1);
    expect(projectile.pendingExplosion).toBe(true);

    manager.resumeMultiExplosionProjectile(projectile.id, []);
    expect(projectile.miniRocketPhase).toBe('coast');
    expect((manager as unknown as { updateMiniRocketFlight: (p: TrackedProjectile, age: number) => boolean })
      .updateMiniRocketFlight(projectile, 120)).toBe(false);
    expect(projectile.miniRocketPhase).toBe('coast');
    expect((manager as unknown as { updateMiniRocketFlight: (p: TrackedProjectile, age: number) => boolean })
      .updateMiniRocketFlight(projectile, 150)).toBe(false);
    expect(projectile.miniRocketPhase).toBe('attack');

    projectile.simulatedAgeMs = 150;
    expect(manager.triggerProjectileExplosion(projectile.id, 'enemies:next')).toBe(true);
    const second = manager.hostUpdate(0);
    expect(second.explodedProjectiles).toHaveLength(1);
    expect(manager.getProjectileById(projectile.id)).toBeUndefined();
  });

  it('collects a spent mini-rocket when its explicit return phase reaches the owner', () => {
    const manager = new ProjectileManager({ physics: { world: { off: vi.fn() } } } as unknown as Phaser.Scene);
    const body = {
      velocity: { x: 100, y: 0, length: () => 100 },
      setVelocity: vi.fn(),
    } as unknown as Phaser.Physics.Arcade.Body;
    const projectile = fakeEntity({
      id: 1,
      ownerId: 'shooter',
      x: 100,
      y: 100,
      body,
      homing: { acquireDelayMs: 0, searchRadius: 300, retargetIntervalMs: 1, maxTurnDegreesPerStep: 90 },
      miniRocketStageRangePx: 100,
      miniRocketPhase: 'return',
      miniRocketSpent: true,
      miniRocketPickupRadius: 32,
      simulatedAgeMs: 200,
    }) as unknown as TrackedProjectile;
    const collected = vi.fn();
    manager.setOwnerPositionProvider(() => ({ x: 100, y: 100 }));
    manager.setMiniRocketCollectedCallback(collected);

    const returned = (manager as unknown as {
      updateMiniRocketFlight: (p: TrackedProjectile, age: number) => boolean;
    }).updateMiniRocketFlight(projectile, 200);

    expect(returned).toBe(true);
    expect(collected).toHaveBeenCalledWith(projectile, 100, 100);
  });

  it('resends new projectile statics, supports a full late-join snapshot, and cleans absent IDs', () => {
    const manager = new ProjectileManager({} as Phaser.Scene);
    const projectile = fakeEntity({
      id: 7,
      ownerId: 'shooter',
      x: 10,
      y: 20,
      displayWidth: 6,
      projectileStyle: 'bullet',
      color: 0xffcc00,
      body: { velocity: { x: 800, y: 0 } },
      isFlame: false,
      isGrenade: false,
      createdAt: Date.now(),
    }) as unknown as TrackedProjectile;
    const registry = bindProjectileRegistry(manager, [projectile]);

    const first = manager.getNetSnapshot();
    const second = manager.getNetSnapshot();
    const third = manager.getNetSnapshot();
    const fourth = manager.getNetSnapshot();
    expect(first?.s.length).toBeGreaterThan(0);
    expect(second?.s.length).toBeGreaterThan(0);
    expect(third?.s.length).toBeGreaterThan(0);
    expect(fourth?.s).toEqual([]);
    expect(fourth?.u.length).toBeGreaterThan(0);

    manager.requestFullNetSnapshot();
    expect(manager.getNetSnapshot()).toMatchObject({ f: 1 });

    registry.store.deactivate(projectile);
    expect(manager.getNetSnapshot()).toBeNull();
    bindProjectileRegistry(manager, [projectile]);
    expect(manager.getNetSnapshot()?.s.length).toBeGreaterThan(0);
  });
});
