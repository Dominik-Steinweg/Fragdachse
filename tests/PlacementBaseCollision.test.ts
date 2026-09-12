import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import { type BaseSpec } from '../src/arena/BaseRegistry';
import { RockGridIndex } from '../src/arena/RockGridIndex';
import { ARENA_OFFSET_X, ARENA_OFFSET_Y, CELL_SIZE } from '../src/config';
import { PERSISTENT_BASE_STATE_SCHEMA_VERSION } from '../src/config/persistentBase';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../src/config/coopDefenseConstructions';
import { COOP_DEFENSE_BASE_TURRET_OWNER_ID } from '../src/config';
import type { PlayerManager } from '../src/entities/PlayerManager';
import { getUtilityConfigForMode } from '../src/loadout/LoadoutConfig';
import type { PersistentRestoreToolDefinition } from '../src/persistentBase/PersistentBaseTools';
import { mergePersistentBaseComposite } from '../src/persistentBase/PersistentBaseComposite';
import type { PersistentBaseState } from '../src/persistentBase/PersistentBaseTypes';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
import { resolvePersistentBaseCoreCells } from '../src/persistentBase/PersistentBaseCore';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import type { ArenaLayout } from '../src/types';

const layout: ArenaLayout = {
  seed: 1,
  rocks: [],
  trees: [],
  tracks: [],
  dirt: [],
  powerUpPedestals: [],
};

const noPlayers = { getAllPlayers: () => [] } as unknown as PlayerManager;

function makeBase(
  id: string,
  cells: readonly { gridX: number; gridY: number }[],
  role: BaseSpec['role'] = 'main',
): BaseSpec {
  const gridXs = cells.map((cell) => cell.gridX);
  const gridYs = cells.map((cell) => cell.gridY);
  return {
    id,
    cells,
    region: {
      minGridX: Math.min(...gridXs),
      maxGridX: Math.max(...gridXs),
      minGridY: Math.min(...gridYs),
      maxGridY: Math.max(...gridYs),
    },
    hpMax: 100,
    faction: 'friendly',
    role,
    turrets: [],
    powerUpPedestals: [],
  };
}

function createPlacement(bases: readonly BaseSpec[] = []): PlacementSystem {
  return new PlacementSystem(layout, new RockGridIndex(layout.rocks), noPlayers, resolveActiveArenaWorldMetrics(), bases);
}

describe('turret aim configuration in placement snapshots', () => {
  it('applies an owner-only snapshot update without merging equal construction types', () => {
    const host = createPlacement(); const definition = COOP_DEFENSE_CONSTRUCTIONS.rock_barrier;
    const first = host.materializePersistentPlaceable(definition, 10, 10, 0, 'p1', 0xffffff)!;
    const second = host.materializePersistentPlaceable(definition, 12, 10, 0, 'p1', 0xffffff)!;
    const client = createPlacement(); client.syncFromSnapshot([first, second]);
    const changed = { ...first, ownerId: 'p2' };
    expect(client.syncFromSnapshot([changed, second])).toMatchObject({ updated: [changed], relocated: [], added: [], removed: [] });
    expect(client.getOwnedConstructions('p1').map(r => r.id)).toEqual([second.id]);
    expect(client.getOwnedConstructions('p2').map(r => r.id)).toEqual([first.id]);
    expect(client.syncFromSnapshot([changed, second]).updated).toEqual([]);
  });
  it.each(['machine_gun_turret', 'rocket_turret'] as const)('preserves %s tuning across placement, restore and client sync', id => {
    const definition = COOP_DEFENSE_CONSTRUCTIONS[id];
    const host = createPlacement();
    const origin = world(9, 10), target = world(10, 10);
    const placed = host.tryPlaceConstruction(definition, definition.maxHp, 'owner', 0xffffff,
      origin.x, origin.y, target.x, target.y)!;
    const expected = { rotationSpeedDegPerSec: definition.rotationSpeedDegPerSec, aimToleranceDeg: definition.aimToleranceDeg };
    expect(placed).toMatchObject(expected);
    const restored = host.materializePersistentPlaceable(definition, 12, 10, 1, 'owner', 0xffffff)!;
    expect(restored).toMatchObject({ ...expected, angle: 1 });
    const client = createPlacement();
    client.syncFromSnapshot(host.getNetSnapshot());
    expect(client.getRuntimeRock(restored.id)).toMatchObject(expected);
    const changed = { ...restored, rotationSpeedDegPerSec: 77, aimToleranceDeg: 4 };
    expect(client.syncFromSnapshot([placed, changed]).updated).toEqual([changed]);
    const { rotationSpeedDegPerSec: _speed, aimToleranceDeg: _tolerance, ...legacy } = changed;
    client.syncFromSnapshot([placed, legacy]);
    expect(client.getRuntimeRock(restored.id)?.rotationSpeedDegPerSec).toBeUndefined();
  });

  it('freezes a utility profile when restored and leaves legacy utility fields absent', () => {
    const host = createPlacement();
    const utility = getUtilityConfigForMode('SPORE_TURRET', 'coop-defense');
    if (utility.type !== 'placeable_turret') throw new Error('expected turret');
    const configured = { ...utility, placeable: { ...utility.placeable, rotationSpeedDegPerSec: 70, aimToleranceDeg: 2 } };
    expect(host.materializePersistentPlaceable(configured, 10, 10, 0.5, 'owner', 1))
      .toMatchObject({ rotationSpeedDegPerSec: 70, aimToleranceDeg: 2, angle: 0.5 });
    expect(host.materializePersistentPlaceable(utility, 12, 10, 0.5, 'owner', 1)?.rotationSpeedDegPerSec).toBeUndefined();
  });
});

