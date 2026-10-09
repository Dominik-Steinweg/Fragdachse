import { describe, expect, it } from 'vitest';
import {
  ENERGY_BALL_CAPACITY, ENERGY_BALL_FLOATS_PER_VERTEX, ENERGY_BALL_INSTANCE_FLOATS, ENERGY_BALL_KIND_BALL,
  ENERGY_BALL_KIND_IMPACT, EnergyBallGpuStore, type EnergyBallInstance,
} from '../src/effects/energyBall/EnergyBallGpuStore';

function instance(x: number, kind = ENERGY_BALL_KIND_BALL): EnergyBallInstance {
  return {
    x, y: 0, extent: 10, glowRadius: 20, shellScale: 1, seed: 1, kind, variant: 0,
    bornS: 0, motion: 0, coreZone: 2, shellZone: 5, coreParticleRadius: 6, shellParticleRadius: 3,
    glowColor: 0x66ccff, shellColor: 0xffffff, coreColor: 0xff2233,
  };
}

/** Center x of every live instance, averaged from its six quad vertices. */
function centers(store: EnergyBallGpuStore): number[] {
  const result: number[] = [];
  for (let slot = 0; slot < store.count; slot++) {
    let sum = 0;
    for (let vertex = 0; vertex < 6; vertex++) {
      const offset = slot * ENERGY_BALL_INSTANCE_FLOATS + vertex * ENERGY_BALL_FLOATS_PER_VERTEX;
      sum += store.data[offset] - store.data[offset + 2];
    }
    result.push(Math.round(sum / 6));
  }
  return result.sort((a, b) => a - b);
}

describe('EnergyBallGpuStore', () => {
  it('keeps the live range dense, so one draw covers exactly the living balls and impacts', () => {
    const store = new EnergyBallGpuStore();
    for (const id of [1, 2, 3, 4]) store.write(id, instance(id * 100));
    store.remove(2);
    expect(store.count).toBe(3);
    expect(centers(store)).toEqual([100, 300, 400]);

    // The ball moved into the freed slot keeps updating its own data.
    store.write(4, instance(900));
    store.remove(1);
    expect(centers(store)).toEqual([300, 900]);
    expect(store.has(3) && store.has(4) && !store.has(1)).toBe(true);
  });

  it('retires impacts at their expiry while balls persist until removed', () => {
    const store = new EnergyBallGpuStore();
    store.write(1, instance(100));
    store.write(-1, instance(200, ENERGY_BALL_KIND_IMPACT), 500);
    store.write(-2, instance(300, ENERGY_BALL_KIND_IMPACT), 900);
    const version = store.version;
    store.expire(499);
    expect(store.version).toBe(version);
    store.expire(500);
    expect(centers(store)).toEqual([100, 300]);
    store.expire(10_000);
    expect(centers(store)).toEqual([100]);
    expect(store.version).toBeGreaterThan(version);
  });

  it('bounds the pool: a ball displaces an impact, impacts never displace balls', () => {
    const store = new EnergyBallGpuStore();
    for (let id = 0; id < ENERGY_BALL_CAPACITY - 1; id++) expect(store.write(id, instance(0))).toBe(true);
    expect(store.write(-1, instance(0, ENERGY_BALL_KIND_IMPACT), 400)).toBe(true);
    expect(store.write(-2, instance(0, ENERGY_BALL_KIND_IMPACT), 400)).toBe(false);
    expect(store.write(ENERGY_BALL_CAPACITY, instance(0))).toBe(true);
    expect(store.has(-1)).toBe(false);
    const version = store.version;
    expect(store.write(ENERGY_BALL_CAPACITY + 1, instance(0))).toBe(false);
    expect(store.version).toBe(version);
    store.clear();
    expect(store.count).toBe(0);
    expect(store.has(0)).toBe(false);
  });
});
