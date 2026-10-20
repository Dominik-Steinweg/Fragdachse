import { describe, expect, it } from 'vitest';
import { ArenaGenerator, resolveArenaGenerationInput } from '../src/arena/ArenaGenerator';
import {
  getBridgeAbutmentCells,
  getBridgeApproachClearings,
  getBridgeDeckCells,
  getBridgeDeckRect,
  isPointOnBridgeDeck,
  nearestBridgeDeckPoint,
  resolveCollisionWater,
} from '../src/arena/BridgeGeometry';
import { CELL_SIZE, getArenaMetricsProfile } from '../src/config';
import { normalizeCoopDefenseBridges } from '../src/config/coopDefenseBridges';
import { getCoopDefenseMapConfig, type CoopDefenseMapConfig } from '../src/config/coopDefenseMaps';
import {
  toAuthoredScenario,
  toCoopDefenseMapConfig,
  toWorldDefinition,
  toWorldGenerationConfig,
} from '../src/config/authoring/coopDefenseAuthoringAdapter';
import type { ArenaBridge, WaterCell } from '../src/types';
import { resolveWorldMetrics } from '../src/world/WorldMetrics';

const RIVER: ArenaBridge = { id: 'test-bridge', axis: 'horizontal', gridX: 10, gridY: 4, spanCells: 3, deckWidthCells: 2 };

function waterRect(gridX: number, gridY: number, width: number, height: number): WaterCell[] {
  const cells: WaterCell[] = [];
  for (let y = gridY; y < gridY + height; y++) for (let x = gridX; x < gridX + width; x++) cells.push({ gridX: x, gridY: y });
  return cells;
}

const NO_STRUCTURES = { bases: [], persistentBase: undefined, rockWalls: undefined, missionProgress: undefined,
  trackMode: 'none' as const, trackPosition: undefined };

function generate(seed: number, map: CoopDefenseMapConfig) {
  const metrics = resolveWorldMetrics(getArenaMetricsProfile('coop_defense', 'ARENA', map.arenaWidthCells, map.arenaHeightCells));
  return ArenaGenerator.generate(seed, resolveArenaGenerationInput('coop_defense', metrics), map);
}

/** Map 12 already narrows its eastern river to four cells on rows 20..22 (x 77..80). */
const MAP_12_BRIDGE: ArenaBridge = { id: 'east-river-bridge', axis: 'horizontal', gridX: 77, gridY: 20, spanCells: 4, deckWidthCells: 3 };

describe('bridge geometry', () => {
  it('lays the deck along the axis of travel and rests it on two dry rows', () => {
    expect(getBridgeDeckRect(RIVER)).toEqual({ gridX: 10, gridY: 4, widthCells: 3, heightCells: 2 });
    expect(getBridgeDeckRect({ ...RIVER, axis: 'vertical' })).toEqual({ gridX: 10, gridY: 4, widthCells: 2, heightCells: 3 });
    expect(getBridgeDeckCells(RIVER)).toHaveLength(6);
    expect(getBridgeAbutmentCells(RIVER)).toEqual({
      start: [{ gridX: 9, gridY: 4 }, { gridX: 9, gridY: 5 }],
      end: [{ gridX: 13, gridY: 4 }, { gridX: 13, gridY: 5 }],
    });
    const vertical = getBridgeAbutmentCells({ ...RIVER, axis: 'vertical' });
    expect(vertical.start).toEqual([{ gridX: 10, gridY: 3 }, { gridX: 11, gridY: 3 }]);
    expect(vertical.end).toEqual([{ gridX: 10, gridY: 7 }, { gridX: 11, gridY: 7 }]);
    const [west, east] = getBridgeApproachClearings(RIVER);
    expect(west!.gridX).toBeLessThan(9);
    expect(east!.gridX).toBeGreaterThan(13);
  });

  it('decides deck membership by the centre point and clamps approach points onto the deck', () => {
    const origin = { offsetX: 100, offsetY: 50 };
    const left = 100 + 10 * CELL_SIZE;
    const top = 50 + 4 * CELL_SIZE;
    expect(isPointOnBridgeDeck(RIVER, origin, left + 1, top + 1)).toBe(true);
    expect(isPointOnBridgeDeck(RIVER, origin, left - 1, top + 1)).toBe(false);
    expect(isPointOnBridgeDeck(RIVER, origin, left + 3 * CELL_SIZE, top + 1)).toBe(false);
    expect(nearestBridgeDeckPoint(RIVER, origin, 0, top + 10)).toEqual({ x: left, y: top + 10 });
  });

  it('removes only the decks of standing bridges from collision water', () => {
    const water = waterRect(10, 0, 3, 10);
    const standing = resolveCollisionWater(water, [RIVER]);
    expect(standing).toHaveLength(water.length - 6);
    expect(standing.some((cell) => cell.gridY === 4 || cell.gridY === 5)).toBe(false);
    expect(resolveCollisionWater(water, [RIVER], new Set([RIVER.id]))).toEqual(water);
    expect(resolveCollisionWater(water, undefined)).toEqual(water);
  });
});