function createPlacementOnGrid(rockGrid: RockGridIndex): PlacementSystem {
  return new PlacementSystem(layout, rockGrid, noPlayers, resolveActiveArenaWorldMetrics());
}

function world(gridX: number, gridY: number): { x: number; y: number } {
  return {
    x: ARENA_OFFSET_X + CELL_SIZE * (gridX + 0.5),
    y: ARENA_OFFSET_Y + CELL_SIZE * (gridY + 0.5),
  };
}

function placeRocketAt(placement: PlacementSystem, gridX: number, gridY: number) {
  const origin = world(gridX - 1, gridY);
  const target = world(gridX, gridY);
  return placement.tryPlaceConstruction(
    COOP_DEFENSE_CONSTRUCTIONS.rocket_turret,
    250,
    'inspector',
    0x52d273,
    origin.x,
    origin.y,
    target.x,
    target.y,
  );
}

function blueprint(
  persistentId: string,
  kind: 'construction' | 'utility',
  id: string,
  relativeGridX: number,
  relativeGridY: number,
  placementOrder: number,
) {
  return {
    persistentId,
    tool: { kind, id },
    relativeGridX,
    relativeGridY,
    angle: 0,
    placementOrder,
  } as const;
}

describe('PlacementSystem Coop-Defense base collision contract', () => {
  it('gibt Runtime-Zellen vor einem LobbyWorld-Reinstance vollstaendig frei', () => {
    const sharedGrid = new RockGridIndex(layout.rocks);
    const coopPlacement = createPlacementOnGrid(sharedGrid);
    expect(placeRocketAt(coopPlacement, 11, 10)).toMatchObject({ gridX: 11, gridY: 10 });

    expect(coopPlacement.clearRuntimeRocks()).toHaveLength(1);
    expect(coopPlacement.getAllRuntimeRocks()).toEqual([]);

    // Der Fast-Reinstance baut auf demselben authored Grid eine neue Placement-Runtime auf.
    const rebuiltCoopPlacement = createPlacementOnGrid(sharedGrid);
    expect(placeRocketAt(rebuiltCoopPlacement, 11, 10)).toMatchObject({ gridX: 11, gridY: 10 });
  });

  it('blocks Inspector construction on exact base cells and allows a free adjacent cell', () => {
    const placement = createPlacement([
      makeBase('main', [{ gridX: 10, gridY: 10 }]),
    ]);

    expect(placement.canPlaceSingleCell(10, 10)).toBe(false);
    expect(placeRocketAt(placement, 10, 10)).toBeNull();
    expect(placement.canPlaceSingleCell(11, 10)).toBe(true);
    expect(placeRocketAt(placement, 11, 10)).toMatchObject({ gridX: 11, gridY: 10 });
  });

  it('rejects a multi-cell footprint when only one footprint cell overlaps a base', () => {
    const placement = createPlacement([
      makeBase('main', [{ gridX: 10, gridY: 10 }]),
    ]);
    const twoCellFootprint = [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }] as const;

    expect(placement.canMaterializeCells(twoCellFootprint, 9, 10)).toBe(false);
    // Exact cells only: the adjacent two-cell footprint is not rejected by the base's region.
    expect(placement.canMaterializeCells(twoCellFootprint, 8, 10)).toBe(true);
  });

  it('blocks permanent Coop-Defense utility placeables on exact base cells', () => {
    const placement = createPlacement([
      makeBase('main', [{ gridX: 10, gridY: 10 }]),
    ]);
    const utility = getUtilityConfigForMode('ROCK_BARRIER', 'coop_defense');
    if (!utility || utility.type !== 'placeable_rock') throw new Error('ROCK_BARRIER_COOP is not a rock utility');

    expect(utility.placeable.lifetimeMs).toBe(0);
    const origin = world(9, 10);
    const baseCell = world(10, 10);
    const adjacentCell = world(11, 10);
    expect(placement.tryPlaceRock(
      utility,
      'inspector',
      0x52d273,
      origin.x,
      origin.y,
      baseCell.x,
      baseCell.y,
      0,
    )).toBeNull();
    expect(placement.tryPlaceRock(
      utility,
      'inspector',
      0x52d273,
      origin.x,
      origin.y,
      adjacentCell.x,
      adjacentCell.y,
      0,
    )).toMatchObject({ gridX: 11, gridY: 10 });
  });

  it('considers every supplied base and has no base collision outside Coop-Defense', () => {
    const placement = createPlacement([
      makeBase('main', [{ gridX: 10, gridY: 10 }]),
      makeBase('outpost', [{ gridX: 14, gridY: 10 }], 'outpost'),
    ]);

    expect(placement.canPlaceSingleCell(10, 10)).toBe(false);
    expect(placement.canPlaceSingleCell(14, 10)).toBe(false);
    expect(placement.canPlaceSingleCell(11, 10)).toBe(true);

    const withoutBases = createPlacement();
    expect(withoutBases.canPlaceSingleCell(10, 10)).toBe(true);
    expect(placeRocketAt(withoutBases, 10, 10)).toMatchObject({ gridX: 10, gridY: 10 });
  });

  it('uses the same central contract for materialization and restore planning', () => {
    const placement = createPlacement([
      makeBase('main', [{ gridX: 10, gridY: 10 }]),
    ]);
    const tools: readonly PersistentRestoreToolDefinition[] = [
      {
        kind: 'construction',
        id: 'rocket_turret',
        footprint: [{ dx: 0, dy: 0 }],
        capacityCost: 4,
        maxHp: 250,
        unlocked: true,
      },
      {
        kind: 'utility',
        id: 'ROCK_BARRIER',
        footprint: [{ dx: 0, dy: 0 }, { dx: 1, dy: 0 }],
        capacityCost: 3,
        maxHp: 200,
        unlocked: true,
      },
    ];
    const state: PersistentBaseState = {
      schemaVersion: PERSISTENT_BASE_STATE_SCHEMA_VERSION,
      revision: 3,
      constructions: [
        blueprint('base-cell', 'construction', 'rocket_turret', 0, 0, 0),
        blueprint('crossing-footprint', 'utility', 'ROCK_BARRIER', -1, 0, 1),
        blueprint('adjacent-cell', 'construction', 'rocket_turret', 1, 0, 2),
      ],
    };
    const materializeCheck = vi.spyOn(placement, 'canMaterializeCells');
    const toolsById = new Map(tools.map((tool) => [tool.id, tool] as const));
    const result = mergePersistentBaseComposite({
      anchor: { gridX: 10, gridY: 10 },
      buildArea: { kind: 'radius', radiusCells: 5 },
      hostContribution: {
        schemaVersion: 1,
        ownerId: 'owner-host',
        revision: state.revision,
        constructions: state.constructions,
      },
      resolveTool: (_ownerId, toolId) => {
        const tool = toolsById.get(toolId);
        return tool ? { footprint: tool.footprint, capacityCost: tool.capacityCost } : null;
      },
      isCellBlocked: (gridX, gridY) => !placement.canMaterializeCells(
        [{ dx: 0, dy: 0 }],
        gridX,
        gridY,
      ),
    });

    expect(materializeCheck).toHaveBeenCalled();
    expect(result.active.map((entry) => entry.blueprint.persistentId)).toEqual(['adjacent-cell']);
    expect(result.conflicts.map((entry) => [entry.persistentId, entry.reason])).toEqual([
      ['base-cell', 'authored-collision'],
      ['crossing-footprint', 'authored-collision'],
    ]);
    // Der Merge laesst den Besitz unangetastet; ein Konflikt loescht keinen Blueprint.
    expect(state.constructions).toHaveLength(3);

    expect(placement.materializePersistentPlaceable(
      COOP_DEFENSE_CONSTRUCTIONS.rocket_turret,
      10,
      10,
      0,
      'inspector',
      0x52d273,
    )).toBeNull();
    expect(placement.materializePersistentPlaceable(
      COOP_DEFENSE_CONSTRUCTIONS.rocket_turret,
      11,
      10,
      0,
      'inspector',
      0x52d273,
    )).toMatchObject({ gridX: 11, gridY: 10 });
  });

  it('allows only the explicit reward path on all twelve surface cells without capacity or collision', () => {
    const anchor = { gridX: 20, gridY: 20 };
    const core = resolvePersistentBaseCoreCells(anchor);
    const surface = core.filter((cell) => cell.domain === 'base-surface');
    expect(surface).toHaveLength(12);
    const placement = createPlacement([
      makeBase('main', core.map((cell) => ({
        gridX: cell.gridX,
        gridY: cell.gridY,
      }))),
    ]);

    for (const cell of surface) {
      expect(placement.canPlaceSingleCell(cell.gridX, cell.gridY)).toBe(false);
      expect(placement.canMaterializePersistentBaseRewardCell(cell.gridX, cell.gridY)).toBe(true);
    }

    const first = surface[0]!;
    const runtime = placement.materializePersistentBaseReward(
      COOP_DEFENSE_CONSTRUCTIONS.spore_turret,
      'base_spore_turret',
      first.gridX,
      first.gridY,
      0,
      COOP_DEFENSE_BASE_TURRET_OWNER_ID,
      0x52d273,
    );
    expect(runtime).toMatchObject({
      ownership: 'base-owned',
      persistentRewardId: 'base_spore_turret',
      collisionMode: 'none',
      indestructible: true,
    });
    expect(placement.getRuntimeRockAt(first.gridX, first.gridY)).toMatchObject({
      persistentRewardId: 'base_spore_turret',
    });
  });
});
