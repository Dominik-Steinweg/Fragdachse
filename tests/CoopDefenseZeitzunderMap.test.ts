import { generateArenaWithActiveMetrics } from './ArenaGeneratorTestHelper';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '16' },
}));

import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { GRID_COLS, GRID_ROWS, applyArenaMetricsForMode } from '../src/config';
import {
  getCoopDefenseMapConfig,
  type CoopDefenseMapGroundHazardEventConfig,
} from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';

describe('Map 16 - Zeitzünder', () => {
  beforeAll(() => {
    const map = getCoopDefenseMapConfig('16');
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
  });

  it('keeps the migrated persistent rear core and independent support bases', () => {
    const map = getCoopDefenseMapConfig('16');
    const rearBase = map.bases.find((base) => base.id === 'coop-base-rear');

    expect(map).toMatchObject({
      timeOfDay: '05:00',
      trackMode: 'void-fire',
      objective: 'advance',
      persistentBase: {
        baseId: 'coop-base-rear',
        anchor: { gridX: 91, gridY: 19 },
        hpMax: 1650,
      },
    });
    expect(rearBase?.hpMax).toBeGreaterThan(0);
    expect(rearBase?.turrets).toEqual([]);
    expect(rearBase?.powerUpPedestals).toEqual([]);
    expect(map.bases.flatMap(base => base.turrets ?? [])).toEqual([]);
    expect(map.bases.flatMap(base => base.powerUpPedestals ?? []).length).toBeGreaterThan(0);
    expect(map.persistentSpawns ?? []).toEqual([]);
    expect(map.secondaryObjectives ?? []).toEqual([]);
    expect(map.encounters?.every(encounter => encounter.start.type === 'after-checkpoint'
      && encounter.groups.some(group => group.enemyKind === 'timebomb-badger' && group.spawnArea))).toBe(true);
  });

  it('generates deterministic prebuilt void-fire fields and no train', () => {
    const map = getCoopDefenseMapConfig('16');
    const first = generateArenaWithActiveMetrics(71_516, map);
    const repeated = generateArenaWithActiveMetrics(71_516, map);
    const hazardEvents = map.mapEvents?.filter((event) => event.type === 'ground-hazard') ?? [];

    expect(first.tracks).toEqual([]);
    expect(first.groundHazardZones).toEqual(repeated.groundHazardZones);
    expect(first.groundHazardZones?.length).toBeGreaterThan(0);
    // Reine Geometrie: Effektwerte kommen beim Aktivieren aus dem Map-Event, nicht aus dem Layout.
    expect(first.groundHazardZones?.every((zone) => (
      hazardEvents.some((candidate) => candidate.id === zone.eventId)
      && zone.cells.length > 0
    ))).toBe(true);

    const hazardCells = new Set(
      first.groundHazardZones!.flatMap((zone) => zone.cells.map((cell) => `${cell.gridX}:${cell.gridY}`)),
    );
    expect(hazardCells.size).toBeGreaterThan(0);
    for (const base of resolveCoopDefenseBases(map)) {
      for (const cell of base.cells) expect(hazardCells.has(`${cell.gridX}:${cell.gridY}`)).toBe(false);
    }
    for (const pedestal of first.powerUpPedestals) {
      expect(hazardCells.has(`${pedestal.gridX}:${pedestal.gridY}`)).toBe(false);
    }
  });

  it('keeps residual void pockets away from checkpoints and extraction', () => {
    const map = getCoopDefenseMapConfig('16');
    for (const event of map.mapEvents ?? []) {
      if (event.type !== 'ground-hazard' || event.area.type !== 'rectangle') continue;
      expect(event.area.heightCells).toBeLessThan(GRID_ROWS / 2);
      for (const checkpoint of map.missionProgress?.checkpoints ?? []) {
        const area = event.area;
        expect(checkpoint.gridX >= area.gridX && checkpoint.gridX < area.gridX + area.widthCells
          && checkpoint.gridY >= area.gridY && checkpoint.gridY < area.gridY + area.heightCells).toBe(false);
      }
    }
  });
});
