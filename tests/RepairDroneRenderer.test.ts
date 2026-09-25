import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: { Linear: (a: number, b: number, t: number) => a + (b - a) * t,
    Easing: { Sine: { In: (t: number) => 1 - Math.cos(t * Math.PI / 2), Out: (t: number) => Math.sin(t * Math.PI / 2) } } },
  BlendModes: { ADD: 1 },
}));
vi.mock('../src/effects/EffectUtils', () => ({ registerGraphicsObject: () => {} }));
const quality = vi.hoisted(() => ({ level: 'high' }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityProfile: () => quality }));
vi.mock('../src/arena/BaseRegistry', () => ({ getBaseWorldBounds: () => ({ x: 100, y: 100, width: 128, height: 128 }) }));
vi.mock('../src/world/WorldMetrics', () => ({ resolveActiveArenaWorldMetrics: () => ({}) }));

import { getPipelineAsset } from '../src/config/pipelineAssets';
import { COOP_DEFENSE_OBJECTIVE_REPAIR_CONFIG as TIMING, COOP_DEFENSE_OBJECTIVE_REPAIR_TOTAL_MS } from '../src/config/coopDefenseObjectiveRepair';
import { RepairDroneRenderer } from '../src/effects/RepairDroneRenderer';
import { CoopDefenseObjectiveRepairDroneRenderer } from '../src/effects/CoopDefenseObjectiveRepairDroneRenderer';
import { createRepairDroneBody, preloadRepairDroneAssets, updateRepairDroneRotors } from '../src/effects/repairDroneVisuals';
import { RepairDroneEffects } from '../src/effects/RepairDroneEffects';
import { setEmissiveScale } from '../src/effects/EmissiveScale';
import type { SyncedRepairDrone } from '../src/types';

function fixture() {
  const objects: Record<string, any>[] = [];
  const object = (x = 0, y = 0, texture?: string, frame?: number) => {
    const item: Record<string, any> = { x, y, texture, frame, rotation: 0, visible: true, destroyed: false, commands: [] };
    for (const method of ['setDepth', 'setOrigin', 'setScale']) item[method] = () => item;
    for (const method of ['lineStyle', 'lineBetween', 'beginPath', 'moveTo', 'lineTo', 'strokePath', 'arc', 'fillStyle', 'fillCircle']) {
      item[method] = (...args: number[]) => { item.commands.push({ op: method, args }); return item; };
    }
    item.clear = () => { item.commands = []; return item; };
    item.setAlpha = (alpha: number) => { item.alpha = alpha; return item; };
    item.setBlendMode = (blendMode: number) => { item.blendMode = blendMode; return item; };
    item.setPosition = (x: number, y: number) => { Object.assign(item, { x, y }); return item; };
    item.setDisplaySize = (width: number, height: number) => { Object.assign(item, { width, height }); return item; };
    item.setRotation = (rotation: number) => { item.rotation = rotation; return item; };
    item.setVisible = (visible: boolean) => { item.visible = visible; return item; };
    item.setFrame = (frame: number) => { item.frame = frame; return item; };
    item.setTint = vi.fn(() => item);
    item.destroy = () => { item.destroyed = true; };
    objects.push(item);
    return item;
  };
  const scene = { time: { now: 0 }, add: { image: object, graphics: object } };
  return { scene, objects, bodies: () => objects.filter(o => typeof o.texture === 'string') };
}

function lightingFixture() {
  const active = new Set<string>();
  return { active,
    setLight: vi.fn((key: string, _preset: string, _x: number, _y: number) => { active.add(key); }),
    releaseLight: vi.fn((key: string) => { active.delete(key); }),
  };
}

