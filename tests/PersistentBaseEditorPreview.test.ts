import { describe, expect, it } from 'vitest';
import { getCoopDefenseConstructionDefinition } from '../src/config/coopDefenseConstructions';
import { cropArenaLayout } from '../src/arena/ArenaLayoutWindow';
import { resolvePersistentBaseBuildAreaForStage } from '../src/persistentBase/PersistentBaseCore';
import { PersistentBaseEditorModel } from '../src/persistentBase/PersistentBaseEditorModel';
import { resolvePersistentBaseEditorPreview, type PersistentBaseEditorRoom } from '../src/persistentBase/PersistentBaseEditorPreview';
import type { PersistentConstruction, PersistentPlayerBaseContribution } from '../src/persistentBase/PersistentBaseTypes';
import { getStoredCoopDefenseProgress } from '../src/utils/localPreferences';
import type { ArenaLayout } from '../src/types';

const anchor = { gridX: 40, gridY: 20 };
const wall = (persistentId: string, relativeGridX: number, relativeGridY: number, placementOrder = 0): PersistentConstruction => ({
  persistentId, tool: { kind: 'construction', id: 'rock_barrier' }, relativeGridX, relativeGridY, angle: 0, placementOrder,
});
const contribution = (ownerId: string, constructions: PersistentConstruction[]): PersistentPlayerBaseContribution => ({
  schemaVersion: 1, ownerId, revision: 1, constructions,
});

function preview(own: PersistentConstruction[], options: {
  host?: 'local' | 'mate'; mate?: PersistentConstruction[]; capacity?: number; stage?: 0 | 1 | 2;
  quarterTurns?: 0 | 1 | 2 | 3; blocked?: (x: number, y: number) => boolean;
} = {}) {
  const progress = getStoredCoopDefenseProgress();
  progress.persistentBaseAreaStage = 2;
  progress.persistentBaseRewardState = { ...progress.persistentBaseRewardState, placements: [] };
  progress.personalBaseContribution = contribution('owner-local', own);
  const model = new PersistentBaseEditorModel(progress);
  const definition = getCoopDefenseConstructionDefinition('rock_barrier');
  const room: PersistentBaseEditorRoom = {
    localOwnerId: 'owner-local',
    hostOwnerId: options.host === 'mate' ? 'owner-mate' : 'owner-local',
    mates: [{ ownerId: 'owner-mate', color: 0x3366ff, contribution: contribution('owner-mate', options.mate ?? []) }],
    localCapacity: options.capacity ?? 100,
    resolveLocalTool: () => ({ footprint: definition.footprint, capacityCost: definition.capacityCost }),
  };
  return resolvePersistentBaseEditorPreview({ model, room,
    frame: { anchor, quarterTurns: options.quarterTurns ?? 0 },
    siteArea: resolvePersistentBaseBuildAreaForStage(options.stage ?? 2),
    isCellBlocked: options.blocked ?? (() => false) });
}

describe('base editor preview of the host merge', () => {
  it('lets the room host win a shared cell, as in a round', () => {
    const asGuest = preview([wall('mine', 2, 0)], { host: 'mate', mate: [wall('theirs', 2, 0)] });
    expect(asGuest.conflicts.get('mine')).toBe('collision');
    expect(asGuest.mates).toEqual([expect.objectContaining({ key: 'owner-mate:theirs', gridX: 42, gridY: 20, color: 0x3366ff })]);

    const asHost = preview([wall('mine', 2, 0)], { host: 'local', mate: [wall('theirs', 2, 0)] });
    expect(asHost.conflicts.size).toBe(0);
    expect(asHost.mates).toEqual([]);
  });

  it('names the map build area, terrain and capacity as reasons', () => {
    // Radius 6 on the personal plan, but the map freezes a smaller stage.
    expect(preview([wall('far', 6, 0)], { stage: 1 }).conflicts.get('far')).toBe('outside-build-area');
    expect(preview([wall('rock', 2, 0)], { blocked: (x, y) => x === 42 && y === 20 }).conflicts.get('rock')).toBe('authored-collision');
    const capacity = getCoopDefenseConstructionDefinition('rock_barrier').capacityCost;
    expect(preview([wall('a', 2, 0, 0), wall('b', 2, 1, 1)], { capacity }).conflicts.get('b')).toBe('capacity');
  });

  it('places teammates through the host base rotation', () => {
    const turned = preview([], { mate: [wall('theirs', 2, 0)], quarterTurns: 1 });
    expect(turned.mates[0]).toMatchObject({ gridX: 40, gridY: 22 });
  });
});

describe('situation map terrain window', () => {
  it('keeps world coordinates and lets decals follow their renumbered rocks', () => {
    const layout: ArenaLayout = { seed: 3, trees: [{ gridX: 5, gridY: 5 }], tracks: [], dirt: [], powerUpPedestals: [],
      rocks: [{ gridX: 0, gridY: 0 }, { gridX: 10, gridY: 10 }, { gridX: 11, gridY: 10 }],
      decals: [
        { gridX: 10, gridY: 10, textureKey: 'a' as never, offsetX: 0, offsetY: 0, terrain: 'rock' as never, rockIds: [0, 2] },
        { gridX: 0, gridY: 0, textureKey: 'b' as never, offsetX: 0, offsetY: 0, terrain: 'rock' as never, rockIds: [0] },
      ],
      water: [{ gridX: 9, gridY: 9 }, { gridX: 30, gridY: 30 }] };
    const cropped = cropArenaLayout(layout, { minX: 8, minY: 8, maxX: 12, maxY: 12 });
    expect(cropped.rocks).toEqual([{ gridX: 10, gridY: 10 }, { gridX: 11, gridY: 10 }]);
    expect(cropped.decals).toEqual([expect.objectContaining({ gridX: 10, rockIds: [1] })]);
    expect(cropped.water).toEqual([{ gridX: 9, gridY: 9 }]);
    expect(cropped.trees).toEqual([]);
  });
});
