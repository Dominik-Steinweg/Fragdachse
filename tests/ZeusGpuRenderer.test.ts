import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 }, Math: {
  Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)),
} }));
const quality = { critical: 1, standard: 1, decorative: 1 };
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityController: () => ({
  getProfile: () => ({ particleFactors: quality }), subscribe: () => () => {},
}) }));
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { GpuVfxLaneId } from '../src/effects/gpu/GpuVfxRenderLanes';
import { GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { ZeusUpgradesGpuRenderer } from '../src/effects/ZeusUpgradesGpuRenderer';
import { buildElectricGroundGeometry } from '../src/effects/ZeusElectricGeometry';
import { makeFakeGpuVfxScene, findFakeLane } from './fakeGpuVfxScene';
import { zeusFixture } from './ZeusTestHelper';
import type { ZeusGround } from '../src/systems/ZeusRuntime';

beforeEach(() => { resetGpuVfxAtlasForTests(); quality.standard = 1; });
function setup() {
  const scene = makeFakeGpuVfxScene(), gpu = new GpuVfxSystem(scene as never);
  const renderer = new ZeusUpgradesGpuRenderer(gpu);
  const f = zeusFixture({ groundEnabled: 1 });
  f.runtime.startBall(f.use, { ...f.movement, radius: 16 }, 0);
  f.runtime.move({ ...f.movement, x: 96, radius: 16 }, 10);
  const target = { x: 100, y: 200, radius: 99 };
  return { ...f, scene, gpu, renderer, target,
    floor: findFakeLane(scene, 'electric-ground'), body: findFakeLane(scene, 'electric-body') };
}

describe('shared electrical GPU material', () => {
  it('emits on GPU depth bands, deduplicates snapshots and follows the body without leaving a ghost', () => {
    const f = setup(), state = f.runtime.snapshot();
    f.renderer.sync(state, 10, () => f.target); f.gpu.update(0);
    expect(f.floor.visible).toBe(true); expect(f.body.visible).toBe(true);
    expect(f.floor.depth).toBeLessThan(f.body.depth);
    const spawned = f.body.members.length;
    for (let i = 0; i < 10; i++) { f.renderer.sync(state, 10, () => f.target); f.gpu.update(0); }
    expect(f.body.members).toHaveLength(spawned);
    f.target.x = 900; f.target.y = -200;
    f.renderer.sync(state, 20, () => f.target); f.gpu.update(1);
    expect(f.body.patched.length).toBeGreaterThan(0);
    expect(f.body.members).toHaveLength(spawned);
    f.renderer.clear(); f.gpu.update(0);
    expect(f.gpu.getLaneStats(GpuVfxLaneId.ElectricBody)!.liveCount).toBe(0);
    expect(f.gpu.getLaneStats(GpuVfxLaneId.ElectricGround)!.liveCount).toBe(0);
    f.gpu.releaseAll(); f.renderer.sync(state, 20, () => f.target); f.gpu.update(0);
    expect(f.body.visible).toBe(true);
    f.renderer.clear(); f.gpu.destroy();
  });
  it('uses the snapshot hitbox, replaces resized shells, and expires even without another snapshot', () => {
    const f = setup();
    const spawned: { x: number; y: number; effect: number }[] = [];
    const spawn = f.gpu.spawn.bind(f.gpu);
    vi.spyOn(f.gpu, 'spawn').mockImplementation((s, ...args) => {
      spawned.push({ x: s.x, y: s.y, effect: s.effect }); return spawn(s, ...args);
    });
    f.renderer.sync(f.runtime.snapshot(), 10, () => f.target); f.gpu.update(0);
    const core = spawned.filter(s => s.effect === GpuVfxEffectId.ElectricBodyCore);
    expect(core.length).toBeGreaterThan(0);
    expect(core.every(s => Math.hypot(s.x - f.target.x, s.y - f.target.y) <= 16)).toBe(true);
    const oldLive = f.gpu.getLaneStats(GpuVfxLaneId.ElectricBody)!.liveCount;
    const smaller = { ...f.runtime.snapshot(), balls: f.runtime.snapshot().balls.map(b => ({ ...b, radius: 8 })) };
    f.renderer.sync(smaller, 10, () => f.target);
    expect(f.gpu.getLaneStats(GpuVfxLaneId.ElectricBody)!.liveCount).toBe(0);
    f.gpu.update(0);
    expect(f.gpu.getLaneStats(GpuVfxLaneId.ElectricBody)!.liveCount).toBe(oldLive);
    f.gpu.update(4000);
    expect(f.gpu.getLaneStats(GpuVfxLaneId.ElectricBody)!.liveCount).toBe(0);
    expect(f.gpu.getLaneStats(GpuVfxLaneId.ElectricGround)!.liveCount).toBe(0);
    f.renderer.clear(); f.gpu.destroy();
  });
  it('keeps the connected cores when decorative quality is reduced', () => {
    quality.standard = 0;
    const f = setup(); f.renderer.sync(f.runtime.snapshot(), 10, () => f.target); f.gpu.update(0);
    const report = f.gpu.buildReport();
    expect(report.effects.find(e => e.id === GpuVfxEffectId.ElectricGroundCore)!.spawns).toBeGreaterThan(0);
    expect(report.effects.find(e => e.id === GpuVfxEffectId.ElectricBodyCore)!.spawns).toBeGreaterThan(0);
    f.renderer.clear(); f.gpu.destroy();
  });
});

describe('electrical ground continuity', () => {
  const segment = (id: number, x: number, y: number, toX: number, toY: number): ZeusGround => ({
    id, ownerId: 'p', from: { x, y, radius: 8 }, to: { x: toX, y: toY, radius: 8 }, createdAt: id, expiresAt: 5000, color: 0,
  });
  it('is independent of movement-step density and duplicate overlapping sources', () => {
    const one = buildElectricGroundGeometry([segment(1, 0, 0, 96, 0)], 0);
    const steps = Array.from({ length: 32 }, (_, i) => segment(i, i * 3, 0, i * 3 + 3, 0));
    const many = buildElectricGroundGeometry(steps, 0);
    expect(many).toEqual(one);
    const duplicates = steps.map(g => ({ ...g, ownerId: 'other' }));
    expect(buildElectricGroundGeometry([...steps, ...duplicates], 0)).toEqual(one);
  });
  it('preserves tight corners and does not connect gaps or expired sections', () => {
    const g = buildElectricGroundGeometry([segment(1, 0, 0, 6, 0), segment(2, 6, 0, 6, 24),
      segment(3, 100, 100, 120, 100)], 0);
    expect(g.nodes.some(n => n.x === 6 && n.y === 0)).toBe(true);
    expect(g.spans.every(s => (s.from.x < 50) === (s.to.x < 50))).toBe(true);
    expect(buildElectricGroundGeometry([segment(1, 0, 0, 96, 0)], 5000)).toEqual({ nodes: [], spans: [] });
  });
});
