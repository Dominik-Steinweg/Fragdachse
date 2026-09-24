import { describe, expect, it } from 'vitest';
import { encodeAttackDrones, decodeAttackDrones, encodeAttackDroneBombs, decodeAttackDroneBombs } from '../src/network/attackDroneSnapshotCodec';
import { droneHarness, droneGroup } from './AttackDroneTestHarness';

describe('attack-drone snapshot codec', () => {
  it('roundtrips identities, independent angles, phases and event sequence without simulation', () => {
    const h = droneHarness(); h.tick(0); h.run(300);
    const state = h.system.getSnapshot();
    expect(decodeAttackDrones(encodeAttackDrones(state))).toEqual(state);
    expect(decodeAttackDrones(undefined)).toEqual([]);
  });
  it('rejects malformed and duplicate station identities', () => {
    const h = droneHarness(); h.tick(0);
    const raw = encodeAttackDrones(h.system.getSnapshot());
    expect(decodeAttackDrones([...raw, ...raw, ['bad']])).toHaveLength(1);
    const invalid = [...raw[0] as unknown[]]; invalid[4] = Infinity;
    expect(decodeAttackDrones([invalid])).toEqual([]);
  });
  it('retains active bomb impact times across late join and accepts empty cleanup state', () => {
    const h = droneHarness({bombBay:1}); h.targets.splice(0,1,...droneGroup()); h.tick(0); h.run(3000);
    const state = h.bombs.map(b => ({id:b.attackId, stationId:b.stationId, ownerId:b.ownerId,x:b.x,y:b.y,droppedAt:b.at,landsAt:b.at+250}));
    expect(decodeAttackDroneBombs(encodeAttackDroneBombs(state))).toEqual(state);
    expect(decodeAttackDroneBombs([])).toEqual([]);
    expect(decodeAttackDroneBombs([['bad',1,'p',0,0,10,5]])).toEqual([]);
  });
});
