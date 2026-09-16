import { describe, it, expect, vi } from 'vitest';
import { navigationTestWorld } from './navigationTestWorld';
import { segmentObstacleDistanceSq, type NavigationObstacle } from '../src/systems/navigation/NavigationGeometry';

const wall = (id: string, left: number, top: number, right: number, bottom: number): NavigationObstacle =>
  ({ id, kind: 'barrier', shape: 'rect', left, top, right, bottom });

describe('Body graph and current geometry', () => {
  it('sends only the newest geometry while retaining immediate physical collision checks', () => {
    const world = navigationTestWorld(); world.goal(224, 128); world.flush();
    const post = vi.spyOn(world.runner, 'post');
    for (let i = 0; i < 10; i++) {
      world.snapshot.obstacles = [wall(`change:${i}`, 112, 0, 144, 256)];
      world.coordinator.invalidateGeometry();
      expect(world.coordinator.getGeometry()!.isFree(128, 128, 15)).toBe(false);
    }
    world.coordinator.advance(100); world.coordinator.advance(1);
    const jobs = post.mock.calls.map(([message]) => message).filter(message => message.type === 'job');
    const patches = jobs.flatMap(job => job.patches).filter(patch => patch.t === 'geometry');
    expect(patches).toHaveLength(1);
    expect(patches[0].geometry.obstacles[0].id).toBe('change:9');
    expect(world.field.queryNavigation(32, 128).status).toBe('unreachable');
    world.destroy();
  });

  it('routes a 30px body through a 32px corridor and its right-angle turn', () => {
    const world = navigationTestWorld([wall('top', 0, 0, 256, 32), wall('bottom', 0, 64, 160, 256),
      wall('right', 192, 64, 256, 256)]);
    world.goal(176, 224); world.flush();
    let x = 32, y = 48;
    for (let step = 0; step < 250 && Math.hypot(x - 176, y - 224) > 2; step++) {
      const route = world.field.queryNavigation(x, y);
      expect(route.status).toBe('ready');
      if (route.status !== 'ready') break;
      const distance = Math.hypot(route.waypoint.x - x, route.waypoint.y - y), t = Math.min(1, 2 / distance);
      const nx = x + (route.waypoint.x - x) * t, ny = y + (route.waypoint.y - y) * t;
      expect(world.geometry().canMove(x, y, nx, ny, 15)).toBe(true); x = nx; y = ny;
    }
    expect(Math.hypot(x - 176, y - 224)).toBeLessThanOrEqual(2); world.destroy();
  });

  it('keeps larger bodies out of small openings while allowing a suitably wide opening', () => {
    for (const [gap, expected] of [[32, 'unreachable'], [80, 'ready']] as const) {
      const world = navigationTestWorld([wall('a', 112, 0, 144, 128 - gap / 2), wall('b', 112, 128 + gap / 2, 144, 256)], [], 34);
      world.goal(208, 128); world.flush();
      expect(world.field.queryNavigation(48, 128).status).toBe(expected); world.destroy();
    }
  });

  it('uses round trunks and rejects unsafe diagonals despite free endpoints', () => {
    const trunk: NavigationObstacle = { id: 'trunk', kind: 'trunk', shape: 'circle', x: 112, y: 112, radius: 10 };
    const world = navigationTestWorld([trunk]);
    expect(world.geometry().isFree(96, 96, 10)).toBe(true);
    expect(world.geometry().canMove(80, 112, 112, 80, 15)).toBe(false);
    expect(segmentObstacleDistanceSq(0, 0, 20, 20, wall('w', 16, 0, 32, 16))).toBe(0);
    world.destroy();
  });

  it('distinguishes pending, invalid start, invalid goal and confirmed unreachable', () => {
    const world = navigationTestWorld([wall('middle', 112, 0, 144, 256)]);
    world.goal(224, 128);
    expect(world.field.queryNavigation(32, 128).status).toBe('pending');
    world.flush();
    expect(world.field.queryNavigation(32, 128).status).toBe('unreachable');
    expect(world.field.queryNavigation(128, 128).status).toBe('invalid-start');
    // Target motion changes costs, not body connectivity. No completed replacement is needed.
    world.goal(224, 192);
    expect(world.field.queryNavigation(32, 128).status).toBe('unreachable');
    world.goal(32, 192);
    expect(world.field.queryNavigation(32, 128).status).toBe('pending');
    world.goal(128, 128);
    expect(world.field.queryNavigation(32, 128).status).toBe('invalid-goal');
    world.flush(); expect(world.field.queryNavigation(32, 128).status).toBe('invalid-goal'); world.destroy();
  });

  it('keeps an overlapping blocker closed until the final physical object is removed', () => {
    const world = navigationTestWorld([wall('first', 112, 0, 144, 256), wall('second', 112, 0, 144, 256)]);
    world.goal(224, 128); world.flush();
    expect(world.field.queryNavigation(32, 128).status).toBe('unreachable');
    world.snapshot.obstacles.splice(0, 1); world.coordinator.invalidateGeometry(); world.flush();
    expect(world.field.queryNavigation(32, 128).status).toBe('unreachable');
    expect(world.field.hasWalkableCircleLine(32, 128, 224, 128, 15)).toBe(false);
    world.snapshot.obstacles.length = 0; world.coordinator.invalidateGeometry(); world.flush();
    expect(world.field.queryNavigation(32, 128).status).toBe('ready');
    expect(world.field.hasWalkableCircleLine(32, 128, 224, 128, 15)).toBe(true);
    world.destroy();
  });

  it('rejects stale fields immediately after a physical change and activates on the next safe frame', () => {
    const world = navigationTestWorld(); world.goal(224, 128); world.flush();
    world.snapshot.obstacles.push(wall('new', 112, 0, 144, 256)); world.coordinator.invalidateGeometry();
    expect(world.field.hasWalkableCircleLine(32, 128, 224, 128, 15)).toBe(false);
    expect(world.field.queryNavigation(32, 128).status).toBe('pending');
    world.coordinator.advance(100); world.coordinator.advance(1);
    expect(world.field.queryNavigation(32, 128).status).toBe('unreachable'); world.destroy();
  });
});
