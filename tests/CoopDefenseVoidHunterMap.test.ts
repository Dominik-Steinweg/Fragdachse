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

  it('uses the fixed duration, night time, boss, bases, and wave cadence', () => {
    const map = getCoopDefenseMapConfig('15');
    expect(map).toMatchObject({
      timeOfDay: '22:00',
      roundDurationSec: 60,
      rockFillRatio: 0.08,
      trackMode: 'void-fire',
      boss: { enemyKind: 'void-hunter', spawnAtMs: 2000 },
    });
    expect(map.bases.reduce((sum, base) => sum + base.hpMax, 0)).toBe(6000);
    expect(map.waves).toEqual(expect.arrayContaining([
      expect.objectContaining({ enemyKind: 'zombie-badger', countPerWave: 1, intervalMs: 2500, startAtMs: 5000 }),
      expect.objectContaining({ enemyKind: 'demon-badger', countPerWave: 1, intervalMs: 5000, startAtMs: 5000 }),
      expect.objectContaining({ enemyKind: 'alien-badger', countPerWave: 1, intervalMs: 15000, startAtMs: 15000 }),
      expect.objectContaining({ enemyKind: 'thrower-badger', countPerWave: 1, intervalMs: 20000, startAtMs: 20000 }),
    ]));
  });

  it('replaces rails with deterministic collision-free permanent void fire', () => {
    const map = getCoopDefenseMapConfig('15');
    const first = ArenaGenerator.generate(71_515, map);
    const repeated = ArenaGenerator.generate(71_515, map);
    expect(first.tracks).toEqual([]);
    expect(first.permanentGroundFireZones).toEqual(repeated.permanentGroundFireZones);
    expect(first.permanentGroundFireZones).toHaveLength(7);
    expect(map.permanentGroundFire?.baseClearanceCells).toBe(2);

    const hazardCells = new Set(
      first.permanentGroundFireZones!.flatMap((zone) => zone.cells.map((cell) => `${cell.gridX}:${cell.gridY}`)),
    );
    expect(hazardCells.size).toBeGreaterThan(0);
    for (const zone of first.permanentGroundFireZones!) {
      expect(zone).toMatchObject({
        burnDurationMs: 2000,
        burnDamagePerTick: 0.5,
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
