import { describe, expect, it } from 'vitest';
import { ARENA_HEIGHT, ARENA_OFFSET_X, ARENA_OFFSET_Y, ARENA_WIDTH, CELL_SIZE } from '../src/config';
import { ArenaObstacleIndex, OBSTACLE_BASE, OBSTACLE_ROCK } from '../src/systems/ArenaObstacleIndex';

/**
 * Minimaler Stand-in für die Phaser-Objekte, aus denen der Index gebaut wird.
 * `ArenaObstacleIndex` importiert Phaser nur als Typ und ruft ausschließlich `getBounds()`
 * auf den übergebenen Objekten auf – deshalb reicht dieses Fake, ohne DOM oder Renderer.
 */
class FakeBox {
  active = true;

  constructor(
    readonly centerX: number,
    readonly centerY: number,
    readonly size = CELL_SIZE,
  ) {}

  getBounds(output?: { left: number; top: number; right: number; bottom: number }) {
    const half = this.size / 2;
    const bounds = output ?? ({} as { left: number; top: number; right: number; bottom: number });
    bounds.left = this.centerX - half;
    bounds.top = this.centerY - half;
    bounds.right = this.centerX + half;
    bounds.bottom = this.centerY + half;
    return bounds;
  }
}

function worldPosition(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: ARENA_OFFSET_X + gridX * CELL_SIZE + CELL_SIZE / 2,
    y: ARENA_OFFSET_Y + gridY * CELL_SIZE + CELL_SIZE / 2,
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any -- FakeBox ersetzt Phaser-Objekte */
type AnyBox = any;

interface Visited {
  rockIndices: number[];
  baseCount: number;
  circleCount: number;
}

function visit(
  index: ArenaObstacleIndex,
  x1: number, y1: number, x2: number, y2: number,
): Visited {
  const result: Visited = { rockIndices: [], baseCount: 0, circleCount: 0 };
  index.querySegment(x1, y1, x2, y2, (kind, rockIndex) => {
    if (kind === OBSTACLE_ROCK) result.rockIndices.push(rockIndex);
    else result.baseCount += 1;
    return false;
  }, () => { result.circleCount += 1; return false; });
  return result;
}

/** Exakter Schnitttest Segment gegen Achsen-Box – die Referenz, gegen die der Index prüft. */
function segmentHitsBox(
  x1: number, y1: number, x2: number, y2: number,
  box: FakeBox,
): boolean {
  const half = box.size / 2;
  const left = box.centerX - half;
  const right = box.centerX + half;
  const top = box.centerY - half;
  const bottom = box.centerY + half;
  const dx = x2 - x1;
  const dy = y2 - y1;
  let enter = 0;
  let exit = 1;
  for (const [origin, delta, lo, hi] of [[x1, dx, left, right], [y1, dy, top, bottom]] as const) {
    if (delta === 0) {
      if (origin < lo || origin > hi) return false;
      continue;
    }
    const inv = 1 / delta;
    let t0 = (lo - origin) * inv;
    let t1 = (hi - origin) * inv;
    if (t0 > t1) { const tmp = t0; t0 = t1; t1 = tmp; }
    if (t0 > enter) enter = t0;
    if (t1 < exit) exit = t1;
    if (enter > exit) return false;
  }
  return true;
}

describe('ArenaObstacleIndex', () => {
  it('meldet jedes Hindernis pro Abfrage genau einmal, auch über Bucket-Grenzen hinweg', () => {
    const spot = worldPosition(5, 5);
    // Deutlich größer als ein Bucket (128 px) und damit in mehreren gleichzeitig.
    const index = new ArenaObstacleIndex({
      rocks: () => null,
      trunks: () => null,
      bases: () => [new FakeBox(spot.x, spot.y, 320) as AnyBox],
    });

    const seen = visit(index, spot.x - 400, spot.y, spot.x + 400, spot.y);
    expect(seen.baseCount).toBe(1);
  });

  it('liefert den Index des Felsens aus dem Quell-Array, auch über Lücken hinweg', () => {
    const a = worldPosition(4, 4);
    const b = worldPosition(8, 4);
    const index = new ArenaObstacleIndex({
      // Slot 1 ist zerstört – der Index von Fels `b` muss trotzdem 2 bleiben,
      // sonst trifft der Felsschaden den falschen Fels.
      rocks: () => [new FakeBox(a.x, a.y) as AnyBox, null, new FakeBox(b.x, b.y) as AnyBox],
      trunks: () => null,
      bases: () => null,
    });

    expect(visit(index, a.x, a.y - 200, a.x, a.y + 200).rockIndices).toContain(0);
    // Der Slot dazwischen ist leer, `b` behält seinen Quell-Index 2 statt nachzurücken.
    expect(visit(index, b.x, b.y - 200, b.x, b.y + 200).rockIndices).toContain(2);
  });

  it('überspringt inaktive Hindernisse ohne Invalidierung', () => {
    const spot = worldPosition(6, 6);
    const rock = new FakeBox(spot.x, spot.y);
    const index = new ArenaObstacleIndex({
      rocks: () => [rock as AnyBox],
      trunks: () => null,
      bases: () => null,
    });

    expect(visit(index, spot.x - 100, spot.y, spot.x + 100, spot.y).rockIndices).toEqual([0]);
    // `active` wird bei jeder Abfrage live gelesen: ein zerstörter Fels blockiert sofort
    // nicht mehr, auch wenn niemand markDirty() gerufen hat.
    rock.active = false;
    expect(visit(index, spot.x - 100, spot.y, spot.x + 100, spot.y).rockIndices).toEqual([]);
  });

  it('erkennt einen neu gesetzten Fels nach der Invalidierung', () => {
    const existing = worldPosition(6, 6);
    const placed = worldPosition(7, 6);
    const rocks: (FakeBox | null)[] = [new FakeBox(existing.x, existing.y), null];
    const index = new ArenaObstacleIndex({
      rocks: () => rocks as AnyBox,
      trunks: () => null,
      bases: () => null,
    });

    expect(visit(index, placed.x, placed.y - 100, placed.x, placed.y + 100).rockIndices)
      .not.toContain(1);

    // Genau das, was RockVisualHelper beim Platzieren macht: Slot belegen, dann Trichter.
    rocks[1] = new FakeBox(placed.x, placed.y);
    index.markDirty();
    expect(visit(index, placed.x, placed.y - 100, placed.x, placed.y + 100).rockIndices)
      .toContain(1);
  });

  it('erkennt ein angehängtes Fels-Slot auch ohne Invalidierung', () => {
    const base = worldPosition(6, 6);
    const appended = worldPosition(9, 6);
    const rocks: (FakeBox | null)[] = [new FakeBox(base.x, base.y)];
    const index = new ArenaObstacleIndex({
      rocks: () => rocks as AnyBox,
      trunks: () => null,
      bases: () => null,
    });
    visit(index, base.x, base.y, base.x + 1, base.y);

    // Platzierbare Felsen bekommen IDs jenseits der Layout-Länge und verlängern das Array.
    rocks.push(new FakeBox(appended.x, appended.y));
    expect(visit(index, appended.x, appended.y - 100, appended.x, appended.y + 100).rockIndices)
      .toContain(1);
  });

  it('führt Baumstämme als Kreis-Hindernisse', () => {
    const spot = worldPosition(3, 7);
    const index = new ArenaObstacleIndex({
      rocks: () => null,
      trunks: () => [{ active: true, x: spot.x, y: spot.y, radius: 10 } as AnyBox],
      bases: () => null,
    });

    expect(visit(index, spot.x - 100, spot.y, spot.x + 100, spot.y).circleCount).toBe(1);
  });

  it('bricht die Traversierung ab, sobald ein Besucher true meldet', () => {
    const positions = [worldPosition(4, 4), worldPosition(5, 4), worldPosition(6, 4)];
    const index = new ArenaObstacleIndex({
      rocks: () => positions.map((p) => new FakeBox(p.x, p.y) as AnyBox),
      trunks: () => null,
      bases: () => null,
    });

    let visits = 0;
    index.querySegment(
      positions[0].x - 50, positions[0].y, positions[2].x + 50, positions[2].y,
      () => { visits += 1; return true; },
      () => false,
    );
    expect(visits).toBe(1);
  });

  it('unterscheidet Felsen und Basen', () => {
    const rock = worldPosition(10, 10);
    const base = worldPosition(11, 10);
    const index = new ArenaObstacleIndex({
      rocks: () => [new FakeBox(rock.x, rock.y) as AnyBox],
      trunks: () => null,
      bases: () => [new FakeBox(base.x, base.y) as AnyBox],
    });

    const kinds: number[] = [];
    index.querySegment(rock.x, rock.y, base.x, base.y, (kind) => { kinds.push(kind); return false; }, () => false);
    expect(kinds.sort()).toEqual([OBSTACLE_ROCK, OBSTACLE_BASE].sort());
  });

  it('verliert gegenüber einem vollständigen Scan kein getroffenes Hindernis', () => {
    // Der Index ist eine Vorauswahl: er darf zu viel liefern, aber niemals ein Hindernis
    // auslassen, das das Segment wirklich schneidet – sonst schössen Projektile durch Fels.
    let seed = 20260726;
    const random = (): number => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 0x100000000;
    };

    const rocks: FakeBox[] = [];
    for (let gridY = 0; gridY < 20; gridY += 1) {
      for (let gridX = 0; gridX < 60; gridX += 1) {
        if (random() > 0.3) continue;
        const p = worldPosition(gridX, gridY);
        rocks.push(new FakeBox(p.x, p.y));
      }
    }
    expect(rocks.length).toBeGreaterThan(200);

    const index = new ArenaObstacleIndex({
      rocks: () => rocks as AnyBox,
      trunks: () => null,
      bases: () => null,
    });

    for (let probe = 0; probe < 500; probe += 1) {
      const x1 = ARENA_OFFSET_X + random() * ARENA_WIDTH;
      const y1 = ARENA_OFFSET_Y + random() * ARENA_HEIGHT;
      const angle = random() * Math.PI * 2;
      const length = 40 + random() * 500;
      const x2 = x1 + Math.cos(angle) * length;
      const y2 = y1 + Math.sin(angle) * length;

      const expected = new Set<number>();
      rocks.forEach((rock, i) => {
        if (segmentHitsBox(x1, y1, x2, y2, rock)) expected.add(i);
      });

      const reported = new Set(visit(index, x1, y1, x2, y2).rockIndices);
      for (const i of expected) {
        expect(reported.has(i), `Segment ${probe} verliert Fels ${i}`).toBe(true);
      }
    }
  });
});
