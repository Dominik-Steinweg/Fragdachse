import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { createFakePhaserModule } = await import('./fakeArenaRenderScene');
  return {
    ...createFakePhaserModule(),
    Scenes: { Events: { POST_UPDATE: 'postupdate' } },
  };
});

import { AutoTiler, ROCK_AUTOTILE } from '../src/arena/AutoTiler';
import { resolveBlobSurfaceCornerTints } from '../src/arena/BlobSurfaceShading';
import { ROCK_BLOB_SURFACE_PROFILE } from '../src/arena/BlobSurfaceProfile';
import { RockGridIndex } from '../src/arena/RockGridIndex';
import { CELL_SIZE, GRID_COLS, GRID_ROWS } from '../src/config';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { ArenaLayout, SyncedPlaceableRock } from '../src/types';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import { RockVisualHelper } from '../src/scenes/arena/RockVisualHelper';
import type { ArenaBuilderResult } from '../src/arena/ArenaBuilder';
import { RockVisualStateStore } from '../src/arena/rocks/RockVisualState';

const OWNER_ID = 'client-owner';
const OWNER_COLOR = 0x52d273;
const ROCK_COORDINATES = [
  { gridX: 10, gridY: 10 },
  { gridX: 11, gridY: 10 },
  { gridX: 12, gridY: 10 },
] as const;

function makeSnapshot(order: readonly number[]): SyncedPlaceableRock[] {
  return order.map((index) => {
    const cell = ROCK_COORDINATES[index];
    return {
      id: index,
      kind: 'rock',
      gridX: cell.gridX,
      gridY: cell.gridY,
      hp: 200,
      maxHp: 200,
      ownerId: OWNER_ID,
      ownerColor: OWNER_COLOR,
      expiresAt: 0,
      warningStartsAt: 0,
      angle: 0,
      constructionId: 'rock_barrier',
      ownership: 'base-owned',
      toolRef: { kind: 'utility', id: 'ROCK_BARRIER' },
    };
  });
}

function makeLayout(): ArenaLayout {
  return {
    seed: 1,
    rocks: [],
    trees: [],
    tracks: [],
    dirt: [],
    powerUpPedestals: [],
  };
}

function createFixture(order: readonly number[], materialize = true) {
  const layout = makeLayout();
  const placement = new PlacementSystem(
    layout,
    new RockGridIndex(layout.rocks),
    { getAllPlayers: () => [] } as never,
    [],
  );
  const snapshot = makeSnapshot(order);
  const changes = placement.syncFromSnapshot(snapshot);
  const rockVisualStates = new RockVisualStateStore();
  let postUpdate: (() => void) | undefined;
  const events = {
    once: vi.fn((_event: string, callback: () => void) => {
      postUpdate = callback;
      return events;
    }),
  };
  const scene = {
    events,
    textures: { exists: () => true },
    game: { events: { emit: vi.fn() } },
  };
  const rockGroup = {
    add: vi.fn((proxy: { body: unknown }) => {
      proxy.body = { updateFromGameObject: vi.fn() };
      return rockGroup;
    }),
    remove: vi.fn(),
  };
  const rockOverlaySurface = {
    refreshAll: vi.fn(),
    refreshRegions: vi.fn(),
  };
  const result = {
    rockPhysicsProxies: [],
    rockVisualStates,
    rockGroup,
    rockGrid: new RockGridIndex([], { cols: GRID_COLS, rows: GRID_ROWS }),
    rockOverlaySurface,
  } as unknown as ArenaBuilderResult;
  const shadowSystem = {
    rebuildArenaStaticShadows: vi.fn(),
    rebuildArenaStaticShadowRegions: vi.fn(),
  };
  const runtimeRocks = new Map(changes.added.map((rock) => [rock.id, rock]));
  const ctx = {
    arenaResult: result,
    currentLayout: layout,
    placementSystem: {
      getRuntimeRock: (id: number) => runtimeRocks.get(id),
      getAllRuntimeRocks: () => [...runtimeRocks.values()],
    },
    combatSystem: { invalidateObstacleIndex: vi.fn() },
    gameAudioSystem: { playSound: vi.fn() },
    lightOccluderIndex: { markDirty: vi.fn() },
    visualFeedback: { camera: { request: vi.fn() } },
  };
  const helper = new RockVisualHelper(
    scene as never,
    ctx as never,
    shadowSystem as never,
    {} as never,
  );

  if (materialize) helper.materializePlaceableRockBatch(changes.added, false);
  return {
    changes,
    helper,
    placement,
    result,
    rockOverlaySurface,
    shadowSystem,
    ctx,
    flushPostUpdate: () => postUpdate?.(),
  };
}

