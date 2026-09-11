import { describe, expect, it, vi } from 'vitest';

/**
 * Phaser-Ersatz mit echter Segmentgeometrie.
 *
 * Die Schusslinienprüfung steht und fällt mit dem Schnitttest gegen die Zug-Bounds; eine
 * Attrappe, die immer „frei" meldet, würde genau den Fehler durchwinken, den dieser Test
 * verhindern soll.
 */
vi.mock('phaser', () => {
  class Rectangle {
    x = 0; y = 0; width = 0; height = 0;
    constructor(x = 0, y = 0, width = 0, height = 0) { this.setTo(x, y, width, height); }
    setTo(x: number, y: number, width: number, height: number) {
      this.x = x; this.y = y; this.width = width; this.height = height;
      return this;
    }
    get left() { return this.x; }
    get right() { return this.x + this.width; }
    get top() { return this.y; }
    get bottom() { return this.y + this.height; }
  }
  class Circle {
    x = 0; y = 0; radius = 0;
    setTo(x: number, y: number, radius: number) {
      this.x = x; this.y = y; this.radius = radius;
      return this;
    }
  }
  class Line {
    x1 = 0; y1 = 0; x2 = 0; y2 = 0;
    setTo(x1: number, y1: number, x2: number, y2: number) {
      this.x1 = x1; this.y1 = y1; this.x2 = x2; this.y2 = y2;
      return this;
    }
    static Length(line: Line): number {
      return Math.hypot(line.x2 - line.x1, line.y2 - line.y1);
    }
  }

  /** Schnittpunkt zweier Strecken, oder `null`. */
  function segmentIntersection(
    ax: number, ay: number, bx: number, by: number,
    cx: number, cy: number, dx: number, dy: number,
  ): { x: number; y: number } | null {
    const rx = bx - ax;
    const ry = by - ay;
    const sx = dx - cx;
    const sy = dy - cy;
    const denominator = rx * sy - ry * sx;
    if (Math.abs(denominator) < 1e-9) return null;
    const t = ((cx - ax) * sy - (cy - ay) * sx) / denominator;
    const u = ((cx - ax) * ry - (cy - ay) * rx) / denominator;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: ax + rx * t, y: ay + ry * t };
  }

  return {
    Geom: {
      Rectangle,
      Circle,
      Line,
      Intersects: {
        GetLineToRectangle(line: Line, rect: Rectangle, out: { x: number; y: number }[] = []) {
          const edges: ReadonlyArray<readonly [number, number, number, number]> = [
            [rect.left, rect.top, rect.right, rect.top],
            [rect.right, rect.top, rect.right, rect.bottom],
            [rect.right, rect.bottom, rect.left, rect.bottom],
            [rect.left, rect.bottom, rect.left, rect.top],
          ];
          for (const [cx, cy, dx, dy] of edges) {
            const point = segmentIntersection(line.x1, line.y1, line.x2, line.y2, cx, cy, dx, dy);
            if (point) out.push(point);
          }
          return out;
        },
        GetLineToCircle(_line: Line, _circle: Circle, out: { x: number; y: number }[] = []) {
          return out;
        },
      },
    },
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
      Distance: {
        Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
      },
    },
  };
});

import { WorldCombatCore as CombatSystem } from '../src/combat/WorldCombatCore';
import { ArenaObstacleIndex } from '../src/systems/ArenaObstacleIndex';
import { CombatGeometry } from '../src/systems/CombatGeometry';
import { createWorldGeometryQueries } from '../src/world/WorldGeometryQueries';
import * as Phaser from 'phaser';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { NetworkBridge } from '../src/network/NetworkBridge';

const TRACK_X = 500;
const SEGMENT_WIDTH = 44;
const SEGMENT_HEIGHT = 100;

/**
 * Zug-Segment wie der `TrainManager` es hält: unsichtbares Rechteck mit Static-Body, dessen
 * `enable`-Flag die physische Anwesenheit trägt.
 */
function makeSegment(centerY: number, enabled = true) {
  return {
    active: true,
    x: TRACK_X,
    y: centerY,
    displayWidth: SEGMENT_WIDTH,
    displayHeight: SEGMENT_HEIGHT,
    body: { enable: enabled },
  } as unknown as Phaser.GameObjects.Rectangle;
}

