import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '15' },
}));

import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { applyArenaMetricsForMode } from '../src/config';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';

describe('Map 15 - Leerenjäger', () => {
  beforeAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA');
  });

  it('defines its structural encounter content and schedules it within the round', () => {
    const map = getCoopDefenseMapConfig('15');
    expect(map).toMatchObject({
      timeOfDay: '22:00',
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
    expect(map.encounters?.[1].groups.every((group) => group.front === 'north' || group.front === 'south')).toBe(true);
    expect(new Set(map.encounters?.[2].groups.map((group) => group.front))).toEqual(
      new Set(['west', 'north', 'east', 'south']),
    );

    expect(map.boss!.spawnAtMs).toBeGreaterThanOrEqual(0);
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
    for (const zone of first.groundHazardZones!) {
      const event = hazardEvents.find((candidate) => candidate.id === zone.eventId);
      expect(zone).toMatchObject({
        burnDurationMs: event?.effect.burnDurationMs,
        burnDamagePerTick: event?.effect.burnDamagePerTick,
        visualStyle: 'void',
        damageTarget: 'players',
      });
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
});
