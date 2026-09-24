import { describe, expect, it } from 'vitest';
import { droneHarness } from '../AttackDroneTestHarness';
import { ATTACK_DRONE_RULES as R } from '../../src/config/attackDrone';
import { encodeAttackDrones, decodeAttackDrones } from '../../src/network/attackDroneSnapshotCodec';

describe('attack drone station load', () => {
  it.each([3,36,48])('keeps %i fully upgraded stations bounded and clears every runtime', count => {
    const h=droneHarness({selfLoader:3,service:3,flight:3,penetration:3,bombBay:1,bombCount:3,fireChunks:3});
    const perOwner=count===48?4:3, station=h.stations[0];
    h.stations.splice(0,1,...Array.from({length:count},(_,i)=>({...station,id:i+1,ownerId:`owner-${Math.floor(i/perOwner)}`})));
    expect(new Set(h.stations.map(s=>s.ownerId)).size).toBe(count===3?1:12);
    h.targets.splice(0,1,...Array.from({length:64},(_,i)=>({key:`t${i}`,x:1750+(i%8)*60,y:1750+Math.floor(i/8)*60,radius:14,weight:1})));
    const start=performance.now();h.tick(0);h.run(60000,100);
    const elapsed=performance.now()-start;
    expect(h.system.getSnapshot()).toHaveLength(count);
    expect(new Set(h.system.getSnapshot().map(d=>d.id)).size).toBe(count);
    expect(h.targetReads).toBeLessThanOrEqual(1+60000/R.targetScanMs);
    expect(new Set(h.bombs.map(b=>b.attackId)).size).toBe(h.bombs.length);
    expect(h.bombs.length).toBeLessThanOrEqual(count*h.stats.bombCount*(1+60000/R.bombCooldownMs));
    expect(decodeAttackDrones(encodeAttackDrones(h.system.getSnapshot()))).toEqual(h.system.getSnapshot());
    console.info(JSON.stringify({scenario:'attack-drone-60s',stations:count,elapsedMs:Math.round(elapsed),targetScans:h.targetReads,
      shots:h.shots.length,bombs:h.bombs.length,snapshotBytes:JSON.stringify(encodeAttackDrones(h.system.getSnapshot())).length}));
    h.stations.length=0;h.tick(0);expect(h.system.getSnapshot()).toEqual([]);h.system.clear();
  },20000);
});