function makeCombatSystem(): CombatSystem {
  const system = new CombatSystem(
    {} as unknown as PlayerManager,
    {} as unknown as NetworkBridge,
  );
  // Kein Fels, kein Baumstamm, keine Basis: übrig bleibt genau der bewegliche Blocker.
  system.setArenaObstacles([], []);
  system.setBaseObstacles(null);
  return system;
}

describe('CombatSystem.hasClearLineOfFire', () => {
  it.each([10, 70, 530])('segments hitscan before real blockers without tracing the portal gap (%s)', wall => {
    const system = makeCombatSystem();
    system.setPortalQueryPort({ getPortalPairs: () => [{ id: 'pair', ownerId: 'owner',
      a: { x: 50, y: 0 }, b: { x: 500, y: 0 }, radius: 16, reentryDistance: 48,
      damageBonus: 0.6, createdAt: 0, expiresAt: 1000 }], isPortalFriendly: () => true });
    vi.spyOn(system, 'traceHitscan').mockImplementation(options => {
      const end = options.startX + options.range;
      const hit = wall >= options.startX && wall <= end;
      const endX = hit ? wall : end;
      return { endX, endY: 0, distance: endX - options.startX, hitObstacle: hit,
        hitPlayerId: null, hitEnemyId: null, hitDecoyId: null };
    });
    const path = system.traceHitscanPath({ shooterId: 'owner', startX: 0, startY: 0,
      angle: 0, range: 100, traceThickness: 1 });
    expect(path).toHaveLength(wall === 10 ? 1 : 2);
    if (wall === 10) expect(path[0].trace.endX).toBe(10);
    else {
      expect(path.map(s => [s.startX, s.trace.endX])).toEqual([[0, 34], [484, wall === 70 ? 550 : 530]]);
      expect(path[1].portalDamage).toEqual([{ pairId: 'pair', bonus: 0.6 }]);
    }
    expect(system.traceHitscanPath({ shooterId: 'owner', startX: 80, startY: 0,
      angle: 0, range: 50, traceThickness: 1 })).toHaveLength(1);
  });

  it('reports a clear line while no train is on the map', () => {
    const system = makeCombatSystem();

    expect(system.hasClearLineOfFire(300, 300, 700, 300)).toBe(true);
  });

  it('blocks a shot whose path crosses the train', () => {
    const system = makeCombatSystem();
    system.setTrainSegments([makeSegment(250), makeSegment(350)]);

    expect(system.hasClearLineOfFire(300, 300, 700, 300)).toBe(false);
    // Die reine Sichtprüfung bleibt unverändert – der Zug ist kein Sichthindernis.
    expect(system.hasLineOfSight(300, 300, 700, 300)).toBe(true);
  });

  it('leaves a shot alongside the train alone', () => {
    const system = makeCombatSystem();
    system.setTrainSegments([makeSegment(250), makeSegment(350)]);

    expect(system.hasClearLineOfFire(300, 300, 400, 300)).toBe(true);
  });

  it('applies the clearance radius of wide projectiles to the train', () => {
    const system = makeCombatSystem();
    system.setTrainSegments([makeSegment(300)]);

    // Wurfbahn knapp am Zugende vorbei: ohne Korridor frei, mit Korridor blockiert.
    expect(system.hasClearLineOfFire(300, 365, 700, 365)).toBe(true);
    expect(system.hasClearLineOfFire(300, 365, 700, 365, { clearanceRadius: 24 })).toBe(false);
  });

  it('stops blocking once the train segments are physically gone', () => {
    const system = makeCombatSystem();
    // Der TrainManager schaltet bei Zerstörung nur die Bodies ab; die Rechtecke bleiben stehen.
    system.setTrainSegments([makeSegment(250, false), makeSegment(350, false)]);

    expect(system.hasClearLineOfFire(300, 300, 700, 300)).toBe(true);
  });
});

describe('CombatSystem.resolveSafeHitscanStart', () => {
  it('keeps a free gameplay muzzle exactly at the desired point', () => {
    const system = makeCombatSystem();

    expect(system.resolveSafeHitscanStart(300, 300, 400, 300)).toEqual({ x: 400, y: 300 });
  });

  it('stops immediately before the train without changing the hitscan direction', () => {
    const system = makeCombatSystem();
    system.setTrainSegments([makeSegment(300)]);

    const resolved = system.resolveSafeHitscanStart(300, 300, 520, 300);

    // Zugkante: 500 - 22. Der Resolver zieht nur sein kleines Epsilon ab, keine doppelte Body-Clearance.
    expect(resolved.x).toBeCloseTo(477.75, 6);
    expect(resolved.y).toBe(300);
  });
});

