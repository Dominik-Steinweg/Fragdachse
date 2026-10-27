import { RockGridIndex } from '../src/arena/RockGridIndex';
import { PlacementSystem } from '../src/systems/PlacementSystem';
import { COOP_DEFENSE_CONSTRUCTIONS } from '../src/config/coopDefenseConstructions';
import { resolveActiveArenaWorldMetrics } from '../src/world/WorldMetrics';
import { PersistentBaseWorldBinding } from '../src/world/PersistentBaseWorldBinding';
import { PersistentBaseRewardStore } from '../src/persistentBase/PersistentBaseRewardStore';
import { PersistentBaseContributionStore } from '../src/persistentBase/PersistentBaseContributionStore';
import { DEFAULT_PERSISTENT_BASE_BUILD_AREA } from '../src/persistentBase/PersistentBaseCore';
import type { WorldPersistentBaseSite } from '../src/world/WorldRuntimeContext';
import { describe, expect, it, vi } from 'vitest';
import {
  PersistentBaseWorldMaterializer,
  type PersistentBaseWorldMaterializerOptions,
} from '../src/world/PersistentBaseWorldMaterializer';
import {
  ConstructionWorldRuntime,
  type ConstructionWorldRuntimeOptions,
} from '../src/world/ConstructionWorldRuntime';

vi.mock('phaser', () => ({ Math: { Clamp: (v: number, min: number, max: number) => Math.max(min, Math.min(max, v)) } }));

describe('PersistentBaseWorldMaterializer build revision gate', () => {
  it('does not resolve restore tools when the build revision is unchanged', () => {
    const signatures = new Map<string, string>();
    let playerId = 'player';
    let buildRevision = 7;
    const resolveRestoreTools = vi.fn(() => []);
    const options = {
      binding: { compositeSignatures: signatures },
      contributions: { ownerIds: ['owner'] },
      rewards: {},
      placementSystem: {},
      powerUpSystem: null,
      baseManager: null,
      getSite: () => null,
      rockVisualHelper: {},
      isHost: () => true,
      getMapId: () => null,
      getLocalOwnerId: () => 'owner',
      resolvePlayerIdForOwner: () => playerId,
      getPlayerColor: () => 0xffffff,
      construction: {
        getCapacity: () => 100,
        getBuildRevision: () => buildRevision,
        getOwnership: () => 'host-persistent',
        resolveRestoreTools,
        materializeRestoreCandidate: () => null,
        materializeRewardConstruction: () => null,
        releaseRuntime: () => undefined,
      },
      emitRestoreAdded: () => undefined,
      emitGridChanged: () => undefined,
      onDiagnosticEvent: () => undefined,
    } as unknown as PersistentBaseWorldMaterializerOptions;

    const materializer = new PersistentBaseWorldMaterializer(options);
    const reconcile = vi.spyOn(materializer, 'reconcile');
    materializer.refreshForRelevantBuildChanges();
    materializer.refreshForRelevantBuildChanges();

    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(resolveRestoreTools).not.toHaveBeenCalled();
    buildRevision += 1;
    materializer.refreshForRelevantBuildChanges();
    expect(reconcile).toHaveBeenCalledTimes(2);
    playerId = 'reconnected-player';
    materializer.refreshForRelevantBuildChanges();
    expect(reconcile).toHaveBeenCalledTimes(3);
  });

  it('keeps a fresh but semantically identical lobby snapshot on the same revision', () => {
    let call = 0;
    const runtime = new ConstructionWorldRuntime({
      getGameMode: () => 'coop_defense',
      getCurrentLoadout: () => {
        call += 1;
        return {
          utility: 'ROCK_BARRIER',
          coopDefenseClassId: 'inspector_gadachs',
          tools: [{ kind: 'utility', id: 'ROCK_BARRIER' }],
        } as never;
      },
    } as unknown as ConstructionWorldRuntimeOptions);

    expect(runtime.getPersistentBaseBuildRevision('player')).toBe(1);
    expect(runtime.getPersistentBaseBuildRevision('player')).toBe(1);
    expect(call).toBe(2);
  });
});

