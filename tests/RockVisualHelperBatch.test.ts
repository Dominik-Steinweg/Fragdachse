import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/network/bridge', () => ({ bridge: { isHost: () => false, getLocalPlayerId: () => 'other-player' } }));

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
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
import { FakeImage } from './fakeArenaRenderScene';

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
  const turretObjects: FakeImage[] = [];
  const visual = (x: number, y: number, texture: string) => {
    const image = Object.assign(new FakeImage(texture, x, y), {
      visible: true,
      setBlendMode() { return this; },
      setTexture(key: string) { this.key = key; return this; },
      setVisible(visible: boolean) { this.visible = visible; return this; },
    });
    turretObjects.push(image);
    return image;
  };
  const scene = {
    add: { image: visual, sprite: visual },
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
  const combatCore = { invalidateObstacleIndex: vi.fn() };
  const ctx = {
    arenaResult: result,
    currentLayout: layout,
    placementSystem: {
      getRuntimeRock: (id: number) => runtimeRocks.get(id),
      getAllRuntimeRocks: () => [...runtimeRocks.values()],
    },
    getWorldCombatCore: () => combatCore,
    gameAudioSystem: { playSound: vi.fn() },
    lightOccluderIndex: { markDirty: vi.fn() },
    visualFeedback: { camera: { request: vi.fn() } },
  };
  const helper = new RockVisualHelper(
    scene as never,
    ctx as never,
    shadowSystem as never,
    {} as never,
    null,
    {
      getWorldRuntime: () => ({
        context: { metrics: resolveActiveArenaWorldMetrics() },
        materialization: {
          arena: result,
          placement: ctx.placementSystem,
          rocks: null,
          lightOccluders: ctx.lightOccluderIndex,
        },
        presentation: { layout },
      } as never),
      getTargetingRuntime: () => null,
      getPlayerGameplayRuntime: () => null,
      getPowerUpRuntime: () => null,
    },
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
    turretObjects,
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
  it('keeps drone station placement and integrity updates free of turret sprites', () => {
    const f = createFixture([0], false);
    const station = f.changes.added[0];
    Object.assign(station, { kind: 'drone_station', constructionId: 'attack_drone_station',
      toolRef: { kind: 'construction', id: 'attack_drone_station' } });

    f.helper.materializePlaceableRock(station, false);
    f.helper.updateRockVisualById(station.id, station.maxHp / 2);
    f.helper.materializePlaceableRock(station, false);
    f.helper.updateRockVisualById(station.id, station.maxHp);
    f.helper.createOrUpdateTurretVisual(station);
    expect(f.result.rockPhysicsProxies[station.id]?.active).toBe(true);
    expect(f.result.rockVisualStates.get(station.id)?.active).toBe(true);
    expect(f.turretObjects).toHaveLength(0);

    f.helper.removePlaceableRockVisual(station, false);
    expect(f.result.rockPhysicsProxies[station.id]?.active).not.toBe(true);
    expect(f.result.rockVisualStates.get(station.id)?.active).not.toBe(true);
    expect(f.turretObjects).toHaveLength(0);
  });

  it('renders actual turrets and releases their artifacts by runtime ID even after a kind change', () => {
    const f = createFixture([0], false);
    const turret = f.changes.added[0];
    Object.assign(turret, { kind: 'turret', constructionId: 'spore_turret', turretWeaponId: 'TURRET_SPORES' });
    f.helper.materializePlaceableRock(turret, false);
    expect(f.turretObjects.some(image => image.active && image.key === 'turret_weapon_spore')).toBe(true);

    // Reproduce an obsolete turret projection attached to a station's runtime ID.
    const station: SyncedPlaceableRock = { ...turret, kind: 'drone_station',
      constructionId: 'attack_drone_station', turretWeaponId: undefined };
    f.helper.removePlaceableRockVisual(station, false);
    expect(f.turretObjects.every(image => !image.active)).toBe(true);
  });

  it('sounds only confirmed new placements, never initial snapshots, restoration or repeated materialization', () => {
    const f = createFixture([0, 1, 2], false);
    // GPU dust allocation is unrelated to admission of the placement audio.
    vi.spyOn(f.helper as any, 'playRockDustBurst').mockImplementation(() => {});
    const [initial, restored, placed] = f.changes.added;
    initial.placementConfirmed = true;
    placed.placementConfirmed = true;
    f.helper.materializePlaceableRockBatch([initial], true, false);
    f.helper.materializePlaceableRockBatch([restored], true);
    expect(f.ctx.gameAudioSystem.playSound).not.toHaveBeenCalled();
    f.helper.materializePlaceableRockBatch([placed], true);
    f.helper.materializePlaceableRockBatch([initial, restored, placed], true);
    expect(f.ctx.gameAudioSystem.playSound).toHaveBeenCalledExactlyOnceWith('sfx_place_rock', expect.any(Number), expect.any(Number), OWNER_ID);
  });
  it('materializes adjacent rock_barrier snapshot additions from one complete grid', () => {
    const fixture = createFixture([0, 1, 2]);

    for (const rock of fixture.changes.added) {
      const state = fixture.result.rockVisualStates.get(rock.id);
      expect(state).toMatchObject({
        active: true,
        alpha: 1,
        ownerColor: OWNER_COLOR,
        ownerTintStrength: 0,
        material: 'walls',
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
    expect(fixture.ctx.getWorldCombatCore()!.invalidateObstacleIndex).toHaveBeenCalledTimes(1);
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

  it.each(['base-owned', 'guest-session'] as const)('keeps %s walls neutral and light through HP updates', (ownership) => {
    const fixture = createFixture([0], false);
    const rock = fixture.changes.added[0];
    rock.ownership = ownership;
    fixture.helper.materializePlaceableRock(rock, false);
    fixture.helper.updateRockVisualById(rock.id, rock.maxHp / 2);
    expect(fixture.result.rockVisualStates.get(rock.id)).toMatchObject({
      material: 'walls', ownerTintStrength: 0, ownerColor: OWNER_COLOR,
    });
  });

  it('preserves configured owner tint for temporary utility rocks', () => {
    const fixture = createFixture([0], false);
    const rock = fixture.changes.added[0];
    delete rock.constructionId;
    fixture.helper.materializePlaceableRock(rock, false);
    fixture.helper.updateRockVisualById(rock.id, rock.maxHp / 2);
    expect(fixture.result.rockVisualStates.get(rock.id)).toMatchObject({
      ownerColor: OWNER_COLOR,
      ownerTintStrength: UTILITY_CONFIGS.ROCK_BARRIER.placeable.ownerTintStrength,
    });
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
