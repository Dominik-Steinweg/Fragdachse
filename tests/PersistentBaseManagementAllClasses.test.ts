import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

vi.mock('phaser', async () => {
  const { createFakePhaserModule } = await import('./fakeArenaRenderScene');
  return createFakePhaserModule();
});

import { ArenaPersistentBaseSession } from '../src/scenes/arena/ArenaPersistentBaseSession';
import { PersistentBaseWorldBinding } from '../src/world/PersistentBaseWorldBinding';
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
import { PersistentBaseRoomSession } from '../src/persistentBase/PersistentBaseRoomSession';
import { PersistentBaseRewardGrantService } from '../src/persistentBase/PersistentBaseRewardGrant';
import { PersistentBaseWorldMaterializer } from '../src/world/PersistentBaseWorldMaterializer';
import { ConstructionWorldRuntime } from '../src/world/ConstructionWorldRuntime';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import { getCoopDefenseConstructionDefinition } from '../src/config/coopDefenseConstructions';
import { createAuthoredWorldDescriptor } from '../src/world/WorldLayout';
import { resolveActiveArenaWorldMetrics, worldCellCenter } from '../src/world/WorldMetrics';
import type { ArenaLayout, SyncedPlaceableRock } from '../src/types';
import type { WorldPersistentBaseSite } from '../src/world/WorldRuntimeContext';
import { FakeNetwork, createHostRoom, type TestRoom } from './fakePeerNetwork';

