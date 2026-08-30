import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { createFakePhaserModule } = await import('./fakeArenaRenderScene');
  return createFakePhaserModule();
});

import { ArenaLifecycleCoordinator } from '../src/scenes/arena/ArenaLifecycleCoordinator';
import { RockGridIndex } from '../src/arena/RockGridIndex';
import { LOBBY_WORLD_DEFINITION_ID } from '../src/config/authoring/lobbyWorld';
import { COOP_DEFENSE_MODE } from '../src/gameModes';
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { bridge } from '../src/network/bridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import {
  DEFAULT_PERSISTENT_BASE_BUILD_AREA,
  resolvePersistentBaseCell,
} from '../src/persistentBase/PersistentBaseCore';
import {
  grantStoredPersistentBaseRewards,
  invalidateLocalStorageCache,
} from '../src/utils/localPreferences';
import { PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION } from '../src/config/persistentBase';
import { PersistentBaseContributionStore } from '../src/persistentBase/PersistentBaseContributionStore';
import { PersistentBaseRewardStore } from '../src/persistentBase/PersistentBaseRewardStore';
import { PersistentBaseRewardGrantService } from '../src/persistentBase/PersistentBaseRewardGrant';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import { getCoopDefenseConstructionDefinition } from '../src/config/coopDefenseConstructions';
import { createAuthoredWorldDescriptor } from '../src/world/WorldLayout';
import { resolveActiveArenaWorldMetrics, worldCellCenter } from '../src/world/WorldMetrics';
import type { ArenaLayout, SyncedPlaceableRock } from '../src/types';
import type { WorldPersistentBaseSite } from '../src/world/WorldRuntimeContext';
import { FakeNetwork, createHostRoom, type TestRoom } from './fakePeerNetwork';

const WORLD_REVISION = 911;
const ANCHOR = { gridX: 20, gridY: 20 } as const;
const METRICS = resolveActiveArenaWorldMetrics();

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

let hostRoom: TestRoom;

beforeAll(async () => {
  hostRoom = await createHostRoom(new FakeNetwork());
  setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'PB3F3' });
  bridge.activate();
});

afterAll(() => {
  hostRoom.room.leave();
  clearActiveSession();
});

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: new MemoryStorage() });
  invalidateLocalStorageCache();
  grantStoredPersistentBaseRewards(['base_health_pedestal']);
  setActiveSession({ room: hostRoom.room, transport: hostRoom.transport, roomCode: 'PB3F3' });
  bridge.publishWorldAndActivity(
    createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, WORLD_REVISION),
    null,
  );
});

