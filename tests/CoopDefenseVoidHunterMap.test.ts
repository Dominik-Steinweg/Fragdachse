import { generateArenaWithActiveMetrics } from './ArenaGeneratorTestHelper';
import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/network/bridge', () => ({
  bridge: { getCoopDefenseMapId: () => '15' },
}));

import { resolveCoopDefenseBases } from '../src/arena/BaseRegistry';
import { ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import { applyArenaMetricsForMode } from '../src/config';
import {
  getCoopDefenseMapConfig,
} from '../src/config/coopDefenseMaps';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import { resolveCoopDefenseWorldMetrics } from '../src/world/WorldMetrics';

describe('Map 15 - Leerenjäger', () => {
  beforeAll(() => {
    applyArenaMetricsForMode(COOP_DEFENSE_MODE, 'ARENA');
  });

  it('defines its structural encounter content and schedules it within the round', () => {
    const map = getCoopDefenseMapConfig('15');
    expect(map).toMatchObject({
      trackMode: 'none',
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
    const phaseTwoHazard = map.mapEvents.find((event) => event.type === 'ground-hazard' && event.area.type === 'expanded-patches');
    expect(phaseTwoHazard?.type).toBe('ground-hazard');
    expect(phaseTwoHazard?.start).toEqual({ type: 'boss-phase', phase: 2 });
    for (const encounter of map.encounters ?? []) {
      for (const group of encounter.groups) expect(group.count).toBeGreaterThan(0);
    }
  });

  it('prebuilds deterministic collision-free void patches without a track corridor', () => {
    const map = getCoopDefenseMapConfig('15');
    const first = generateArenaWithActiveMetrics(71_515, map);
    const repeated = generateArenaWithActiveMetrics(71_515, map);
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
      expect(zone).not.toHaveProperty('effect');
      expect(zone.cells.length).toBeGreaterThan(0);
    }
    for (const rock of first.rocks) expect(hazardCells.has(`${rock.gridX}:${rock.gridY}`)).toBe(false);
    for (const tree of first.trees) expect(hazardCells.has(`${tree.gridX}:${tree.gridY}`)).toBe(false);
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

  it('keeps the full layout fingerprint identical across hypot rounding implementations', () => {
    const map = getCoopDefenseMapConfig('15');
    const input = resolveArenaGenerationInput(
      COOP_DEFENSE_MODE,
      resolveCoopDefenseWorldMetrics(map.arenaWidthCells, map.arenaHeightCells),
    );
    const hypot = vi.spyOn(Math, 'hypot');
    try {
      // Both formulas compute the same distance, but scaling changes the last bits.
      // Model that engine difference explicitly instead of comparing one engine to itself.
      hypot.mockImplementation((...values) => Math.sqrt(values.reduce((sum, value) => sum + value * value, 0)));
      const hostLayout = ArenaGenerator.generate(42, input, map);
      hypot.mockImplementation((...values) => {
        const scale = Math.max(...values.map(Math.abs));
        if (scale === 0) return 0;
        return scale * Math.sqrt(values.reduce((sum, value) => sum + (value / scale) * (value / scale), 0));
      });
      const clientLayout = ArenaGenerator.generate(42, input, map);

      expect(hostLayout.groundHazardZones?.some(zone =>
        zone.cells.some(cell => cell.expansionProgress !== undefined))).toBe(true);
      expect(ArenaGenerator.fingerprint(clientLayout)).toBe(ArenaGenerator.fingerprint(hostLayout));
      expect(clientLayout).toEqual(hostLayout);
    } finally {
      hypot.mockRestore();
    }
  });

  it('expands the same seeded patches without duplicating initial or overlapping cells', () => {
    const map = getCoopDefenseMapConfig('15');
    const expansion = map.mapEvents.find(event => event.type === 'ground-hazard' && event.area.type === 'expanded-patches');
    if (expansion?.type !== 'ground-hazard' || expansion.area.type !== 'expanded-patches') throw new Error('Missing expansion');
    const area = expansion.area;
    const source = map.mapEvents.find(event => event.id === area.sourceEventId);
    if (source?.type !== 'ground-hazard' || source.area.type !== 'random-patches') throw new Error('Missing source patches');
    expect(source?.start).toEqual({ type: 'time', atMs: 0 });
    expect(map.mapEvents.some(event => event.id === 'void-track-corridor')).toBe(false);
    for (const seed of [71_515, 42, 993]) {
      const layout = generateArenaWithActiveMetrics(seed, map);
      const sources = layout.groundHazardZones!.filter(zone => zone.eventId === area.sourceEventId);
      expect(sources.length).toBe(source.area.randomPatchCount);
      const initial = new Set(sources.flatMap(zone => zone.cells.map(cell => `${cell.gridX}:${cell.gridY}`)));
      const extended = layout.groundHazardZones!.filter(zone => zone.eventId === expansion.id).flatMap(zone => zone.cells);
      expect(extended.length).toBeGreaterThan(0);
      expect(new Set(extended.map(cell => `${cell.gridX}:${cell.gridY}`)).size).toBe(extended.length);
      for (const cell of extended) {
        expect(initial.has(`${cell.gridX}:${cell.gridY}`)).toBe(false);
        const progresses = sources.flatMap(zone => {
          const patch = zone.patch!;
          const distance = Math.hypot(cell.gridX - patch.centerX, cell.gridY - patch.centerY);
          return distance <= patch.radiusCells * area.radiusScale
            ? [Math.max(0, (distance - patch.radiusCells) / (patch.radiusCells * (area.radiusScale - 1)))] : [];
        });
        expect(progresses.length).toBeGreaterThan(0);
        expect(cell.expansionProgress).toBeCloseTo(Math.min(...progresses));
      }
      const reversed = generateArenaWithActiveMetrics(seed, { ...map, mapEvents: [...map.mapEvents].reverse() });
      expect(reversed.groundHazardZones).toEqual(layout.groundHazardZones);
    }
  });
});
