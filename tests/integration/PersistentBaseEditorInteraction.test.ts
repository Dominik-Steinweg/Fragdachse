import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => ({ ...(await import('../fakeArenaRenderScene')).createFakePhaserModule(), Scene: class {} }));
vi.mock('../../src/effects/postfx/CameraPostFxController', () => ({ CameraPostFxController: class {} }));
vi.mock('../../src/ui/PersistentBaseDragPreview', () => ({ createPersistentBaseDragPreview: vi.fn(() => ({
  setPosition: vi.fn().mockReturnThis(), setScale: vi.fn().mockReturnThis(), destroy: vi.fn(),
})) }));

import { PERSISTENT_BASE_EDITOR_BAKE_BUDGET_MS, PERSISTENT_BASE_EDITOR_WARM_FRAMES, PersistentBaseEditorScene } from '../../src/scenes/PersistentBaseEditorScene';
import { PersistentBaseEditorModel } from '../../src/persistentBase/PersistentBaseEditorModel';
import { getStoredCoopDefenseProgress } from '../../src/utils/localPreferences';
import { CELL_SIZE, GAME_WIDTH } from '../../src/config';
import { type PersistentBaseAreaStage } from '../../src/persistentBase/PersistentBaseCore';
import { getPersistentBaseEditorSize } from '../../src/persistentBase/PersistentBaseEditorWorld';
import type { PersistentBaseEditorRoomBase } from '../../src/persistentBase/PersistentBaseEditorModel';

function graphics() {
  const result: any = {};
  for (const method of ['clear', 'setVisible', 'setStrokeStyle', 'fillStyle', 'lineStyle', 'fillRect', 'strokeRect'])
    result[method] = vi.fn(() => result);
  return result;
}
function harness(scale = 1, stage: PersistentBaseAreaStage = 0, room?: PersistentBaseEditorRoomBase) {
  const progress = getStoredCoopDefenseProgress();
  progress.persistentBaseAreaStage = stage;
  progress.persistentBaseRewardUnlocks = ['base_health_pedestal', 'base_spore_turret'];
  progress.persistentBaseRewardState = { ...progress.persistentBaseRewardState, placements: [
    { rewardId: 'base_health_pedestal', relativeGridX: 0, relativeGridY: 0, angle: 0 },
  ] };
  progress.personalBaseContribution = { ...progress.personalBaseContribution, constructions: [{
    persistentId: 'wall', tool: { kind: 'construction', id: 'rock_barrier' },
    relativeGridX: 1, relativeGridY: 1, angle: 0, placementOrder: 1,
  }] };
  const model = new PersistentBaseEditorModel(progress, undefined, room);
  // Drive the pointer entry points without a DOM or a fake full GPU renderer: a ready stage with a session open.
  const scene: any = new PersistentBaseEditorScene({ terrain: null, model, color: 0xffffff });
  const size = getPersistentBaseEditorSize(model.area);
  const world = { size, anchor: (size / CELL_SIZE - 1) / 2, syncObjects: vi.fn(), setMates: vi.fn(), planRoutes: () => null,
    view: { x: 0, y: 0, width: size, height: size }, siteArea: model.area, isCellBlocked: () => false,
    get frame() { return { anchor: { gridX: this.anchor, gridY: this.anchor }, quarterTurns: model.quarterTurns }; } };
  Object.assign(scene, { world, scale: { width: GAME_WIDTH * scale }, preview: graphics(),
    selection: graphics(), grid: graphics(), conflictHalo: graphics(), tableOutline: graphics(), error: graphics(), ui: { add() {} },
    refreshList: vi.fn(() => scene.refreshSelection()), ready: true, closed: false,
    options: { model, color: 0xffffff, newRewardIds: [], close() {}, save: async () => ({ ok: true }) },
  });
  const point = (x: number, y: number) => ({ x: x * scale, y: y * scale, id: 1, button: 0 });
  const cell = (x: number, y: number) => point(scene.view.x + (world.anchor + x + .5) * CELL_SIZE * scene.worldZoom,
    scene.view.y + (world.anchor + y + .5) * CELL_SIZE * scene.worldZoom);
  return { scene, model, world, point, cell };
}
const object = { kind: 'reward', id: 'base_health_pedestal' } as const;

