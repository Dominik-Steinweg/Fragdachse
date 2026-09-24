import { describe, expect, it } from 'vitest';
import { ATTACK_DRONE_RULES as R, attackDroneBurstShots, forecastAttackDroneBursts, shouldServiceAttackDrone } from '../src/config/attackDrone';
import { droneHarness, droneGroup } from './AttackDroneTestHarness';
import { droneDistance, selectDroneBombCorridor, selectDroneFiringPosition, selectDroneGunTarget } from '../src/systems/AttackDroneTargeting';

describe('station-owned attack drone', () => {
  it.each([false, true])('spreads overlapping combat drones through soft flight, including different owners (%s)', differentOwners => {
    const h = droneHarness();
    h.stations.push(...[3, 5].map(id => ({ ...h.stations[0], id, ownerId: differentOwners ? `owner-${id}` : h.stations[0].ownerId })));
    h.tick(0);
    for (const d of h.system.getSnapshot()) expect(d).toMatchObject({ x: h.owner.x, y: h.owner.y });
    h.run(R.burstMs + R.pauseMs + R.burstMs / 2);
    const drones = h.system.getSnapshot();
    for (let i = 0; i < drones.length; i++) for (let j = i + 1; j < drones.length; j++) {
      expect(droneDistance(drones[i], drones[j])).toBeGreaterThan(R.separationRadius / 2);
    }
    expect(new Set(h.shots.map(s => s.stationId)).size).toBe(h.stations.length);
  });
  it('prefers an unoccupied firing position when it can still cover the target', () => {
    const h = droneHarness(), start = { x: h.targets[0].x - R.range / 2, y: h.targets[0].y };
    const destination = selectDroneFiringPosition(start, h.owner, h.targets[0], h.targets,
      { left: 0, top: 0, right: 12000, bottom: 12000 }, h.stats.attackSpeed * R.pauseMs / 1000, [start]);
    expect(droneDistance(start, destination)).toBeGreaterThanOrEqual(R.separationRadius);
    expect(selectDroneGunTarget(destination, h.targets)!.targetKeys).toContain(h.targets[0].key);
  });
  it('allows temporarily overlapping drones to dock without separation blocking service', () => {
    const h = droneHarness(); h.stations.push({ ...h.stations[0], id: 3 });
    h.tick(0); h.run(R.burstMs); h.owner.available = false;
    h.run(R.serviceMs + 5000);
    for (const d of h.system.getSnapshot()) expect(d).toMatchObject({ phase: 'docked', x: h.stations[0].x, y: h.stations[0].y });
    h.owner.available = true; h.tick();
    const before = h.system.getSnapshot(); h.tick();
    for (const d of h.system.getSnapshot()) expect(droneDistance(d, before.find(b => b.id === d.id)!))
      .toBeLessThanOrEqual(R.flightAcceleration * 0.025 ** 2 + 1e-8);
  });
  it.each([25, 500, 1600])('fires exactly one burst with no boundary shot through %i ms outer ticks', dt => {
    const h = droneHarness(); h.tick(0); h.run(R.burstMs, dt);
    expect(h.shots).toHaveLength(attackDroneBurstShots());
    expect(h.shots.map(s => s.at)).toEqual(Array.from({ length: attackDroneBurstShots() }, (_, i) => i * R.shotIntervalMs));
    expect(h.system.getDiagnostics()[0].ammo).toBe(R.magazine - attackDroneBurstShots());
    expect(new Set(h.shots.map(s => s.attackId)).size).toBe(1);
  });
  it.each([0, 3])('keeps moving late in a burst without outrunning gun tracking (flight %i)', flight => {
    const h = droneHarness({ flight }); h.tick(0); h.run(R.burstMs / 2);
    const middle = h.system.getSnapshot()[0]; h.run(R.burstMs / 2);
    expect(droneDistance(middle, h.system.getSnapshot()[0])).toBeGreaterThan(R.muzzleOffset);
    expect(h.shots).toHaveLength(attackDroneBurstShots());
    // Actual muzzle origins move, while each ray still intersects the static target.
    for (const shot of h.shots) {
      const dx = h.targets[0].x - shot.x, dy = h.targets[0].y - shot.y;
      expect(dx * Math.cos(shot.angle) + dy * Math.sin(shot.angle)).toBeGreaterThan(0);
      expect(Math.abs(dx * Math.sin(shot.angle) - dy * Math.cos(shot.angle))).toBeLessThan(h.targets[0].radius);
    }
    const late = h.shots.slice(attackDroneBurstShots() / 2);
    expect(droneDistance(late[0], late.at(-1)!)).toBeGreaterThan(R.muzzleOffset);
  });
  it('uses the pause to approach a moved target and respects the next burst deadline', () => {
    const h = droneHarness(); h.tick(0); h.run(R.burstMs);
    const before = h.system.getSnapshot()[0];
    h.targets[0] = { ...h.targets[0], x: h.owner.x + R.ownerRadius, y: h.owner.y };
    const distanceBefore = droneDistance(before, h.targets[0]);
    h.run(R.pauseMs - R.targetScanMs);
    expect(h.shots).toHaveLength(attackDroneBurstShots());
    expect(droneDistance(h.system.getSnapshot()[0], h.targets[0])).toBeLessThan(distanceBefore);
    h.run(R.targetScanMs * 2);
    const next = h.shots[attackDroneBurstShots()];
    expect(next.at).toBeGreaterThanOrEqual(R.burstMs + R.pauseMs);
    expect(next.at).toBeLessThanOrEqual(R.burstMs + R.pauseMs + R.targetScanMs);
  });
  it('prepares an angle that covers more enemies without leaving the owner or crossing the target', () => {
    const h = droneHarness(), start = { x: h.owner.x - R.range / 2, y: h.owner.y };
    const targets = Array.from({ length: 3 }, (_, i) => ({ ...h.targets[0], key: `line-${i}`,
      x: h.owner.x, y: h.owner.y + i * R.range / 5, radius: R.range / 40 }));
    const destination = selectDroneFiringPosition(start, h.owner, targets[0], targets,
      { left: 0, top: 0, right: 12000, bottom: 12000 }, h.stats.attackSpeed * R.pauseMs / 1000);
    expect(selectDroneGunTarget(destination, targets)!.targetKeys.length)
      .toBeGreaterThan(selectDroneGunTarget(start, targets)!.targetKeys.length);
    expect(droneDistance(destination, h.owner)).toBeLessThanOrEqual(R.ownerRadius);
    expect(droneDistance(destination, start)).toBeLessThanOrEqual(h.stats.attackSpeed * R.pauseMs / 1000);
    const halfway = { x: (destination.x + start.x) / 2, y: (destination.y + start.y) / 2 };
    expect(droneDistance(halfway, targets[0])).toBeGreaterThan(targets[0].radius);
  });
  it('keeps a reachable target engaged through pauses instead of flying to a random patrol point', () => {
    const h = droneHarness(); h.tick(0); h.run(R.burstMs);
    const target = h.targets[0];
    h.run(R.pauseMs - R.targetScanMs);
    const drone = h.system.getSnapshot()[0], desired = Math.atan2(target.y - drone.y, target.x - drone.x);
    expect(Math.abs(Math.atan2(Math.sin(drone.gunAngle - desired), Math.cos(drone.gunAngle - desired)))).toBeLessThan(0.001);
    expect(droneDistance(drone, target)).toBeLessThanOrEqual(R.range / 2 + 1);
    expect(h.shots).toHaveLength(attackDroneBurstShots());
    // A combat intent must not survive an Activity change and pull a drone toward old enemies.
    h.targets.length = 0; h.system.invalidateActivity(); h.owner.available = false; h.tick();
    expect(h.system.getSnapshot()[0].phase).toBe('returning');
  });
  it('keeps combat flight inside world bounds at the left edge', () => {
    const h = droneHarness(); h.owner.x = 0; h.owner.y = 0;
    h.stations[0] = { ...h.stations[0], x: 0, y: 0 };
    h.targets[0] = { ...h.targets[0], x: R.range / 2, y: R.range / 2 };
    h.tick(0);
    for (let i = 0; i < (R.burstMs + R.pauseMs) * 2 / 25; i++) {
      h.tick(); const d = h.system.getSnapshot()[0];
      expect(d.x).toBeGreaterThanOrEqual(0); expect(d.y).toBeGreaterThanOrEqual(0);
      expect(droneDistance(d, h.owner)).toBeLessThanOrEqual(R.attackRadius);
    }
    expect(h.shots.length).toBeGreaterThan(attackDroneBurstShots());
  });
  it('does not interrupt engagement at the owner leash between consecutive bursts', () => {
    const h = droneHarness();
    h.stations[0] = { ...h.stations[0], x: h.owner.x + R.catchupEndRadius };
    h.targets[0] = { ...h.targets[0], x: h.owner.x + R.ownerRadius + R.range - h.targets[0].radius };
    h.tick(0);
    while (!h.shots.length && h.now < 5000) h.tick();
    expect(h.shots.length).toBeGreaterThan(0);
    const startedAt = h.shots[0].at;
    while (h.now < startedAt + R.burstMs + R.pauseMs + R.targetScanMs) {
      h.tick(); const d = h.system.getSnapshot()[0];
      expect(d.phase).not.toBe('catchup');
      expect(droneDistance(d, h.owner)).toBeLessThanOrEqual(R.catchupStartRadius);
    }
    expect(new Set(h.shots.map(s => s.attackId)).size).toBe(2);
  });
  it('keeps one identity per station across moves and activity transitions, and removes it immediately', () => {
    const h = droneHarness(); h.stations.push({ ...h.stations[0], id: 2 }); h.tick(0);
    const ids = h.system.getSnapshot().map(d => d.id), ammo = h.system.getDiagnostics().map(d => d.ammo);
    h.stations[0] = { ...h.stations[0], x: 2200 }; h.system.invalidateActivity(); h.tick(0);
    expect(h.system.getSnapshot().map(d => d.id)).toEqual(ids);
    expect(h.system.getDiagnostics().map(d => d.ammo)).toEqual(ammo);
    h.stations.splice(0, 1); h.tick(0);
    expect(h.system.getSnapshot().map(d => d.id)).toEqual([ids[1]]);
    h.system.clear(); expect(h.system.getSnapshot()).toEqual([]);
  });
  it('defends after death, follows revival, and stops new attacks without a participant', () => {
    const h = droneHarness(); h.tick(0); h.owner.alive = false; h.owner.x = 9000;
    h.run(R.burstMs); expect(h.shots).toHaveLength(attackDroneBurstShots());
    expect(h.system.getSnapshot()[0].x).toBeLessThan(3000);
    h.owner.available = false; const before = h.shots.length; h.run(15000, 500);
    expect(h.shots).toHaveLength(before); expect(h.system.getSnapshot()[0].phase).toBe('docked');
    h.owner.available = true; h.owner.alive = true; h.tick(); h.run(3000);
    expect(h.system.getSnapshot()[0].x).toBeGreaterThan(3000);
  });
  it('follows a moved station while returning and servicing without resetting its timer', () => {
    const h = droneHarness(); h.tick(0); h.owner.available = false; h.tick();
    h.stations[0] = { ...h.stations[0], x: 2100 }; h.tick();
    h.run(R.serviceMs + 1000);
    expect(h.system.getSnapshot()[0]).toMatchObject({ phase: 'docked', x: 2100, y: 2000 });
    h.stations[0] = { ...h.stations[0], x: 2200 }; h.tick();
    expect(h.system.getSnapshot()[0].x).toBe(2200);
  });
  it('retains fractional self-loader regeneration outside the burst', () => {
    const h = droneHarness({ selfLoader: 1 }); h.tick(0); h.run(R.burstMs); h.targets.length = 0;
    h.tick(17);
    expect(h.system.getDiagnostics()[0].ammo).toBeCloseTo(R.magazine - attackDroneBurstShots() + h.stats.regenerationPerMs * 17, 8);
  });
  it('fires the remaining partial magazine once, then waits for a complete regenerated burst', () => {
    const h = droneHarness({ selfLoader: 1 }); h.tick(0);
    // Move the station far away after deployment so the normal forecast chooses regeneration.
    h.stations[0] = { ...h.stations[0], x: 11000, y: 11000 };
    h.run(60000);
    const bursts = new Map<string, typeof h.shots>();
    for (const shot of h.shots) {
      const burst = bursts.get(shot.attackId) ?? [];
      burst.push(shot); bursts.set(shot.attackId, burst);
    }
    const completed = [...bursts.values()].filter(burst => burst[0].at + R.burstMs < h.now);
    const partial = completed.findIndex(burst => burst.length < attackDroneBurstShots());
    expect(partial).toBeGreaterThan(0);
    expect(completed[partial].length).toBeGreaterThan(1);
    expect(completed.slice(partial + 1).length).toBeGreaterThan(0);
    for (const burst of completed.slice(partial + 1)) expect(burst).toHaveLength(attackDroneBurstShots());
    expect(completed[partial + 1][0].at - completed[partial].at(-1)!.at)
      .toBeGreaterThan((attackDroneBurstShots() - 1) / h.stats.regenerationPerMs);
  });
  it('keeps a committed return despite upgraded regeneration and follows the moved station', () => {
    const h = droneHarness(); h.tick(0);
    h.stations[0] = { ...h.stations[0], x: 5000 };
    while (h.system.getSnapshot()[0].phase !== 'returning' && h.now < 30000) h.tick();
    expect(h.system.getSnapshot()[0].phase).toBe('returning');
    const before = h.shots.length;
    h.stations[0] = { ...h.stations[0], x: 6000, stats: droneHarness({ selfLoader: 3 }).stats };
    while (h.system.getSnapshot()[0].phase === 'returning' && h.now < 40000) h.tick();
    expect(h.system.getSnapshot()[0]).toMatchObject({ phase: 'servicing', x: 6000 });
    expect(h.shots).toHaveLength(before);
  });
  it('uses one shared target refresh for many stations', () => {
    const h = droneHarness(); h.targets.length = 0;
    for (let i = 2; i <= 40; i++) h.stations.push({ ...h.stations[0], id: i });
    h.tick(0); h.run(1000);
    expect(h.targetReads).toBe(Math.floor(1000 / R.targetScanMs) + 1);
    expect(new Set(h.system.getSnapshot().map(d => `${d.x}:${d.y}`)).size).toBeGreaterThan(35);
  });
  it.each([0.4, 0.95])('approaches owner threats from behind the player without firing beyond weapon range (%s)', radiusFactor => {
    const h = droneHarness();
    h.stations[0] = { ...h.stations[0], x: h.owner.x - R.catchupEndRadius };
    h.targets[0] = { ...h.targets[0], x: h.owner.x + R.ownerThreatRadius * radiusFactor };
    h.tick(0); expect(h.shots).toHaveLength(0);
    while (!h.shots.length && h.now < 5000) h.tick();
    expect(h.shots.length).toBeGreaterThan(0);
    const first = h.shots[0], target = h.targets[0];
    expect(Math.hypot(first.x - target.x, first.y - target.y)).toBeLessThanOrEqual(R.range + target.radius);
    expect(h.targetReads).toBeLessThanOrEqual(1 + Math.ceil(h.now / R.targetScanMs));
  });
  it('acquires distant targets from the drone and gives up when they leave the defended area', () => {
    const h = droneHarness();
    h.stations[0] = { ...h.stations[0], x: h.owner.x + R.catchupEndRadius };
    h.targets[0] = { ...h.targets[0], x: h.owner.x + R.ownerRadius + R.range - h.targets[0].radius };
    h.tick(0); expect(h.shots).toHaveLength(0); h.run(1000);
    expect(h.shots.length).toBeGreaterThan(0);
    h.targets[0] = { ...h.targets[0], x: 11000 }; h.run(R.burstMs + R.pauseMs);
    const count = h.shots.length; h.run(3000);
    expect(h.shots).toHaveLength(count);
    expect(Math.hypot(h.system.getSnapshot()[0].x - h.owner.x, h.system.getSnapshot()[0].y - h.owner.y))
      .toBeLessThanOrEqual(R.catchupStartRadius);
  });
});
describe('drone bomb planning and distance scheduling', () => {
  it('timestamps each bomb at the actual distance crossing while accelerating and braking', () => {
    const h = droneHarness({ bombBay: 1, bombCount: 3 }); h.targets.splice(0, 1, ...droneGroup()); h.tick(0);
    while (!h.bombs.length && h.now < 5000) h.tick();
    expect(h.bombs).toHaveLength(1);
    const start = h.system.getSnapshot()[0];
    while (h.bombs.length < h.stats.bombCount && h.now < 10000) {
      const before = h.system.getSnapshot()[0], at = h.now, count = h.bombs.length;
      h.tick(); const after = h.system.getSnapshot()[0];
      for (let i = count; i < h.bombs.length; i++) {
        const bomb = h.bombs[i];
        expect(bomb.at).toBeGreaterThanOrEqual(at); expect(bomb.at).toBeLessThanOrEqual(h.now);
        const interpolatedDistance = droneDistance(start, before) + (droneDistance(start, after) - droneDistance(start, before))
          * (bomb.at - at) / (h.now - at);
        expect(interpolatedDistance).toBeCloseTo(R.bombLength * i / (h.stats.bombCount - 1), 6);
      }
    }
    expect(h.bombs).toHaveLength(h.stats.bombCount);
  });
  it('waits for a carpet to land before reassessing survivors, while other drones use their guns', () => {
    const h = droneHarness({ bombBay: 1 }); h.targets.splice(0, 1, ...droneGroup());
    h.stations.push({ ...h.stations[0], id: 2 }, { ...h.stations[0], id: 3 });
    h.tick(0);
    expect(h.system.getSnapshot().filter(d => d.phase === 'bomb_approach')).toHaveLength(1);
    while (h.bombs.length < h.stats.bombCount && h.now < 5000) h.tick();
    expect(h.bombs).toHaveLength(h.stats.bombCount);
    expect(new Set(h.shots.map(s => s.stationId)).size).toBe(2);
    h.run(R.bombFallMs);
    // The group dies at the final impact, so no other station should waste its ready bombs.
    h.targets.length = 0; h.run(5000);
    expect(h.bombs).toHaveLength(h.stats.bombCount);
  });
  it('staggers repeated bomb runs against survivors and eventually uses every station', () => {
    const h = droneHarness({ bombBay: 1, flight: 3, bombCount: 3 }); h.targets.splice(0, 1, ...droneGroup());
    h.stations.push({ ...h.stations[0], id: 2 }, { ...h.stations[0], id: 3 });
    h.tick(0); h.run(R.bombCooldownMs);
    const runs = [...new Set(h.bombs.map(b => b.stationId))].map(id => h.bombs.filter(b => b.stationId === id));
    expect(runs).toHaveLength(h.stations.length);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i][0].at).toBeGreaterThanOrEqual(runs[i - 1].at(-1)!.at + R.bombFallMs + R.bombReassessmentMs);
    }
  });
  it('coordinates per owner, without delaying another owner', () => {
    const h = droneHarness({ bombBay: 1 }); h.targets.splice(0, 1, ...droneGroup());
    h.stations.push({ ...h.stations[0], id: 2, ownerId: 'other' }); h.tick(0);
    expect(h.system.getSnapshot().filter(d => d.phase === 'bomb_approach')).toHaveLength(2);
  });
  it.each([false, true])('releases a removed station reservation, but retains already falling bombs (%s)', dropped => {
    const h = droneHarness({ bombBay: 1 }); h.targets.splice(0, 1, ...droneGroup()); h.tick(0);
    if (dropped) while (!h.bombs.length && h.now < 3000) h.tick();
    h.stations[0] = { ...h.stations[0], id: 2 }; h.tick();
    expect(h.system.getSnapshot()[0].phase).toBe(dropped ? 'gun' : 'bomb_approach');
    h.run(5000); expect(h.bombs.some(b => b.stationId === 2)).toBe(true);
    if (dropped) expect(h.bombs.find(b => b.stationId === 2)!.at)
      .toBeGreaterThanOrEqual(h.bombs[0].at + R.bombFallMs + R.bombReassessmentMs);
  });
  it('does not start a second carpet in a long World update before its first impacts can resolve', () => {
    const h = droneHarness({ bombBay: 1 }); h.targets.splice(0, 1, ...droneGroup());
    h.stations.push({ ...h.stations[0], id: 2 }); h.tick(6000);
    expect(h.bombs).toHaveLength(h.stats.bombCount);
    h.targets.length = 0; h.tick(6000);
    expect(h.bombs).toHaveLength(h.stats.bombCount);
  });
  it('clears pending coordination on activity teardown', () => {
    const h = droneHarness({ bombBay: 1 }); h.targets.splice(0, 1, ...droneGroup()); h.tick(0);
    h.system.invalidateActivity(); h.tick(R.targetScanMs);
    expect(h.system.getSnapshot()[0].phase).toBe('bomb_approach');
  });
  it.each([800, 1200])('only defers empty-magazine service inside the bomb wait window (%i ms)', rest => {
    const h = droneHarness(); h.tick(0);
    const shotsBeforeBomb = R.magazine - attackDroneBurstShots();
    while ((h.shots.length < shotsBeforeBomb || h.system.getSnapshot()[0].phase === 'gun') && h.now < 20000) h.tick();
    expect(h.system.getDiagnostics()[0].ammo).toBe(attackDroneBurstShots());
    h.stations[0] = { ...h.stations[0], stats: droneHarness({ bombBay: 1 }).stats };
    h.targets.splice(0, h.targets.length, ...droneGroup().map((target, i) => i ? target : { ...target, key: 'target' }));
    while (!h.bombs.length && h.now < 25000) h.tick();
    // The first carpet remains committed while its targets retreat from weapon range.
    h.targets.splice(0, h.targets.length, { key: 'waiting', x: 2810, y: 2000, radius: 20, weight: 1 });
    while ((h.bombs.length < R.bombCount || h.system.getSnapshot()[0].phase === 'bomb_run') && h.now < 25000) h.tick();
    expect(h.bombs).toHaveLength(R.bombCount);
    expect(h.system.getDiagnostics()[0].ammo).toBe(attackDroneBurstShots());
    const readyAt = h.system.getDiagnostics()[0].bombReadyAt;
    // Isolate the readiness boundary from acquisition: hold flight still while the target
    // remains outside weapon range. Normal drones now pursue it instead of idly waiting.
    const flightStats = h.stations[0].stats;
    h.stations[0] = { ...h.stations[0], stats: { ...flightStats, patrolSpeed: 0, attackSpeed: 0 } };
    const resumeAt = readyAt - R.burstMs - rest - R.targetScanMs / 2;
    h.run(resumeAt - h.now);
    expect(h.system.getDiagnostics()[0].ammo).toBe(attackDroneBurstShots());
    h.stations[0] = { ...h.stations[0], stats: flightStats };
    const drone = h.system.getSnapshot()[0];
    h.targets[0] = { ...h.targets[0], x: drone.x + 80, y: drone.y };
    while (h.system.getSnapshot()[0].phase !== 'gun' && h.now < readyAt) h.tick();
    expect(h.system.getSnapshot()[0].phase).toBe('gun');
    while (h.system.getSnapshot()[0].phase === 'gun' && h.now < readyAt) h.tick();
    expect(h.system.getDiagnostics()[0].ammo).toBe(0);
    const remaining = readyAt - h.now;
    expect(remaining).toBeGreaterThan(rest - R.targetScanMs / 2 - 25);
    expect(remaining).toBeLessThanOrEqual(rest + R.targetScanMs / 2 + 25);
    h.tick();
    expect(h.system.getSnapshot()[0].phase).toBe(rest < R.bombWaitMs ? 'bomb_approach' : 'returning');
    if (rest < R.bombWaitMs) {
      h.stations[0] = { ...h.stations[0], stats: droneHarness({ bombBay: 1, selfLoader: 1 }).stats };
      const count = h.shots.length;
      while (h.bombs.length === R.bombCount && h.now < readyAt + 2000) h.tick();
      expect(h.bombs.length).toBeGreaterThan(R.bombCount);
      expect(h.shots).toHaveLength(count);
    }
  });
  it('keeps carpet positions and count independent of upgraded speed and outer delta', () => {
    const runs = [0, 3].map(flight => {
      const h = droneHarness({ bombBay: 1, bombCount: 3, flight }); h.targets.splice(0, 1, ...droneGroup()); h.tick(0); h.run(5000, 500);
      expect(h.bombs).toHaveLength(h.stats.bombCount);
      expect(new Set(h.bombs.map(b => b.attackId)).size).toBe(h.stats.bombCount);
      expect(h.system.getDiagnostics()[0].bombReadyAt).toBeCloseTo(h.bombs.at(-1)!.at + R.bombCooldownMs);
      return h.bombs;
    });
    expect(runs[0].map(b => [b.x,b.y])).toEqual(runs[1].map(b => [b.x,b.y]));
    expect(runs[1].at(-1)!.at - runs[1][0].at).toBeLessThan(runs[0].at(-1)!.at - runs[0][0].at);
  });
  it('abandons a corridor when every target leaves before first drop', () => {
    const h = droneHarness({ bombBay: 1 }); h.targets.splice(0,1,...droneGroup()); h.tick(0);
    expect(h.system.getSnapshot()[0].phase).toBe('bomb_approach');
    h.targets.splice(0,h.targets.length,...droneGroup(9000,9000)); h.run(3000);
    expect(h.bombs).toHaveLength(0);
  });
  it('finishes an initiated carpet even if its targets disappear', () => {
    const h = droneHarness({ bombBay: 1 }); h.targets.splice(0,1,...droneGroup()); h.tick(0);
    while (!h.bombs.length && h.now < 4000) h.tick();
    expect(h.bombs.length).toBeGreaterThan(0); h.targets.length = 0; h.run(2000);
    expect(h.bombs).toHaveLength(h.stats.bombCount);
  });
  it('prioritizes four distinct normal targets over fewer heavy targets', () => {
    const h = droneHarness(); const targets = [...droneGroup(1800,1800),
      ...[0,1,2].map(i => ({key:`boss${i}`,x:2250+i*20,y:2280,radius:10,weight:3}))];
    const line = selectDroneBombCorridor(h.owner,h.owner,targets,R.bombCount,{left:0,top:0,right:5000,bottom:5000});
    expect(line!.targetKeys.length).toBeGreaterThanOrEqual(R.bombGroupThreshold);
  });
});
describe('service forecast', () => {
  it('counts complete bursts and never a boundary extra burst', () => {
    expect(forecastAttackDroneBursts(R.magazine,0,0,R.burstMs-1)).toBe(0);
    expect(forecastAttackDroneBursts(R.magazine,0,0,R.burstMs)).toBe(1);
    expect(forecastAttackDroneBursts(attackDroneBurstShots()-1,0)).toBe(0);
  });
  it('keeps fighting with a full burst, returns without regeneration, and stays on a forecast tie', () => {
    const h = droneHarness(); const input = {ammo:0,stats:h.stats,outboundDistance:12000,inboundDistance:12000,gunReadyInMs:0,hasTargets:true};
    expect(shouldServiceAttackDrone(input)).toBe(true);
    expect(shouldServiceAttackDrone({...input,ammo:attackDroneBurstShots()})).toBe(false);
    expect(shouldServiceAttackDrone({...input,stats:droneHarness({selfLoader:1}).stats})).toBe(false);
  });
});
