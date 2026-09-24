import { describe, expect, it } from 'vitest';
import { ATTACK_DRONE_RULES as R, attackDroneBurstShots, forecastAttackDroneBursts, shouldServiceAttackDrone } from '../src/config/attackDrone';
import { droneHarness, droneGroup } from './AttackDroneTestHarness';
import { selectDroneBombCorridor } from '../src/systems/AttackDroneTargeting';

describe('station-owned attack drone', () => {
  it.each([25, 500, 1600])('fires exactly one burst with no boundary shot through %i ms outer ticks', dt => {
    const h = droneHarness(); h.tick(0); h.run(R.burstMs, dt);
    expect(h.shots).toHaveLength(attackDroneBurstShots());
    expect(h.shots.map(s => s.at)).toEqual(Array.from({ length: attackDroneBurstShots() }, (_, i) => i * R.shotIntervalMs));
    expect(h.system.getDiagnostics()[0].ammo).toBe(R.magazine - attackDroneBurstShots());
    expect(new Set(h.shots.map(s => s.attackId)).size).toBe(1);
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
});
describe('drone bomb planning and distance scheduling', () => {
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
    // Remain in the shared target view, but outside weapon range during the cooldown.
    const resumeAt = readyAt - R.burstMs - rest - R.targetScanMs / 2;
    h.run(resumeAt - h.now);
    expect(h.system.getDiagnostics()[0].ammo).toBe(attackDroneBurstShots());
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
