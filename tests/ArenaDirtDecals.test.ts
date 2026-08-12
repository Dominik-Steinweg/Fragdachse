import { beforeEach, describe, expect, it } from 'vitest';

import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { ARENA_DECAL_CONFIG, DIRT_ROCK_UNDERLAY_DECAL_CONFIG, getDecalTextureKey } from '../src/arena/DecalConfig';
import { applyArenaMetricsForMode } from '../src/config';

describe('Arena dirt decals', () => {
  beforeEach(() => {
    applyArenaMetricsForMode('deathmatch', 'ARENA');
  });

  it('registers twenty quiet brown dirt variants and ten rock-underlay variants', () => {
    expect(ARENA_DECAL_CONFIG.dirt.variants.filter((variant) => variant.fileName.startsWith('dirt_brown_'))).toHaveLength(20);
    expect(DIRT_ROCK_UNDERLAY_DECAL_CONFIG.variants).toHaveLength(10);
    expect(DIRT_ROCK_UNDERLAY_DECAL_CONFIG.variants.every((variant) => variant.fileName.startsWith('dirt_rock_'))).toBe(true);
  });

  it('places rock-underlay decals on dirt cells beneath rocks', () => {
    const underlayKeys = new Set(
      DIRT_ROCK_UNDERLAY_DECAL_CONFIG.variants.map((variant) => getDecalTextureKey(variant.fileName)),
    );
    const layouts = Array.from({ length: 20 }, (_, index) => ArenaGenerator.generate(74_000 + index));
    let underlayCount = 0;

    for (const layout of layouts) {
      const rockKeys = new Set(layout.rocks.map((rock) => `${rock.gridX}:${rock.gridY}`));
      const dirtKeys = new Set(layout.dirt.map((cell) => `${cell.gridX}:${cell.gridY}`));
      for (const decal of layout.decals ?? []) {
        if (!underlayKeys.has(decal.textureKey)) continue;
        underlayCount += 1;
        const cellKey = `${decal.gridX}:${decal.gridY}`;
        expect(decal.terrain).toBe('dirt');
        expect(decal.surface).toBe('ground');
        expect(rockKeys.has(cellKey)).toBe(true);
        expect(dirtKeys.has(cellKey)).toBe(true);
        expect(Math.abs(decal.offsetX)).toBeLessThanOrEqual(DIRT_ROCK_UNDERLAY_DECAL_CONFIG.maxOffsetX);
        expect(Math.abs(decal.offsetY)).toBeLessThanOrEqual(DIRT_ROCK_UNDERLAY_DECAL_CONFIG.maxOffsetY);
      }
    }

    expect(underlayCount).toBeGreaterThan(0);
  });
});
