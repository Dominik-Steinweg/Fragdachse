import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => ({ ...(await import('../fakeArenaRenderScene')).createFakePhaserModule(), Scene: class {} }));
vi.mock('../../src/effects/postfx/CameraPostFxController', () => ({ CameraPostFxController: class {} }));
vi.mock('../../src/ui/PersistentBaseDragPreview', () => ({ createPersistentBaseDragPreview: vi.fn(() => ({
  setPosition: vi.fn().mockReturnThis(), destroy: vi.fn(),
})) }));

import { PersistentBaseEditorScene } from '../../src/scenes/PersistentBaseEditorScene';
import { PersistentBaseEditorModel } from '../../src/persistentBase/PersistentBaseEditorModel';
import { getStoredCoopDefenseProgress } from '../../src/utils/localPreferences';
import { CELL_SIZE, GAME_WIDTH } from '../../src/config';

function graphics() {
  const result: any = {};
  for (const method of ['clear', 'setVisible', 'setStrokeStyle', 'fillStyle', 'lineStyle', 'fillRect', 'strokeRect'])
    result[method] = vi.fn(() => result);
  return result;
}
function harness(scale = 1) {
  const progress = getStoredCoopDefenseProgress();
  progress.persistentBaseRewardUnlocks = ['base_health_pedestal', 'base_spore_turret'];
  progress.persistentBaseRewardState = { ...progress.persistentBaseRewardState, placements: [
    { rewardId: 'base_health_pedestal', relativeGridX: 0, relativeGridY: 0, angle: 0 },
  ] };
  progress.personalBaseContribution = { ...progress.personalBaseContribution, constructions: [{
    persistentId: 'wall', tool: { kind: 'construction', id: 'rock_barrier' },
    relativeGridX: 1, relativeGridY: 1, angle: 0, placementOrder: 1,
  }] };
  const model = new PersistentBaseEditorModel(progress);
  // Drive the pointer entry points without a DOM or a fake full GPU renderer.
  const scene: any = new PersistentBaseEditorScene({ model, color: 0xffffff,
    newRewardIds: [], close() {}, save: async () => true });
  const world = { anchor: (scene.view.width / CELL_SIZE - 1) / 2, syncObjects: vi.fn() };
  Object.assign(scene, { world, scale: { width: GAME_WIDTH * scale }, preview: graphics(),
    selection: graphics(), grid: graphics(), tableOutline: graphics(), error: graphics(), ui: { add() {} },
    refreshList: vi.fn(() => scene.refreshSelection()),
  });
  const point = (x: number, y: number) => ({ x: x * scale, y: y * scale, id: 1, button: 0 });
  const cell = (x: number, y: number) => point(scene.view.x + (world.anchor + x + .5) * CELL_SIZE,
    scene.view.y + (world.anchor + y + .5) * CELL_SIZE);
  return { scene, model, world, point, cell };
}
const object = { kind: 'reward', id: 'base_health_pedestal' } as const;

describe('base menu drag interaction', () => {
  it('marks a single click without moving or removing a placed list item', () => {
    const { scene, model, world, point } = harness();
    const pointer = point(950, 300);
    scene.beginDrag(object, pointer);
    scene.updateDrag({ ...pointer, x: pointer.x + 1 });
    scene.drop(pointer);
    expect(scene.selected).toEqual(object);
    expect(model.getPosition(object)).toMatchObject({ relativeGridX: 0, relativeGridY: 0 });
    expect(world.syncObjects).not.toHaveBeenCalled();
    expect(scene.dragPreview).toBeNull();
  });
  it.each([.5, 1, 2])('moves the preview, drops into the list and places again at render scale %s', scale => {
    const { scene, model, world, point, cell } = harness(scale);
    scene.beginDrag(object, cell(0, 0)); scene.updateDrag(cell(-1, 1));
    const preview = scene.dragPreview;
    expect(preview.setPosition).toHaveBeenLastCalledWith(cell(-1, 1).x / scale, cell(-1, 1).y / scale);
    const listPoint = point(950, 340);
    scene.updateDrag(listPoint); scene.drop(listPoint);
    expect(model.getPosition(object)).toBeUndefined();
    expect(model.unplaced).toContain(object.id);
    expect(preview.destroy).toHaveBeenCalled();
    scene.beginDrag(object, listPoint); scene.updateDrag(cell(-1, 1)); scene.drop(cell(-1, 1));
    expect(model.getPosition(object)).toMatchObject({ relativeGridX: -1, relativeGridY: 1 });
    expect(scene.world).toBe(world);
    expect(world.syncObjects).toHaveBeenCalledTimes(2);
  });
  it('keeps the original placement after invalid drops or cancellation', () => {
    const { scene, model, world, cell, point } = harness();
    scene.beginDrag(object, cell(0, 0)); scene.updateDrag(cell(1, 1)); scene.drop(cell(1, 1));
    expect(model.getPosition(object)).toMatchObject({ relativeGridX: 0, relativeGridY: 0 });
    scene.beginDrag(object, cell(0, 0)); scene.updateDrag(point(20, 20)); scene.drop(point(20, 20));
    scene.beginDrag(object, cell(0, 0)); scene.updateDrag(cell(-1, 0)); scene.endDrag();
    expect(model.getPosition(object)).toMatchObject({ relativeGridX: 0, relativeGridY: 0 });
    expect(world.syncObjects).not.toHaveBeenCalled();
    expect(scene.dragPreview).toBeNull();
  });
  it('combines open rewards, placed rewards and personal builds in a single list', () => {
    const { scene, model } = harness();
    expect(scene.rows()).toEqual(expect.arrayContaining([
      expect.objectContaining({ object, status: 'placed', personal: false }),
      expect.objectContaining({ object: { kind: 'reward', id: 'base_spore_turret' }, status: 'unplaced', personal: false }),
      expect.objectContaining({ object: { kind: 'construction', id: 'wall' }, status: 'placed', personal: true }),
    ]));
    model.remove({ kind: 'construction', id: 'wall' });
    expect(scene.rows()).toContainEqual(expect.objectContaining({ object: { kind: 'construction', id: 'wall' }, status: 'unplaced', personal: true }));
  });
});
