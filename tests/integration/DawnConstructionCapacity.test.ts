import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', async () => (await import('../fakeArenaRenderScene')).createFakePhaserModule());

import { composeWorldConstruction } from '../../src/scenes/arena/ArenaWorldConstructionComposition';
import { ClientUpdateCoordinator } from '../../src/scenes/arena/ClientUpdateCoordinator';
import { bridge } from '../../src/network/bridge';
import { ConstructionWorldRuntime } from '../../src/world/ConstructionWorldRuntime';
import { PersistentBaseWorldBinding } from '../../src/world/PersistentBaseWorldBinding';
import { PersistentBaseRoomSession } from '../../src/persistentBase/PersistentBaseRoomSession';
import { resolvePersistentBaseBuildAreaForStage, type PersistentBaseAreaStage } from '../../src/persistentBase/PersistentBaseCore';
import { resolvePersistentBaseConstructionCapacityBonus } from '../../src/persistentBase/PersistentBaseConstructionCapacity';
import { resolveConstructionCapacity } from '../../src/config/coopDefenseConstructions';
import { RockGridIndex } from '../../src/arena/RockGridIndex';
import { PlacementSystem } from '../../src/systems/PlacementSystem';
import { resolveActiveArenaWorldMetrics, worldCellCenter } from '../../src/world/WorldMetrics';
import type { ArenaLayout, CoopDefenseClassId, LoadoutCommitSnapshot } from '../../src/types';

afterEach(() => vi.restoreAllMocks());

function setup(stage: PersistentBaseAreaStage | undefined, classId: CoopDefenseClassId = 'dachs_nukem', itemBonus = 0) {
  const metrics = resolveActiveArenaWorldMetrics();
  const anchor = { gridX: 20, gridY: 20 };
  const position = worldCellCenter(metrics, anchor.gridX, anchor.gridY);
  const player = { id: 'guest', ...position, active: true, color: 0xffffff };
  const players = { getPlayer: () => player, getAllPlayers: () => [] };
  const loadout: LoadoutCommitSnapshot = {
    weapon1: 'GLOCK', weapon2: 'P90', utility: 'ROCK_BARRIER', ultimate: 'ARMAGEDDON',
    coopDefenseClassId: classId, tools: [{ kind: 'construction', id: 'rock_barrier' }],
    coopDefenseProfile: { upgrades: { unlock_rock_barrier: { unlocked: true, level: 1 } } },
  };
  const descriptor = { worldRevision: 1, parameters: stage === undefined ? undefined : { persistentBaseAreaStage: stage } };
  vi.spyOn(bridge, 'getWorldDescriptor').mockReturnValue(descriptor as never);
  vi.spyOn(bridge, 'getActivityDescriptor').mockReturnValue(null);
  vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('guest');
  vi.spyOn(bridge, 'getPlayerCurrentLoadoutSnapshot').mockReturnValue(loadout);
  vi.spyOn(bridge, 'getPlayerColor').mockReturnValue(0xffffff);
  vi.spyOn(bridge, 'getActiveGameMode').mockReturnValue('coop_defense');
  vi.spyOn(bridge, 'isHost').mockReturnValue(true);
  vi.spyOn(bridge, 'publishUtilityCooldownUntil').mockImplementation(() => {});
  vi.spyOn(bridge, 'recordConstructionBuilt').mockImplementation(() => {});
  const site = { baseId: 'base', anchor, areaStage: stage ?? 0,
    buildArea: resolvePersistentBaseBuildAreaForStage(stage ?? 0) };
  const world = { descriptor, persistentBaseSite: site, metrics };
  const layout: ArenaLayout = { seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [] };
  const placement = new PlacementSystem(layout, new RockGridIndex([]), players as never, metrics);
  const session = new PersistentBaseRoomSession();
  const binding = new PersistentBaseWorldBinding({ finalizeRuntimeObjects: vi.fn(), releaseRewardRuntime: vi.fn() });
  binding.setSite(anchor, site.buildArea);
  session.useWorldRuntimes(binding.constructionRuntimes);
  const modifiers = { getNumericStat: () => itemBonus, getPercentageStat: () => 0, getModifiers: () => null };
  const gameplay = { combatSystem: { isAlive: () => true, isBurrowed: () => false }, construction: null as ConstructionWorldRuntime | null,
    player: { getPlayerModifierReadPort: () => modifiers, getTunnelPlacementPort: () => null,
      setUtilityPlacementCapability: vi.fn(), setTunnelPlacementCapability: vi.fn() } };
  const context = { anchor, buildArea: site.buildArea, contributions: session.contributions, rewards: session.rewards };
  composeWorldConstruction({
    scene: { game: { events: { emit: vi.fn() } } }, ctx: { playerManager: players,
      gameAudioSystem: { playSound: vi.fn() }, decoySystem: { breakStealth: vi.fn() } },
    rockVisualHelper: { gridToWorld: (x: number, y: number) => worldCellCenter(metrics, x, y), materializePlaceableRock: vi.fn() },
    flow: { getConfiguredGameMode: () => 'coop_defense', getPlayerCapabilities: () => ({ canPlace: true }),
      getPersistentBaseConstructionContext: () => context, resolveOwnerId: () => 'owner-guest',
      resolvePlayerIdForOwner: () => 'guest', getWorldMapId: () => 'capacity-test',
      acceptsCurrentPersistentBaseMutation: () => true, getActivityStartAnchor: () => null,
      emitPersistentRestoreAdded: vi.fn(), onDiagnosticEvent: vi.fn(),
      publishImmediatePersistentBaseContribution: vi.fn() },
    persistentBaseStores: { contributions: session.contributions, rewards: session.rewards },
    worldRuntime: { context: world, bind: vi.fn() }, world, placementSystem: placement,
    baseManager: null, persistentBaseBinding: binding, coopMissionRuntime: null, activityDescriptor: null,
  } as never, gameplay as never);
  const client = Object.assign(Object.create(ClientUpdateCoordinator.prototype), {
    getLocalEffectTotals: () => ({ additive: { 'construction.capacity': itemBonus }, percentage: {} }),
  }) as ClientUpdateCoordinator;
  return { runtime: gameplay.construction!, client, placement, binding, session, position };
}

