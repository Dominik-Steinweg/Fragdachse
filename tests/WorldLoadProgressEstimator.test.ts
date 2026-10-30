import { describe, expect, it } from 'vitest';
import {
  WorldLoadProgressEstimator,
  type WorldLoadDurationStore,
} from '../src/world/WorldLoadProgressEstimator';

function memoryStore(initial: Record<string, number> = {}): WorldLoadDurationStore & { values: Record<string, number> } {
  const values = { ...initial };
  return { values, read: key => values[key] ?? null, write: (key, ms) => { values[key] = ms; } };
}

describe('WorldLoadProgressEstimator', () => {
  it('never falls back while a World loads, even when the measurement drops', () => {
    const estimator = new WorldLoadProgressEstimator(memoryStore());
    const samples = [5, 40, 30, 55, 20, 70].map((measured, i) => estimator.sample(1, 'map', measured, false, i * 100));
    for (let i = 1; i < samples.length; i += 1) expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    expect(Math.max(...samples)).toBeLessThan(100);
  });

  it('reaches 100 only when ready and learns the duration per World definition', () => {
    const store = memoryStore();
    const estimator = new WorldLoadProgressEstimator(store);
    estimator.sample(1, 'map', 10, false, 0);
    expect(estimator.sample(1, 'map', 99, false, 1_000)).toBeLessThan(100);
    expect(estimator.sample(1, 'map', 0, true, 3_000)).toBe(100);
    expect(store.values.map).toBe(3_000);
  });

  it('spreads progress over the learned duration instead of jumping with the fast build phase', () => {
    const estimator = new WorldLoadProgressEstimator(memoryStore({ map: 4_000 }));
    // Der synchrone Aufbau meldet frueh viel Messfortschritt, die Zeit steht aber erst am Anfang.
    const early = estimator.sample(1, 'map', 60, false, 0);
    const half = estimator.sample(1, 'map', 60, false, 2_000);
    const late = estimator.sample(1, 'map', 60, false, 3_800);
    expect(early).toBeLessThan(40);
    expect(half).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(half);
    expect(estimator.sample(1, 'map', 60, false, 60_000)).toBeLessThan(100);
  });

  it('starts over for a new World revision', () => {
    const estimator = new WorldLoadProgressEstimator(memoryStore());
    estimator.sample(1, 'map', 80, false, 0);
    expect(estimator.sample(2, 'map', 5, false, 100)).toBe(5);
  });
});
