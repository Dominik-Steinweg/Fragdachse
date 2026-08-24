import * as Phaser from 'phaser';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class Rectangle {
    x = 0;
    y = 0;
    width = 0;
    height = 0;

    constructor(x = 0, y = 0, width = 0, height = 0) {
      this.setTo(x, y, width, height);
    }

    setTo(x: number, y: number, width: number, height: number): this {
      this.x = x;
      this.y = y;
      this.width = width;
      this.height = height;
      return this;
    }

    get left(): number { return this.x; }
    get right(): number { return this.x + this.width; }
    get top(): number { return this.y; }
    get bottom(): number { return this.y + this.height; }
    get centerX(): number { return this.x + this.width / 2; }
    get centerY(): number { return this.y + this.height / 2; }
  }

  class Line {
    x1: number;
    y1: number;
    x2: number;
    y2: number;

    constructor(x1 = 0, y1 = 0, x2 = 0, y2 = 0) {
      this.x1 = x1;
      this.y1 = y1;
      this.x2 = x2;
      this.y2 = y2;
    }
  }

  class Circle {
    x = 0;
    y = 0;
    radius = 0;

    setTo(x: number, y: number, radius: number): this {
      this.x = x;
      this.y = y;
      this.radius = radius;
      return this;
    }
  }

  const distance = (x1: number, y1: number, x2: number, y2: number): number =>
    Math.hypot(x2 - x1, y2 - y1);
  const lineToRectangle = (line: Line, rect: Rectangle, out: { x: number; y: number }[]): typeof out => {
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    let enter = 0;
    let exit = 1;
    for (const [origin, delta, min, max] of [
      [line.x1, dx, rect.left, rect.right],
      [line.y1, dy, rect.top, rect.bottom],
    ] as const) {
      if (delta === 0) {
        if (origin < min || origin > max) return out;
        continue;
      }
      let t0 = (min - origin) / delta;
      let t1 = (max - origin) / delta;
      if (t0 > t1) [t0, t1] = [t1, t0];
      enter = Math.max(enter, t0);
      exit = Math.min(exit, t1);
      if (enter > exit) return out;
    }
    out.push({ x: line.x1 + dx * enter, y: line.y1 + dy * enter });
    if (exit > enter) out.push({ x: line.x1 + dx * exit, y: line.y1 + dy * exit });
    return out;
  };
  const lineToCircle = (line: Line, circle: Circle, out: { x: number; y: number }[]): typeof out => {
    const dx = line.x2 - line.x1;
    const dy = line.y2 - line.y1;
    const ox = line.x1 - circle.x;
    const oy = line.y1 - circle.y;
    const a = dx * dx + dy * dy;
    const b = 2 * (ox * dx + oy * dy);
    const c = ox * ox + oy * oy - circle.radius * circle.radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0 || a === 0) return out;
    const root = Math.sqrt(discriminant);
    for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
      if (t >= 0 && t <= 1) out.push({ x: line.x1 + dx * t, y: line.y1 + dy * t });
    }
    return out;
  };

  return {
    Geom: {
      Rectangle,
      Line,
      Circle,
      Intersects: {
        GetLineToRectangle: lineToRectangle,
        GetLineToCircle: lineToCircle,
      },
    },
    Math: { Distance: { Between: distance } },
  };
});

import type { ProjectileSpawnConfig } from '../src/types';
import { ArenaObstacleIndex } from '../src/systems/ArenaObstacleIndex';
import { CombatGeometry } from '../src/systems/CombatGeometry';
import {
  LEAF_BLOWER_OBSTACLE_BODY_SCALE,
  MIN_BODY_LEN,
  resolveProjectileBodyProfile,
  resolveSafeMuzzleSpawn,
} from '../src/systems/ProjectileSpawnResolver';

class FakeBox {
  active = true;

  constructor(
    readonly x: number,
    readonly y: number,
    readonly size: number,
  ) {}

  getBounds(output = new Phaser.Geom.Rectangle()): Phaser.Geom.Rectangle {
    return output.setTo(this.x - this.size / 2, this.y - this.size / 2, this.size, this.size);
  }
}

function projectileConfig(overrides: Partial<ProjectileSpawnConfig> = {}): ProjectileSpawnConfig {
  return {
    speed: 1200,
    size: 4,
    damage: 10,
    color: 0xffffff,
    lifetime: 1000,
    maxBounces: 3,
    isGrenade: false,
    adrenalinGain: 0,
    ...overrides,
  };
}