const WORLD_REVISION = 911;
const ACTIVITY_A_REVISION = 7;
const ACTIVITY_B_REVISION = 8;
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
  const persistentBaseSession = new PersistentBaseRoomSession();
  const contributionStore = persistentBaseSession.contributions;
  const rewardStore = persistentBaseSession.rewards;
  const loadoutManager = new LoadoutManager();
  const powerUpSystem = {
    repositionPersistentBaseRewardPedestal: vi.fn(() => true),
    repositionConstructionPedestal: vi.fn(() => true),
    unregisterPersistentBaseRewardPedestal: vi.fn(() => true),
  };
  const playerId = bridge.getLocalPlayerId();
  const playerCell = rewardCell(0, 0);
  const playerWorld = worldCellCenter(METRICS, playerCell.gridX, playerCell.gridY);
  const player = { id: playerId, active: true, x: playerWorld.x, y: playerWorld.y, color: 0xffffff };

  vi.spyOn(bridge, 'getPlayerCurrentLoadoutSnapshot').mockReturnValue({ coopDefenseClassId: classId } as never);

  // Phase 10C: Die host-seitigen Persistent-Base-Anfragen gehoeren dem raumlanglebigen Owner.
  const coordinator = Object.create(ArenaPersistentBaseSession.prototype) as ArenaPersistentBaseSession & Record<string, any>;
  const persistentBaseWorldBinding = new PersistentBaseWorldBinding({
    finalizeRuntimeObjects: () => { /* nicht Gegenstand dieses Tests */ },
    releaseRewardRuntime: () => { /* dito */ },
  });
  Object.assign(coordinator, {
    scene: { game: { events: { emit: vi.fn() } } },
    ctx: {
      playerManager: { getPlayer: () => player },
      combatSystem: { isAlive: vi.fn(() => true), isBurrowed: vi.fn(() => false) },
      gameAudioSystem: { playSound: vi.fn() },
    },
    rockVisualHelper: {
      gridToWorld: (gridX: number, gridY: number) => worldCellCenter(METRICS, gridX, gridY),
      materializePlaceableRock: vi.fn(),
      removePlaceableRockVisual: vi.fn(),
    },
    // Die world-lokalen Runtime-IDs gehoeren der World-Runtime; der Test stellt genau diese
    // Bindung, nicht mehr zwei lose Maps.
    session: persistentBaseSession,
    projectionSignature: null,
    projectionRevision: 0,
    grantService: new PersistentBaseRewardGrantService(),
    world: {
      getWorldRuntime: () => ({
        context: { persistentBaseSite: site, definition: { sourceMapId: 'management-test' } },
        materialization: { placement: placementSystem, bases: null },
      }),
      getPlayerGameplayRuntime: () => ({
        systems: { loadout: loadoutManager, targetStatus: null, energyInjector: null },
      }),
      getWorldBinding: () => persistentBaseWorldBinding,
      getConstructionRuntime: () => coordinator.constructionWorldRuntime,
      getPlayerCapabilities: () => ({ canPlace: true, canDismantle: true, canInteract: true } as never),
      hasPersistentBaseSite: () => true,
      getConfiguredGameMode: () => COOP_DEFENSE_MODE,
    },
  });
  coordinator.persistentBaseWorldBinding = persistentBaseWorldBinding;
  coordinator.getPlayerCapabilities = () => ({ canPlace: true, canDismantle: true, canInteract: true } as never);
  coordinator.persistCurrentCommittedPersistentBaseRewards = vi.fn();
  coordinator.publishPersistentBaseRewardSessionState = vi.fn();
  coordinator.publishImmediatePersistentBaseContribution = vi.fn();
  coordinator.resolveOwnerId = (ownerId: string) => ownerId;
  coordinator.relocatePlaceableRuntimePresentation = vi.fn();
  coordinator.reconcilePersistentBaseWorld = () => coordinator.persistentBaseWorldBinding.reconcile();
  coordinator.constructionWorldRuntime = new ConstructionWorldRuntime({
    scene: coordinator.scene,
    playerManager: coordinator.ctx.playerManager,
    combatSystem: coordinator.ctx.combatSystem,
    placementSystem,
    loadoutManager,
    targetStatusSystem: null,
    energyInjectorSystem: null,
    powerUpSystem: powerUpSystem as never,
    modifierSystem: null,
    burrowSystem: null,
    tunnelSystem: null,
    gameAudioSystem: coordinator.ctx.gameAudioSystem,
    getGameMode: () => COOP_DEFENSE_MODE,
    getPlayerCapabilities: (id) => coordinator.getPlayerCapabilities(id),
    getCurrentLoadout: (id) => bridge.getPlayerCurrentLoadoutSnapshot(id),
    getPersistentBaseContext: () => ({
      anchor: site.anchor,
      buildArea: site.buildArea,
      contributions: contributionStore,
      rewards: rewardStore,
    }),
    persistentBaseBinding: persistentBaseWorldBinding,
    resolveOwnerId: (id) => id,
    getLocalPlayerId: () => playerId,
    isHost: () => bridge.isHost(),
    acceptsPersistentBaseMutation: (activityRevision) => coordinator.acceptsCurrentPersistentBaseMutation(activityRevision),
    mayManagePersistentBase: (id) => coordinator.mayManagePersistentBase(id),
    getRewardPlacementRuntime: () => null,
    emitGridChanged: () => { /* not relevant for management tests */ },
    relocatePresentation: (previous, next) => coordinator.relocatePlaceableRuntimePresentation(previous, next),
    reconcilePersistentBaseWorld: () => coordinator.reconcilePersistentBaseWorld(),
    publishImmediateContribution: (ownerId) => coordinator.publishImmediatePersistentBaseContribution(ownerId),
    persistRewards: () => coordinator.persistCurrentCommittedPersistentBaseRewards(),
    publishRewardSessionState: () => coordinator.publishPersistentBaseRewardSessionState(),
    publishUtilityCooldown: vi.fn(),
    recordConstructionBuilt: vi.fn(),
    rockVisualHelper: coordinator.rockVisualHelper,
  });

  persistentBaseWorldBinding.setSite(site.anchor, site.buildArea);
  persistentBaseWorldBinding.setMaterializer(new PersistentBaseWorldMaterializer({
    binding: persistentBaseWorldBinding,
    contributions: contributionStore,
    rewards: rewardStore,
    placementSystem,
    powerUpSystem,
    baseManager: null,
    getSite: () => site,
    rockVisualHelper: coordinator.rockVisualHelper,
    isHost: () => bridge.isHost(),
    getMapId: () => 'management-test',
    getLocalOwnerId: () => 'owner-local',
    resolvePlayerIdForOwner: () => playerId,
    getPlayerColor: () => 0xffffff,
    construction: {
      getCapacity: () => 100,
      getOwnership: () => 'host-persistent',
      resolveRestoreTools: () => [],
      materializeRestoreCandidate: () => null,
      materializeRewardConstruction: () => null,
      releaseRuntime: () => { /* PlacementSystem already removed the runtime. */ },
    },
    emitRestoreAdded: () => { /* not relevant for reward-management tests */ },
    emitGridChanged: () => { /* not relevant for reward-management tests */ },
    onDiagnosticEvent: () => { /* not relevant for reward-management tests */ },
  }));

  coordinator.persistentBaseWorldBinding.reconcile = vi.fn();

  return {
    coordinator,
    contributionStore,
    rewardStore,
    persistentBaseSession,
    placementSystem,
    loadoutManager,
    powerUpSystem,
    playerId,
    site,
  };
}

