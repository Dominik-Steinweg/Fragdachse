import { describe, expect, it } from 'vitest';
import { EnemyLocomotion } from '../src/systems/navigation/EnemyLocomotion';
import { NavigationGeometry, type NavigationObstacle } from '../src/systems/navigation/NavigationGeometry';
import type { LocomotionRequest } from '../src/systems/navigation/NavigationContracts';

const body: LocomotionRequest = { id: 'a', x: 64, y: 64, radius: 15, speed: 100,
  waypoint: { x: 180, y: 64 }, previousVx: 0, previousVy: 0, priority: 'ordinary' };
const geometry = (obstacles: NavigationObstacle[] = []) => new NavigationGeometry({ left: 0, top: 0, right: 256, bottom: 256, obstacles });
const neighbor = (id: string, x: number, y: number, radius = 15) => ({ id, x, y, radius, vx: 0, vy: 0 });

describe('Shared enemy and ally locomotion', () => {
  it('keeps broad-phase reuse equivalent to exact sweeps for mixed shapes and world boundaries', () => {
    const world = geometry([
      { id: 'wall', kind: 'rock', shape: 'rect', left: 96, right: 128, top: 80, bottom: 176 },
      { id: 'trunk', kind: 'trunk', shape: 'circle', x: 56, y: 120, radius: 12 },
    ]);
    for (const radius of [0, 8, 15, 30]) for (const [x, y] of [[64, 64], [88, 80], [16, 220], [96 - 1e-7, 100]]) {
      const candidates: NavigationObstacle[] = [];
      world.visit(x - 120, y - 120, x + 120, y + 120, radius, obstacle => { candidates.push(obstacle); return false; });
      for (let angle = 0; angle < 32; angle++) for (const length of [0, 1, 16, 60, 120]) {
        const bx = x + Math.cos(angle * Math.PI / 16) * length;
        const by = y + Math.sin(angle * Math.PI / 16) * length;
        expect(world.canMoveAgainst(x, y, bx, by, radius, candidates)).toBe(world.canMove(x, y, bx, by, radius));
      }
    }
  });

  it('does not overwrite another unit’s crowd-wait snapshot when reusing scratch lists', () => {
    const world = geometry(), movement = new EnemyLocomotion();
    const self = neighbor('a', body.x, body.y);
    const ring = Array.from({ length: 16 }, (_, index) => neighbor(`b${index}`,
      body.x + Math.cos(index * Math.PI / 8) * 20, body.y + Math.sin(index * Math.PI / 8) * 20));
    movement.begin([self, ...ring], world, 16);
    expect(movement.solve(body).waitReason).toBe('crowd');
    movement.solve({ ...body, id: 'far', x: 220, y: 220, waypoint: { x: 220, y: 200 } });
    movement.begin([self], world, 16);
    expect(movement.solve(body).vx).toBeGreaterThan(0);
  });

  it('includes a fast approaching physical neighbor outside the ordinary walking horizon', () => {
    const movement = new EnemyLocomotion(), world = geometry();
    movement.begin([{ ...neighbor('dash', 145, 64), vx: -450 }], world, 16);
    const crossing = movement.solve({ ...body, previousVx: 100 });
    expect(crossing.neighborsVisited).toBe(1);
    movement.begin([], world, 16);
    expect(crossing.vx).toBeLessThan(movement.solve({ ...body, previousVx: 100 }).vx);
  });

  it('uses both body radii and removes departed neighbors from the next snapshot', () => {
    const movement = new EnemyLocomotion(), world = geometry();
    movement.begin([neighbor('b', 96, 64, 28)], world, 16);
    const crowded = movement.solve(body);
    expect(crowded.neighborsVisited).toBe(1);
    movement.begin([], world, 16);
    const free = movement.solve(body);
    expect(free.neighborsVisited).toBe(0);
    expect(free.vx).toBeGreaterThan(crowded.vx);
  });

  it('preserves steering across negative spatial boundaries and repeated snapshot resets', () => {
    const world = new NavigationGeometry({ left: -512, top: -512, right: 512, bottom: 512, obstacles: [] });
    const population = (x: number, y: number) => [
      neighbor('front', x + 30, y), neighbor('behind', x - 42, y - 20),
      neighbor('diagonal', x + 42, y + 30), neighbor('beside', x - 22, y + 42),
      neighbor('distant', x + 300, y + 300),
    ];
    const request = (x: number, y: number): LocomotionRequest => ({ ...body, x, y, waypoint: { x: x + 116, y } });
    const reference = new EnemyLocomotion();
    reference.begin(population(body.x, body.y), world, 16);
    const expected = reference.solve(body);
    expect(expected.neighborsVisited).toBe(4);

    const movement = new EnemyLocomotion();
    // Translate the same local encounter across row and column boundaries, including
    // the origin. Rebuilding the spatial index must neither lose nor retain neighbors.
    const positions = [[-97, 95], [-96, 96], [-95, 97], [-1, -97], [0, -96],
      [1, -95], [95, -1], [96, 0], [97, 1]];
    for (let pass = 0; pass < 2; pass++) {
      for (const [x, y] of positions) {
        movement.begin([], world, 16);
        const free = movement.solve(request(x, y));
        expect(free.neighborsVisited).toBe(0);
        expect(free.vx).toBeGreaterThan(expected.vx);
        movement.begin(population(x, y), world, 16);
        expect(movement.solve(request(x, y))).toEqual(expected);
      }
      movement.clear();
      expect(movement.solve(body).waitReason).toBe('exclusive');
    }
  });

  it('accounts for later overlap relief before rejecting a steering candidate', () => {
    const world = geometry();
    const front = neighbor('front', 86, 64, 10), rear = neighbor('rear', 54, 64, 10);
    const steer = (neighbors: ReturnType<typeof neighbor>[]) => {
      const movement = new EnemyLocomotion();
      movement.begin(neighbors, world, 100);
      return movement.solve({ ...body, radius: 10 });
    };
    // Both neighbors occupy one spatial bucket. The front adds predicted pressure;
    // leaving the initial overlap at the rear makes a diagonal worthwhile afterward.
    const pressureFirst = steer([front, rear]);
    const reliefFirst = steer([rear, front]);
    expect(pressureFirst).toEqual(reliefFirst);
    expect(pressureFirst).toMatchObject({ waitReason: 'none', neighborsVisited: 2 });
    expect(pressureFirst.vx).toBeGreaterThan(0);
    expect(pressureFirst.vy).toBeGreaterThan(pressureFirst.vx);
  });

  it('keeps an unobstructed straight continuation while smoothing a reversed velocity', () => {
    const movement = new EnemyLocomotion(), world = geometry();
    // This visible neighbor contributes no pressure. Reversing existing momentum
    // still moves away from the waypoint briefly, but must not trigger a crowd stop.
    movement.begin([neighbor('beside', 64, 110)], world, 16);
    const result = movement.solve({ ...body, previousVx: -100 });
    expect(result).toMatchObject({ waitReason: 'none', neighborsVisited: 1, vy: 0 });
    expect(result.vx).toBeLessThan(0);
    expect(world.canMove(body.x, body.y, body.x + result.vx * .016, body.y, body.radius)).toBe(true);
  });

  it('ignores a neighbor on the opposite side of a wall', () => {
    const world = geometry([{ id: 'wall', kind: 'barrier', shape: 'rect', left: 80, right: 84, top: 0, bottom: 256 }]);
    const movement = new EnemyLocomotion();
    movement.begin([neighbor('b', 100, 64)], world, 16);
    const result = movement.solve({ ...body, waypoint: { x: 64, y: 160 } });
    expect(result.neighborsVisited).toBe(0);
    expect(result.vy).toBeGreaterThan(0);
    expect(world.canMove(body.x, body.y, body.x + result.vx * .016, body.y + result.vy * .016, body.radius)).toBe(true);
  });

  it('leaves a crowd wait as soon as the blocking neighbors are removed', () => {
    const world = geometry(), movement = new EnemyLocomotion();
    const self = neighbor('a', body.x, body.y);
    const ring = Array.from({ length: 16 }, (_, index) => neighbor(`b${index}`,
      body.x + Math.cos(index * Math.PI / 8) * 20, body.y + Math.sin(index * Math.PI / 8) * 20));
    movement.begin([self, ...ring], world, 16);
    expect(movement.solve(body)).toMatchObject({ vx: 0, vy: 0, waitReason: 'crowd' });
    movement.begin([self, ...ring], world, 16);
    expect(movement.solve(body)).toMatchObject({ vx: 0, vy: 0, waitReason: 'crowd' });
    movement.begin([self], world, 16);
    expect(movement.solve(body).vx).toBeGreaterThan(0);
  });

  it('keeps dense neighbor visibility equivalent across mixed obstacles and geometry replacement', () => {
    const walls = geometry([
      { id: 'wall', kind: 'barrier', shape: 'rect', left: 80, right: 84, top: 0, bottom: 120 },
      { id: 'trunk', kind: 'trunk', shape: 'circle', x: 55, y: 90, radius: 8 },
    ]);
    const crowd = Array.from({ length: 24 }, (_, i) => neighbor(`n${i}`,
      body.x + Math.cos(i * Math.PI / 12) * 35, body.y + Math.sin(i * Math.PI / 12) * 35));
    const movement = new EnemyLocomotion();
    for (const world of [walls, geometry(), walls]) {
      const visible = crowd.filter(n => world.canMove(body.x, body.y, n.x, n.y, 0));
      const reference = new EnemyLocomotion();
      movement.begin(crowd, world, 16); reference.begin(visible, world, 16);
      expect(movement.solve(body)).toEqual(reference.solve(body));
    }
  });

  it('checks the final smoothed velocity against the entire body corridor', () => {
    const world = geometry([{ id: 'wall', kind: 'barrier', shape: 'rect', left: 80, right: 96, top: 0, bottom: 256 }]);
    const movement = new EnemyLocomotion(); movement.begin([], world, 16);
    const result = movement.solve({ ...body, previousVx: 400, waypoint: { x: 64, y: 160 } });
    expect(world.canMove(64, 64, 64 + result.vx * .016, 64 + result.vy * .016, 15)).toBe(true);
  });

  it('escapes an embedded start continuously with decreasing overlap', () => {
    const world = geometry([{ id: 'new-wall', kind: 'rock', shape: 'rect', left: 72, right: 104, top: 32, bottom: 96 }]);
    const movement = new EnemyLocomotion(); movement.begin([], world, 16);
    const result = movement.solve(body);
    expect(result.waitReason).toBe('recovery');
    expect(Math.hypot(result.vx, result.vy) * .016).toBeLessThanOrEqual(4);
    expect(world.penetration(64 + result.vx * .016, 64 + result.vy * .016, 15)).toBeLessThan(world.penetration(64, 64, 15));
  });

  it('reduces an initial world-edge overlap without teleporting or entering another obstacle', () => {
    const world = geometry(), movement = new EnemyLocomotion(); movement.begin([], world, 16);
    const result = movement.solve({ ...body, x: 12 });
    expect(result.waitReason).toBe('recovery');
    expect(result.vx).toBeGreaterThan(0);
    expect(world.penetration(12 + result.vx * .016, 64 + result.vy * .016, 15)).toBeLessThan(3);
    expect(world.canRecover(12, 64, 11, 64, 15, new Set())).toBe(false);
  });

  it('keeps attack and exclusive movement outside ordinary steering', () => {
    const movement = new EnemyLocomotion(); movement.begin([], geometry(), 16);
    expect(movement.solve({ ...body, priority: 'attack' })).toMatchObject({ vx: 0, vy: 0, waitReason: 'attack' });
    expect(movement.solve({ ...body, priority: 'exclusive' })).toMatchObject({ vx: 0, vy: 0, waitReason: 'exclusive' });
  });
});
