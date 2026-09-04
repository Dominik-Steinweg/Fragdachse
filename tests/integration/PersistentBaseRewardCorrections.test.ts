import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  const placeholder = new Proxy(() => undefined, {
    get: (_target, property) => property === 'then' ? undefined : placeholder,
    apply: () => undefined,
    construct: () => ({}),
  });
  return new Proxy({
    Math: {
      Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
      Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
      Angle: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1), Wrap: (value: number) => value },
      Linear: (start: number, end: number, amount: number) => start + (end - start) * amount,
      FloatBetween: (min: number, max: number) => (min + max) / 2,
      DegToRad: (degrees: number) => degrees * Math.PI / 180,
      RND: { realInRange: (min: number, max: number) => (min + max) / 2 },
    },
    BlendModes: { ADD: 1, MULTIPLY: 2, NORMAL: 0 },
    GameObjects: { Events: { DESTROY: 'destroy' } },
    Utils: { Array: { Shuffle: <T>(values: T[]) => values } },
  }, {
    get: (target, property) => property === 'then'
      ? undefined
      : property in target ? target[property as keyof typeof target] : placeholder,
  });
});

import { ArenaPersistentBaseSession } from '../../src/scenes/arena/ArenaPersistentBaseSession';
import { PersistentBaseWorldBinding } from '../../src/world/PersistentBaseWorldBinding';
import { LOBBY_WORLD_DEFINITION_ID } from '../../src/config/authoring/lobbyWorld';
import {
  getCoopDefenseMapConfig,
  resolveCoopDefenseMapSecondaryObjectives,
} from '../../src/config/coopDefenseMaps';
import { DEFAULT_PERSISTENT_BASE_BUILD_AREA } from '../../src/persistentBase/PersistentBaseCore';
import { PersistentBaseContributionStore } from '../../src/persistentBase/PersistentBaseContributionStore';
import { PersistentBaseRoomSession } from '../../src/persistentBase/PersistentBaseRoomSession';
import {
  applyPersistentBaseRoundOutcome,
  resolvePersistentBaseRoundOutcome,
} from '../../src/persistentBase/PersistentBaseRoundOutcome';
import { PersistentBaseRewardGrantService } from '../../src/persistentBase/PersistentBaseRewardGrant';
import { PersistentBaseRewardStore } from '../../src/persistentBase/PersistentBaseRewardStore';
import { PersistentBaseWorldMaterializer } from '../../src/world/PersistentBaseWorldMaterializer';
import { PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION } from '../../src/config/persistentBase';
import { bridge } from '../../src/network/bridge';
import { COOP_DEFENSE_MODE } from '../../src/gameModes';
import { clearActiveSession, setActiveSession } from '../../src/network/peer/session';
import { CoopDefenseSecondaryObjectiveSystem } from '../../src/systems/CoopDefenseSecondaryObjectiveSystem';
import {
  getStoredLocalOwnerId,
  getStoredPersistentBaseRewardUnlocks,
  grantStoredPersistentBaseRewards,
  invalidateLocalStorageCache,
} from '../../src/utils/localPreferences';
import type { PersistentConstruction, PersistentPlayerBaseContribution } from '../../src/persistentBase/PersistentBaseTypes';
import type { SyncedPlaceableRock } from '../../src/types';
import type { WorldPersistentBaseSite } from '../../src/world/WorldRuntimeContext';
import { createAuthoredWorldDescriptor } from '../../src/world/WorldLayout';
import { FakeNetwork, addClientRoom, createHostRoom, type TestRoom } from '../fakePeerNetwork';

const LIFECYCLE_PATH = resolve(process.cwd(), 'src/scenes/arena/ArenaPersistentBaseSession.ts');

function readLifecycle(): string {
  return readFileSync(LIFECYCLE_PATH, 'utf8');
}

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

let behaviorHostRoom: TestRoom;
let behaviorClientRoom: TestRoom;

beforeAll(async () => {
  const network = new FakeNetwork();
  behaviorHostRoom = await createHostRoom(network);
  behaviorClientRoom = await addClientRoom(network);
  setActiveSession({
    room: behaviorHostRoom.room,
    transport: behaviorHostRoom.transport,
    roomCode: 'PB3D-CORRECTIONS',
  });
  bridge.activate();
});

