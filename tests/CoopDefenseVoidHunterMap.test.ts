import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '15' },
}));

import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { GRID_COLS, GRID_ROWS, applyArenaMetricsForMode } from '../src/config';
import {
  getCoopDefenseMapConfig,
  type CoopDefenseMapGroundHazardEventConfig,
} from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';

describe('Map 15 - Leerenjäger', () => {
  beforeAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA');
  });

  it('defines its structural encounter content and schedules it within the round', () => {
    const map = getCoopDefenseMapConfig('15');
    expect(map).toMatchObject({
      timeOfDay: '19:00',
      trackMode: 'void-fire',
      boss: { enemyKind: 'void-hunter' },
    });
    expect(map.bases.filter((base) => (base.role ?? 'main') === 'main').map((base) => base.id)).toEqual([
      'coop-base-center',
    ]);
    expect(map.bases.filter((base) => base.role === 'outpost')).toEqual([]);
    expect(map.persistentSpawns).toEqual([]);
    expect(map.encounters?.length).toBeGreaterThan(0);
    expect(map.encounters?.map((encounter) => encounter.start.type)).toEqual([
      'time',
      'boss-phase',
      'time',
    ]);
    expect(map.encounters?.[1].start).toEqual({ type: 'boss-phase', phase: 2 });
    expect(map.encounters?.[1].groups.every((group) =>
      group.front === 'north'
      || group.front === 'south'
      || group.front === 'west'
      || group.front === 'east')).toBe(true);
    expect(new Set(map.encounters?.[2].groups.map((group) => group.front))).toEqual(
      new Set(['west', 'north', 'east', 'south']),
    );

    expect(map.boss!.spawnAtMs).toBeGreaterThanOrEqual(0);
    const phaseTwoHazard = map.mapEvents.find((event) => event.id === 'void-random-patches');
    expect(phaseTwoHazard?.type).toBe('ground-hazard');
    expect(phaseTwoHazard?.start).toEqual({ type: 'boss-phase', phase: 2 });
    for (const encounter of map.encounters ?? []) {
      for (const group of encounter.groups) expect(group.count).toBeGreaterThan(0);
    }
  });

  it('replaces rails with deterministic collision-free prebuilt void hazards', () => {
    const map = getCoopDefenseMapConfig('15');
    const first = ArenaGenerator.generate(71_515, map);
    const repeated = ArenaGenerator.generate(71_515, map);
    const hazardEvents = map.mapEvents?.filter((event) => event.type === 'ground-hazard') ?? [];
    expect(first.tracks).toEqual([]);
    expect(first.groundHazardZones).toEqual(repeated.groundHazardZones);
    expect(first.groundHazardZones?.length).toBeGreaterThan(0);
    expect(hazardEvents.every((event) => event.area.baseClearanceCells === 2)).toBe(true);

    const hazardCells = new Set(
      first.groundHazardZones!.flatMap((zone) => zone.cells.map((cell) => `${cell.gridX}:${cell.gridY}`)),
    );
    expect(hazardCells.size).toBeGreaterThan(0);
    // Die Zone traegt nur Geometrie: Brenndauer, Schaden und Look bleiben allein im Map-Event,
    // damit Balancing nicht an zwei Stellen gepflegt werden muss.
    for (const zone of first.groundHazardZones!) {
      expect(hazardEvents.some((candidate) => candidate.id === zone.eventId)).toBe(true);
      expect(Object.keys(zone).sort()).toEqual(['cells', 'eventId', 'id']);
      expect(zone.cells.length).toBeGreaterThan(0);
    }
    for (const rock of first.rocks) expect(hazardCells.has(`${rock.gridX}:${rock.gridY}`)).toBe(false);
    for (const pedestal of first.powerUpPedestals) {
      expect(hazardCells.has(`${pedestal.gridX}:${pedestal.gridY}`)).toBe(false);
    }
    for (const base of resolveCoopDefenseBases(map)) {
      for (const baseCell of base.cells) {
        for (const zone of first.groundHazardZones!) {
          for (const hazardCell of zone.cells) {
            const chebyshevDistance = Math.max(
              Math.abs(hazardCell.gridX - baseCell.gridX),
              Math.abs(hazardCell.gridY - baseCell.gridY),
            );
            expect(chebyshevDistance).toBeGreaterThan(2);
          }
        }
      }
    }
  });

  /**
   * Das Korridor-Rechteck ist authored, die Gleisspalten entstehen prozedural aus `GRID_COLS`.
   * Ohne diese Kopplung wuerde eine geaenderte `arenaWidthCells` den Voidbrand still neben den
   * Korridor schieben -- die Map-Validierung akzeptiert ein Rechteck an jeder Stelle der Arena.
   */
  it('keeps the authored corridor rectangle on the centered track columns', () => {
    const map = getCoopDefenseMapConfig('15');
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', map.arenaWidthCells, map.arenaHeightCells);
    try {
      const corridor = map.mapEvents
        ?.find((event) => event.id === 'void-track-corridor') as CoopDefenseMapGroundHazardEventConfig;
      expect(corridor?.type).toBe('ground-hazard');
      expect(corridor.area).toMatchObject({
        type: 'rectangle',
        gridX: Math.floor((GRID_COLS - 2) / 2),
        widthCells: 2,
        gridY: 0,
        heightCells: GRID_ROWS,
      });
    } finally {
      applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA');
    }
  });
});
