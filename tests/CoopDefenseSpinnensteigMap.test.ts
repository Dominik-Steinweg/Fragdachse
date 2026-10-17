import { generateArenaWithActiveMetrics } from './ArenaGeneratorTestHelper';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '16' },
}));

import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { applyArenaMetricsForMode } from '../src/config';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';

describe('Map 16 - Spinnensteig', () => {
  beforeAll(() => {
    const map = getCoopDefenseMapConfig('16');
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
  });

  it('starts at the persistent core in the west and extracts in the east', () => {
    const map = getCoopDefenseMapConfig('16');
    const checkpoints = map.missionProgress?.checkpoints ?? [];
    const extraction = checkpoints[checkpoints.length - 1];

    expect(map).toMatchObject({
      objective: 'advance',
      trackMode: 'none',
      enemyTargeting: 'players',
      persistentBaseRewardsOnVictory: ['base_watchtower'],
      persistentBase: { baseId: 'coop-base-rear' },
    });
    expect(map.respawnsPerPlayer).toBeGreaterThan(0);
    expect(map.persistentBase!.anchor.gridX).toBeLessThan(map.arenaWidthCells / 3);
    expect(checkpoints[0].gridX).toBeGreaterThan(map.persistentBase!.anchor.gridX);
    expect(extraction.gridX).toBeGreaterThan(map.arenaWidthCells * 2 / 3);
    // Die Reise fuehrt um den See: Die Route erreicht den Norden, bevor sie im Osten endet.
    expect(Math.min(...checkpoints.map(checkpoint => checkpoint.gridY))).toBeLessThan(map.arenaHeightCells / 4);
    expect(map.bases.flatMap(base => base.turrets ?? [])).toEqual([]);
    expect(map.bases.flatMap(base => base.powerUpPedestals ?? []).length).toBeGreaterThan(0);
    expect(map.persistentSpawns ?? []).toEqual([]);
  });

  it('opens with kaboomtula ambushes and lets amphibious brood rise from the water', () => {
    const map = getCoopDefenseMapConfig('16');
    const groups = (map.encounters ?? []).flatMap(encounter => encounter.groups);

    expect(groups.some(group => group.enemyKind === 'kaboomtula')).toBe(true);
    const waterGroups = groups.filter(group => group.spawnArea?.medium === 'water');
    expect(waterGroups.length).toBeGreaterThan(0);
    expect(waterGroups.every(group => getCoopDefenseEnemyConfig(group.enemyKind).amphibious)).toBe(true);
    expect(map.water?.length).toBeGreaterThan(0);
  });

  it('generates a deterministic arena without tracks', () => {
    const map = getCoopDefenseMapConfig('16');
    const first = generateArenaWithActiveMetrics(71_516, map);
    const repeated = generateArenaWithActiveMetrics(71_516, map);

    expect(first.tracks).toEqual([]);
    expect(first.rocks).toEqual(repeated.rocks);
    expect(first.groundHazardZones).toEqual(repeated.groundHazardZones);
    const hazardCells = new Set((first.groundHazardZones ?? [])
      .flatMap(zone => zone.cells.map(cell => `${cell.gridX}:${cell.gridY}`)));
    for (const base of resolveCoopDefenseBases(map)) {
      for (const cell of base.cells) expect(hazardCells.has(`${cell.gridX}:${cell.gridY}`)).toBe(false);
    }
  });
});