afterAll(() => {
  behaviorClientRoom.room.leave();
  behaviorHostRoom.room.leave();
  clearActiveSession();
});

beforeEach(() => {
  vi.stubGlobal('window', { localStorage: new MemoryStorage() });
  invalidateLocalStorageCache();
});

afterEach(() => {
  invalidateLocalStorageCache();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function useBehaviorHost(): void {
  setActiveSession({
    room: behaviorHostRoom.room,
    transport: behaviorHostRoom.transport,
    roomCode: 'PB3D-CORRECTIONS',
  });
}

function publishBehaviorWorld(worldRevision: number): void {
  useBehaviorHost();
  bridge.publishWorldAndActivity(
    createAuthoredWorldDescriptor(LOBBY_WORLD_DEFINITION_ID, worldRevision),
    null,
  );
}

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
    anchor: { gridX: 5, gridY: 5 },
    orientation: 'open-left',
    areaStage: 0,
    buildArea: DEFAULT_PERSISTENT_BASE_BUILD_AREA,
  };
}

function runtimeRock(
  id: number,
  kind: SyncedPlaceableRock['kind'],
  gridX: number,
  gridY: number,
  overrides: Partial<SyncedPlaceableRock> = {},
): SyncedPlaceableRock {
  return {
    id,
    kind,
    gridX,
    gridY,
    hp: 100,
    maxHp: 100,
    ownerId: 'owner',
    ownerColor: 0xffffff,
    expiresAt: 0,
    warningStartsAt: 0,
    angle: 0,
    toolRef: { kind: 'construction', id: 'rock_barrier' },
    ...overrides,
  };
}

function fakePlacementSystem(initialRocks: readonly SyncedPlaceableRock[] = []) {
  const rocks = new Map(initialRocks.map((rock) => [rock.id, rock]));
  let nextId = Math.max(20, ...initialRocks.map((rock) => rock.id + 1));
  const placementSystem = {
    getRuntimeRock: (id: number) => rocks.get(id),
    getRuntimeRockAt: (gridX: number, gridY: number) => [...rocks.values()]
      .find((rock) => rock.gridX === gridX && rock.gridY === gridY),
    getAllRuntimeRocks: () => [...rocks.values()],
    hasRuntimeRock: (id: number) => rocks.has(id),
    getWorldPointForCell: () => ({ x: 0, y: 0 }),
    canMaterializePersistentBaseRewardCell: () => true,
    canMaterializeCells: () => true,
    removeRock: (id: number) => {
      const rock = rocks.get(id);
      if (rock) rocks.delete(id);
      return rock;
    },
    removePersistentBaseReward: (rewardId: string) => {
      const rock = [...rocks.values()].find((candidate) => candidate.persistentRewardId === rewardId);
      return rock ? placementSystem.removeRock(rock.id) : undefined;
    },
    materializePersistentBaseReward: vi.fn((_definition, rewardId, gridX, gridY, angle, ownerId, ownerColor) => {
      const rock = runtimeRock(nextId++, 'turret', gridX, gridY, {
        ownerId,
        ownerColor,
        angle,
        ownership: 'base-owned',
        persistentRewardId: rewardId,
        collisionMode: 'none',
      });
      rocks.set(rock.id, rock);
      return rock;
    }),
    materializePersistentBaseRewardPedestal: vi.fn((_rewardId, gridX, gridY, angle, ownerId, ownerColor) => {
      const rock = runtimeRock(nextId++, 'pedestal', gridX, gridY, {
        ownerId,
        ownerColor,
        angle,
        ownership: 'base-owned',
        persistentRewardId: _rewardId,
        collisionMode: 'none',
      });
      rocks.set(rock.id, rock);
      return rock;
    }),
  };
  return { placementSystem, rocks };
}