describe('base menu drag interaction', () => {
  it('prepares the stage hidden with the background budget, faster while a player waits, then rests', async () => {
    const { scene, world } = harness(1, 11);
    let ready = false;
    Object.assign(world, { update: vi.fn(), isReadyForView: vi.fn(() => ready) });
    Object.assign(scene, { ready: false, closed: true, options: null });
    const view = { x: 0, y: 0, width: world.size, height: world.size };
    scene.update(0, 16);
    expect(world.update).toHaveBeenLastCalledWith(0, 16, view, PERSISTENT_BASE_EDITOR_BAKE_BUDGET_MS.background);
    scene.setUrgent(true);
    scene.update(16, 16);
    expect(world.update).toHaveBeenLastCalledWith(16, 16, view, PERSISTENT_BASE_EDITOR_BAKE_BUDGET_MS.urgent);
    expect(scene.isReady()).toBe(false);
    const whenReady = scene.whenReady();
    const camera = { setAlpha: vi.fn() };
    Object.assign(scene, { cameras: { cameras: [camera] } });
    ready = true;
    // Hidden cameras never draw: the stage first draws a few frames at an invisible alpha.
    for (let frame = 0; frame < PERSISTENT_BASE_EDITOR_WARM_FRAMES; frame++) {
      scene.update(32 + frame * 16, 16);
      expect(scene.isReady()).toBe(false);
      expect(camera.setAlpha).toHaveBeenLastCalledWith(expect.closeTo(0, 2));
      expect(camera.setAlpha.mock.lastCall[0]).toBeGreaterThan(0);
    }
    scene.update(64, 16);
    await expect(whenReady).resolves.toBeUndefined();
    expect(scene.isReady()).toBe(true);
    expect(camera.setAlpha).toHaveBeenLastCalledWith(0);
    // Ready and without a session, the stage rests until the next one.
    const calls = world.update.mock.calls.length;
    scene.update(80, 16);
    expect(world.update).toHaveBeenCalledTimes(calls);
  });
  it('builds in slices, and a heavy step waits for a calm lobby unless a player waits', () => {
    const { scene } = harness();
    Object.assign(scene, { ready: false, closed: true, options: null });
    const ran: string[] = [];
    scene.building = (function* () { ran.push('a'); yield; ran.push('b'); yield 'heavy'; ran.push('heavy'); yield; ran.push('c'); })();
    scene.setCalm(false);
    scene.update(0, 16);
    scene.update(16, 16);
    expect(ran).toEqual(['a', 'b']);
    scene.setCalm(true);
    scene.update(32, 16);
    expect(ran).toEqual(['a', 'b', 'heavy', 'c']);
    expect(scene.building).toBeNull();
    const urgent: string[] = [];
    scene.building = (function* () { yield 'heavy'; urgent.push('heavy'); yield 'heavy'; urgent.push('heavier'); })();
    scene.setCalm(false); scene.setUrgent(true);
    scene.update(48, 16);
    expect(urgent).toEqual(['heavy', 'heavier']);
  });
  it.each([false, true])('shows a session on the ready stage at once (transition: %s)', transitioning => {
    const { scene } = harness(1, 11);
    const camera = { setAlpha: vi.fn() };
    const presented = vi.fn(), revealed = vi.fn();
    Object.assign(scene, { cameras: { cameras: [camera] },
      input: { enabled: false, keyboard: { enabled: false, resetKeys: vi.fn() } },
      tweens: { add: vi.fn((config: any) => { config.targets.alpha = config.alpha; config.onUpdate(); config.onComplete(); return { remove() {} }; }) } });
    if (transitioning) scene.options.presented = presented;
    scene.options.revealed = revealed;
    scene.getTransitionView().setAlpha(0);
    scene.setTransitionInputBlocked(false);
    expect(scene.input.enabled).toBe(false);
    scene.present();
    expect(revealed).toHaveBeenCalledTimes(1);
    if (transitioning) {
      expect(presented).toHaveBeenCalledTimes(1);
      expect(scene.input.enabled).toBe(false);
      presented.mock.calls[0][0].setAlpha(1);
      scene.setTransitionInputBlocked(false);
    } else {
      // Its own short fade-in.
      expect(scene.tweens.add).toHaveBeenCalledWith(expect.objectContaining({ duration: PersistentBaseEditorScene.REVEAL_MS }));
    }
    expect(camera.setAlpha).toHaveBeenLastCalledWith(1);
    expect(scene.input.enabled).toBe(true);
    expect(scene.input.keyboard.enabled).toBe(true);
  });
  it.each([0, 1, 2] as const)('retains unscaled campaign geometry at stage %s', stage => {
    const { scene, world } = harness(1, stage);
    expect(scene.worldZoom).toBe(1);
    expect(scene.view.width).toBe(world.size);
  });
  it.each([.5, 1, 2])('fits the largest base and places objects at its edge at render scale %s', scale => {
    const { scene, model, cell, point } = harness(scale, 11);
    expect(scene.worldZoom).toBeLessThan(1);
    expect(scene.view.x).toBeGreaterThanOrEqual(88);
    expect(scene.view.x + scene.view.width).toBeLessThanOrEqual(1088);
    for (const [x, y] of [[15, 0], [-15, 0], [0, 15], [0, -15]]) {
      expect(scene.cellAt(cell(x, y))).toEqual({ x, y });
    }
    const wall = { kind: 'construction', id: 'wall' } as const;
    scene.beginDrag(wall, cell(1, 1)); scene.updateDrag(cell(15, 0));
    expect(scene.dragPreview.setScale).toHaveBeenLastCalledWith(scene.worldZoom);
    expect(scene.dragPreview.setPosition).toHaveBeenLastCalledWith(cell(15, 0).x / scale, cell(15, 0).y / scale);
    scene.drop(cell(15, 0));
    expect(model.getPosition(wall)).toMatchObject({ relativeGridX: 15, relativeGridY: 0 });
    expect(model.validate(wall, 16, 0)).toBe('outside');
    expect(scene.cellAt(point(scene.view.x - 1, scene.view.y))).toBeNull();
  });
  it('marks a single click without moving or removing a placed list item', () => {
    const { scene, model, world, point } = harness();
    const pointer = point(1300, 520);
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
    const listPoint = point(1300, 680);
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
  it('turns pointer cells back into the canonical draft after the host rotated the base', () => {
    const { scene, model, cell } = harness();
    expect(model.rotate()).toBe(true);
    const wall = { kind: 'construction', id: 'wall' } as const;
    // Canonical (1, 1) stands at world offset (-1, 1) after one clockwise quarter turn.
    expect(scene.cellAt(cell(-1, 1))).toEqual({ x: 1, y: 1 });
    scene.beginDrag(wall, cell(-1, 1)); scene.updateDrag(cell(2, 0)); scene.drop(cell(2, 0));
    expect(model.getPosition(wall)).toMatchObject({ relativeGridX: 0, relativeGridY: -2 });
    expect(model.dirty).toBe(true);
  });
  it('shows a guest the room rewards without letting them move', () => {
    const { scene, model } = harness(1, 0, { editable: false, quarterTurns: 2,
      placements: [{ rewardId: 'base_spore_turret', relativeGridX: -1, relativeGridY: 1, angle: 0 }] });
    expect(model.rotate()).toBe(false);
    expect(model.quarterTurns).toBe(2);
    expect(model.validate({ kind: 'reward', id: 'base_spore_turret' }, 1, 1)).toBe('locked');
    const rows = scene.rows();
    expect(rows).toContainEqual(expect.objectContaining({ object: undefined, status: 'placed', personal: false }));
    expect(rows).toContainEqual(expect.objectContaining({ object: { kind: 'construction', id: 'wall' }, personal: true }));
    expect(rows.some((row: { status: string }) => row.status === 'missed')).toBe(false);
  });
});
