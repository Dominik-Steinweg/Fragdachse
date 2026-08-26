import { generateArenaWithActiveMetrics } from './ArenaGeneratorTestHelper';
import { beforeEach, describe, expect, it } from 'vitest';

import { ROCK_DECAL_CONFIG, ROCK_DECAL_LARGE_MAX_OFFSET_PX, ROCK_DECAL_LARGE_SIZE, ROCK_DECAL_SIZE, ROCK_DECAL_VERY_LARGE_MAX_OFFSET_PX, ROCK_DECAL_VERY_LARGE_SIZE } from '../src/arena/DecalConfig';
import { applyArenaMetricsForMode } from '../src/config';

describe('Arena rock decals', () => {
  beforeEach(() => {
    applyArenaMetricsForMode('deathmatch', 'ARENA');
  });

  it('configures eighty generated variants in three sizes and keeps their layout deterministic', () => {
    expect(ROCK_DECAL_CONFIG.variants).toHaveLength(80);
    expect(ROCK_DECAL_CONFIG.variants.filter((variant) => variant.displaySize === ROCK_DECAL_SIZE)).toHaveLength(57);
    expect(ROCK_DECAL_CONFIG.variants.filter((variant) => variant.displaySize === ROCK_DECAL_LARGE_SIZE)).toHaveLength(17);
    expect(ROCK_DECAL_CONFIG.variants.filter((variant) => variant.displaySize === ROCK_DECAL_VERY_LARGE_SIZE)).toHaveLength(6);
    expect(ROCK_DECAL_CONFIG.variants.filter((variant) => variant.displaySize === ROCK_DECAL_SIZE && variant.placement === 'edge')).toHaveLength(47);
    expect(ROCK_DECAL_CONFIG.variants.filter((variant) => variant.displaySize === ROCK_DECAL_VERY_LARGE_SIZE)
      .every((variant) => variant.placement === 'core' && (variant.alpha ?? 1) < 0.7)).toBe(true);

    const first = generateArenaWithActiveMetrics(91_777);
    const repeated = generateArenaWithActiveMetrics(91_777);
    expect(first.decals).toEqual(repeated.decals);

    const rockDecals = first.decals!.filter((decal) => decal.surface === 'rock');
    expect(rockDecals.length).toBeGreaterThan(0);
    for (const decal of rockDecals) {
      expect(decal.terrain).toBe('rock');
      expect(decal.rotation).toEqual(expect.any(Number));
      expect(decal.rockIds?.length).toBeGreaterThan(0);
      expect(decal.rockIds).toEqual(expect.arrayContaining([
        first.rocks.findIndex((rock) => rock.gridX === decal.gridX && rock.gridY === decal.gridY),
      ]));
      for (const rockId of decal.rockIds ?? []) {
        expect(rockId).toBeGreaterThanOrEqual(0);
        expect(rockId).toBeLessThan(first.rocks.length);
      }
    }
  });

  it('can bind a decal conservatively to multiple touching rocks', () => {
    const crossRockDecal = Array.from({ length: 30 }, (_, index) => generateArenaWithActiveMetrics(92_100 + index))
      .flatMap((layout) => layout.decals ?? [])
      .find((decal) => decal.surface === 'rock' && (decal.rockIds?.length ?? 0) > 1);

    expect(crossRockDecal).toBeDefined();
  });

  it('uses tighter offsets for large decals so rotated bounds stay inside core rock groups', () => {
    const rockDecals = Array.from({ length: 24 }, (_, index) => generateArenaWithActiveMetrics(93_700 + index))
      .flatMap((layout) => layout.decals ?? [])
      .filter((decal) => decal.surface === 'rock');

    for (const decal of rockDecals) {
      const maxOffset = decal.displaySize === ROCK_DECAL_VERY_LARGE_SIZE
        ? ROCK_DECAL_VERY_LARGE_MAX_OFFSET_PX
        : decal.displaySize === ROCK_DECAL_LARGE_SIZE
          ? ROCK_DECAL_LARGE_MAX_OFFSET_PX
          : undefined;
      if (maxOffset === undefined) continue;
      expect(Math.abs(decal.offsetX)).toBeLessThanOrEqual(maxOffset);
      expect(Math.abs(decal.offsetY)).toBeLessThanOrEqual(maxOffset);
    }
  });
});