function expectedState(
  result: ArenaBuilderResult,
  layout: ArenaLayout,
  id: number,
): { frame: number; cornerTints: readonly [number, number, number, number] } {
  const cell = layout.rocks[id];
  const isOccupied = (gridX: number, gridY: number) => result.rockGrid.isOccupiedWithBorder(gridX, gridY);
  return {
    frame: AutoTiler.getFrame(
      AutoTiler.computeMask(cell.gridX, cell.gridY, isOccupied),
      ROCK_AUTOTILE,
    ),
    cornerTints: resolveBlobSurfaceCornerTints(
      ROCK_BLOB_SURFACE_PROFILE,
      cell.gridX,
      cell.gridY,
      isOccupied,
    ),
  };
}

describe('RockVisualHelper client snapshot materialization', () => {
  it('materializes adjacent rock_barrier snapshot additions from one complete grid', () => {
    const fixture = createFixture([0, 1, 2]);
    const ownerTintStrength = UTILITY_CONFIGS.ROCK_BARRIER.placeable.ownerTintStrength;

    for (const rock of fixture.changes.added) {
      const state = fixture.result.rockVisualStates.get(rock.id);
      expect(state).toMatchObject({
        active: true,
        alpha: 1,
        ownerColor: OWNER_COLOR,
        ownerTintStrength,
      });
      expect(state?.frame).toBe(expectedState(fixture.result, makeLayoutWithRocks(fixture.changes.added), rock.id).frame);
      expect(state?.cornerTints).toEqual(
        expectedState(fixture.result, makeLayoutWithRocks(fixture.changes.added), rock.id).cornerTints,
      );
      expect(fixture.result.rockGrid.getIndex(rock.gridX, rock.gridY)).toBe(rock.id);
      expect(fixture.placement.getRuntimeRock(rock.id)).toBeDefined();
    }

    fixture.flushPostUpdate();
    expect(fixture.rockOverlaySurface.refreshAll).not.toHaveBeenCalled();
    expect(fixture.rockOverlaySurface.refreshRegions).toHaveBeenCalledTimes(1);
    expect(fixture.shadowSystem.rebuildArenaStaticShadows).not.toHaveBeenCalled();
    expect(fixture.shadowSystem.rebuildArenaStaticShadowRegions).toHaveBeenCalledTimes(1);
    expect(fixture.ctx.combatSystem.invalidateObstacleIndex).toHaveBeenCalledTimes(1);
  });

  it('is independent of snapshot order', () => {
    const forward = createFixture([0, 1, 2]);
    const reverse = createFixture([2, 1, 0]);

    for (const id of [0, 1, 2]) {
      const left = forward.result.rockVisualStates.get(id);
      const right = reverse.result.rockVisualStates.get(id);
      expect(right).toMatchObject({
        active: left?.active,
        alpha: left?.alpha,
        frame: left?.frame,
        cornerTints: left?.cornerTints,
        ownerColor: left?.ownerColor,
        ownerTintStrength: left?.ownerTintStrength,
      });
    }
  });

  it('keeps a normal single placement on the same materialization path', () => {
    const fixture = createFixture([0], false);
    const rock = fixture.changes.added[0];
    fixture.helper.materializePlaceableRock(rock, false);
    const state = fixture.result.rockVisualStates.get(rock.id);

    expect(state?.active).toBe(true);
    expect(state?.alpha).toBe(1);
    expect(fixture.result.rockGrid.getIndex(rock.gridX, rock.gridY)).toBe(rock.id);
    expect(fixture.result.rockPhysicsProxies[rock.id]?.active).toBe(true);
  });
});

function makeLayoutWithRocks(rocks: readonly SyncedPlaceableRock[]): ArenaLayout {
  const layout = makeLayout();
  layout.rocks = rocks
    .slice()
    .sort((left, right) => left.id - right.id)
    .map(({ gridX, gridY }) => ({ gridX, gridY }));
  return layout;
}