afterEach(() => { quality.level = 'high'; setEmissiveScale(1); });

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
    expect(f.objects.some(o => o.commands.some((c: any) => c.op === 'lineStyle' && c.args[1] === state.ownerColor))).toBe(true);
    renderer.syncVisuals([{ ...state, x: 200 }], []);
    renderer.update(16);
    expect(body.rotation).toBeCloseTo(Math.PI / 2);
    renderer.syncVisuals([], []);
    expect(f.objects.every(o => o.destroyed)).toBe(true);
  });

  it('animates mission drones through the repair window, hides the complete pool and reuses it for a later mission', () => {
    const f = fixture(), renderer = new CoopDefenseObjectiveRepairDroneRenderer(f.scene as never);
    const lighting = lightingFixture();
    renderer.build();
    renderer.setLightingSystem(lighting as never);
    const count = f.objects.length;
    const snapshot = [{ objectiveId: 'hold', type: 'hold', state: 'completed', stateChangedAtMs: 0 }];
    const configs = [{ id: 'hold', targets: ['outpost'], rewards: { repairTargetOnComplete: true } }];
    const base = { spec: { region: {} }, isDormant: () => false, isDestroyed: () => false,
      // A drone above a solid base cell receives its probe itself as the nearest surface point.
      getNearestSurfacePoint: (x: number, y: number) => ({ x, y }) };
    const bases = { getBase: () => base, getBasesByFaction: () => [] };
    const sync = (elapsed: number) => renderer.sync(snapshot as never, configs as never, bases as never, elapsed, true);
    sync(TIMING.approachMs / 2);
    expect(lighting.active.size).toBe(0);
    sync(TIMING.approachMs + 100);
    expect(lighting.active.size).toBe(TIMING.droneCount);
    const [, , contactX, contactY] = lighting.setLight.mock.calls[0];
    expect(Math.hypot(contactX - f.bodies()[0].x, contactY - f.bodies()[0].y)).toBeGreaterThan(16);
    expect(f.bodies().filter(b => b.visible)).toHaveLength(TIMING.droneCount);
    const first = f.bodies()[0].frame;
    f.scene.time.now = 25;
    sync(TIMING.approachMs + 125);
    expect(f.bodies()[0].frame).not.toBe(first);
    expect(f.bodies().every(b => b.width === 32 && b.height === 32)).toBe(true);
    sync(TIMING.approachMs + TIMING.repairMs + 1);
    expect(lighting.active.size).toBe(0);
    expect(f.objects.filter(o => !o.texture).every(o => !o.visible && o.commands.length === 0)).toBe(true);
    sync(COOP_DEFENSE_OBJECTIVE_REPAIR_TOTAL_MS + 1);
    expect(f.objects.every(o => !o.visible)).toBe(true);
    sync(TIMING.approachMs + 150);
    expect(f.objects).toHaveLength(count);
    expect(f.bodies().filter(b => b.visible)).toHaveLength(TIMING.droneCount);
    renderer.destroy();
    expect(f.objects.every(o => o.destroyed)).toBe(true);
    expect(lighting.active.size).toBe(0);
  });

  it('ends player work when the repair phase or target disappears, and releases lights on teardown', () => {
    const f = fixture(), renderer = new RepairDroneRenderer(f.scene as never), lighting = lightingFixture();
    renderer.setLightingSystem(lighting as never);
    const state: SyncedRepairDrone = { ownerId: 'p', ownerColor: 0x4488ff, x: 100, y: 200,
      phase: 'repairing', targetConstructionId: 42 };
    const construction = { id: 42, gridX: 8, gridY: 8, constructionId: 'wall' };
    renderer.syncVisuals([state], [construction] as never);
    renderer.update(16);
    expect(lighting.active.size).toBe(1);
    renderer.syncVisuals([{ ...state, phase: 'returning' }], [construction] as never);
    renderer.update(16);
    expect(lighting.active.size).toBe(0);
    expect(f.objects.find(o => o.blendMode === 1)?.visible).toBe(false);
    renderer.syncVisuals([state], []);
    renderer.update(16);
    expect(lighting.active.size).toBe(0);
    renderer.syncVisuals([state], [construction] as never);
    renderer.update(16);
    expect(lighting.active.size).toBe(1);
    renderer.destroyAll();
    expect(lighting.active.size).toBe(0);
    expect(f.objects.every(o => o.destroyed)).toBe(true);
  });

  it.each(['high', 'low'])('keeps the two tool origins and active repair contact readable at %s quality without allocating per frame', level => {
    quality.level = level;
    const f = fixture(), effects = new RepairDroneEffects(f.scene as never, 'test');
    const body = { x: 100, y: 200, rotation: 0 }, contact = { id: 'target', x: 100, y: 100 };
    const allocated = f.objects.length;
    for (let now = 0; now < 1000; now += 16) effects.update(body, contact, now);
    expect(f.objects).toHaveLength(allocated);
    expect(f.objects.every(o => o.visible && o.commands.length > 0)).toBe(true);
    const starts = f.objects[0].commands.filter((c: any) => c.op === 'moveTo').map((c: any) => c.args);
    expect(starts.some(([x, y]: number[]) => x < body.x && y < body.y)).toBe(true);
    expect(starts.some(([x, y]: number[]) => x > body.x && y < body.y)).toBe(true);
    const spots = f.objects[0].commands.filter((c: any) => c.op === 'fillCircle');
    expect(spots.some((c: any) => Math.hypot(c.args[0] - contact.x, c.args[1] - contact.y) < 8)).toBe(true);
    effects.update(body, null, 1000);
    expect(f.objects.every(o => !o.visible && o.commands.length === 0)).toBe(true);
    effects.destroy();
  });

  it('balances only additive light with daylight and clears all geometry and keyed light when hidden or rebound', () => {
    const f = fixture(), effects = new RepairDroneEffects(f.scene as never, 'repair:test');
    const oldLighting = lightingFixture(), newLighting = lightingFixture();
    const body = { x: 10, y: 20, rotation: Math.PI / 2 }, contact = { id: 'target', x: 60, y: 20 };
    setEmissiveScale(0.4);
    effects.setLightingSystem(oldLighting as never);
    effects.update(body, contact, 100, 0.5);
    expect(f.objects.find(o => o.blendMode === 1)?.alpha).toBeCloseTo(0.2);
    expect(f.objects.find(o => o.blendMode !== 1)?.alpha).toBe(0.5);
    effects.setLightingSystem(newLighting as never);
    expect(oldLighting.releaseLight).toHaveBeenCalledWith('repair:test', { immediate: true });
    effects.update(body, contact, 200);
    expect(newLighting.active.size).toBe(1);
    effects.hide();
    expect(newLighting.active.size).toBe(0);
    expect(f.objects.every(o => !o.visible && o.commands.length === 0)).toBe(true);
    effects.update(body, { id: 'replacement', x: body.x, y: body.y }, 220);
    expect(f.objects.flatMap(o => o.commands.flatMap((c: any) => c.args)).every(Number.isFinite)).toBe(true);
    effects.destroy();
    expect(f.objects.every(o => o.destroyed)).toBe(true);
    expect(newLighting.active.size).toBe(0);
  });
});
