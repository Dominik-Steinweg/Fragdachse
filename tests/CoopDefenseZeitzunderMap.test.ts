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

  it('keeps the rear base fortified with linked and free power-ups', () => {
    const map = getCoopDefenseMapConfig('16');
    const rearBase = map.bases.find((base) => base.id === 'coop-base-rear');
    const middleBase = map.bases.find((base) => base.id === 'coop-base-middle');

    expect(map).toMatchObject({
      timeOfDay: '05:00',
      trackMode: 'void-fire',
      objective: 'repel-assault',
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
    expect(friendlyOutpostTurrets.every((weaponId) => weaponId === 'SPORE_TURRET_PLASMA')).toBe(true);
    expect(map.powerUps.length).toBeGreaterThan(0);
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

  /**
   * Das Korridor-Rechteck ist authored, die Gleisspalten entstehen prozedural aus `GRID_COLS`.
   * Ohne diese Kopplung wuerde eine geaenderte `arenaWidthCells` den Voidbrand still neben den
   * Korridor schieben -- die Map-Validierung akzeptiert ein Rechteck an jeder Stelle der Arena.
   */
  it('keeps the authored corridor rectangle on the centered track columns', () => {
    const corridor = getCoopDefenseMapConfig('16').mapEvents
      ?.find((event) => event.id === 'void-track-corridor') as CoopDefenseMapGroundHazardEventConfig;
    expect(corridor?.type).toBe('ground-hazard');
    expect(corridor.area).toMatchObject({
      type: 'rectangle',
      gridX: Math.floor((GRID_COLS - 2) / 2),
      widthCells: 2,
      gridY: 0,
      heightCells: GRID_ROWS,
    });
  });
});