describe('frozen World construction capacity', () => {
  it.each([undefined, 0, 1, 2, 3, 6, 11] as const)('host composition and client preview agree at stage %s', stage => {
    for (const classId of ['dachs_nukem', 'inspector_gadachs'] as const) {
      const { runtime, client } = setup(stage, classId, 7);
      const baseline = resolveConstructionCapacity({ gameMode: 'coop_defense', classId, modifiers: 7 });
      const expected = baseline + (stage === undefined ? 0 : resolvePersistentBaseConstructionCapacityBonus(stage));
      expect(runtime.getCapacity('guest')).toBe(expected);
      vi.mocked(bridge.isHost).mockReturnValue(false);
      expect(client.getLocalConstructionCapacity()).toBe(expected);
      // Replacing the current World immediately changes the client projection. The old host
      // runtime keeps its own frozen stage until it is replaced together with its World.
      vi.mocked(bridge.getWorldDescriptor).mockReturnValue({ worldRevision: 2 } as never);
      expect(client.getLocalConstructionCapacity()).toBe(baseline);
      expect(runtime.getCapacity('guest')).toBe(expected);
    }
  });

  it.each([2, 3] as const)('uses the same stage %i budget for restore and placement validation', stage => {
    const { runtime, client, placement, session, binding, position } = setup(stage);
    const capacity = runtime.getCapacity('guest');
    // Both stages have enough room for these 33 independent single-cell blueprints.
    const cells = Array.from({ length: 33 }, (_, i) => ({ x: i % 7 - 3, y: Math.floor(i / 7) - 2 }));
    session.contributions.offerContribution({ schemaVersion: 1, ownerId: 'owner-guest', revision: 1,
      constructions: cells.map(({ x, y }, i) => ({ persistentId: `rock-${i}`, placementOrder: i,
        tool: { kind: 'construction', id: 'rock_barrier' }, relativeGridX: x, relativeGridY: y, angle: 0 })) });
    binding.reconcile();
    expect(placement.getUsedCapacity('guest')).toBe(capacity);
    expect(placement.getAllRuntimeRocks()).toHaveLength(capacity);
    expect(session.contributions.getContribution('owner-guest')?.constructions).toHaveLength(cells.length);
    expect(client.getLocalConstructionCapacity()).toBe(capacity);
    expect(runtime.placeInspectorConstruction('guest', 'rock_barrier', position.x, position.y, 100)).toEqual({ ok: false, reason: 'capacity' });
    const removed = placement.getAllRuntimeRocks()[0];
    placement.removeRock(removed.id);
    session.contributions.removeByRuntimeId(removed.id);
    const target = worldCellCenter(resolveActiveArenaWorldMetrics(), removed.gridX, removed.gridY);
    expect(runtime.placeInspectorConstruction('guest', 'rock_barrier', target.x, target.y, 200)).toEqual({ ok: true });
    expect(placement.getUsedCapacity('guest')).toBe(capacity);
  });
});