function geometryWith(
  rocks: readonly FakeBox[] | null = null,
  trunks: readonly { active: boolean; x: number; y: number; radius: number }[] | null = null,
  bases: readonly FakeBox[] | null = null,
  barriers: readonly FakeBox[] | null = null,
): CombatGeometry {
  const index = new ArenaObstacleIndex({
    rocks: () => rocks,
    trunks: () => trunks,
    bases: () => bases,
    barriers: () => barriers,
  });
  return new CombatGeometry(index);
}

describe('ProjectileSpawnResolver', () => {
  it('leitet das Anti-Tunneling- und Sonderkörperprofil vor der Body-Erzeugung ab', () => {
    const fastBullet = resolveProjectileBodyProfile(projectileConfig({ size: 4 }), 0);
    expect(fastBullet.width).toBe(MIN_BODY_LEN);
    expect(fastBullet.height).toBe(4);
    expect(fastBullet.conservativeClearance).toBeCloseTo(Math.hypot(10, 4) / 2, 8);

    const leaf = resolveProjectileBodyProfile(
      projectileConfig({ size: 20, projectileStyle: 'leaf_blower' }),
      Math.PI / 4,
    );
    expect(leaf.width).toBe(Math.max(20 * LEAF_BLOWER_OBSTACLE_BODY_SCALE, 10));
    expect(leaf.height).toBe(leaf.width);
  });

  it('setzt eine freie Mündung exakt an den gewünschten Gameplay-Punkt', () => {
    const spawn = resolveSafeMuzzleSpawn(
      100,
      100,
      { x: 150, y: 100 },
      0,
      projectileConfig(),
      { geometry: geometryWith(), worldBounds: new Phaser.Geom.Rectangle(0, 0, 400, 300) },
    );

    expect(spawn).toEqual({ x: 150, y: 100 });
  });

  it('wendet die aufgeblasene Hindernisgeometrie nicht ein zweites Mal an', () => {
    const rock = new FakeBox(150, 100, 20);
    const geometry = geometryWith([rock]);
    const cfg = projectileConfig({ size: 4 });
    const desired = { x: 220, y: 100 };
    const profile = resolveProjectileBodyProfile(cfg, 0);
    const line = new Phaser.Geom.Line(100, 100, desired.x, desired.y);
    const hit = geometry.nearestObstacleHit(line, { clearanceRadius: profile.conservativeClearance });
    if (!hit) throw new Error('Test benötigt einen Fels-Treffer');

    const spawn = resolveSafeMuzzleSpawn(100, 100, desired, 0, cfg, {
      geometry,
      worldBounds: new Phaser.Geom.Rectangle(0, 0, 400, 300),
    });

    expect(spawn.x).toBeCloseTo(100 + hit.distance - 0.25, 8);
    expect(spawn.x).toBeGreaterThan(100 + hit.distance - profile.conservativeClearance - 1);
  });

  it('berücksichtigt Trunk, Basis, Barriere und Zug als normale Blocker', () => {
    const cases = [
      { geometry: geometryWith(null, [{ active: true, x: 150, y: 100, radius: 10 }]), trainBounds: null },
      { geometry: geometryWith(null, null, [new FakeBox(150, 100, 20)]), trainBounds: null },
      { geometry: geometryWith(null, null, null, [new FakeBox(150, 100, 20)]), trainBounds: null },
      { geometry: geometryWith(), trainBounds: new Phaser.Geom.Rectangle(140, 90, 20, 20) },
    ];

    for (const context of cases) {
      const spawn = resolveSafeMuzzleSpawn(100, 100, { x: 220, y: 100 }, 0, projectileConfig(), {
        ...context,
        worldBounds: new Phaser.Geom.Rectangle(0, 0, 400, 300),
      });
      expect(spawn.x).toBeLessThan(150);
    }
  });

  it('hält den Start vor den World-Bounds und lässt durchdringende Spezialprojektile passieren', () => {
    const worldBounds = new Phaser.Geom.Rectangle(0, 0, 200, 200);
    const context = { geometry: geometryWith(), worldBounds };
    const normal = resolveSafeMuzzleSpawn(100, 100, { x: 220, y: 100 }, 0, projectileConfig(), context);
    expect(normal.x).toBeLessThan(200);

    const bfg = resolveSafeMuzzleSpawn(
      100,
      100,
      { x: 150, y: 100 },
      0,
      projectileConfig({ projectileStyle: 'bfg', isBfg: true }),
      { geometry: geometryWith([new FakeBox(125, 100, 20)]), worldBounds },
    );
    expect(bfg).toEqual({ x: 150, y: 100 });

    const penetrating = resolveSafeMuzzleSpawn(
      100,
      100,
      { x: 150, y: 100 },
      0,
      projectileConfig({ penetratesRocks: true }),
      { geometry: geometryWith([new FakeBox(125, 100, 20)]), worldBounds },
    );
    expect(penetrating).toEqual({ x: 100, y: 100 });
  });
});
