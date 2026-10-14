import { describe, expect, it } from 'vitest';
import { ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import { getArenaMetricsProfile } from '../src/config';
import { getCoopDefenseMapConfig, type CoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { resolveWorldMetrics } from '../src/world/WorldMetrics';

function generate(seed: number, map: CoopDefenseMapConfig) {
  const metrics = resolveWorldMetrics(getArenaMetricsProfile('coop_defense', 'ARENA', map.arenaWidthCells, map.arenaHeightCells));
  return ArenaGenerator.generate(seed, resolveArenaGenerationInput('coop_defense', metrics), map);
}

describe('ArenaGenerator site clearings', () => {
  // Eine dicht verfelste Kampagnenkarte; die Lichtungen liegen bewusst mitten im Fels.
  const base = getCoopDefenseMapConfig('14');
  const siteClearings = [
    { id: 'site-a', gridX: Math.floor(base.arenaWidthCells! * 0.25), gridY: Math.floor(base.arenaHeightCells! * 0.3), radiusCells: 2 },
    { id: 'site-b', gridX: Math.floor(base.arenaWidthCells! * 0.7), gridY: Math.floor(base.arenaHeightCells! * 0.7), radiusCells: 3 },
  ];
  const withSites: CoopDefenseMapConfig = { ...base, siteClearings };

  it('keeps every clearing core free of rocks and trees for any seed', () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const layout = generate(seed, withSites);
      const occupied = new Set([...layout.rocks, ...layout.trees].map(({ gridX, gridY }) => `${gridX}_${gridY}`));
      for (const clearing of siteClearings) {
        for (let dy = -clearing.radiusCells; dy <= clearing.radiusCells; dy += 1) {
          for (let dx = -clearing.radiusCells; dx <= clearing.radiusCells; dx += 1) {
            if (dx * dx + dy * dy > clearing.radiusCells * clearing.radiusCells) continue;
            expect(occupied.has(`${clearing.gridX + dx}_${clearing.gridY + dy}`), `seed ${seed} ${clearing.id}`).toBe(false);
          }
        }
      }
    }
  });

  it('leaves layouts without site clearings unchanged', () => {
    for (const seed of [3, 17, 4242]) {
      expect(ArenaGenerator.fingerprint(generate(seed, { ...base, siteClearings: [] })))
        .toBe(ArenaGenerator.fingerprint(generate(seed, base)));
    }
  });

  it('places authored groves deterministically and reserves the full crown around sites', () => {
    const treeGroves = { canopyClearanceCells: 6, areas: [
      { gridX: 18, gridY: 20, radiusCells: 14 },
      { gridX: 65, gridY: 20, radiusCells: 16 },
    ] };
    const map: CoopDefenseMapConfig = { ...withSites, rockFillRatio: 0, rockField: undefined,
      treeCount: 30, treeGroves };
    for (const seed of [3, 17, 4242]) {
      const layout = generate(seed, map);
      expect(layout.trees.length).toBeGreaterThan(0);
      expect(ArenaGenerator.fingerprint(generate(seed, map))).toBe(ArenaGenerator.fingerprint(layout));
      for (const tree of layout.trees) {
        expect(treeGroves.areas.some(area => Math.hypot(tree.gridX - area.gridX, tree.gridY - area.gridY)
          <= area.radiusCells)).toBe(true);
        for (const clearing of siteClearings) {
          for (let dy = -clearing.radiusCells; dy <= clearing.radiusCells; dy++) {
            for (let dx = -clearing.radiusCells; dx <= clearing.radiusCells; dx++) {
              if (dx * dx + dy * dy > clearing.radiusCells ** 2) continue;
              expect(Math.hypot(tree.gridX - clearing.gridX - dx, tree.gridY - clearing.gridY - dy))
                .toBeGreaterThan(treeGroves.canopyClearanceCells);
            }
          }
        }
      }
    }
  });
});
