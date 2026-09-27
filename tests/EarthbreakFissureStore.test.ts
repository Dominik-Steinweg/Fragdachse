import { describe, expect, it } from 'vitest';
import {
  EarthbreakFissureStore, FISSURE_CAPACITY, FISSURE_INSTANCE_FLOATS,
} from '../src/effects/earthbreak/EarthbreakFissureStore';

const segment = (ax: number, ay: number, bx: number, by: number, joinA: [number, number] | null = null) => ({
  ax, ay, bx, by, arcStart: 0, joinA, joinB: null, bornAt: 0, seed: 0.3, color: 0x6b4a2f,
});

/** The fragment shader's ownership test, evaluated in the segment frame the store wrote. */
function owns(store: EarthbreakFissureStore, slot: number, x: number, y: number): boolean {
  const o = slot * FISSURE_INSTANCE_FLOATS;
  const d = store.data;
  const [length, , cos, sin] = [d[o + 4], d[o + 5], d[o + 6], d[o + 7]];
  // Vertex 0 holds the world position of local corner (-pad, -pad).
  const ax = d[o] - (d[o + 2] * cos - d[o + 3] * sin), ay = d[o + 1] - (d[o + 2] * sin + d[o + 3] * cos);
  const px = (x - ax) * cos + (y - ay) * sin, py = -(x - ax) * sin + (y - ay) * cos;
  return px * d[o + 8] + py * d[o + 9] >= 0 && (px - length) * d[o + 10] + py * d[o + 11] <= 0;
}

describe('Earthbreak fissure store', () => {
  it('partitions the ground at a joint between adjacent segments without gaps or overlap', () => {
    const store = new EarthbreakFissureStore();
    const a = [0, 0], joint = [24, 0], b = [40, 18];
    const inDir = [1, 0], outLength = Math.hypot(b[0] - joint[0], b[1] - joint[1]);
    const outDir = [(b[0] - joint[0]) / outLength, (b[1] - joint[1]) / outLength];
    const sum = Math.hypot(inDir[0] + outDir[0], inDir[1] + outDir[1]);
    const bisector: [number, number] = [(inDir[0] + outDir[0]) / sum, (inDir[1] + outDir[1]) / sum];
    store.addSegment('1', segment(a[0], a[1], joint[0], joint[1]), 0);
    store.addSegment('2', segment(joint[0], joint[1], b[0], b[1], bisector), 0);
    store.setJoin('1', 'b', bisector);
    for (let x = joint[0] - 20; x <= joint[0] + 20; x += 1.37) {
      for (let y = -20; y <= 20; y += 1.41) {
        // Points on the bisector plane itself have measure zero; skip float ties.
        if (Math.abs((x - joint[0]) * bisector[0] + y * bisector[1]) < 1e-6) continue;
        expect(Number(owns(store, 0, x, y)) + Number(owns(store, 1, x, y))).toBe(1);
      }
    }
  });

  it('lets a consumer rebuild the live buffer from committed dirty ranges alone', () => {
    const store = new EarthbreakFissureStore();
    const gpu = new Float32Array(store.data.length);
    let uploaded = -1;
    const upload = (): void => {
      if (uploaded === store.version) return;
      const incremental = uploaded >= 0 && uploaded + 1 === store.version;
      const first = incremental ? store.dirtyStart : 0, end = incremental ? store.dirtyEnd : store.count;
      gpu.set(store.data.subarray(first * FISSURE_INSTANCE_FLOATS, end * FISSURE_INSTANCE_FLOATS), first * FISSURE_INSTANCE_FLOATS);
      uploaded = store.version;
    };
    for (let i = 0; i < 12; i++) store.addSegment(`s${i}`, segment(i * 24, 0, i * 24 + 24, 0), 0);
    store.commit(); upload();
    store.setCollapse('s3', 10, 20, 30);
    store.cancel('s9', 5);
    store.remove('s1');
    store.commit(); upload();
    store.retire(10_000);
    store.commit(); upload();
    const live = store.count * FISSURE_INSTANCE_FLOATS;
    expect(store.count).toBe(9);
    expect(Array.from(gpu.subarray(0, live))).toEqual(Array.from(store.data.subarray(0, live)));
  });

  it('never exceeds its capacity and reuses slots of expired ground', () => {
    const store = new EarthbreakFissureStore();
    for (let i = 0; i < FISSURE_CAPACITY; i++) {
      store.addSegment(`s${i}`, segment(0, i, 24, i), 0);
      store.setCollapse(`s${i}`, 0, 0, 0);
    }
    expect(store.addSegment('late', segment(0, 0, 24, 0), 0)).toBe(false);
    expect(store.addSegment('late', segment(0, 0, 24, 0), 1_000_000)).toBe(true);
    expect(store.size).toBe(1);
  });
});
