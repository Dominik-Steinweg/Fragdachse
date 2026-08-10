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
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA', getCoopDefenseMapConfig('16').arenaWidthCells);
  });

  it('keeps the rear base fortified with linked and free power-ups', () => {
    const map = getCoopDefenseMapConfig('16');
    const rearBase = map.bases.find((base) => base.id === 'coop-base-rear');
    const middleBase = map.bases.find((base) => base.id === 'coop-base-middle');

    expect(map).toMatchObject({
      timeOfDay: '05:00',
      trackMode: 'void-fire',
      objective: 'destroy-hostile-bases',
    });
    expect(rearBase?.hpMax).toBeGreaterThan(0);
    expect(rearBase?.turrets).toHaveLength(0);
    expect(rearBase?.powerUpPedestals?.map((pedestal) => pedestal.defId)).toEqual(expect.arrayContaining([
      'HEALTH_PACK',
      'ARMOR',
      'ADRENALINE',
    ]));
    expect(middleBase?.hpMax).toBeGreaterThan(0);
    const friendlyOutpostTurrets = map.bases
      .filter((base) => base.role === 'outpost' && base.faction !== 'hostile')
      .flatMap((base) => base.turrets ?? [])
      .map((turret) => turret.weaponId);
    expect(friendlyOutpostTurrets.length).toBeGreaterThan(0);
    expect(friendlyOutpostTurrets.every((weaponId) => weaponId === 'FLIEGENPILZ_PLASMA')).toBe(true);
    expect(map.powerUps.length).toBeGreaterThan(0);
  });

  it('generates seven deterministic void-fire fields and no train', () => {
    const map = getCoopDefenseMapConfig('16');
    const first = ArenaGenerator.generate(71_516, map);
    const repeated = ArenaGenerator.generate(71_516, map);

    expect(first.tracks).toEqual([]);
    expect(first.permanentGroundFireZones).toEqual(repeated.permanentGroundFireZones);
    expect(first.permanentGroundFireZones?.length).toBeGreaterThan(0);
    expect(first.permanentGroundFireZones?.every((zone) => (
      zone.visualStyle === 'void'
      && zone.damageTarget === 'players'
      && zone.burnDurationMs === map.permanentGroundFire?.burnDurationMs
      && zone.burnDamagePerTick === map.permanentGroundFire?.burnDamagePerTick
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
