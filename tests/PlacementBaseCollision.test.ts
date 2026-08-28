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
import type { PlayerManager } from '../src/entities/PlayerManager';
import { getUtilityConfigForMode } from '../src/loadout/LoadoutConfig';
import type { PersistentRestoreToolDefinition } from '../src/persistentBase/PersistentBaseTools';
import { mergePersistentBaseComposite } from '../src/persistentBase/PersistentBaseComposite';
import type { PersistentBaseState } from '../src/persistentBase/PersistentBaseTypes';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
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
      radiusCells: 5,
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
});
