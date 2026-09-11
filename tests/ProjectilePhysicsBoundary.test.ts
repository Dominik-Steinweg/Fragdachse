import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  BlendModes: {
    NORMAL: 0,
    ADD: 1,
  },
  // Der ProjectilePhysicsBinding legt Scratch-Geometrie schon im Feld-Initialisierer an.
  Geom: {
    Circle: class {},
    Rectangle: class {
      constructor(public x = 0, public y = 0, public width = 0, public height = 0) {}
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
      setTo(x1: number, y1: number, x2: number, y2: number) {
        Object.assign(this, { x1, y1, x2, y2 });
        return this;
      }
      static Length(line: { x1: number; y1: number; x2: number; y2: number }) {
        return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
      }
    },
    Intersects: {
      GetLineToRectangle: (
        line: { x1: number; y1: number; x2: number; y2: number },
        rect: { left: number; right: number; top: number; bottom: number },
        scratch: Array<{ x: number; y: number }> = [],
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
import { ProjectilePhysicsBinding } from '../src/projectile/ProjectilePhysicsBinding';
import { WorldProjectileRuntime } from '../src/projectile/WorldProjectileRuntime';
import { ProjectileIdentityScope } from '../src/projectile/ProjectileIdentityScope';
import { createSingleOwnerProvenance, type ProjectileSpawnRequest } from '../src/projectile/ProjectileSpawnRequest';
import { createPresentation, createTechnicalPhysicsBinding } from './ProjectileRuntimeTestHelper';
import type { RockPhysicsProxy } from '../src/arena/rocks/RockPhysicsProxy';
import { ArenaObstacleIndex } from '../src/systems/ArenaObstacleIndex';

function fixture() {
  const doubles = createTechnicalPhysicsBinding();
  let nextId = 0;
  const contacts: Array<{ mode: string; callback: (a: unknown, b: unknown) => void;
    process?: (a: unknown, b: unknown) => boolean; destroy: ReturnType<typeof vi.fn> }> = [];
  const listeners = new Set<(body: unknown) => void>();
  const register = (mode: string) => (_a: unknown, _b: unknown,
    callback: (a: unknown, b: unknown) => void, process?: (a: unknown, b: unknown) => boolean) => {
    const collider = { mode, callback, process, destroy: vi.fn() };
    contacts.push(collider);
    return collider;
  };
  const scene = {
    add: { rectangle: (x: number, y: number, size: number, _height: number, color: number) => {
      const handle = doubles.binding.createPhysicsHandle({ id: nextId++, x, y, size, color,
        bodyWidth: size, bodyHeight: size, bodyOffsetX: 0, bodyOffsetY: 0,
        velocityX: 0, velocityY: 0, mechanics: {} as never });
      vi.mocked(handle.body.setSize).mockImplementation((width = size, height = width) => {
        Object.assign(handle.body, { width, height, halfWidth: Math.floor(width / 2), halfHeight: Math.floor(height / 2) });
        return handle.body;
      });
      return Object.assign(handle.sprite, { body: handle.body, setDepth: vi.fn() });
    } },
    physics: { add: { existing: vi.fn(), collider: register('collider'), overlap: register('overlap') },
      world: { bounds: new Phaser.Geom.Rectangle(),
        on: (event: string, fn: (body: unknown) => void) => { if (event === 'worldbounds') listeners.add(fn); },
        off: (event: string, fn: (body: unknown) => void) => { if (event === 'worldbounds') listeners.delete(fn); } } },
  } as unknown as Phaser.Scene;
  const binding = new ProjectilePhysicsBinding(scene);
  const runtime = new WorldProjectileRuntime({ physicsBinding: binding, presentation: createPresentation(),
    identityScope: new ProjectileIdentityScope(1), hostNowMs: () => 0 });
  return { binding, runtime, doubles, contacts, listeners, scene };
}

function request(): ProjectileSpawnRequest {
  return { origin: { x: 0, y: 0, angle: 0 },
    flight: { speed: 100, size: 8, lifetimeMs: 1000, maxBounces: 2, isGrenade: false },
    provenance: createSingleOwnerProvenance('owner'), interaction: { directHit: { damage: 10 } },
    presentation: { color: 0xffffff } };
}

function rock(x: number): RockPhysicsProxy {
  return { active: true, getBounds: () => new Phaser.Geom.Rectangle().setTo(x, -10, 10, 20) } as RockPhysicsProxy;
}

describe('technical Phaser boundary with the authoritative runtime', () => {
  it('hits a figure behind several low walls without spending penetration on the walls', () => {
    const { binding, runtime, doubles } = fixture();
    const walls = [20, 40, 60].map(x => Object.assign(rock(x), { obstacleClass: 'low' as const }));
    binding.setRockGroup(null, walls, null);
    binding.setObstacleIndex(new ArenaObstacleIndex({ bounds: () => ({ offsetX: -100, offsetY: -100, width: 1000, height: 200 }),
      rocks: () => walls, trunks: () => null, bases: () => null }));
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => {
      for (let i = 0; i < 3; i++) sink('rock', i, 'owner', 25 + 20 * i, 0, 10, 20 + 20 * i, -10, 30 + 20 * i, 10, 'rock');
      for (const x of [90, 130]) sink('enemy', String(x), 'hostile', x, 0, 5, x - 5, -5, x + 5, 5);
    } });
    const hit = vi.fn(() => ({ accepted: true }));
    runtime.setProjectileCombatPort({ resolveDirectImpact: hit } as never);
    const spawn = request(); runtime.spawnProjectile({ ...spawn, flight: { ...spawn.flight, penetration: { count: 1 } } });
    doubles.handles.get(0)!.sprite.x = 160;
    runtime.runHostInteractionStage(16); runtime.runHostProjectileStage(16, 16);
    expect(hit.mock.calls.map(call => (call[0] as { target: { id: string } }).target.id)).toEqual(['90', '130']);
    expect(runtime.activeCount).toBe(0);
    runtime.destroy();
  });

  it.each(['sweep', 'physics', 'overlap'] as const)('blocks standard %s fire at a closed mission gate and releases an open gate', mode => {
    for (const active of [true, false]) {
      const { binding, runtime, doubles } = fixture();
      const gate = { active, getBounds: () => new Phaser.Geom.Rectangle(50, -20, 10, 40) };
      binding.setObstacleIndex(new ArenaObstacleIndex({ bounds: () => ({ offsetX: -100, offsetY: -100, width: 1000, height: 200 }),
        rocks: () => null, trunks: () => null, bases: () => null, barriers: () => [gate] }));
      const spawn = request(); runtime.spawnProjectile({ ...spawn, flight: { ...spawn.flight, collisionMode: mode } });
      const handle = doubles.handles.get(0)!; handle.sprite.x = 80;
      runtime.runHostInteractionStage(16); runtime.runHostProjectileStage(16, 16);
      expect(handle.body.velocity.x > 0).toBe(!active);
      runtime.destroy();
    }
  });

  it.each(['portal', 'redirect'] as const)('revokes an active carrier exemption on %s', transfer => {
    const { binding, runtime, doubles, scene } = fixture();
    scene.physics.world.bounds.setTo(-100, -100, 1000, 500);
    const cells = [{ active: true, getData: () => 'carrier', getBounds: () => new Phaser.Geom.Rectangle(0, 0, 300, 32) }];
    binding.setBaseGroup({ getChildren: () => cells } as never);
    binding.setObstacleIndex(new ArenaObstacleIndex({ bounds: () => ({ offsetX: -100, offsetY: -100, width: 1000, height: 500 }),
      rocks: () => null, trunks: () => null, bases: () => cells }));
    const hit = vi.fn(); runtime.setBaseHitCallback(hit);
    const spawn = request(); runtime.spawnProjectile({ ...spawn, origin: { x: 16, y: 16, angle: 0 },
      flight: { ...spawn.flight, collisionFilter: { sourceCarrierBaseId: 'carrier' } } });
    const handle = doubles.handles.get(0)!;
    if (transfer === 'portal') {
      runtime.setPortalQueryPort({ getPortalPairs: () => [{ id: 'pair', ownerId: 'owner', a: { x: 60, y: 16 }, b: { x: 200, y: 16 },
        radius: 8, reentryDistance: 20, damageBonus: 0, createdAt: 0, expiresAt: 2000 }], isPortalFriendly: () => true });
      handle.sprite.x = 100; runtime.runHostPortalStage(16);
    } else {
      runtime.focusProjectilesInCircle({ x: 16, y: 16, radius: 30, targetX: 100, targetY: 16, ownerId: 'other', ownerColor: 0xffffff, nowMs: 0 });
      handle.sprite.x = 70;
    }
    runtime.runHostInteractionStage(16); runtime.runHostProjectileStage(16, 16);
    expect(hit).toHaveBeenCalledOnce();
    expect(hit.mock.calls[0][0]).toBe('carrier');
    runtime.destroy();
  });

  it.each(['sweep', 'physics', 'bfg', 'gauss', 'piercing'] as const)('passes low walls without contact or hit consumption (%s)', mode => {
    const { binding, runtime, doubles, contacts } = fixture();
    const walls = [20, 40, 60].map(x => Object.assign(rock(x), { obstacleClass: 'low' as const }));
    binding.setRockGroup({ getChildren: () => walls } as never, walls, null);
    binding.setObstacleIndex(new ArenaObstacleIndex({ bounds: () => ({ offsetX: -100, offsetY: -100, width: 1000, height: 200 }),
      rocks: () => walls, trunks: () => null, bases: () => null }));
    const damage = vi.fn(); runtime.setRockHitCallback(damage);
    const spawn = request();
    runtime.spawnProjectile({ ...spawn, flight: { ...spawn.flight,
      collisionMode: mode === 'sweep' ? 'sweep' : mode === 'physics' ? 'physics' : 'overlap',
      isBfg: mode === 'bfg', piercesTargets: mode === 'gauss',
      penetration: mode === 'piercing' ? { penetratesRocks: true, count: 2 } : undefined } });
    const handle = doubles.handles.get(0)!;
    handle.sprite.x = 80;
    for (const contact of contacts) for (const wall of walls) expect(contact.process?.(handle.sprite, wall)).toBe(false);
    runtime.runHostInteractionStage(16); runtime.runHostProjectileStage(16, 16);
    expect(damage).not.toHaveBeenCalled();
    expect(runtime.activeCount).toBe(1);
    expect(handle.body.velocity.x).toBe(100);
    runtime.readProjectileReplication(record => expect(record.dynamic.bounce).toBeUndefined());
    runtime.destroy();
  });

  it.each([false, true])('ends carrier permission at a complete exit, including a same-frame niche (niche: %s)', niche => {
    const { binding, runtime, doubles } = fixture();
    const cells = (niche ? [0, 64] : [0, 32]).map(x => ({ active: true, getData: () => 'carrier',
      getBounds: () => new Phaser.Geom.Rectangle(x, 0, 32, 32) }));
    binding.setBaseGroup({ getChildren: () => cells } as never);
    binding.setObstacleIndex(new ArenaObstacleIndex({ bounds: () => ({ offsetX: -100, offsetY: -100, width: 1000, height: 300 }),
      rocks: () => null, trunks: () => null, bases: () => cells as never }));
    const hit = vi.fn(); runtime.setBaseHitCallback(hit);
    const spawn = request();
    runtime.spawnProjectile({ ...spawn, origin: { x: 16, y: 16, angle: 0 },
      flight: { ...spawn.flight, collisionFilter: { sourceCarrierBaseId: 'carrier' } } });
    const handle = doubles.handles.get(0)!;
    handle.sprite.x = niche ? 80 : 90;
    runtime.runHostInteractionStage(16); runtime.runHostProjectileStage(16, 16);
    if (!niche) {
      expect(hit).not.toHaveBeenCalled();
      handle.body.setVelocity(-100, 0); handle.sprite.x = 40;
      runtime.runHostInteractionStage(32); runtime.runHostProjectileStage(16, 32);
    }
    expect(hit).toHaveBeenCalledOnce();
    expect(hit.mock.calls[0][0]).toBe('carrier');
    runtime.destroy();
  });

  it('delivers one injector support contact to the first eligible low target', () => {
    const { binding, runtime, doubles } = fixture();
    const walls = [20, 40, 60].map(x => Object.assign(rock(x), { obstacleClass: 'low' as const }));
    binding.setRockGroup(null, walls, null);
    runtime.setLowSupportTargetChecker(id => id !== 0);
    runtime.setObstacleKindResolver(() => 'turret');
    binding.setObstacleIndex(new ArenaObstacleIndex({ bounds: () => ({ offsetX: -100, offsetY: -100, width: 1000, height: 200 }),
      rocks: () => walls, trunks: () => null, bases: () => null }));
    runtime.setProjectileWorldBlockerPort({ getNearestBlockerDistance: (sx, sy, ex, ey, _ignore, options) =>
      binding.getObstacleGeometry()!.nearestObstacleHit(new Phaser.Geom.Line(sx, sy, ex, ey), options)?.distance ?? null });
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink =>
      sink('enemy', 'behind', 'hostile', 80, 0, 5, 75, -5, 85, 5) });
    const figureHit = vi.fn(() => ({ accepted: true }));
    runtime.setProjectileCombatPort({ resolveDirectImpact: figureHit } as never);
    const support = vi.fn(); runtime.setSupportImpactCallback(support);
    const spawn = request();
    runtime.spawnProjectile({ ...spawn, interaction: { ...spawn.interaction,
      support: { energyInjector: { damageMultiplier: 1.2, durationMs: 1000 } as never } } });
    doubles.handles.get(0)!.sprite.x = 80;
    runtime.runHostInteractionStage(16); runtime.runHostProjectileStage(16, 16);
    expect(support).toHaveBeenCalledOnce();
    expect(support.mock.calls[0][1]).toMatchObject({ kind: 'rock', rockId: 1 });
    expect(figureHit).not.toHaveBeenCalled();
    expect(runtime.activeCount).toBe(0);
    runtime.destroy();
  });

  it('defers Arcade contacts behind an earlier portal and resolves the physical exit remainder', () => {
    const { binding, runtime, doubles, contacts, scene } = fixture();
    scene.physics.world.bounds.setTo(-100, -100, 1100, 200);
    const trunk = { active: true, body: { enable: true, x: 520, y: -10, halfWidth: 10, halfHeight: 10 } };
    binding.setRockGroup(null, null, { getChildren: () => [trunk] } as never);
    runtime.setPortalQueryPort({ getPortalPairs: () => [{ id: 'pair', ownerId: 'owner',
      a: { x: 50, y: 0 }, b: { x: 500, y: 0 }, radius: 16, reentryDistance: 48,
      damageBonus: 0, createdAt: 0, expiresAt: 2000 }], isPortalFriendly: () => true });
    const id = runtime.spawnProjectile(request())!;
    const handle = doubles.handles.get(0)!;
    handle.body.x = 100;
    expect(contacts[0].process!(undefined, trunk)).toBe(false);
    runtime.setProjectileWorldBlockerPort({ getNearestBlockerDistance: () => 20 });
    expect(contacts[0].process!(undefined, trunk)).toBe(true);
    runtime.setProjectileWorldBlockerPort(null);
    handle.sprite.x = 100;
    runtime.runHostPortalStage(1000);
    expect(handle.sprite.x + handle.body.halfWidth).toBeCloseTo(520 - 0.01);
    expect(handle.body.velocity.x).toBeLessThan(0);
    expect(runtime.activeCount).toBe(1);
    expect(id).toBeGreaterThanOrEqual(0);
    runtime.destroy();
  });

  it('gives swept rock impacts one response owner, while physics projectiles retain their collider', () => {
    const { runtime, binding, contacts } = fixture();
    binding.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, [rock(50)], null);
    runtime.spawnProjectile(request());
    expect(contacts).toHaveLength(0);
    const spawn = request();
    runtime.spawnProjectile({ ...spawn, flight: { ...spawn.flight, collisionMode: 'physics' } });
    expect(contacts.map(c => c.mode)).toEqual(['collider']);
    runtime.destroy();
  });

  it('uses the entered face near a corner instead of reflecting a nearby second axis', () => {
    const { runtime, binding } = fixture();
    const target = { active: true, getBounds: () => new Phaser.Geom.Rectangle(0, 0, 10, 10) } as RockPhysicsProxy;
    binding.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, [target], null);
    expect(binding.findNearestRockSweep(20, 20, 0, -1)).toMatchObject({ x: 10, y: 9.5, normalX: 1, normalY: 0 });
    expect(binding.findNearestRockSweep(20, 20, 0, 1)).toMatchObject({ normalX: 0, normalY: 1 });
    expect(binding.findNearestRockSweep(20, 0, 0, 20)).toBeNull(); // isolated tangency, no entry
    expect(binding.findNearestRockSweep(5, 5, 20, 20)).toBeNull(); // exiting is not entering
    expect(binding.findNearestRockSweep(20, 20, 0, 0)).toMatchObject({ normalX: 1, normalY: 1 });
    binding.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, [target,
      { active: true, getBounds: () => new Phaser.Geom.Rectangle(0, 12, 8, 8) } as RockPhysicsProxy], null);
    expect(binding.findNearestRockSweep(20, 0, 0, 20)).toMatchObject({ rockIndex: 1, x: 8, y: 12 });
    runtime.destroy();
  });

  it.each([false, true])('sweeps the projectile body across a cell edge even when its centerline misses (indexed: %s)', indexed => {
    const { runtime, binding } = fixture();
    const targets = [{ active: true, getBounds: () => new Phaser.Geom.Rectangle(128, 128, 32, 32) } as RockPhysicsProxy];
    binding.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, targets, null);
    if (indexed) binding.setObstacleIndex(new ArenaObstacleIndex({
      bounds: () => ({ offsetX: 0, offsetY: 0, width: 512, height: 512 }),
      rocks: () => targets, trunks: () => null, bases: () => null,
    }));
    // The line stays in the neighbouring spatial bucket, but a Glock-sized body hits.
    expect(binding.findNearestRockSweep(100, 127.5, 180, 127.5, undefined, 4, 2)).toMatchObject({
      rockIndex: 0, centerX: 124, centerY: 127.5, x: 128, y: 128, normalX: -1, normalY: 0,
    });
    runtime.destroy();
  });

  it.each([[false, false], [true, false], [false, true], [true, true]])(
    'does not reflect from an internal wall seam (reversed: %s, indexed: %s)', (reverse, indexed) => {
    const { runtime, binding } = fixture();
    const targets = [0, 10].map(y => ({ active: true,
      getBounds: () => new Phaser.Geom.Rectangle(0, y, 10, 10) }) as RockPhysicsProxy);
    if (reverse) targets.reverse();
    binding.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, targets, null);
    if (indexed) {
      const index = new ArenaObstacleIndex({ bounds: () => ({ offsetX: 0, offsetY: 0, width: 100, height: 100 }),
        rocks: () => targets, trunks: () => null, bases: () => null });
      binding.setObstacleIndex(index);
    }
    expect(binding.findNearestRockSweep(20, 20, 0, 0)).toMatchObject({
      rockIndex: reverse ? 1 : 0, x: 10, y: 10, normalX: 1, normalY: 0,
    });
    runtime.destroy();
  });

  it('bounces a swept shot up-right once at a vertical wall and keeps travelling away next frame', () => {
    const { runtime, binding, doubles, contacts } = fixture();
    binding.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup,
      [{ active: true, getBounds: () => new Phaser.Geom.Rectangle(0, 0, 10, 10) } as RockPhysicsProxy], null);
    const hit = vi.fn();
    runtime.setRockHitCallback(hit);
    const spawn = request();
    const id = runtime.spawnProjectile({ ...spawn, origin: { x: 20, y: 20, angle: Math.atan2(-21, -20) } })!;
    const { body, sprite } = doubles.handles.get(0)!;
    const before = { ...body.velocity };
    expect(contacts).toHaveLength(0); // Arcade must not reflect from a tile overlap first.
    sprite.x = 0; sprite.y = -1;
    runtime.runHostProjectileStage(16, 16);
    expect(body.velocity.x).toBe(-before.x);
    expect(body.velocity.y).toBe(before.y);
    expect(hit).toHaveBeenCalledOnce();
    sprite.x += body.velocity.x * 0.016; sprite.y += body.velocity.y * 0.016;
    runtime.runHostProjectileStage(16, 32);
    expect(body.velocity.x).toBe(-before.x);
    expect(body.velocity.y).toBe(before.y);
    expect(hit).toHaveBeenCalledOnce();
    runtime.readProjectileReplication(record => {
      expect(record.id).toBe(id);
      expect(record.dynamic.bounce).toMatchObject({ sequence: 1, vx: -before.x, vy: before.y });
    });
    runtime.destroy();
  });

  it('does not let the combat target circle move a Glock-sized shot inside a persistent-base cell before its wall sweep', () => {
    const { runtime, binding, doubles } = fixture();
    const target = { active: true, getBounds: () => new Phaser.Geom.Rectangle(128, 128, 32, 32) } as RockPhysicsProxy;
    binding.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, [target], null);
    runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink =>
      sink('rock', 0, '__world__', 144, 144, 16 * Math.SQRT2, 128, 128, 160, 160, 'rock') });
    const hit = vi.fn(); runtime.setRockHitCallback(hit);
    const spawn = request();
    runtime.spawnProjectile({ ...spawn, origin: { x: 200, y: 128, angle: Math.PI },
      flight: { ...spawn.flight, size: 2, speed: 900 }, presentation: { color: 0xffffff, tracer: { profile: 'light' } } });
    const { sprite, body } = doubles.handles.get(0)!;
    sprite.x = 130; sprite.y = 128;
    runtime.runHostInteractionStage(16);
    expect(sprite.x).toBe(130); // only the wall sweep may resolve this movement
    expect(hit).not.toHaveBeenCalled();
    runtime.runHostProjectileStage(16, 16);
    expect(body.velocity.x).toBeGreaterThan(0);
    expect(hit).toHaveBeenCalledOnce();
    runtime.readProjectileReplication(record => {
      expect(record.dynamic.bounce?.sequence).toBe(1);
      expect(record.dynamic.flightPath!.points.every(p => p.x >= 160)).toBe(true);
    });
    runtime.destroy();
  });

  it.each([0, Math.PI, Math.PI / 2, -Math.PI / 2])('blocks Glock shots across a raster seam from angle %s in successive physics steps', angle => {
    for (const seamOffset of [-0.75, 0, 0.75]) {
      const { runtime, binding, doubles } = fixture();
      const targets = [128, 160].map(y => ({ active: true,
        getBounds: () => new Phaser.Geom.Rectangle(128, y, 32, 32) } as RockPhysicsProxy));
      binding.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, targets, null);
      binding.setObstacleIndex(new ArenaObstacleIndex({
        bounds: () => ({ offsetX: 0, offsetY: 0, width: 512, height: 512 }),
        rocks: () => targets, trunks: () => null, bases: () => null,
      }));
      runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => {
        for (let index = 0; index < 2; index++) sink('rock', index, '__world__', 144, 144 + index * 32,
          16 * Math.SQRT2, 128, 128 + index * 32, 160, 160 + index * 32, 'rock');
      } });
      const hit = vi.fn(); runtime.setRockHitCallback(hit);
      const spawn = request();
      const horizontal = Math.abs(Math.cos(angle)) > 0.5;
      runtime.spawnProjectile({ ...spawn,
        origin: { x: horizontal ? 144 - Math.cos(angle) * 70 : 144 + seamOffset,
          y: horizontal ? 160 + seamOffset : 160 - Math.sin(angle) * 80, angle },
        flight: { ...spawn.flight, size: 2, speed: 900 } });
      const { sprite, body } = doubles.handles.get(0)!;
      for (let step = 1; step <= 16; step++) {
        sprite.x += body.velocity.x / 120; sprite.y += body.velocity.y / 120;
        runtime.runHostInteractionStage(step * 1000 / 120);
        runtime.runHostProjectileStage(1000 / 120, step * 1000 / 120);
      }
      expect(hit).toHaveBeenCalledOnce();
      expect(body.velocity.x * Math.cos(angle) + body.velocity.y * Math.sin(angle)).toBeLessThan(0);
      runtime.destroy();
    }
  });

  it.each([false, true])('reflects the exported lateral Glock shot once at the exterior of actual base cells (indexed: %s)', indexed => {
    for (const mirror of [false, true]) {
      const { runtime, binding, doubles, contacts } = fixture();
      // Two BaseEntity cells touch at y=588. They are OBSTACLE_BASE, not rocks.
      const cells = [556, 588].map(y => ({ active: true, getData: () => 'persistent-main',
        getBounds: () => new Phaser.Geom.Rectangle(1026, y, 32, 32) }));
      binding.setBaseGroup({ getChildren: () => cells } as unknown as Phaser.Physics.Arcade.StaticGroup);
      if (indexed) binding.setObstacleIndex(new ArenaObstacleIndex({
        bounds: () => ({ offsetX: 0, offsetY: 0, width: 2048, height: 1024 }),
        rocks: () => [], trunks: () => null, bases: () => cells,
      }));
      runtime.setProjectileCollisionTargetQueryPort({ readCollisionTargets: sink => {
        sink('base', 'persistent-main', '__world__', 1042, 588, 36, 1026, 556, 1058, 620);
      } });
      // The previous rock-only lookup returns no candidate for the exported entry.
      expect(binding.findNearestRockSweep(1064.3135946483026, 588.2906038102445,
        1056.8144512897586, 588.177250874655, undefined, 4.9994289056959405, 1)).toBeNull();
      expect(binding.findNearestRockSweep(1064.3135946483026, 588.2906038102445,
        1056.8144512897586, 588.177250874655, undefined, 4.9994289056959405, 1, undefined, true))
        .toMatchObject({ baseId: 'persistent-main', normalX: 1, normalY: 0 });
      const hit = vi.fn(); runtime.setBaseHitCallback(hit);
      const spawn = request();
      const vx = mirror ? 899.8972030252693 : -899.8972030252693;
      const vy = -13.602352270739633;
      const id = runtime.spawnProjectile({ ...spawn,
        origin: { x: mirror ? 2084 - 1152.5824537536853 : 1152.5824537536853,
          y: 589.624827443846, angle: Math.atan2(vy, vx) },
        flight: { ...spawn.flight, size: 2, speed: 900 },
        presentation: { color: 0xffffff, tracer: { profile: 'light' } } })!;
      expect(contacts).toHaveLength(0);
      const { sprite, body } = doubles.handles.get(0)!;
      for (let step = 1; step <= 32; step++) {
        sprite.x += body.velocity.x / 120; sprite.y += body.velocity.y / 120;
        runtime.runHostInteractionStage(step * 1000 / 120);
        runtime.runHostProjectileStage(1000 / 120, step * 1000 / 120);
        // The center must stay outside the solid block for the entire flight.
        expect(mirror ? sprite.x < 1026 : sprite.x > 1058).toBe(true);
      }
      expect(hit).toHaveBeenCalledOnce();
      expect(hit.mock.calls[0][0]).toBe('persistent-main');
      expect(body.velocity.x).toBeCloseTo(-vx);
      expect(body.velocity.y).toBeCloseTo(vy);
      runtime.readProjectileReplication(record => {
        expect(record.id).toBe(id);
        expect(record.dynamic.bounce?.sequence).toBe(1);
        expect(record.dynamic.flightPath!.points.every(p => mirror ? p.x < 1026 : p.x > 1058)).toBe(true);
      });
      runtime.destroy();
    }
  });

  it('keeps a real opening between base cells passable but blocks an unrelated carrier reference', () => {
    const { runtime, binding, doubles, contacts } = fixture();
    const cells = [100, 164].map(y => ({ active: true, getData: () => 'main',
      getBounds: () => new Phaser.Geom.Rectangle(100, y, 32, 32) }));
    binding.setBaseGroup({ getChildren: () => cells } as unknown as Phaser.Physics.Arcade.StaticGroup);
    expect(binding.findNearestRockSweep(160, 148, 80, 148, undefined, 5, 1, undefined, true)).toBeNull();
    const hit = vi.fn(); runtime.setBaseHitCallback(hit);
    const spawn = request();
    runtime.spawnProjectile({ ...spawn, origin: { x: 160, y: 116, angle: Math.PI },
      flight: { ...spawn.flight, collisionFilter: { sourceCarrierBaseId: 'carrier' } } });
    expect(contacts).toHaveLength(0);
    doubles.handles.get(0)!.sprite.x = 80;
    runtime.runHostInteractionStage(16);
    runtime.runHostProjectileStage(16, 16);
    expect(hit).toHaveBeenCalledOnce();
    expect(doubles.handles.get(0)!.body.velocity.x).toBeGreaterThan(0);
    runtime.destroy();
  });

  it.each(['physics', 'overlap'] as const)('preserves base colliders for %s shots', collisionMode => {
    const { runtime, binding, contacts } = fixture();
    binding.setBaseGroup({ getChildren: () => [] } as unknown as Phaser.Physics.Arcade.StaticGroup);
    const spawn = request();
    runtime.spawnProjectile({ ...spawn, flight: { ...spawn.flight, collisionMode } });
    expect(contacts.map(contact => contact.mode)).toEqual(['collider']);
    runtime.destroy();
  });

  it('uses overlap for rock penetration, applies one hit and keeps flight velocity', () => {
    const { runtime, binding, contacts, doubles, listeners } = fixture();
    const target = rock(50);
    binding.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, [target], null);
    const hit = vi.fn();
    runtime.setRockHitCallback(hit);
    const spawn = request();
    runtime.spawnProjectile({ ...spawn, flight: { ...spawn.flight, penetration: { penetratesRocks: true } } });
    expect(contacts[0].mode).toBe('overlap');
    contacts[0].callback({}, target);
    runtime.setHostFrameTime(16);
    contacts[0].callback({}, target);
    expect(hit).toHaveBeenCalledOnce();
    expect(doubles.handles.get(0)!.body.velocity.x).toBe(100);
    expect(runtime.activeCount).toBe(1);
    runtime.destroy();
    expect(contacts[0].destroy).toHaveBeenCalledOnce();
    expect(listeners.size).toBe(0);
  });

  it('undoes a second Phaser reflection without applying another obstacle hit in the same step', () => {
    const { runtime, binding, contacts, doubles } = fixture();
    const targets = [rock(50), rock(60)];
    binding.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, targets, null);
    const hit = vi.fn();
    runtime.setRockHitCallback(hit);
    const spawn = request();
    runtime.spawnProjectile({ ...spawn, flight: { ...spawn.flight, collisionMode: 'physics', drag: { bounceFrictionMultiplier: 0.5 } } });
    const body = doubles.handles.get(0)!.body;
    body.setVelocity(-100, 0);
    contacts[0].callback({}, targets[0]);
    body.setVelocity(50, 0);
    contacts[0].callback({}, targets[1]);
    expect(body.velocity.x).toBe(-50);
    expect(hit).toHaveBeenCalledOnce();
    runtime.destroy();
  });

  it('finds the nearest rock without an obstacle index and honors the supporting-rock exclusion', () => {
    const { binding, runtime } = fixture();
    binding.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, [rock(50), rock(20)], null);
    expect(binding.findNearestRockSweep(0, 0, 100, 0)).toMatchObject({ rockIndex: 1, x: 20, y: 0 });
    expect(binding.findNearestRockSweep(0, 0, 100, 0, 1)).toMatchObject({ rockIndex: 0, x: 50, y: 0 });
    runtime.destroy();
    expect(binding.findNearestRockSweep(0, 0, 100, 0)).toBeNull();
  });

  it('stops both velocity axes for a non-bouncing grenade at world bounds and preserves the fuse', () => {
    const { runtime, doubles, listeners } = fixture();
    const spawn = request();
    runtime.spawnProjectile({ ...spawn, flight: { ...spawn.flight, isGrenade: true, maxBounces: 0, fuseTimeMs: 1000 },
      interaction: { grenadeEffect: { type: 'damage', radius: 20, damage: 10 } } });
    const body = doubles.handles.get(0)!.body;
    body.setVelocity(0, 70);
    for (const listener of listeners) listener(body);
    expect(body.velocity).toMatchObject({ x: 0, y: 0 });
    expect(runtime.activeCount).toBe(1);
    expect(runtime.runHostProjectileStage(1000, 1000).grenadePayloads).toHaveLength(1);
    expect(runtime.activeCount).toBe(0);
  });

  it.each(['bfg', 'gauss', 'piercing'] as const)('damages rock and train once across physics frames for %s', (capability) => {
    const { runtime, binding, contacts } = fixture();
    const target = rock(50);
    binding.setRockGroup({} as Phaser.Physics.Arcade.StaticGroup, [target], null);
    binding.setTrainGroup({} as Phaser.Physics.Arcade.StaticGroup);
    const rockHit = vi.fn();
    const trainHit = vi.fn();
    runtime.setRockHitCallback(rockHit);
    runtime.setTrainImpactPort({ resolveTrainImpact: trainHit });
    const spawn = request();
    runtime.spawnProjectile({ ...spawn,
      flight: { ...spawn.flight, isBfg: capability === 'bfg', collisionMode: 'overlap', piercesTargets: capability === 'piercing' },
      interaction: { directHit: { damage: 10, gaussChain: capability === 'gauss' ? { radius: 20, damageFactor: 0.5 } : undefined } },
    });
    expect(contacts.map(value => value.mode)).toEqual(['overlap', 'overlap']);
    for (const now of [0, 16, 32]) {
      runtime.setHostFrameTime(now);
      for (const collider of contacts) collider.callback({}, target);
    }
    expect(rockHit).toHaveBeenCalledOnce();
    expect(trainHit).toHaveBeenCalledOnce();
    runtime.destroy();
  });

  it('delivers the grenade payload when several bounds contacts exceed its bounce budget', () => {
    const { runtime, doubles, listeners } = fixture();
    const spawn = request();
    runtime.spawnProjectile({ ...spawn, flight: { ...spawn.flight, isGrenade: true, maxBounces: 1, fuseTimeMs: 10000 },
      interaction: { grenadeEffect: { type: 'damage', radius: 20, damage: 10 } } });
    const body = doubles.handles.get(0)!.body;
    for (let contact = 0; contact < 2; contact++) for (const listener of listeners) listener(body);
    expect(body.enable).toBe(false);
    expect(runtime.runHostProjectileStage(1, 1).grenadePayloads).toHaveLength(1);
    expect(runtime.activeCount).toBe(0);
  });
});
