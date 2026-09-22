import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => (await import('../fakeArenaRenderScene')).createFakePhaserModule());
vi.mock('../../src/effects/postfx/CameraPostFxController', () => ({ CameraPostFxController: class {} }));

import { PersistentBaseEditorWorld, getPersistentBaseEditorSize } from '../../src/persistentBase/PersistentBaseEditorWorld';
import { GroundSurfaceStreamer, GROUND_PERSISTENT_BASE_GRAVEL_LAYER_ID } from '../../src/arena/chunks/GroundSurfaceStreamer';
import { resolvePersistentBaseBuildAreaForStage } from '../../src/persistentBase/PersistentBaseCore';
import { CELL_SIZE } from '../../src/config';
import { createFakeArenaScene, type FakeRenderTexture } from '../fakeArenaRenderScene';
import { PersistentBaseEditorModel } from '../../src/persistentBase/PersistentBaseEditorModel';
import { getStoredCoopDefenseProgress } from '../../src/utils/localPreferences';
import { RockGridIndex } from '../../src/arena/RockGridIndex';
import { RockVisualStateStore } from '../../src/arena/rocks/RockVisualState';
import { PERSISTENT_BASE_REWARD_IDS } from '../../src/persistentBase/PersistentBaseRewardTypes';
import { getPersistentBaseRewardDefinition } from '../../src/persistentBase/PersistentBaseRewardCatalog';

describe('base editor World terrain', () => {
  it('moves runtime walls without leaving rocks behind and keeps pedestal identity stable', () => {
    const scene = createFakeArenaScene();
    const progress = getStoredCoopDefenseProgress();
    const pedestalId = PERSISTENT_BASE_REWARD_IDS.find(id => getPersistentBaseRewardDefinition(id).category === 'basePedestal')!;
    progress.persistentBaseRewardUnlocks = [pedestalId];
    progress.personalBaseContribution.constructions = [{ persistentId: 'wall', tool: { kind: 'construction', id: 'rock_barrier' },
      relativeGridX: 0, relativeGridY: 0, angle: 0, placementOrder: 1 }];
    const model = new PersistentBaseEditorModel(progress);
    const wall = { kind: 'construction' as const, id: 'wall' };
    const pedestal = { kind: 'reward' as const, id: pedestalId };
    expect(model.move(pedestal, 1, 1)).toBe(true);
    const size = getPersistentBaseEditorSize(model.area), cells = size / CELL_SIZE, anchor = (cells - 1) / 2;
    const states = new RockVisualStateStore();
    const rockGrid = new RockGridIndex([], { cols: cells, rows: cells });
    const powerUps = { syncPedestals: vi.fn(), sync: vi.fn() };
    const shadows = { rebuildStaticLayoutShadows: vi.fn() };
    const world = Object.assign(Object.create(PersistentBaseEditorWorld.prototype), {
      scene, model, size, anchor, color: 0xffffff,
      layout: { seed: 17, rocks: [] }, wallIds: new Map(), pedestalIds: new Map(), turrets: new Map(),
      arena: { rockPhysicsProxies: [], rockVisualStates: states, rockGrid,
        rockGroup: {
          add: (child: { body?: unknown }) => { child.body ??= { updateFromGameObject() {} }; },
          remove: (child: { destroy(): void }) => child.destroy(),
        },
      },
      powerUps, shadows, occluders: { markDirty() {} }, fog: { terrain: { setObstacle() {} } },
    }) as PersistentBaseEditorWorld;
    world.syncObjects();
    const firstId = rockGrid.getIndex(anchor, anchor);
    expect(states.get(firstId)).toMatchObject({ active: true, material: 'walls' });
    const pickupId = powerUps.sync.mock.lastCall![0][0].uid;

    expect(model.move(wall, -1, -1)).toBe(true);
    expect(model.move(pedestal, -1, 1)).toBe(true);
    world.syncObjects();
    expect(rockGrid.getIndex(anchor, anchor)).toBe(-1);
    expect(states.get(firstId)?.active).toBe(false);
    expect(states.get(rockGrid.getIndex(anchor - 1, anchor - 1))).toMatchObject({ active: true, material: 'walls',
      x: (anchor - .5) * CELL_SIZE, y: (anchor - .5) * CELL_SIZE });
    expect(powerUps.sync.mock.lastCall![0][0]).toMatchObject({ uid: pickupId,
      x: (anchor - .5) * CELL_SIZE, y: (anchor + 1.5) * CELL_SIZE });
    expect(powerUps.syncPedestals.mock.lastCall![0][0]).toMatchObject({ id: pickupId,
      x: (anchor - .5) * CELL_SIZE, y: (anchor + 1.5) * CELL_SIZE });

    expect(model.move(wall, 0, 0)).toBe(true);
    world.syncObjects();
    expect(rockGrid.getIndex(anchor, anchor)).toBe(firstId);
    expect(states.get(firstId)).toMatchObject({ active: true, material: 'walls' });
    expect(rockGrid.getIndex(anchor - 1, anchor - 1)).toBe(-1);
    // Shadow replacements preserve the existing baked image until the new bake is ready.
    expect(shadows.rebuildStaticLayoutShadows.mock.calls.every(call => call[2] === true)).toBe(true);
  });

  it.each([0, 1, 2] as const)('finishes real gravel bakes through normal editor frames at base stage %s', stage => {
    const scene = createFakeArenaScene();
    const area = resolvePersistentBaseBuildAreaForStage(stage);
    const size = getPersistentBaseEditorSize(area);
    const anchor = (size / CELL_SIZE - 1) / 2;
    const view = { x: 0, y: 0, width: size, height: size };
    const ground = new GroundSurfaceStreamer({ scene: scene as never,
      frame: { offsetX: 0, offsetY: 0, width: size, height: size },
      layout: { seed: 17, rocks: [], trees: [], dirt: [], tracks: [], decals: [], powerUpPedestals: [] },
      groundCoverPlacements: [], enablePersistentBaseGravel: true,
      persistentBaseGravel: { seed: 17, anchor: { gridX: anchor, gridY: anchor }, buildArea: area },
    });
    // Unrelated animated renderers are ports here; terrain and its scene-local queue are real.
    const world = Object.assign(Object.create(PersistentBaseEditorWorld.prototype), {
      scene, arena: { groundSurface: ground }, shadows: { updateStaticResidency() {} },
      bases: { syncLights() {} }, animations: { update() {} }, powerUps: { updatePedestals() {} },
      gpu: { update() {} }, fog: { update() {} }, lighting: { update() {} }, fx: { update() {} },
    }) as PersistentBaseEditorWorld;
    ground.updateResidency(view);
    expect(ground.isReadyForView(view)).toBe(false);
    for (let frame = 0; frame < 100 && !ground.isReadyForView(view); frame++) world.update(frame * 16, 16, view);
    expect(ground.isReadyForView(view)).toBe(true);
    const gravel = ground.getChunkTexture(GROUND_PERSISTENT_BASE_GRAVEL_LAYER_ID, 0, 0) as unknown as FakeRenderTexture;
    expect(gravel).not.toBeNull();
    expect(gravel.content.length).toBeGreaterThan(0);
    ground.destroy();
    expect(gravel.active).toBe(false);
  });
});