function testCoordinator(
  initialRocks: readonly SyncedPlaceableRock[] = [],
): {
  coordinator: ArenaPersistentBaseSession & Record<string, any>;
  contributionStore: PersistentBaseContributionStore;
  rewardStore: PersistentBaseRewardStore;
  rocks: Map<number, SyncedPlaceableRock>;
  site: WorldPersistentBaseSite;
} {
  useBehaviorHost();
  const site = testSite();
  const persistentBaseSession = new PersistentBaseRoomSession();
  const contributionStore = persistentBaseSession.contributions;
  const rewardStore = persistentBaseSession.rewards;
  const fakePlacement = fakePlacementSystem(initialRocks);
  const playerId = bridge.getLocalPlayerId();
  // Phase 10C: Die host-seitigen Persistent-Base-Anfragen gehoeren dem raumlanglebigen Owner.
  const coordinator = Object.create(ArenaPersistentBaseSession.prototype) as ArenaPersistentBaseSession & Record<string, any>;
  const baseManager = {
    getBase: () => ({ isInert: () => false }),
  };

  Object.assign(coordinator, {
    scene: { game: { events: { emit: vi.fn() } } },
    ctx: {
      playerManager: { getPlayer: () => ({ id: playerId, active: true, x: 0, y: 0 }) },
      combatSystem: { isAlive: () => true, isBurrowed: () => false },
    },
    rockVisualHelper: {
      gridToWorld: () => ({ x: 0, y: 0 }),
      materializePlaceableRock: vi.fn(),
      removePlaceableRockVisual: vi.fn(),
    },
    // Die world-lokalen Runtime-IDs gehoeren der World-Runtime; der Test stellt genau diese
    // Bindung, nicht mehr zwei lose Maps.
    persistentBaseWorldBinding: new PersistentBaseWorldBinding({
      finalizeRuntimeObjects: () => { /* nicht Gegenstand dieses Tests */ },
      releaseRewardRuntime: () => { /* dito */ },
    }),
    session: persistentBaseSession,
    projectionSignature: null,
    projectionRevision: 0,
    grantService: new PersistentBaseRewardGrantService(),
    world: {
      getWorldRuntime: () => ({
        context: { persistentBaseSite: site, definition: { sourceMapId: 'corrections-test' } },
        materialization: { placement: fakePlacement.placementSystem, bases: baseManager },
      }),
      getPlayerGameplayRuntime: () => null,
      getWorldBinding: () => coordinator.persistentBaseWorldBinding,
      getConstructionRuntime: () => null,
      getPlayerCapabilities: () => coordinator.getPlayerCapabilities(),
      hasPersistentBaseSite: () => true,
      getConfiguredGameMode: () => COOP_DEFENSE_MODE,
    },
  });

  coordinator.getPlayerCapabilities = () => ({ canPlace: true, canDismantle: true } as any);
  coordinator.resolvePersistentBaseRewardCell = () => ({
    gridX: 5,
    gridY: 5,
    domain: 'courtyard-build-area',
  });
  coordinator.isPersistentBaseRewardPlacementInDomain = () => true;
  coordinator.buildPersistentRestoreTools = () => [{
    kind: 'construction',
    id: 'rock_barrier',
    footprint: [{ dx: 0, dy: 0 }],
    capacityCost: 1,
    maxHp: 100,
    unlocked: true,
    active: true,
  }];
  coordinator.getConstructionCapacity = () => 100;
  coordinator.materializePersistentRestoreCandidate = (candidate, ownerId, ownerColor, ownership) => {
    const rock = runtimeRock(100 + fakePlacement.rocks.size, 'rock', candidate.gridX, candidate.gridY, {
      ownerId,
      ownerColor,
      ownership,
      constructionId: 'rock_barrier',
    });
    fakePlacement.rocks.set(rock.id, rock);
    return rock;
  };

  const persistentBaseWorldBinding = coordinator.persistentBaseWorldBinding as PersistentBaseWorldBinding;
  persistentBaseWorldBinding.setSite(site.anchor, site.buildArea);
  persistentBaseWorldBinding.setMaterializer(new PersistentBaseWorldMaterializer({
    binding: persistentBaseWorldBinding,
    contributions: contributionStore,
    rewards: rewardStore,
    placementSystem: fakePlacement.placementSystem as never,
    powerUpSystem: null,
    baseManager: baseManager as never,
    getSite: () => site,
    rockVisualHelper: coordinator.rockVisualHelper,
    isHost: () => bridge.isHost(),
    getMapId: () => 'corrections-test',
    getLocalOwnerId: () => getStoredLocalOwnerId(),
    resolvePlayerIdForOwner: () => playerId,
    getPlayerColor: () => 0xffffff,
    construction: {
      getCapacity: () => coordinator.getConstructionCapacity(playerId),
      getOwnership: () => 'host-persistent',
      resolveRestoreTools: () => coordinator.buildPersistentRestoreTools(playerId),
      materializeRestoreCandidate: (candidate, ownerId, ownerColor, ownership) => (
      coordinator.materializePersistentRestoreCandidate(candidate, ownerId, ownerColor, ownership)
      ),
      materializeRewardConstruction: (_constructionId, rewardId, gridX, gridY, angle, ownerId, ownerColor) => (
        fakePlacement.placementSystem.materializePersistentBaseReward(
          {} as never,
          rewardId,
          gridX,
          gridY,
          angle,
          ownerId,
          ownerColor,
        )
      ),
      releaseRuntime: () => { /* fake placement owns the map entry in this test */ },
    },
    emitRestoreAdded: () => { /* not relevant for this contract */ },
    emitGridChanged: () => { /* not relevant for this contract */ },
    onDiagnosticEvent: () => { /* not relevant for this contract */ },
  }));

  return {
    coordinator,
    contributionStore,
    rewardStore,
    rocks: fakePlacement.rocks,
    site,
    baseManager,
  };
}

