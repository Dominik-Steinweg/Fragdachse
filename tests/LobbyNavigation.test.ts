import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Phaser-Ersatz mit echter Segmentgeometrie.
 *
 * Der Renderer bleibt aussen vor, die Schnitttests nicht: Die Wegglättung entscheidet über
 * {@link CombatGeometry.hasLineOfSight}, ob sie einen Wegpunkt überspringen darf. Mit
 * Attrappen, die immer „frei" melden, würde der Test genau den Fehler durchwinken, den er
 * verhindern soll – eine Abkürzung quer durch einen Felsen.
 */
vi.mock('phaser', () => {
  class Rectangle {
    x = 0; y = 0; width = 0; height = 0;
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
        GetLineToCircle(line: Line, circle: Circle, out: { x: number; y: number }[] = []) {
          const dx = line.x2 - line.x1;
          const dy = line.y2 - line.y1;
          const fx = line.x1 - circle.x;
          const fy = line.y1 - circle.y;
          const a = dx * dx + dy * dy;
          const b = 2 * (fx * dx + fy * dy);
          const c = fx * fx + fy * fy - circle.radius * circle.radius;
          const discriminant = b * b - 4 * a * c;
          if (a === 0 || discriminant < 0) return out;
          const root = Math.sqrt(discriminant);
          for (const t of [(-b - root) / (2 * a), (-b + root) / (2 * a)]) {
            if (t < 0 || t > 1) continue;
            out.push({ x: line.x1 + dx * t, y: line.y1 + dy * t });
          }
          return out;
        },
      },
    },
    Math: {
      Distance: {
        Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
      },
    },
  };
});

import { CELL_SIZE } from '../src/config';
import type { ArenaLayout, RockCell } from '../src/types';
import { LobbyObstacleWorld } from '../src/lobby/LobbyObstacleWorld';
import { LobbyNavigation } from '../src/lobby/LobbyNavigation';

const GRID_COLS = 20;
const GRID_ROWS = 10;
const WORLD_FRAME = { offsetX: 0, offsetY: 0, width: GRID_COLS * CELL_SIZE, height: GRID_ROWS * CELL_SIZE };

function layoutWith(rocks: RockCell[]): ArenaLayout {
  return { seed: 1, rocks, trees: [], tracks: [], dirt: [], decals: [], powerUpPedestals: [] } as unknown as ArenaLayout;
}

function centreOf(gridX: number, gridY: number): { x: number; y: number } {
  return { x: gridX * CELL_SIZE + CELL_SIZE / 2, y: gridY * CELL_SIZE + CELL_SIZE / 2 };
}

/** Senkrechte Wand über die volle Höhe, optional mit einer Lücke. */
function verticalWall(gridX: number, gapGridY?: number): RockCell[] {
  const cells: RockCell[] = [];
  for (let gridY = 0; gridY < GRID_ROWS; gridY += 1) {
    if (gridY === gapGridY) continue;
    cells.push({ gridX, gridY });
  }
  return cells;
}

describe('lobby navigation', () => {
  let world: LobbyObstacleWorld;
  let nav: LobbyNavigation;

  function build(rocks: RockCell[]): void {
    world = new LobbyObstacleWorld(layoutWith(rocks), WORLD_FRAME);
    nav = new LobbyNavigation(world);
  }

  beforeEach(() => {
    build(verticalWall(5));
  });

  it('cannot cross a closed wall', () => {
    const from = centreOf(1, 5);
    const to = centreOf(9, 5);
    expect(nav.findPath(from.x, from.y, to.x, to.y)).toBeNull();
  });

  it('uses a passage that a destroyed rock opens, without rebuilding anything else', () => {
    const from = centreOf(1, 5);
    const to = centreOf(9, 5);
    expect(nav.findPath(from.x, from.y, to.x, to.y)).toBeNull();

    const gapRockId = world.getRockIdAt(5, 5);
    expect(gapRockId).toBeGreaterThanOrEqual(0);
    expect(world.setRockAlive(gapRockId, false)).toBe(true);

    const path = nav.findPath(from.x, from.y, to.x, to.y);
    expect(path).not.toBeNull();
    expect(path![path!.length - 1]).toEqual(centreOf(9, 5));
    // Es gibt keinen anderen Durchlass: Ein Weg beweist, dass die geöffnete Zelle benutzt wird.
    // Er läuft in Zellhöhe der Lücke, weil ein Ausweichen daneben durch die Wand ginge.
    for (const point of path!) {
      expect(Math.abs(point.y - centreOf(5, 5).y)).toBeLessThanOrEqual(CELL_SIZE);
    }
  });

  it('pulls the path straight instead of following the cell grid', () => {
    // Freies Feld: Der geglättete Weg braucht einen einzigen Wegpunkt, das Ziel.
    build([]);
    const from = centreOf(1, 1);
    const to = centreOf(14, 8);

    const path = nav.findPath(from.x, from.y, to.x, to.y);
    expect(path).not.toBeNull();
    expect(path).toEqual([centreOf(14, 8)]);
  });

  it('never smooths a shortcut through a rock', () => {
    build(verticalWall(5, 5));
    const from = centreOf(1, 1);
    const to = centreOf(9, 1);

    const path = nav.findPath(from.x, from.y, to.x, to.y);
    expect(path).not.toBeNull();
    // Zwischen Start und Ziel steht die Wand; ein direkter Sprung wäre ein Durchgehen.
    expect(path).not.toEqual([centreOf(9, 1)]);
    // Stattdessen führt der Weg über die Lücke nach unten und wieder hinauf.
    expect(path!.some((point) => Math.abs(point.y - centreOf(5, 5).y) <= CELL_SIZE)).toBe(true);
  });

  it('counts every topology change so running paths know they are stale', () => {
    const before = world.getTopologyVersion();
    const rockId = world.getRockIdAt(5, 2);
    world.setRockAlive(rockId, false);
    world.setRockAlive(rockId, true);
    expect(world.getTopologyVersion()).toBe(before + 2);
    // Ein unveränderter Zustand zählt nicht mit.
    expect(world.setRockAlive(rockId, true)).toBe(false);
    expect(world.getTopologyVersion()).toBe(before + 2);
  });

  it('never cuts the corner between two diagonally touching rocks', () => {
    build([{ gridX: 1, gridY: 0 }, { gridX: 0, gridY: 1 }]);

    // (1,1) ist nur diagonal von (0,0) erreichbar, und dieser Schritt schneidet die Ecke.
    const from = centreOf(0, 0);
    const to = centreOf(1, 1);
    expect(nav.findPath(from.x, from.y, to.x, to.y)).toBeNull();
  });

  it('refuses a rebuild that would wall an actor into a dead pocket', () => {
    // Eine 1x1-Tasche bei (1,1), deren einziger Ausgang die Zelle (2,1) ist.
    build([
      { gridX: 0, gridY: 0 }, { gridX: 1, gridY: 0 }, { gridX: 2, gridY: 0 },
      { gridX: 0, gridY: 1 },
      { gridX: 0, gridY: 2 }, { gridX: 1, gridY: 2 }, { gridX: 2, gridY: 2 },
    ]);

    const actor = [centreOf(1, 1)];
    expect(nav.isRebuildSafe(2, 1, actor)).toBe(false);
    // Weit weg im offenen Feld ist derselbe Neubau unbedenklich.
    expect(nav.isRebuildSafe(15, 7, actor)).toBe(true);
    // In den Actor hineinbauen ist ebenfalls verboten.
    expect(nav.isRebuildSafe(1, 1, actor)).toBe(false);
  });
});
