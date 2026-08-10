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
      'coop-base-rear',
      'coop-base-middle',
    ]);
    expect(map.bases.filter((base) => base.role === 'outpost').map((base) => base.id)).toEqual([
      'friendly-outpost-rocket',
      'friendly-outpost-flame',
    ]);
    expect(map.persistentSpawns).toEqual([]);
    expect(map.encounters).toHaveLength(3);
    expect(map.encounters?.map((encounter) => encounter.start.type)).toEqual([
      'time',
      'boss-phase',
      'time',
    ]);
    expect(map.encounters?.[1].start).toEqual({ type: 'boss-phase', phase: 2 });

    const roundDurationMs = map.roundDurationSec * 1000;
    expect(map.boss!.spawnAtMs).toBeGreaterThanOrEqual(0);
    expect(map.boss!.spawnAtMs).toBeLessThan(roundDurationMs);
    for (const encounter of map.encounters ?? []) {
      expect(encounter.groups.length).toBeGreaterThan(0);
      for (const group of encounter.groups) expect(group.count).toBeGreaterThan(0);
    }
  });

  it('replaces rails with deterministic collision-free permanent void fire', () => {
    const map = getCoopDefenseMapConfig('15');
    const first = ArenaGenerator.generate(71_515, map);
    const repeated = ArenaGenerator.generate(71_515, map);
    expect(first.tracks).toEqual([]);
    expect(first.permanentGroundFireZones).toEqual(repeated.permanentGroundFireZones);
    expect(first.permanentGroundFireZones).toHaveLength(1 + (map.permanentGroundFire?.randomPatchCount ?? 0));
    expect(map.permanentGroundFire?.baseClearanceCells).toBeGreaterThan(0);

    const hazardCells = new Set(
      first.permanentGroundFireZones!.flatMap((zone) => zone.cells.map((cell) => `${cell.gridX}:${cell.gridY}`)),
    );
    expect(hazardCells.size).toBeGreaterThan(0);
    for (const zone of first.permanentGroundFireZones!) {
      expect(zone).toMatchObject({
        burnDurationMs: map.permanentGroundFire?.burnDurationMs,
        burnDamagePerTick: map.permanentGroundFire?.burnDamagePerTick,
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
        for (const zone of first.permanentGroundFireZones!) {
          for (const hazardCell of zone.cells) {
            const chebyshevDistance = Math.max(
              Math.abs(hazardCell.gridX - baseCell.gridX),
              Math.abs(hazardCell.gridY - baseCell.gridY),
            );
            expect(chebyshevDistance).toBeGreaterThan(map.permanentGroundFire!.baseClearanceCells);
          }
        }
      }
    }
  });
});