function personalContribution(ownerId: string): {
  contribution: PersistentPlayerBaseContribution;
  blueprint: PersistentConstruction;
} {
  const blueprint: PersistentConstruction = {
    persistentId: 'personal-x',
    tool: { kind: 'construction', id: 'rock_barrier' },
    relativeGridX: 0,
    relativeGridY: 0,
    angle: 0,
    placementOrder: 0,
  };
  return {
    blueprint,
    contribution: {
      schemaVersion: PERSISTENT_PLAYER_BASE_CONTRIBUTION_SCHEMA_VERSION,
      ownerId,
      revision: 3,
      constructions: [blueprint],
    },
  };
}

describe('Persistent Base Reward – 3D-2 Korrekturvertraege', () => {
  it('verwendet die zentrale kanonische World-Zellen-Aufloesung', () => {
    const source = readLifecycle();
    const resolverStart = source.indexOf('  resolvePersistentBaseRewardCell(');
    const resolverEnd = source.indexOf('\n  resolvePersistentBaseRewardRelativeCell(', resolverStart);
    expect(resolverStart).toBeGreaterThanOrEqual(0);
    expect(resolverEnd).toBeGreaterThan(resolverStart);
    const resolver = source.slice(resolverStart, resolverEnd);
    expect(resolver).toContain('return resolvePersistentBaseCell(');
    expect(resolver).not.toContain('resolvePersistentBaseCoreCellsRelative');
  });

  it('entfernt bei Basiszerstoerung nur die Reward-Turret-Runtime', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'src/world/WorldCombatGameplayBinding.ts'),
      'utf8',
    );
    const materializer = readFileSync(
      resolve(process.cwd(), 'src/world/PersistentBaseWorldMaterializer.ts'),
      'utf8',
    );
    const destroyedStart = source.indexOf('o.baseManager?.setOnBaseDestroyed((destroyedBase) => {');
    const destroyedEnd = source.indexOf('\n    });', destroyedStart);
    expect(destroyedStart).toBeGreaterThanOrEqual(0);
    expect(destroyedEnd).toBeGreaterThan(destroyedStart);
    const destroyed = source.slice(destroyedStart, destroyedEnd);
    expect(destroyed).toContain('o.getTargetStatusSystem()?.removeTarget');
    expect(destroyed).toContain('o.getEnergyInjectorSystem()?.removeTarget');
    expect(destroyed).toContain('o.getPowerUpSystem()?.destroyPedestalsLinkedToBase');
    expect(destroyed).toContain('o.reconcilePersistentBaseWorld();');
    expect(destroyed).toContain('o.reportTargetDestroyed');
    expect(destroyed).toContain('o.hostPhysics.applyRadialImpulse');
    expect(destroyed).toContain('o.syncActiveBaseIds();');

    const removalStart = materializer.indexOf('  private removeRewardTurretsForBase(');
    const removalEnd = materializer.indexOf('\n  private isPersistentBaseRuntimeActive(', removalStart);
    expect(removalStart).toBeGreaterThanOrEqual(0);
    expect(removalEnd).toBeGreaterThan(removalStart);
    const removal = materializer.slice(removalStart, removalEnd);
    expect(removal).toContain("rock.kind !== 'turret'");
    expect(removal).toContain("rock.ownership !== 'base-owned'");
    expect(removal).toContain('rock.persistentRewardId === undefined');
    expect(removal).toContain('this.options.placementSystem.removeRock(rock.id)');
    expect(removal).toContain('this.options.construction.releaseRuntime(removed, false);');
    expect(removal).not.toContain('dismantleReward');
    expect(materializer).toContain('if (!persistentBaseActive) this.removeRewardTurretsForBase(site.baseId);');
  });

  it('baut nach einem Materialisierungsfehler das unveraenderte Composite wieder auf', () => {
    const source = readLifecycle();
    const placementStart = source.indexOf('  placePersistentBaseReward(');
    const placementEnd = source.indexOf('\n  /** Liefert die lokale Reward-Vorschau', placementStart);
    expect(placementStart).toBeGreaterThanOrEqual(0);
    expect(placementEnd).toBeGreaterThan(placementStart);
    const placement = source.slice(placementStart, placementEnd);
    const rollbackAt = placement.indexOf('store.rollbackPlacement(sanitizedRequest.rewardId);');
    const refreshAt = placement.indexOf('this.reconcilePersistentBaseWorld();', rollbackAt);
    expect(placement).toContain('isPersistentContribution');
    expect(rollbackAt).toBeGreaterThanOrEqual(0);
    expect(refreshAt).toBeGreaterThan(rollbackAt);
    expect(placement).toContain('emitArenaMapGridChanged(this.scene.game.events');
  });

  it('rollt eine fehlgeschlagene Reward-Platzierung atomar zur persoenlichen Composite-Runtime zurueck', () => {
    useBehaviorHost();
    publishBehaviorWorld(407);
    const ownerId = getStoredLocalOwnerId();
    const { contribution, blueprint } = personalContribution(ownerId);
    const personalRuntime = runtimeRock(17, 'rock', 5, 5, {
      ownerId,
      ownership: 'host-persistent',
    });
    const { coordinator, contributionStore, rewardStore, rocks } = testCoordinator([personalRuntime]);
    contributionStore.offerContribution(contribution);
    contributionStore.registerRestored(ownerId, blueprint, personalRuntime.id);
    grantStoredPersistentBaseRewards(['base_health_pedestal']);
    vi.spyOn(bridge, 'getPlayerCurrentLoadoutSnapshot').mockReturnValue({
      coopDefenseClassId: 'inspector_gadachs',
    } as any);
    vi.spyOn(bridge, 'getPlayerColor').mockReturnValue(0xffffff);
    coordinator.persistentBaseWorldBinding.materializeRewardPlacement = vi.fn(() => null);

    const result = coordinator.placePersistentBaseReward(bridge.getLocalPlayerId(), {
      worldRevision: 407,
      rewardId: 'base_health_pedestal',
      relativeGridX: 0,
      relativeGridY: 0,
      angle: 0,
    });

    expect(result).toEqual({ ok: false, reason: 'placement' });
    expect(rewardStore.getState().placements).toEqual([]);
    expect(contributionStore.getCommittedContribution(ownerId)).toEqual(contribution);
    expect(contributionStore.isMaterialized(ownerId, blueprint.persistentId)).toBe(true);
    expect(rocks.get(17)).toBeUndefined();
    expect([...rocks.values()].find((rock) => rock.gridX === 5 && rock.gridY === 5)).toMatchObject({
      kind: 'rock',
      ownerId: bridge.getLocalPlayerId(),
      ownership: 'host-persistent',
    });
    expect([...rocks.values()].some((rock) => rock.persistentRewardId !== undefined)).toBe(false);
  });

  it('entfernt bei einer zerstoerten Basis nur die Reward-Turret-Runtime und materialisiert sie nicht erneut', () => {
    useBehaviorHost();
    publishBehaviorWorld(408);
    const { coordinator, rewardStore, rocks, site, baseManager } = testCoordinator();
    expect(rewardStore.placeReward({
      rewardId: 'base_spore_turret',
      relativeGridX: 2,
      relativeGridY: 1,
      angle: 0,
    })).toBe(true);
    let baseInert = false;
    baseManager.getBase = () => ({ isInert: () => baseInert });

    coordinator.persistentBaseWorldBinding.reconcile();
    expect([...rocks.values()]).toHaveLength(1);
    expect([...rocks.values()][0]).toMatchObject({
      kind: 'turret',
      ownership: 'base-owned',
      persistentRewardId: 'base_spore_turret',
      collisionMode: 'none',
    });

    baseInert = true;
    coordinator.persistentBaseWorldBinding.reconcile();
    expect([...rocks.values()]).toEqual([]);
    expect(rewardStore.getState().placements).toHaveLength(1);
    expect(coordinator.persistentBaseWorldBinding.rewardRuntimes.size).toBe(0);

    coordinator.persistentBaseWorldBinding.reconcile();
    expect([...rocks.values()]).toEqual([]);
    expect(rewardStore.getState().placements).toHaveLength(1);
  });

  it('gibt Map 12 das Holy-Hand-Grenade-Podest ueber den echten Hold- und Grant-Pfad dauerhaft frei', () => {
    useBehaviorHost();
    const map = getCoopDefenseMapConfig('12');
    const objective = resolveCoopDefenseMapSecondaryObjectives(map)
      .find((entry) => entry.id === 'hold-supply-base');
    expect(objective).toBeDefined();
    if (!objective) return;

    const worldRevision = 409;
    publishBehaviorWorld(worldRevision);
    bridge.hostStartRoundParticipants(bridge.getConnectedPlayerIds(), 0, worldRevision);
    const { coordinator } = testCoordinator();
    vi.spyOn(bridge, 'getPlayerCurrentLoadoutSnapshot').mockReturnValue({
      coopDefenseClassId: 'inspector_gadachs',
    } as any);
    const clearedEncounters = new Set<string>();
    const completed: string[] = [];
    const objectiveSystem = new CoopDefenseSecondaryObjectiveSystem([objective], {
      isEncounterCleared: (encounterId) => clearedEncounters.has(encounterId),
      onHoldCompleted: (objectiveId) => {
        completed.push(objectiveId);
        coordinator.grantAuthoredPersistentBaseRewards(objective.rewards?.persistentBaseRewardsOnComplete);
      },
    });

    objectiveSystem.hostUpdate(1, false);
    expect(objectiveSystem.getObjectiveState(objective.id)).toBe('dormant');
    clearedEncounters.add('reveal');
    objectiveSystem.hostUpdate(1, false);
    expect(objectiveSystem.getObjectiveState(objective.id)).toBe('active');
    clearedEncounters.add('defend');
    objectiveSystem.hostUpdate(1, false);

    expect(completed).toEqual(['hold-supply-base']);
    expect(getStoredPersistentBaseRewardUnlocks()).toEqual(['base_holy_hand_grenade_pedestal']);
    expect(coordinator.getPersistentBaseRewardIdsForPlayer(bridge.getLocalPlayerId()))
      .toEqual(['base_holy_hand_grenade_pedestal']);
    expect(bridge.getPersistentBaseRewardSessionState()).toMatchObject({
      worldRevision,
      availableRewardIds: ['base_holy_hand_grenade_pedestal'],
      placements: [],
    });
    const clientId = bridge.getConnectedPlayerIds().find((id) => id !== bridge.getLocalPlayerId());
    expect(clientId).toBeDefined();
    if (clientId) {
      expect(bridge.getPlayerPersistentBaseRewardGrant(clientId)).toEqual({
        revision: 1,
        rewardIds: ['base_holy_hand_grenade_pedestal'],
      });
    }

    const roundSession = new PersistentBaseRoomSession();
    roundSession.beginTransaction({ worldRevision: 21, activityRevision: 7 });
    applyPersistentBaseRoundOutcome(resolvePersistentBaseRoundOutcome('defeat'), {
      session: roundSession,
      isRuntimeObjectAlive: () => true,
    });
    bridge.clearWorldAndActivity();
    expect(getStoredPersistentBaseRewardUnlocks()).toContain('base_holy_hand_grenade_pedestal');
  });
});