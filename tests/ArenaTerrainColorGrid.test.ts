import { describe, expect, it } from 'vitest';
import { TerrainColorSnapshot } from '../src/arena/TerrainColorSnapshot';

describe('terrain color snapshot', () => {
  it('stores packed RGB data at fixed 1:4 scale', () => {
    const snapshot = new TerrainColorSnapshot(1, 1, 0, 0, new Uint8Array([0x20, 0x40, 0x60]));
    expect(snapshot.scale).toBe(4);
    expect(snapshot.sample(0, 0)).toBe(0x204060);
    expect(snapshot.sample(4, 0)).toBe(0xc9d8b0);
  });
});