describe('destructible persistent reward lifetime', () => {
  it('materializes all cells, reserves them after destruction, and restores only in the next mission', () => {
    let revision = 1;
    const grid = new RockGridIndex([]);
    const placement = new PlacementSystem({ seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [] },
      grid, { getAllPlayers: () => [] } as never, resolveActiveArenaWorldMetrics());
    const rewards = new PersistentBaseRewardStore();
    const record = { rewardId: 'base_watchtower' as const, relativeGridX: 1, relativeGridY: 1, angle: 0 };
    rewards.placeReward(record);
    const contributions = new PersistentBaseContributionStore();
    const binding = new PersistentBaseWorldBinding({ finalizeRuntimeObjects: () => {}, releaseRewardRuntime: () => {} });
    const site = { baseId: 'base', anchor: { gridX: 10, gridY: 10 }, orientation: 'open-left', buildArea: DEFAULT_PERSISTENT_BASE_BUILD_AREA } as WorldPersistentBaseSite;
    let materializer: PersistentBaseWorldMaterializer;
    const construction = new ConstructionWorldRuntime({ placementSystem: placement,
      rockVisualHelper: { removePlaceableRockVisual: () => {}, updatePlaceableRock: () => {} },
      emitGridChanged: () => materializer.reconcile(),
      onConstructionDestroyed: (rock, cause) => {
        if (rock.persistentRewardId && (cause === 'damage' || cause === 'decay')) binding.markRewardDestroyed(rock.persistentRewardId);
      },
    } as ConstructionWorldRuntimeOptions);
    materializer = new PersistentBaseWorldMaterializer({
      binding, contributions, rewards, placementSystem: placement, powerUpSystem: null, baseManager: null,
      getSite: () => site, getMissionRevision: () => revision, isHost: () => true, getMapId: () => '16',
      getLocalOwnerId: () => 'owner', resolvePlayerIdForOwner: () => 'player', getPlayerColor: () => 0,
      rockVisualHelper: { gridToWorld: (x, y) => ({ x, y }), materializePlaceableRock: () => {} },
      construction: { getCapacity: () => 20, getBuildRevision: () => 0, getOwnership: () => 'host-persistent',
        resolveRestoreTools: () => [{ id: 'rock_barrier', footprint: [{ dx: 0, dy: 0 }], capacityCost: 1, unlocked: true, active: true } as never],
        materializeRestoreCandidate: (candidate, player, color, ownership) => placement.materializePersistentPlaceable(COOP_DEFENSE_CONSTRUCTIONS.rock_barrier, candidate.gridX, candidate.gridY, 0, player, color, ownership),
        materializeRewardConstruction: (id, reward, x, y, angle, owner, color) => placement.materializePersistentBaseReward(COOP_DEFENSE_CONSTRUCTIONS[id], reward, x, y, angle, owner, color),
        releaseRuntime: () => {},
      },
      emitRestoreAdded: () => {}, emitGridChanged: () => {}, onDiagnosticEvent: () => {},
    });
    binding.setMaterializer(materializer);
    materializer.reconcile();
    const tower = placement.getAllRuntimeRocks()[0];
    expect(tower.kind).toBe('watchtower');
    for (const { dx, dy } of COOP_DEFENSE_CONSTRUCTIONS.watchtower.footprint) expect(placement.getRuntimeRockAt(11 + dx, 11 + dy)?.id).toBe(tower.id);
    expect(construction.commitDamage(tower.id, tower.maxHp).kind).toBe('applied');
    // A contribution overlapping a non-anchor cell remains suppressed even while the reward is absent.
    contributions.offerContribution({ schemaVersion: 1, ownerId: 'owner', revision: 1, constructions: [{
      persistentId: 'wall', tool: { kind: 'construction', id: 'rock_barrier' }, relativeGridX: 2, relativeGridY: 2, angle: 0, placementOrder: 0,
    }] });
    materializer.reconcile(); materializer.refreshForRelevantBuildChanges();
    expect(materializer.materializeRewardPlacement(record)).toBeNull();
    expect(placement.getAllRuntimeRocks()).toEqual([]);
    expect(rewards.getState().placements).toEqual([record]);
    revision += 1; materializer.reconcile();
    expect(placement.getAllRuntimeRocks()).toHaveLength(1);
    expect(placement.getAllRuntimeRocks()[0]).toMatchObject({ kind: 'watchtower', gridX: 11, gridY: 11, hp: COOP_DEFENSE_CONSTRUCTIONS.watchtower.maxHp });
    expect(placement.getAllRuntimeRocks()[0].id).not.toBe(tower.id);
  });
});