describe('WorldGeometryQueries – headless read-only boundary', () => {
  it('separates direct fire and support from physical blocking and reads gate state live', () => {
    const walls = [20, 40].map(x => ({ active: true, obstacleClass: 'low' as const,
      getBounds: () => new Phaser.Geom.Rectangle(x, -10, 10, 20) }));
    const gate = { active: false, getBounds: () => new Phaser.Geom.Rectangle(70, -10, 10, 20) };
    const index = new ArenaObstacleIndex({ bounds: () => ({ offsetX: -100, offsetY: -100, width: 1000, height: 200 }),
      rocks: () => walls, bases: () => null, trunks: () => null, barriers: () => [gate] });
    const geometry = new CombatGeometry(index);
    const line = new Phaser.Geom.Line().setTo(0, 0, 100, 0);
    expect(geometry.nearestObstacleHit(line, { purpose: 'directFire' })).toBeNull();
    expect(geometry.nearestObstacleHit(line, { purpose: 'physical' })).toMatchObject({ kind: 'rock', index: 0 });
    expect(geometry.nearestObstacleHit(line, { purpose: 'support', acceptsLowTarget: id => id === 1 }))
      .toMatchObject({ kind: 'rock', index: 1, x: 40 });
    gate.active = true;
    expect(geometry.nearestObstacleHit(line, { purpose: 'directFire' })).toMatchObject({ kind: 'barrier', x: 70 });
    gate.active = false;
    expect(geometry.nearestObstacleHit(line, { purpose: 'directFire' })).toBeNull();
    Object.assign(walls[0], { obstacleClass: 'invalid' });
    expect(() => geometry.nearestObstacleHit(line, { purpose: 'directFire' })).toThrow('Unclassified solid obstacle');
  });

  it('keeps exact base gaps open and limits carrier permission to the first connected body footprint', () => {
    const cells = [0, 32, 96].map(x => ({ active: true, getData: () => 'carrier',
      getBounds: () => new Phaser.Geom.Rectangle(x, 0, 32, 32) }));
    const geometry = new CombatGeometry(new ArenaObstacleIndex({
      bounds: () => ({ offsetX: -100, offsetY: -100, width: 1000, height: 300 }),
      rocks: () => [], bases: () => cells, trunks: () => [] }));
    const shot = { purpose: 'directFire' as const, sourceCarrierBaseId: 'carrier', halfWidth: 5, halfHeight: 2 };
    expect(geometry.nearestObstacleHit(new Phaser.Geom.Line().setTo(16, 16, 68, 16), shot)).toBeNull();
    expect(geometry.carrierExitFraction(16, 16, 68, 16, 'carrier', 5, 2)).toBeGreaterThan(1);
    expect(geometry.nearestObstacleHit(new Phaser.Geom.Line().setTo(16, 16, 120, 16), shot))
      .toMatchObject({ kind: 'base', baseId: 'carrier', x: 91 });
    expect(geometry.nearestObstacleHit(new Phaser.Geom.Line().setTo(80, -30, 80, 60), shot)).toBeNull();
    expect(geometry.nearestObstacleHit(new Phaser.Geom.Line().setTo(80, 16, 110, 16), shot))
      .toMatchObject({ kind: 'base', baseId: 'carrier', x: 91 });
  });

  it('produces the same blocker and safe-muzzle result without a CombatSystem instance', () => {
    const rock = {
      active: true,
      getBounds: () => new Phaser.Geom.Rectangle(480, 280, 40, 40),
    };
    const index = new ArenaObstacleIndex({
      bounds: () => ({ offsetX: 0, offsetY: 0, width: 1000, height: 1000 }),
      rocks: () => [rock],
      trunks: () => [],
      bases: () => [],
    });
    const queries = createWorldGeometryQueries({
      metrics: { offsetX: 0, offsetY: 0, widthPx: 1000, heightPx: 1000 },
      index,
    });

    expect(queries.hasLineOfFire(300, 300, 700, 300)).toBe(false);
    expect(queries.resolveSafeGameplayMuzzle(300, 300, { x: 700, y: 300 })).toEqual({ x: 479.75, y: 300 });
  });
});
