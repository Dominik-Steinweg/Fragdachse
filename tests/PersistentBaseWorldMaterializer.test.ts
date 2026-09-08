import { describe, expect, it, vi } from 'vitest';
import {
  PersistentBaseWorldMaterializer,
  type PersistentBaseWorldMaterializerOptions,
} from '../src/world/PersistentBaseWorldMaterializer';
import {
  ConstructionWorldRuntime,
  type ConstructionWorldRuntimeOptions,
} from '../src/world/ConstructionWorldRuntime';

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
