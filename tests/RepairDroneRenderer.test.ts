import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: { Linear: (a: number, b: number, t: number) => a + (b - a) * t,
    Easing: { Sine: { In: (t: number) => 1 - Math.cos(t * Math.PI / 2), Out: (t: number) => Math.sin(t * Math.PI / 2) } } },
  BlendModes: { ADD: 1 },
}));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: () => {} }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityProfile: () => ({ level: 'high' }) }));
vi.mock('../src/arena/BaseRegistry', () => ({ getBaseWorldBounds: () => ({ x: 100, y: 100, width: 128, height: 128 }) }));
vi.mock('../src/world/WorldMetrics', () => ({ resolveActiveArenaWorldMetrics: () => ({}) }));

import { getPipelineAsset } from '../src/config/pipelineAssets';
import { COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG as TIMING, COOP_DEFENSE_OBJECTIVE_REPAIR_TOTAL_MS } from '../src/config/coopDefenseObjectiveRepair';
import { RepairDroneRenderer } from '../src/effects/RepairDroneRenderer';
import { CoopDefenseObjectiveRepairDroneRenderer } from '../src/effects/CoopDefenseObjectiveRepairDroneRenderer';
import { createRepairDroneBody, preloadRepairDroneAssets, updateRepairDroneRotors } from '../src/effects/repairDroneVisuals';
import type { SyncedRepairDrone } from '../src/types';

function fixture() {
  const objects: Record<string, any>[] = [];
  const object = (x = 0, y = 0, texture?: string, frame?: number) => {
    const item: Record<string, any> = { x, y, texture, frame, rotation: 0, visible: true, destroyed: false };
    for (const method of ['setDepth', 'setOrigin', 'setAlpha', 'setScale', 'setBlendMode', 'clear', 'lineStyle', 'lineBetween']) item[method] = () => item;
    item.setPosition = (x: number, y: number) => { Object.assign(item, { x, y }); return item; };
    item.setDisplaySize = (width: number, height: number) => { Object.assign(item, { width, height }); return item; };
    item.setRotation = (rotation: number) => { item.rotation = rotation; return item; };
    item.setVisible = (visible: boolean) => { item.visible = visible; return item; };
    item.setFrame = (frame: number) => { item.frame = frame; return item; };
    item.setStrokeStyle = (_width: number, color: number) => { item.strokeColor = color; return item; };
    item.setTint = vi.fn(() => item);
    item.destroy = () => { item.destroyed = true; };
    objects.push(item);
    return item;
  };
  const scene = { time: { now: 0 }, add: { image: object, circle: object, graphics: object } };
  return { scene, objects, bodies: () => objects.filter(o => typeof o.texture === 'string') };
}

describe('Blender repair drone presentation', () => {
  it('loads the selected sheet with gutters and loops only its flight frames without moving the body', () => {
    const asset = getPipelineAsset('repair-drone'), clip = asset.clips.find(c => c.name === 'move')!;
    const loader = { spritesheet: vi.fn() };
    preloadRepairDroneAssets(loader as never);
    expect(loader.spritesheet).toHaveBeenCalledWith(asset.sheetTextureKey, asset.sheetPath, asset.layout);
    const f = fixture(), body = createRepairDroneBody(f.scene as never, 100, 200);
    body.setRotation(0.7);
    const seen: number[] = [];
    for (let i = 0; i <= clip.frames.length; i++) {
      updateRepairDroneRotors(body, (i + 0.1) * 1000 / clip.frameRate);
      seen.push(f.bodies()[0].frame);
    }
    expect(seen).toEqual([...clip.frames, clip.frames[0]]);
    expect(seen).not.toContain(asset.idleFrame);
    expect(f.bodies()[0]).toMatchObject({ width: 32, height: 32, rotation: 0.7, x: 100, y: 200 });
  });

  it('keeps authored colors and a stable hovering hull, and removes every player visual on an empty snapshot', () => {
    const f = fixture(), renderer = new RepairDroneRenderer(f.scene as never);
    const state: SyncedRepairDrone = { ownerId: 'p', ownerColor: 0x4488ff, x: 100, y: 200, phase: 'orbiting' };
    renderer.syncVisuals([state], []);
    renderer.update(16);
    const body = f.bodies()[0], first = body.frame;
    f.scene.time.now = 25;
    renderer.update(25);
    expect(body.frame).not.toBe(first);
    expect(body.rotation).toBe(0);
    expect(body.setTint).not.toHaveBeenCalled();
    expect(f.objects.some(o => o.strokeColor === state.ownerColor)).toBe(true);
    renderer.syncVisuals([{ ...state, x: 200 }], []);
    renderer.update(16);
    expect(body.rotation).toBeCloseTo(Math.PI / 2);
    renderer.syncVisuals([], []);
    expect(f.objects.every(o => o.destroyed)).toBe(true);
  });

  it('animates mission drones through the repair window, hides the complete pool and reuses it for a later mission', () => {
    const f = fixture(), renderer = new CoopDefenseObjectiveRepairDroneRenderer(f.scene as never);
    renderer.build();
    const count = f.objects.length;
    const snapshot = [{ objectiveId: 'hold', type: 'hold', state: 'completed', stateChangedAtMs: 0 }];
    const configs = [{ id: 'hold', targets: ['outpost'], rewards: { repairTargetOnComplete: true } }];
    const base = { spec: { region: {} }, isDormant: () => false, isDestroyed: () => false,
      getNearestSurfacePoint: () => ({ x: 164, y: 164 }) };
    const bases = { getBase: () => base, getBasesByFaction: () => [] };
    const sync = (elapsed: number) => renderer.sync(snapshot as never, configs as never, bases as never, elapsed, true);
    sync(TIMING.approachMs + 100);
    expect(f.bodies().filter(b => b.visible)).toHaveLength(TIMING.droneCount);
    const first = f.bodies()[0].frame;
    f.scene.time.now = 25;
    sync(TIMING.approachMs + 125);
    expect(f.bodies()[0].frame).not.toBe(first);
    expect(f.bodies().every(b => b.width === 32 && b.height === 32)).toBe(true);
    sync(COOP_DEFENSE_OBJECTIVE_REPAIR_TOTAL_MS + 1);
    expect(f.objects.every(o => !o.visible)).toBe(true);
    sync(TIMING.approachMs + 150);
    expect(f.objects).toHaveLength(count);
    expect(f.bodies().filter(b => b.visible)).toHaveLength(TIMING.droneCount);
    renderer.destroy();
    expect(f.objects.every(o => o.destroyed)).toBe(true);
  });
});
