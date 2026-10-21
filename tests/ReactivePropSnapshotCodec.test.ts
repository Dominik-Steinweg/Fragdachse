import { describe, expect, it } from 'vitest';
import {
  decodeReactivePropSnapshot,
  encodeReactivePropSnapshot,
  mergeReactivePropSnapshot,
} from '../src/network/ReactivePropSnapshotCodec';

describe('reactive prop wire slice', () => {
  it('round-trips full and delta snapshots', () => {
    for (const snapshot of [{ full: true, entries: [] }, { full: false, entries: [0, 1, 200, 7, 4, 0] }]) {
      expect(decodeReactivePropSnapshot(encodeReactivePropSnapshot(snapshot))).toEqual(snapshot);
    }
  });

  it('rejects malformed payloads instead of guessing', () => {
    for (const raw of [undefined, [], [2], [1, 0, 1], [0, -1, 0, 0], [0, 0, 5, 0], [0, 0, 1, 256], [0, 1.5, 1, 1], 'x']) {
      expect(decodeReactivePropSnapshot(raw), JSON.stringify(raw)).toBeNull();
    }
  });

  it('keeps only non-default props, lets a full snapshot reset and a delta upsert', () => {
    const afterFull = mergeReactivePropSnapshot({ full: true, entries: [3, 1, 100, 5, 4, 0] }, [9, 2, 10]);
    expect(afterFull).toEqual([3, 1, 100, 5, 4, 0]);
    const afterDelta = mergeReactivePropSnapshot({ full: false, entries: [3, 0, 255, 1, 1, 200] }, afterFull);
    expect(afterDelta).toEqual([1, 1, 200, 5, 4, 0]);
    expect(mergeReactivePropSnapshot(null, afterDelta)).toBe(afterDelta);
  });
});
