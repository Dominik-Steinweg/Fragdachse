import { describe, expect, it } from 'vitest';
import { navigationTestWorld } from './navigationTestWorld';
import { AttackPositionReservations } from '../src/systems/navigation/AttackPositionReservations';

describe('Soft navigation costs and attack positions', () => {
  it('keeps hard connectivity when density changes and rejects non-finite penalties', () => {
    const world = navigationTestWorld(); world.goal(224, 128); world.flush();
    const before = world.field.queryNavigation(32, 128);
    const density = new Float32Array(17 * 17).fill(2);
    world.coordinator.setDensityCosts(density); world.flush();
    const after = world.field.queryNavigation(32, 128);
    expect(before.status).toBe('ready'); expect(after.status).toBe('ready');
    if (before.status === 'ready' && after.status === 'ready') {
      expect(after.region).toBe(before.region); expect(after.cost).toBeGreaterThan(before.cost);
    }
    density[0] = Infinity;
    expect(() => world.coordinator.setDensityCosts(density)).toThrow(); world.destroy();
  });

  it('reserves different reachable body-safe attack places without excluding other units', () => {
    const world = navigationTestWorld();
    world.coordinator.setGoalCells('test', [8 * 17 + 8, 10 * 17 + 8, 6 * 17 + 8]); world.flush();
    const route = world.field.queryNavigation(64, 128), snapshot = world.field.getNavigationSnapshot()!;
    expect(route.status).toBe('ready'); if (route.status !== 'ready') throw new Error('fixture');
    const places = new AttackPositionReservations();
    const first = places.select('one', 'target', 64, 128, 15, route.region, 0, snapshot, world.metrics, world.geometry());
    const second = places.select('two', 'target', 64, 128, 15, route.region, 0, snapshot, world.metrics, world.geometry());
    expect(first).not.toBeNull(); expect(second).not.toEqual(first);
    expect(world.geometry().canMove(64, 128, second!.x, second!.y, 15)).toBe(true);
    places.retain(new Set(['two']), 1000);
    expect(places.select('three', 'target', 64, 128, 15, route.region, 1000, snapshot, world.metrics, world.geometry())).toEqual(first);
    world.destroy();
  });
});