describe('bridge authoring', () => {
  const water = waterRect(10, 0, 3, 12);
  const normalize = (bridges: readonly ArenaBridge[], extra: object = {}) =>
    normalizeCoopDefenseBridges({ ...NO_STRUCTURES, bridges, ...extra }, water, 30, 20);

  it('accepts a deck over water between dry banks and is idempotent', () => {
    const once = normalize([RIVER]);
    expect(once).toEqual([RIVER]);
    expect(normalize(once!)).toEqual(once);
    expect(normalize([])).toEqual([]);
    expect(normalizeCoopDefenseBridges({ ...NO_STRUCTURES }, water, 30, 20)).toBeUndefined();
  });

  it('rejects decks on land, abutments in water, bad shapes and overlaps', () => {
    expect(() => normalize([{ ...RIVER, spanCells: 2 }])).toThrow(/abutment must rest on dry land/);
    expect(() => normalize([{ ...RIVER, gridX: 9 }])).toThrow(/deck must span water/);
    expect(() => normalize([{ ...RIVER, spanCells: 1 }])).toThrow(/spanCells/);
    expect(() => normalize([{ ...RIVER, deckWidthCells: 5 }])).toThrow(/deckWidthCells/);
    expect(() => normalize([{ ...RIVER, id: 'Not Kebab' }])).toThrow(/kebab-case/);
    expect(() => normalize([RIVER, { ...RIVER }])).toThrow(/Duplicate bridge id/);
    expect(() => normalize([RIVER, { ...RIVER, id: 'second', gridY: 5 }])).toThrow(/overlaps bridge test-bridge/);
    expect(() => normalize([{ ...RIVER, gridY: -1 }])).toThrow(/outside the arena/);
    expect(() => normalize([RIVER], { trackMode: 'rails', trackPosition: { kind: 'grid', gridX: 13 } }))
      .toThrow(/railway/);
    expect(() => normalize([RIVER], { spawnZones: [{ id: 'den', gridX: 11, gridY: 4, widthCells: 1, heightCells: 1, medium: 'water' }] }))
      .toThrow(/water spawn zone den/);
    expect(() => normalize([RIVER], { krakenHabitat: {} })).toThrow(/kraken habitat/);
  });
});

describe('bridge generation', () => {
  const base = getCoopDefenseMapConfig('12');
  // Map configs are normalized once; the generator re-validates the added bridge itself.
  const withBridge: CoopDefenseMapConfig = { ...base, bridges: [MAP_12_BRIDGE] };

  it('keeps maps without bridges byte-identical', () => {
    for (const seed of [3, 17]) {
      expect(ArenaGenerator.fingerprint(generate(seed, { ...base, bridges: [] })))
        .toBe(ArenaGenerator.fingerprint(generate(seed, base)));
    }
  });

  it('emits the bridge, keeps its deck in authored water and its approaches free of rock and trees', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const layout = generate(seed, withBridge);
      expect(layout.bridges).toEqual([MAP_12_BRIDGE]);
      const wet = new Set((layout.water ?? []).map((cell) => `${cell.gridX}_${cell.gridY}`));
      for (const cell of getBridgeDeckCells(MAP_12_BRIDGE)) expect(wet.has(`${cell.gridX}_${cell.gridY}`)).toBe(true);
      const occupied = new Set([...layout.rocks, ...layout.trees].map(({ gridX, gridY }) => `${gridX}_${gridY}`));
      const { start, end } = getBridgeAbutmentCells(MAP_12_BRIDGE);
      for (const cell of [...start, ...end]) expect(occupied.has(`${cell.gridX}_${cell.gridY}`), `seed ${seed}`).toBe(false);
    }
  });

  it('requires a land crossing besides the bridge', () => {
    // Continue the river down to the southern edge: the bridge would be the only way east.
    const sealed: CoopDefenseMapConfig = {
      ...base,
      water: [...(base.water ?? []), ...waterRect(70, 36, 4, 5)],
      bridges: [MAP_12_BRIDGE],
    };
    expect(() => generate(7, sealed)).toThrow(/verbinden/);
  });

  it('round-trips bridges through the World/Activity split and the generator contract', () => {
    expect(toCoopDefenseMapConfig(toAuthoredScenario(withBridge))).toEqual(withBridge);
    const world = toWorldDefinition(withBridge);
    expect(world.terrain.bridges).toEqual([MAP_12_BRIDGE]);
    expect(toWorldGenerationConfig(world).bridges).toEqual([MAP_12_BRIDGE]);
  });
});
