import { describe, expect, it } from 'vitest';
import {
  TESLA_STORM_CAPACITY, TESLA_STORM_FLOATS_PER_VERTEX, TESLA_STORM_INSTANCE_FLOATS, TeslaStormBoltStore,
} from '../src/effects/teslaStorm/TeslaStormBoltStore';

/** Center x of every live instance, averaged from its six quad vertices. */
function centers(store: TeslaStormBoltStore): number[] {
  const result: number[] = [];
  for (let slot = 0; slot < store.count; slot++) {
    let sum = 0;
    for (let vertex = 0; vertex < 6; vertex++) sum += store.data[slot * TESLA_STORM_INSTANCE_FLOATS + vertex * TESLA_STORM_FLOATS_PER_VERTEX];
    result.push(Math.round(sum / 6));
  }
  return result;
}

describe('TeslaStormBoltStore', () => {
  it('keeps the live range dense, so one draw covers exactly the living discharges', () => {
    const store = new TeslaStormBoltStore();
    for (const id of [1, 2, 3, 4]) store.write(id, id * 100, 0, 0, 32, 0x66ccff, id);
    store.remove(2);
    expect(store.count).toBe(3);
    expect(centers(store).sort((a, b) => a - b)).toEqual([100, 300, 400]);

    // The discharge moved into the freed slot keeps updating its own data.
    store.write(4, 900, 0, 0, 32, 0x66ccff, 4);
    store.remove(1);
    expect(centers(store).sort((a, b) => a - b)).toEqual([300, 900]);
    expect(store.activeIds().sort()).toEqual([3, 4]);
  });

  it('bumps its version on every change and rejects writes beyond the bounded pool', () => {
    const store = new TeslaStormBoltStore();
    for (let id = 0; id < TESLA_STORM_CAPACITY; id++) expect(store.write(id, 0, 0, 0, 32, 0xffffff, id)).toBe(true);
    const version = store.version;
    expect(store.write(TESLA_STORM_CAPACITY, 0, 0, 0, 32, 0xffffff, 0)).toBe(false);
    expect(store.version).toBe(version);
    store.clear();
    expect(store.count).toBe(0);
    expect(store.version).toBeGreaterThan(version);
    expect(store.has(0)).toBe(false);
  });
});