afterEach(() => {
  invalidateLocalStorageCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function testSite(): WorldPersistentBaseSite {
  return {
    baseId: 'persistent-main',
    base: {
      id: 'persistent-main',
      cells: [],
      region: {} as never,
      hpMax: 1_000,
      faction: 'friendly',
      role: 'main',
      turrets: [],
      powerUpPedestals: [],
    },
    anchor: { ...ANCHOR },
    orientation: 'open-left',
    areaStage: 0,
    buildArea: DEFAULT_PERSISTENT_BASE_BUILD_AREA,
  };
}

/** Absolute Weltzelle einer kanonischen Reward-Offsetkoordinate der Testbasis. */
function rewardCell(relativeGridX: number, relativeGridY: number): { gridX: number; gridY: number } {
  const cell = resolvePersistentBaseCell(
    ANCHOR,
    relativeGridX,
    relativeGridY,
    'open-left',
    DEFAULT_PERSISTENT_BASE_BUILD_AREA,
  );
  if (!cell) throw new Error('setup failed: relative cell is outside the canonical base');
  return { gridX: cell.gridX, gridY: cell.gridY };
}

function makeLayout(): ArenaLayout {
  return { seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [] };
}

function createHarness(classId: string) {
  const site = testSite();
  const layout = makeLayout();
  const placementSystem = new PlacementSystem(
    layout,
    new RockGridIndex(layout.rocks),
    { getAllPlayers: () => [] } as never,
    METRICS,
  );
  const contributionStore = new PersistentBaseContributionStore();
  const rewardStore = new PersistentBaseRewardStore();
  const loadoutManager = new LoadoutManager();
  const playerId = bridge.getLocalPlayerId();
  const playerCell = rewardCell(0, 0);
  const playerWorld = worldCellCenter(METRICS, playerCell.gridX, playerCell.gridY);
  const player = { id: playerId, active: true, x: playerWorld.x, y: playerWorld.y, color: 0xffffff };

  vi.spyOn(bridge, 'getPlayerCurrentLoadoutSnapshot').mockReturnValue({ coopDefenseClassId: classId } as never);

  const coordinator = Object.create(ArenaLifecycleCoordinator.prototype) as ArenaLifecycleCoordinator & Record<string, any>;
  Object.assign(coordinator, {
    scene: { game: { events: { emit: vi.fn() } } },
    ctx: {
      world: { persistentBaseSite: site, definition: { sourceMapId: 'management-test' } },
      persistentBaseContributions: contributionStore,
      persistentBaseRewards: rewardStore,
      placementSystem,
      loadoutManager,
      playerManager: { getPlayer: () => player },
      combatSystem: { isAlive: () => true, isBurrowed: () => false },
      gameAudioSystem: { playSound: vi.fn() },
      powerUpSystem: { repositionPersistentBaseRewardPedestal: vi.fn(() => true), repositionConstructionPedestal: vi.fn(() => true) },
      targetStatusSystem: null,
      energyInjectorSystem: null,
    },
    rockVisualHelper: {
      gridToWorld: (gridX: number, gridY: number) => worldCellCenter(METRICS, gridX, gridY),
      materializePlaceableRock: vi.fn(),
      removePlaceableRockVisual: vi.fn(),
    },
    persistentBaseRewardRuntimeBindings: new Map(),
    persistentBaseCompositeBuildSignatures: new Map(),
    persistentBaseOwnerByPlayerId: new Map(),
    persistentBaseRewardSessionSignature: null,
    persistentBaseRewardSessionRevision: 0,
    persistentBaseRewardGrantService: new PersistentBaseRewardGrantService(),
  });
  coordinator.resolveConfiguredGameMode = () => COOP_DEFENSE_MODE;
  coordinator.getPlayerCapabilities = () => ({ canPlace: true, canDismantle: true, canInteract: true } as never);
  coordinator.hostRefreshPersistentBaseComposite = vi.fn();
  coordinator.persistCurrentCommittedPersistentBaseRewards = vi.fn();
  coordinator.publishPersistentBaseRewardSessionState = vi.fn();
  coordinator.publishImmediatePersistentBaseContribution = vi.fn();

  return { coordinator, contributionStore, rewardStore, placementSystem, loadoutManager, playerId, site };
}

/** Platziert das Health-Podest im Store und materialisiert seine Runtime an derselben Zelle. */
function placeRewardPedestal(
  harness: ReturnType<typeof createHarness>,
  relativeGridX: number,
  relativeGridY: number,
): SyncedPlaceableRock {
  const { coordinator, rewardStore, placementSystem } = harness;
  expect(rewardStore.placeReward({
    rewardId: 'base_health_pedestal',
    relativeGridX,
    relativeGridY,
    angle: 0,
  })).toBe(true);
  const cell = rewardCell(relativeGridX, relativeGridY);
  const runtime = placementSystem.materializePersistentBaseRewardPedestal(
    'base_health_pedestal',
    cell.gridX,
    cell.gridY,
    0,
    'base',
    0xffffff,
  );
  if (!runtime) throw new Error('setup failed: reward pedestal was not materialized');
  coordinator.persistentBaseRewardRuntimeBindings.set('base_health_pedestal', {
    runtimeId: runtime.id,
    gridX: runtime.gridX,
    gridY: runtime.gridY,
  });
  return runtime;
}

function moveRequest(
  source: SyncedPlaceableRock,
  target: { gridX: number; gridY: number },
  overrides: Record<string, number> = {},
) {
  return {
    worldRevision: WORLD_REVISION,
    sourceRuntimeId: source.id,
    sourceGridX: source.gridX,
    sourceGridY: source.gridY,
    targetGridX: target.gridX,
    targetGridY: target.gridY,
    ...overrides,
  };
}

describe('Base-Reward-Verwaltung durch alle Coop-Klassen', () => {
  it('bietet unplatzierte Rewards auch ohne Inspector-Klasse an', () => {
    const { coordinator, playerId } = createHarness('assault_dachs');

    expect(coordinator.getPersistentBaseRewardIdsForPlayer(playerId)).toEqual(['base_health_pedestal']);
  });

  it('zeigt ein bereits platziertes Reward nicht mehr als Placement-Aktion, ein zurueckgebautes wieder', () => {
    const { coordinator, rewardStore, playerId } = createHarness('assault_dachs');

    expect(rewardStore.placeReward({
      rewardId: 'base_health_pedestal', relativeGridX: 0, relativeGridY: 0, angle: 0,
    })).toBe(true);
    expect(coordinator.getPersistentBaseRewardIdsForPlayer(playerId)).toEqual([]);

    // Nach dem Rueckbau haengt die Platzierbarkeit nur noch am aktuellen Placement-State.
    expect(rewardStore.dismantleReward('base_health_pedestal')).toBe(true);
    expect(coordinator.getPersistentBaseRewardIdsForPlayer(playerId)).toEqual(['base_health_pedestal']);
  });

  it('verschiebt ein Base-Reward-Podest atomar und erhaelt seinen Runtime- und Podestzustand', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, rewardStore, placementSystem, playerId } = harness;
    const source = placeRewardPedestal(harness, 0, 0);
    const target = rewardCell(1, 1);

    const result = coordinator.movePersistentBaseObject(playerId, moveRequest(source, target));

    expect(result).toEqual({ ok: true });
    expect(rewardStore.getState().placements).toEqual([
      expect.objectContaining({
        rewardId: 'base_health_pedestal',
        relativeGridX: 1,
        relativeGridY: 1,
      }),
    ]);
    // Dieselbe Runtime, nur an einer anderen Zelle: kein Rueckbau und kein Neubau.
    expect(placementSystem.getRuntimeRock(source.id)).toMatchObject({
      id: source.id,
      gridX: target.gridX,
      gridY: target.gridY,
      persistentRewardId: 'base_health_pedestal',
    });
    expect(placementSystem.getRuntimeRockAt(source.gridX, source.gridY)).toBeUndefined();
    expect(placementSystem.getAllRuntimeRocks()).toHaveLength(1);
    expect(coordinator.persistentBaseRewardRuntimeBindings.get('base_health_pedestal')).toEqual({
      runtimeId: source.id,
      gridX: target.gridX,
      gridY: target.gridY,
    });
    const powerUpSystem = coordinator.ctx.powerUpSystem;
    expect(powerUpSystem.repositionPersistentBaseRewardPedestal).toHaveBeenCalledTimes(1);
    expect(powerUpSystem.unregisterPersistentBaseRewardPedestal).toBeUndefined();
    // Das Composite wird genau einmal gegen den neuen Zustand aufgeloest.
    expect(coordinator.hostRefreshPersistentBaseComposite).toHaveBeenCalledTimes(1);
  });

  it('schuetzt aufeinanderfolgende Moves mit 100 ms und laesst die Quelle dabei unveraendert', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, placementSystem, loadoutManager, playerId } = harness;
    const source = placeRewardPedestal(harness, 0, 0);
    const firstTarget = rewardCell(1, 1);
    vi.spyOn(Date, 'now').mockReturnValue(5_000);

    expect(coordinator.movePersistentBaseObject(playerId, moveRequest(source, firstTarget)))
      .toEqual({ ok: true });
    expect(loadoutManager.getManagementActionCooldownUntil(playerId, 'reposition')).toBe(5_100);

    const moved = placementSystem.getRuntimeRock(source.id)!;
    const secondTarget = rewardCell(-1, 1);
    expect(coordinator.movePersistentBaseObject(playerId, moveRequest(moved, secondTarget)))
      .toEqual({ ok: false, reason: 'cooldown' });
    expect(placementSystem.getRuntimeRock(source.id)).toMatchObject({
      gridX: firstTarget.gridX,
      gridY: firstTarget.gridY,
    });

    vi.spyOn(Date, 'now').mockReturnValue(5_100);
    expect(coordinator.movePersistentBaseObject(playerId, moveRequest(moved, secondTarget)))
      .toEqual({ ok: true });
  });

  it('lehnt eine Anfrage ab, deren Quelle inzwischen woanders steht', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, rewardStore, placementSystem, playerId } = harness;
    const source = placeRewardPedestal(harness, 0, 0);
    const first = rewardCell(1, 1);
    vi.spyOn(Date, 'now').mockReturnValue(9_000);
    expect(coordinator.movePersistentBaseObject(playerId, moveRequest(source, first))).toEqual({ ok: true });

    // Zweite Anfrage haelt noch die alte Quellzelle: first valid host-accepted mutation wins.
    vi.spyOn(Date, 'now').mockReturnValue(9_500);
    const stale = coordinator.movePersistentBaseObject(playerId, moveRequest(source, rewardCell(-1, 1)));
    expect(stale).toEqual({ ok: false, reason: 'blocked' });
    expect(rewardStore.getState().placements).toEqual([
      expect.objectContaining({
        rewardId: 'base_health_pedestal',
        relativeGridX: 1,
        relativeGridY: 1,
      }),
    ]);
    expect(placementSystem.getRuntimeRock(source.id)).toMatchObject({
      gridX: first.gridX,
      gridY: first.gridY,
    });
  });

  it('verdraengt beim Move nur die Runtime einer persoenlichen Konstruktion, nie ihren Blueprint', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, contributionStore, placementSystem, playerId } = harness;
    const source = placeRewardPedestal(harness, 0, 0);
    const target = rewardCell(1, 1);
    const personal = placementSystem.materializePersistentPlaceable(
      getCoopDefenseConstructionDefinition('rock_barrier'),
      target.gridX,
      target.gridY,
      0,
      playerId,
      0xffffff,
      'host-persistent',
    )!;
    const blueprint = {
      persistentId: 'pb-owner-a-1-0',
      tool: { kind: 'construction', id: 'rock_barrier' } as const,
      relativeGridX: 1,
      relativeGridY: 1,
      angle: 0,
      placementOrder: 0,
    };
    contributionStore.offerContribution({
      schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
      ownerId: 'owner-a',
      revision: 1,
      constructions: [blueprint],
    });
    contributionStore.registerRestored('owner-a', blueprint, personal.id);

    expect(coordinator.movePersistentBaseObject(playerId, moveRequest(source, target)))
      .toEqual({ ok: true });

    // Der Reward steht allein auf der Zielzelle; die verdraengte Runtime ist fort.
    expect(placementSystem.getRuntimeRockAt(target.gridX, target.gridY)?.id).toBe(source.id);
    expect(placementSystem.getRuntimeRock(personal.id)).toBeUndefined();
    // Ein Konflikt loescht keinen Besitz: Der Blueprint bleibt vollstaendig gespeichert.
    expect(contributionStore.getContribution('owner-a')?.constructions).toEqual([blueprint]);
    expect(contributionStore.getRuntimeBindings()).toEqual([]);
    // Genau ein Composite-Lauf loest den neuen Zustand auf, inklusive der freigewordenen Quelle.
    expect(coordinator.hostRefreshPersistentBaseComposite).toHaveBeenCalledTimes(1);
  });

  it('lehnt eine Anfrage aus einer alten World ab', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, rewardStore, playerId } = harness;
    const source = placeRewardPedestal(harness, 0, 0);

    expect(coordinator.movePersistentBaseObject(
      playerId,
      moveRequest(source, rewardCell(1, 1), { worldRevision: WORLD_REVISION - 1 }),
    )).toEqual({ ok: false, reason: 'blocked' });
    expect(rewardStore.getState().placements).toEqual([
      { rewardId: 'base_health_pedestal', relativeGridX: 0, relativeGridY: 0, angle: 0 },
    ]);
    expect(coordinator.hostRefreshPersistentBaseComposite).not.toHaveBeenCalled();
  });
});

