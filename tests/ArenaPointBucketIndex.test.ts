import { describe, expect, it } from 'vitest';
import { ArenaPointBucketIndex } from '../src/arena/chunks/ArenaPointBucketIndex';

interface Placement {
  x: number;
  y: number;
}

const FRAME = { offsetX: 37, offsetY: 12, width: 400 * 16, height: 80 * 16 };

function scanAll(
  placements: readonly Placement[],
  localX: number,
  localY: number,
  size: number,
  reach: number,
): number[] {
  const result: number[] = [];
  for (let index = 0; index < placements.length; index += 1) {
    const placement = placements[index];
    const localPlacementX = placement.x - FRAME.offsetX;
    const localPlacementY = placement.y - FRAME.offsetY;
    if (localPlacementX + reach > localX && localPlacementX - reach < localX + size
      && localPlacementY + reach > localY && localPlacementY - reach < localY + size) {
      result.push(index);
    }
  }
  return result;
}

describe('arena point bucket index', () => {
  it('returns a superset of the point scan for local regions and conservative reach', () => {
    const placements: Placement[] = [
      { x: FRAME.offsetX + 32, y: FRAME.offsetY + 32 },
      { x: FRAME.offsetX + 128 + 4, y: FRAME.offsetY + 128 + 8 },
      { x: FRAME.offsetX + 512 + 63, y: FRAME.offsetY + 384 + 11 },
      { x: FRAME.offsetX + FRAME.width - 2, y: FRAME.offsetY + FRAME.height - 2 },
    ];
    const index = new ArenaPointBucketIndex<Placement>(FRAME, (placement) => placement, 128);
    index.sync(placements);

    for (const size of [128, 512]) {
      for (const reach of [0, 24, 96]) {
        for (const localX of [-16, 0, 96, 512, FRAME.width - 128]) {
          for (const localY of [-16, 0, 96, 384, FRAME.height - 128]) {
            const expected = scanAll(placements, localX, localY, size, reach);
            const actual = new Set(index.collect(localX, localY, size, reach));
            for (const hit of expected) {
              expect(actual.has(hit), `missing ${hit} at ${localX}/${localY}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it('reuses the output buffer and indexes appended entries incrementally', () => {
    const placements: Placement[] = [{ x: FRAME.offsetX + 16, y: FRAME.offsetY + 16 }];
    const index = new ArenaPointBucketIndex<Placement>(FRAME, (placement) => placement, 128);
    index.sync(placements);
    const output: number[] = [99];
    const first = index.collect(0, 0, 64, 0, output);

    placements.push({ x: FRAME.offsetX + 320, y: FRAME.offsetY + 16 });
    index.sync(placements);
    const second = index.collect(320, 0, 64, 0, output);

    expect(first).toBe(output);
    expect(second).toBe(output);
    expect(index.size).toBe(placements.length);
    expect(second).toContain(1);
  });

  it('keeps a local query far below the full placement inventory', () => {
    const placements: Placement[] = [];
    for (let gridY = 0; gridY < 80; gridY += 1) {
      for (let gridX = 0; gridX < 400; gridX += 1) {
        placements.push({
          x: FRAME.offsetX + gridX * 16 + 8,
          y: FRAME.offsetY + gridY * 16 + 8,
        });
      }
    }
    const index = new ArenaPointBucketIndex<Placement>(FRAME, (placement) => placement, 128);
    index.sync(placements);

    const candidates = index.collect(5_000, 1_000, 128, 96);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThan(placements.length / 50);
  });
});
