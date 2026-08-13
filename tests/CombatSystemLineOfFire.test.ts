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

import { CombatSystem } from '../src/systems/CombatSystem';
import type { PlayerManager } from '../src/entities/PlayerManager';
import type { ProjectileManager } from '../src/entities/ProjectileManager';
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
    {} as unknown as ProjectileManager,
    {} as unknown as NetworkBridge,
  );
  // Kein Fels, kein Baumstamm, keine Basis: übrig bleibt genau der bewegliche Blocker.
  system.setArenaObstacles([], []);
  system.setBaseObstacles(null);
  return system;
}

describe('CombatSystem.hasClearLineOfFire', () => {
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
