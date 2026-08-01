import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '16' },
}));

import { ArenaGenerator } from '../src/arena/ArenaGenerator';
import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { applyArenaMetricsForMode } from '../src/config';
import { getCoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';

describe('Map 16 - Zeitzünder', () => {
  beforeAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', 104);
  });

  it('keeps the rear base fortified with linked and free power-ups', () => {
    const map = getCoopDefenseMapConfig('16');
    const rearBase = map.bases.find((base) => base.id === 'coop-base-rear');
    const middleBase = map.bases.find((base) => base.id === 'coop-base-middle');

    expect(map).toMatchObject({
      arenaWidthCells: 104,
      timeOfDay: '05:00',
      trackMode: 'void-fire',
      objective: 'destroy-hostile-bases',
      roundDurationSec: 90,
    });
    expect(rearBase?.hpMax).toBe(4200);
    expect(rearBase?.turrets).toHaveLength(0);
    expect(rearBase?.powerUpPedestals?.map((pedestal) => pedestal.defId)).toEqual([
      'HEALTH_PACK',
      'ARMOR',
      'ADRENALINE',
    ]);
    expect(middleBase?.hpMax).toBe(1100);
    expect(map.bases.filter((base) => base.role === 'outpost' && base.faction !== 'hostile'))
      .toHaveLength(6);
    expect(map.bases
      .filter((base) => base.role === 'outpost' && base.faction !== 'hostile')
      .flatMap((base) => base.turrets ?? [])
      .map((turret) => turret.weaponId))
      .toEqual([
        'FLIEGENPILZ_PLASMA',
        'FLIEGENPILZ_PLASMA',
        'FLIEGENPILZ_PLASMA',
        'FLIEGENPILZ_PLASMA',
        'FLIEGENPILZ_PLASMA',
        'FLIEGENPILZ_PLASMA',
      ]);
    expect(map.powerUps.map((powerUp) => powerUp.defId)).toEqual([
      'HEALTH_PACK',
      'ARMOR',
      'ADRENALINE',
      'HEALTH_PACK',
      'DOUBLE_DAMAGE',
    ]);
  });

  it('generates seven deterministic void-fire fields and no train', () => {
    const map = getCoopDefenseMapConfig('16');
    const first = ArenaGenerator.generate(71_516, map);
    const repeated = ArenaGenerator.generate(71_516, map);

    expect(first.tracks).toEqual([]);
    expect(first.permanentGroundFireZones).toEqual(repeated.permanentGroundFireZones);
    expect(first.permanentGroundFireZones).toHaveLength(7);
    expect(first.permanentGroundFireZones?.every((zone) => (
      zone.visualStyle === 'void'
      && zone.damageTarget === 'players'
      && zone.burnDurationMs === 2000
      && zone.burnDamagePerTick === 0.5
    ))).toBe(true);

    const hazardCells = new Set(
      first.permanentGroundFireZones!.flatMap((zone) => zone.cells.map((cell) => `${cell.gridX}:${cell.gridY}`)),
    );
    expect(hazardCells.size).toBeGreaterThan(0);
    for (const base of resolveCoopDefenseBases(map)) {
      for (const cell of base.cells) expect(hazardCells.has(`${cell.gridX}:${cell.gridY}`)).toBe(false);
    }
    for (const pedestal of first.powerUpPedestals) {
      expect(hazardCells.has(`${pedestal.gridX}:${pedestal.gridY}`)).toBe(false);
    }
  });
});
