import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({
  BlendModes: {
    NORMAL: 0,
    ADD: 1,
  },
  // Der ProjectilePhysicsBinding legt Scratch-Geometrie schon im Feld-Initialisierer an.
  Geom: {
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
  return { binding, runtime, doubles, contacts, listeners };
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
    runtime.spawnProjectile({ ...spawn, flight: { ...spawn.flight, drag: { bounceFrictionMultiplier: 0.5 } } });
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
