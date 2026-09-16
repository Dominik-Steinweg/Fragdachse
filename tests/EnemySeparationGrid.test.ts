import { describe, expect, it } from 'vitest';
import { EnemyLocomotion } from '../src/systems/navigation/EnemyLocomotion';
import { NavigationGeometry, type NavigationObstacle } from '../src/systems/navigation/NavigationGeometry';
import type { LocomotionRequest } from '../src/systems/navigation/NavigationContracts';

const body: LocomotionRequest = { id: 'a', x: 64, y: 64, radius: 15, speed: 100,
  waypoint: { x: 180, y: 64 }, previousVx: 0, previousVy: 0, priority: 'ordinary' };
const geometry = (obstacles: NavigationObstacle[] = []) => new NavigationGeometry({ left: 0, top: 0, right: 256, bottom: 256, obstacles });
const neighbor = (id: string, x: number, y: number, radius = 15) => ({ id, x, y, radius, vx: 0, vy: 0 });

describe('Shared enemy and ally locomotion', () => {
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