function useClientPreviewState(
  playerId: string,
  state: { alive: boolean; isBurrowed: boolean },
): void {
  vi.spyOn(bridge, 'isHost').mockReturnValue(false);
  vi.spyOn(bridge, 'getLatestGameState').mockReturnValue({
    worldRevision: WORLD_REVISION,
    players: { [playerId]: state },
  } as never);
  vi.spyOn(bridge, 'getPersistentBaseRewardSessionState').mockReturnValue({
    worldRevision: WORLD_REVISION,
    revision: 1,
    availableRewardIds: ['base_health_pedestal'],
    placements: [],
  } as never);
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
  coordinator.persistentBaseWorldBinding.rewardRuntimes.set('base_health_pedestal', {
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
  it('verwendet beim Client die replizierte Verfuegbarkeit fuer die Move-Quellvorschau', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, placementSystem, playerId } = harness;
    const source = placeRewardPedestal(harness, 1, 0);
    const sourceWorld = worldCellCenter(METRICS, source.gridX, source.gridY);
    useClientPreviewState(playerId, { alive: true, isBurrowed: false });

    const preview = coordinator.getPersistentBaseMoveSourcePreview(
      playerId,
      sourceWorld.x,
      sourceWorld.y,
    );

    expect(preview).toMatchObject({
      isValid: true,
      mode: 'move-source',
      sourceRuntimeId: source.id,
    });
    expect(coordinator.ctx.combatSystem.isAlive).not.toHaveBeenCalled();
    expect(coordinator.ctx.combatSystem.isBurrowed).not.toHaveBeenCalled();
    expect(placementSystem.getRuntimeRock(source.id)).toBeDefined();

    const target = rewardCell(-1, 1);
    const targetWorld = worldCellCenter(METRICS, target.gridX, target.gridY);
    expect(coordinator.getPersistentBaseMoveTargetPreview(
      playerId,
      source.id,
      targetWorld.x,
      targetWorld.y,
    )).toMatchObject({
      isValid: true,
      mode: 'move-target',
      sourceRuntimeId: source.id,
      gridX: target.gridX,
      gridY: target.gridY,
    });
    expect(coordinator.ctx.combatSystem.isAlive).not.toHaveBeenCalled();
    expect(coordinator.ctx.combatSystem.isBurrowed).not.toHaveBeenCalled();
  });

  it.each([
    [{ alive: false, isBurrowed: false }, 'toten'],
    [{ alive: true, isBurrowed: true }, 'eingegrabenen'],
  ] as const)('lehnt die Move-Quellvorschau fuer einen %s Client ab', (state) => {
    const harness = createHarness('assault_dachs');
    const { coordinator, playerId } = harness;
    useClientPreviewState(playerId, state);

    expect(coordinator.getPersistentBaseMoveSourcePreview(playerId, 0, 0)).toBeUndefined();
    expect(coordinator.ctx.combatSystem.isAlive).not.toHaveBeenCalled();
    expect(coordinator.ctx.combatSystem.isBurrowed).not.toHaveBeenCalled();
  });

  it('verwendet beim Client die replizierte Verfuegbarkeit fuer Reward-Placement', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, playerId } = harness;
    const target = rewardCell(1, 1);
    const targetWorld = worldCellCenter(METRICS, target.gridX, target.gridY);
    useClientPreviewState(playerId, { alive: true, isBurrowed: false });

    const preview = coordinator.getPersistentBaseRewardPlacementPreview(
      playerId,
      'base_health_pedestal',
      targetWorld.x,
      targetWorld.y,
    );

    expect(preview).toMatchObject({ isValid: true, mode: 'place', gridX: target.gridX, gridY: target.gridY });
    expect(coordinator.ctx.combatSystem.isAlive).not.toHaveBeenCalled();
    expect(coordinator.ctx.combatSystem.isBurrowed).not.toHaveBeenCalled();
  });

  it('laesst Client-Commits trotz lokaler Preview nicht autoritativ durch', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, playerId } = harness;
    useClientPreviewState(playerId, { alive: true, isBurrowed: false });

    expect(coordinator.movePersistentBaseObject(playerId, {
      worldRevision: WORLD_REVISION,
      sourceRuntimeId: 1,
      sourceGridX: 1,
      sourceGridY: 1,
      targetGridX: 2,
      targetGridY: 2,
    })).toEqual({ ok: false, reason: 'invalid' });
  });

  it('behandelt null als fehlendes Loadout im Management-Gate', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, playerId } = harness;
    vi.spyOn(bridge, 'getPlayerCurrentLoadoutSnapshot').mockReturnValue(null);

    expect(coordinator.getPersistentBaseRewardIdsForPlayer(playerId)).toEqual([]);
  });

  it('bindet Rueckbau in Management-Overlay ein und unterdrueckt dabei das normale Aim', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/scenes/ArenaScene.ts'), 'utf8');
    const overlayStart = source.indexOf('this.persistentBaseVisuals.sync(');
    const overlayEnd = source.indexOf('const ultimatePreview', overlayStart);
    const showAimStart = source.indexOf('const showAim =');
    const showAimEnd = source.indexOf('const scopeProgress', showAimStart);

    expect(overlayStart).toBeGreaterThanOrEqual(0);
    expect(overlayEnd).toBeGreaterThan(overlayStart);
    expect(source.slice(overlayStart, overlayEnd)).toContain('isDismantlePlacementActive()');
    expect(showAimStart).toBeGreaterThanOrEqual(0);
    expect(showAimEnd).toBeGreaterThan(showAimStart);
    expect(source.slice(showAimStart, showAimEnd)).toContain(
      '&& !this.ctx.inputSystem.isDismantlePlacementActive()',
    );
  });

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

  it('zeigt und bestaetigt Base-Reward-Rueckbau fuer eine Nicht-Inspector-Klasse', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, placementSystem, rewardStore, playerId } = harness;
    const reward = placeRewardPedestal(harness, 1, 0);
    const originCell = rewardCell(0, 0);
    const origin = worldCellCenter(METRICS, originCell.gridX, originCell.gridY);
    const target = worldCellCenter(METRICS, reward.gridX, reward.gridY);

    expect(placementSystem.getDismantlePreview(
      playerId,
      origin.x,
      origin.y,
      target.x,
      target.y,
      1_000,
    )).toMatchObject({ isValid: true, sourceRuntimeId: reward.id, mode: 'dismantle' });

    expect(coordinator.constructionWorldRuntime.dismantleConstruction(playerId, target.x, target.y)).toEqual({ ok: true });
    expect(placementSystem.getRuntimeRock(reward.id)).toBeUndefined();
    expect(rewardStore.getState().placements).toEqual([]);
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
    expect(coordinator.persistentBaseWorldBinding.rewardRuntimes.get('base_health_pedestal')).toEqual({
      runtimeId: source.id,
      gridX: target.gridX,
      gridY: target.gridY,
    });
    const { powerUpSystem } = harness;
    expect(powerUpSystem.repositionPersistentBaseRewardPedestal).toHaveBeenCalledTimes(1);
    expect(powerUpSystem.unregisterPersistentBaseRewardPedestal).not.toHaveBeenCalled();
    // Das Composite wird genau einmal gegen den neuen Zustand aufgeloest.
    expect(coordinator.persistentBaseWorldBinding.reconcile).toHaveBeenCalledTimes(1);
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
    expect(coordinator.persistentBaseWorldBinding.reconcile).toHaveBeenCalledTimes(1);
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
    expect(coordinator.persistentBaseWorldBinding.reconcile).not.toHaveBeenCalled();
  });

  it('lehnt stale Move-A nach Activity A → B ab und akzeptiert danach nur Move-B', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, persistentBaseSession, rewardStore, placementSystem, playerId } = harness;
    const source = placeRewardPedestal(harness, 0, 0);
    persistentBaseSession.beginTransaction({
      worldRevision: WORLD_REVISION,
      activityRevision: ACTIVITY_A_REVISION,
    });
    persistentBaseSession.beginTransaction({
      worldRevision: WORLD_REVISION,
      activityRevision: ACTIVITY_B_REVISION,
    });

    const stale = coordinator.movePersistentBaseObject(
      playerId,
      moveRequest(source, rewardCell(1, 1), { activityRevision: ACTIVITY_A_REVISION }),
    );
    expect(stale).toEqual({ ok: false, reason: 'blocked' });
    expect(rewardStore.getState().placements).toEqual([
      { rewardId: 'base_health_pedestal', relativeGridX: 0, relativeGridY: 0, angle: 0 },
    ]);
    expect(placementSystem.getRuntimeRock(source.id)).toMatchObject({
      id: source.id,
      gridX: source.gridX,
      gridY: source.gridY,
    });

    const current = coordinator.movePersistentBaseObject(
      playerId,
      moveRequest(source, rewardCell(1, 1), { activityRevision: ACTIVITY_B_REVISION }),
    );
    expect(current).toEqual({ ok: true });
    expect(rewardStore.getState().placements).toEqual([
      {
        rewardId: 'base_health_pedestal',
        relativeGridX: 1,
        relativeGridY: 1,
        angle: Math.PI / 4,
      },
    ]);
  });

  it('lehnt einen stale Construction-Dismantle aus A nach B vor jeder Runtime-Mutation ab', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, contributionStore, persistentBaseSession, placementSystem, playerId } = harness;
    const blueprint = {
      persistentId: 'pb-dismantle-a',
      tool: { kind: 'construction', id: 'rock_barrier' } as const,
      relativeGridX: 0,
      relativeGridY: 0,
      angle: 0,
      placementOrder: 0,
    };
    contributionStore.offerContribution({
      schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
      ownerId: playerId,
      revision: 1,
      constructions: [blueprint],
    });
    persistentBaseSession.beginTransaction({
      worldRevision: WORLD_REVISION,
      activityRevision: ACTIVITY_A_REVISION,
    });
    const sourceCell = rewardCell(0, 0);
    const source = placementSystem.materializePersistentPlaceable(
      getCoopDefenseConstructionDefinition('rock_barrier'),
      sourceCell.gridX,
      sourceCell.gridY,
      0,
      playerId,
      0xffffff,
      'host-persistent',
    );
    if (!source) throw new Error('setup failed: construction was not materialized');
    contributionStore.registerRestored(playerId, blueprint, source.id);
    persistentBaseSession.beginTransaction({
      worldRevision: WORLD_REVISION,
      activityRevision: ACTIVITY_B_REVISION,
    });
    const target = worldCellCenter(METRICS, source.gridX, source.gridY);

    expect(coordinator.constructionWorldRuntime.dismantleConstruction(
      playerId,
      target.x,
      target.y,
      ACTIVITY_A_REVISION,
    )).toEqual({ ok: false, reason: 'blocked' });
    expect(placementSystem.getRuntimeRock(source.id)).toBeDefined();
    expect(contributionStore.getContribution(playerId)?.constructions).toEqual([blueprint]);

    expect(coordinator.constructionWorldRuntime.dismantleConstruction(
      playerId,
      target.x,
      target.y,
      ACTIVITY_B_REVISION,
    )).toEqual({ ok: true });
    expect(placementSystem.getRuntimeRock(source.id)).toBeUndefined();
    expect(contributionStore.getContribution(playerId)?.constructions).toEqual([]);
  });

  it('lehnt A nach Activity-Ende auch gegen den committed Lobby-Stand ab', () => {
    const harness = createHarness('assault_dachs');
    const { coordinator, persistentBaseSession, rewardStore, placementSystem, playerId } = harness;
    const source = placeRewardPedestal(harness, 0, 0);
    persistentBaseSession.beginTransaction({
      worldRevision: WORLD_REVISION,
      activityRevision: ACTIVITY_A_REVISION,
    });
    persistentBaseSession.completeTransaction('rollback', () => true, {
      worldRevision: WORLD_REVISION,
      activityRevision: ACTIVITY_A_REVISION,
    });

    expect(coordinator.movePersistentBaseObject(
      playerId,
      moveRequest(source, rewardCell(1, 1), { activityRevision: ACTIVITY_A_REVISION }),
    )).toEqual({ ok: false, reason: 'blocked' });
    expect(rewardStore.getState().placements).toEqual([
      { rewardId: 'base_health_pedestal', relativeGridX: 0, relativeGridY: 0, angle: 0 },
    ]);
    expect(placementSystem.getRuntimeRock(source.id)).toMatchObject({
      gridX: source.gridX,
      gridY: source.gridY,
    });
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

  it('markiert nur eigene persoenliche Konstruktionen als rueckbaubar', () => {
    const harness = createHarness('assault_dachs');
    const { placementSystem, playerId } = harness;
    const own = placeOwnConstruction(harness, playerId, 1, 0);
    const foreign = placeOwnConstruction(harness, 'someone-else', -1, 0);
    const originCell = rewardCell(0, 0);
    const origin = worldCellCenter(METRICS, originCell.gridX, originCell.gridY);
    const ownTarget = worldCellCenter(METRICS, own.gridX, own.gridY);
    const foreignTarget = worldCellCenter(METRICS, foreign.gridX, foreign.gridY);

    expect(placementSystem.getDismantlePreview(
      playerId, origin.x, origin.y, ownTarget.x, ownTarget.y, 1_000,
    )?.isValid).toBe(true);
    expect(placementSystem.getDismantlePreview(
      playerId, origin.x, origin.y, foreignTarget.x, foreignTarget.y, 1_000,
    )?.isValid).toBe(false);
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