describe('Persoenliche Konstruktionen bleiben owner-basiert', () => {
  function placeOwnConstruction(
    harness: ReturnType<typeof createHarness>,
    ownerId: string,
    relativeGridX: number,
    relativeGridY: number,
  ): SyncedPlaceableRock {
    const cell = rewardCell(relativeGridX, relativeGridY);
    const runtime = harness.placementSystem.materializePersistentPlaceable(
      getCoopDefenseConstructionDefinition('rock_barrier'),
      cell.gridX,
      cell.gridY,
      0,
      ownerId,
      0xffffff,
      'host-persistent',
    );
    if (!runtime) throw new Error('setup failed: construction was not materialized');
    return runtime;
  }

  it('verschiebt die eigene Konstruktion und erhaelt dabei Runtime-ID und HP', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, placementSystem, playerId } = harness;
    const source = placeOwnConstruction(harness, playerId, 0, 0);
    placementSystem.applyDamage(source.id, 60);
    const target = rewardCell(1, 1);

    expect(coordinator.movePersistentBaseObject(playerId, moveRequest(source, target)))
      .toEqual({ ok: true });
    expect(placementSystem.getRuntimeRock(source.id)).toMatchObject({
      id: source.id,
      ownerId: playerId,
      gridX: target.gridX,
      gridY: target.gridY,
      hp: source.maxHp - 60,
      maxHp: source.maxHp,
    });
  });

  it('laesst eine fremde Konstruktion vollstaendig unveraendert', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, placementSystem, playerId } = harness;
    const foreign = placeOwnConstruction(harness, 'someone-else', 0, 0);

    expect(coordinator.movePersistentBaseObject(playerId, moveRequest(foreign, rewardCell(1, 1))))
      .toEqual({ ok: false, reason: 'blocked' });
    expect(placementSystem.getRuntimeRock(foreign.id)).toMatchObject({
      gridX: foreign.gridX,
      gridY: foreign.gridY,
    });
  });

  it('haelt einen persistenten Beitrag beim Verschieben im Baubereich', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, placementSystem, contributionStore, playerId } = harness;
    const source = placeOwnConstruction(harness, playerId, 0, 0);
    contributionStore.registerRestored('owner-a', {
      persistentId: 'pb-owner-a-1-0',
      tool: { kind: 'construction', id: 'rock_barrier' },
      relativeGridX: 0,
      relativeGridY: 0,
      angle: 0,
      placementOrder: 4,
    }, source.id);

    // Ausserhalb des 3x3-Baubereichs koennte der Store den Blueprint nicht mehr halten.
    const outside = { gridX: ANCHOR.gridX + 4, gridY: ANCHOR.gridY };
    expect(coordinator.movePersistentBaseObject(playerId, moveRequest(source, outside)))
      .toEqual({ ok: false, reason: 'placement' });
    expect(placementSystem.getRuntimeRock(source.id)).toMatchObject({
      gridX: source.gridX,
      gridY: source.gridY,
    });
  });
});
