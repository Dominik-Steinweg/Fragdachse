import { describe, it, expect, vi } from 'vitest';
import { navigationTestWorld } from './navigationTestWorld';
import { segmentObstacleDistanceSq, type NavigationObstacle } from '../src/systems/navigation/NavigationGeometry';
import { EnemyLocomotion } from '../src/systems/navigation/EnemyLocomotion';

const wall = (id: string, left: number, top: number, right: number, bottom: number): NavigationObstacle =>
  ({ id, kind: 'barrier', shape: 'rect', left, top, right, bottom });

describe('Body graph and current geometry', () => {
  it('finishes a subpixel waypoint attachment before turning through a narrow rock corner', () => {
    // Reduced from a generated Map 3 corridor: the diagonal is body-safe at the
    // waypoint, but remains blocked when stopping almost a pixel before it.
    const world = navigationTestWorld([wall('top', 64, 96, 160, 128), wall('corner', 96, 160, 128, 192)], [], 11);
    world.goal(48, 208); world.flush();
    const geometry = world.geometry(), movement = new EnemyLocomotion(), dt = 1000 / 60;
    let x = 96.98, y = 144.15, vx = 0, vy = 0;
    for (let step = 0; step < 180 && Math.hypot(x - 48, y - 208) > 2; step++) {
      const route = world.field.queryNavigation(x, y);
      expect(route.status).toBe('ready');
      if (route.status !== 'ready') break;
      movement.begin([{ id: 'unit', x, y, radius: 11, vx, vy }], geometry, dt);
      const feedback = movement.solve({ id: 'unit', x, y, radius: 11, speed: 180, waypoint: route.waypoint,
        previousVx: vx, previousVy: vy, priority: 'ordinary' });
      vx = feedback.vx; vy = feedback.vy;
      const nx = x + vx * dt / 1000, ny = y + vy * dt / 1000;
      expect(geometry.canMove(x, y, nx, ny, 11)).toBe(true);
      x = nx; y = ny;
    }
    expect(Math.hypot(x - 48, y - 208)).toBeLessThanOrEqual(2);
    world.destroy();
  });

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

  it('accepts landing points awaiting moved or missing goals, but never a confirmed dead end', () => {
    const open = navigationTestWorld(); open.goal(224, 128); open.flush();
    open.goal(224, 192);
    expect(open.field.queryNavigation(32, 128).status).toBe('pending');
    expect(open.field.isCirclePositionFreeAt(32, 128, 15)).toBe(true);
    open.destroy();

    const walled = navigationTestWorld([wall('middle', 112, 0, 144, 256)]);
    walled.goal(224, 128); walled.flush();
    expect(walled.field.isCirclePositionFreeAt(32, 128, 15)).toBe(false);
    walled.goal(128, 128); walled.flush();
    expect(walled.field.queryNavigation(32, 128).status).toBe('invalid-goal');
    expect(walled.field.isCirclePositionFreeAt(32, 128, 15)).toBe(true);
    walled.destroy();
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

describe('Portal links on the body graph', () => {
  // Index = gridY * 17 + gridX on the 16 px test raster; (48, 48) and (208, 48) are nodes themselves.
  const ENTRY = 3 * 17 + 3, EXIT = 3 * 17 + 13, LEFT = 8 * 17 + 2, RIGHT = 8 * 17 + 14;
  const flank = { id: 'flank', ax: 48, ay: 48, bx: 208, by: 48, radiusPx: 28, maxBodyRadiusPx: 20, costPx: 192 };
  const sealed = () => [wall('middle', 112, 0, 144, 256)];

  it('relaxes a jump from its exit, so the entry costs exactly the exit plus the link', () => {
    const world = navigationTestWorld(sealed()); world.goal(224, 128); world.flush();
    expect(world.field.queryNavigation(32, 128).status).toBe('unreachable');
    world.coordinator.setPortalLinks([flank]); world.flush();
    const snapshot = world.field.getNavigationSnapshot()!;
    expect(Array.from(snapshot.portalLinks)).toEqual([ENTRY, EXIT, 192, EXIT, ENTRY, 192]);
    expect(snapshot.integrationField[ENTRY]).toBe(Math.fround(snapshot.integrationField[EXIT] + 192));
    expect(snapshot.goalSourceField[ENTRY]).toBe(snapshot.goalSourceField[EXIT]);
    expect(world.field.queryNavigation(32, 128).status).toBe('ready');
    world.destroy();
  });

  it('points into the portal with a zero vector and keeps the waypoint at the entry node', () => {
    const world = navigationTestWorld(sealed()); world.goal(224, 128);
    world.coordinator.setPortalLinks([flank]); world.flush();
    expect(world.field.getVectorAt(3, 3)).toEqual({ x: 0, y: 0 });
    // The exit is not a portal entry for this goal: returning would cost the link twice.
    expect(world.field.getVectorAt(13, 3)).not.toEqual({ x: 0, y: 0 });
    const route = world.field.queryNavigation(48, 72);
    expect(route.status === 'ready' && route.waypoint).toEqual({ x: 48, y: 48 });
    world.destroy();
  });

  it('joins both sides into one region and restores the plain graph without a rebuild', () => {
    const world = navigationTestWorld(sealed()); world.goal(224, 128); world.flush();
    const plain = world.field.getNavigationSnapshot()!, plainIntegration = Array.from(plain.integrationField);
    const plainRegions = Array.from(plain.regions!);
    expect(plainRegions[LEFT]).not.toBe(plainRegions[RIGHT]);
    const geometry = world.coordinator.getGeometry();
    world.coordinator.setPortalLinks([flank]); world.flush();
    const linked = world.field.getNavigationSnapshot()!;
    expect(linked.regions![LEFT]).toBe(linked.regions![RIGHT]);
    expect(linked.regions![LEFT]).toBe(Math.min(plainRegions[LEFT], plainRegions[RIGHT]));
    expect(world.field.canReachCurrentGoals(32, 128)).toBe(true);
    expect(world.coordinator.getGeometry()).toBe(geometry);
    world.coordinator.setPortalLinks([]); world.flush();
    const restored = world.field.getNavigationSnapshot()!;
    expect(Array.from(restored.regions!)).toEqual(plainRegions);
    expect(Array.from(restored.integrationField)).toEqual(plainIntegration);
    expect(restored.portalLinks).toHaveLength(0);
    expect(world.field.canReachCurrentGoals(32, 128)).toBe(false);
    world.destroy();
  });

  it('gives bodies above the link limit and endpoints without a free node no link', () => {
    for (const [radius, linked] of [[20, true], [21, false]] as const) {
      const world = navigationTestWorld(sealed(), [], radius); world.goal(224, 128);
      world.coordinator.setPortalLinks([flank]); world.flush();
      expect(world.field.getNavigationSnapshot()!.portalLinks.length > 0).toBe(linked);
      expect(world.field.queryNavigation(32, 128).status).toBe(linked ? 'ready' : 'unreachable');
      world.destroy();
    }
    // The nearest body-free node lies outside the crossing radius: the link does not exist for this body.
    const buried = navigationTestWorld([...sealed(), wall('rock', 8, 8, 88, 88)]); buried.goal(224, 128);
    buried.coordinator.setPortalLinks([flank]); buried.flush();
    expect(buried.field.getNavigationSnapshot()!.portalLinks).toHaveLength(0);
    buried.destroy();
  });

  it('scales the jump like every other cost of a swimming profile', () => {
    const world = navigationTestWorld(sealed());
    const swim = world.coordinator.registerField('swim', { goalMode: 'dynamic', bodyRadius: 15, swimCostRatio: 2 });
    world.coordinator.setGoalCells('swim', [8 * 17 + 14]);
    world.coordinator.setPortalLinks([flank]); world.flush();
    const snapshot = swim.snapshot()!;
    expect(Array.from(snapshot.portalLinks)).toEqual([ENTRY, EXIT, 192 * 8, EXIT, ENTRY, 192 * 8]);
    expect(snapshot.integrationField[ENTRY]).toBe(Math.fround(snapshot.integrationField[EXIT] + 192 * 8));
    world.destroy();
  });

  it('lets the target-bound path search cross the jump and name the entry as the next step', () => {
    const world = navigationTestWorld(sealed()); world.goal(224, 128); world.flush();
    expect(world.field.findNextWorldPositionTowards(2, 8, 14, 8)).toBeNull();
    world.coordinator.setPortalLinks([flank]); world.flush();
    const next = world.field.findNextWorldPositionTowards(2, 8, 14, 8)!;
    expect(next.x).toBeLessThan(112);
    expect(world.field.findNextWorldPositionTowards(3, 3, 14, 8)).toEqual({ x: 48, y: 48 });
    world.destroy();
  });
});
