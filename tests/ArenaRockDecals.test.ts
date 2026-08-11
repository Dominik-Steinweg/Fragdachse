import { beforeEach, describe, expect, it } from 'vitest';

import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { ROCK_DECAL_CONFIG, ROCK_DECAL_LARGE_SIZE, ROCK_DECAL_SIZE } from '../src/arena/DecalConfig';
import { applyArenaMetricsForMode } from '../src/config';

describe('Arena rock decals', () => {
  beforeEach(() => {
    applyArenaMetricsForMode('deathmatch', 'ARENA');
  });

  it('configures thirty generated variants in two sizes and keeps their layout deterministic', () => {
    expect(ROCK_DECAL_CONFIG.variants).toHaveLength(30);
    expect(ROCK_DECAL_CONFIG.variants.filter((variant) => variant.displaySize === ROCK_DECAL_SIZE)).toHaveLength(20);
    expect(ROCK_DECAL_CONFIG.variants.filter((variant) => variant.displaySize === ROCK_DECAL_LARGE_SIZE)).toHaveLength(10);

    const first = ArenaGenerator.generate(91_777);
    const repeated = ArenaGenerator.generate(91_777);
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
    const crossRockDecal = Array.from({ length: 30 }, (_, index) => ArenaGenerator.generate(92_100 + index))
      .flatMap((layout) => layout.decals ?? [])
      .find((decal) => decal.surface === 'rock' && (decal.rockIds?.length ?? 0) > 1);

    expect(crossRockDecal).toBeDefined();
  });
});
