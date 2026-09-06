import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Math: {
    FloatBetween: (min: number, max: number) => min + Math.random() * (max - min),
    Distance: { Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1) },
    Easing: { Quadratic: { Out: (t: number) => t * (2 - t) } },
  },
}));

const qualityFactors = { critical: 1, standard: 1, decorative: 1 };
vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: qualityFactors }),
    subscribe: () => () => {},
  }),
}));

import { RocketRenderer } from '../src/effects/RocketRenderer';
import { TracerRenderer } from '../src/effects/TracerRenderer';
import { ProjectileBurnRenderer } from '../src/effects/ProjectileBurnRenderer';
import { GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { gpuVfxEasedBase } from '../src/effects/gpu/GpuVfxMember';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { DEPTH } from '../src/config';
import { evaluateFakeAnimation, findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function setup() {
  const scene = makeFakeGpuVfxScene();
  const registry = new GpuVfxSystem(scene as never);
  const renderer = new RocketRenderer(scene as never);
  renderer.generateTextures();
  renderer.registerGpuVfx(registry);
  return { scene, registry, renderer, smoke: findFakeLane(scene, 'rocket-smoke') };
}

function fly(renderer: RocketRenderer, registry: GpuVfxSystem, id = 1, x = 60, y = 0): void {
  renderer.createVisual(id, 0, 0, 10, 0xff0000, 0x00ff00, 0x445566);
  renderer.emitTrailSegment(id, {
    from: { sequence: 1, timeMs: 0, x: 0, y: 0, vx: x * 60, vy: y * 60 },
    to: { sequence: 2, timeMs: 16, x, y, vx: x * 60, vy: y * 60 }, ageMs: 0,
  }, 10, 1, 0x445566);
  registry.update(0);
}

beforeEach(() => {
  resetGpuVfxAtlasForTests();
  qualityFactors.standard = 1;
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => vi.restoreAllMocks());

describe('rocket smoke path particles', () => {
  it('distributes smoke along the travelled segment with its local nozzle offset', () => {
    const { renderer, registry, smoke } = setup();
    fly(renderer, registry);
    const puffs = smoke.edited.map(i => smoke.members[i]);
    expect(puffs.length).toBeGreaterThan(1);
    const xs = puffs.map(p => evaluateFakeAnimation(p.x, 0));
    expect(Math.min(...xs)).toBeLessThan(10);
    expect(Math.max(...xs)).toBeGreaterThan(40);
    expect(smoke.blendMode).toBe(0);
    for (const p of puffs) {
      expect(evaluateFakeAnimation(p.y, 0)).toBeCloseTo(0);
      expect(evaluateFakeAnimation(p.scaleX, 0.5)).toBeGreaterThan(evaluateFakeAnimation(p.scaleX, 0));
      expect(evaluateFakeAnimation(p.alpha, 0.999)).toBeCloseTo(0);
    }
  });

  it('samples the outgoing bounce leg independently of the incoming direction', () => {
    const { renderer, registry, smoke } = setup();
    fly(renderer, registry);
    const count = smoke.edited.length;
    renderer.emitTrailSegment(1, {
      from: { sequence: 2, timeMs: 16, x: 60, y: 0, vx: 0, vy: 1000 },
      to: { sequence: 3, timeMs: 32, x: 60, y: 60, vx: 0, vy: 1000 }, ageMs: 0,
    }, 10, 1, 0x445566);
    registry.update(0);
    for (const index of smoke.edited.slice(count)) expect(evaluateFakeAnimation(smoke.members[index].x, 0)).toBeCloseTo(60);
  });

  it('leaves emitted smoke alive after the rocket and clears it on world teardown', () => {
    const { renderer, registry } = setup();
    fly(renderer, registry);
    const alive = registry.getStats()!['rocket-smoke'].liveCount;
    expect(alive).toBeGreaterThan(0);
    renderer.destroyVisual(1);
    expect(registry.getStats()!['rocket-smoke'].liveCount).toBe(alive);
    renderer.destroyAll();
    expect(registry.getStats()!['rocket-smoke'].liveCount).toBe(0);
  });

  it('does not replay suppressed paths and removes smoke at zero standard quality', () => {
    const { renderer, registry, smoke } = setup();
    registry.setSuppressed(true);
    fly(renderer, registry);
    registry.setSuppressed(false);
    registry.update(16);
    expect(smoke.edited).toHaveLength(0);
    qualityFactors.standard = 0;
    const other = setup();
    fly(other.renderer, other.registry);
    expect(other.smoke.edited).toHaveLength(0);
  });

  it('bounds a hitch without rewriting live members and retires their remaining lifetime', () => {
    const { renderer, registry, smoke } = setup();
    fly(renderer, registry, 1, 100000);
    const writes = smoke.edited.length;
    expect(writes).toBeGreaterThan(0);
    expect(writes).toBeLessThan(100);
    registry.update(100);
    expect(smoke.edited.length).toBe(writes);
    renderer.destroyVisual(1);
    registry.update(1100);
    expect(registry.getStats()!['rocket-smoke'].liveCount).toBe(0);
  });
});

describe('gpu vfx eased base', () => {
  it('uses historical creation time and only the remaining GPU pool lifetime', () => {
    const { scene, registry } = setup();
    const lane = findFakeLane(scene, 'flight-signature');
    lane.timeElapsed = 200;
    const spec = registry.createSpec(GpuVfxEffectId.FlightCore);
    spec.lifeMs = 100;
    const source = registry.createSource(GpuVfxEffectId.FlightCore);
    expect(registry.spawn(spec, source, 0, 60)).toBe(true);
    expect(lane.members[lane.edited[0]].creationTime).toBe(140);
    registry.update(39);
    expect(registry.getStats()!['flight-signature'].liveCount).toBe(1);
    registry.update(2);
    expect(registry.getStats()!['flight-signature'].liveCount).toBe(0);
    expect(registry.spawn(spec, source, 41, 100)).toBe(false);
  });

  it('keeps essential core geometry when wake quality is disabled and does not edit living strips', () => {
    qualityFactors.standard = 0; qualityFactors.decorative = 0;
    const { scene, registry } = setup();
    const tracer = new TracerRenderer(scene as never);
    tracer.registerGpuVfx(registry);
    tracer.createTracer(1, 0, 0, { profile: 'heavy' }, 0xffaa00);
    tracer.addSegment(1, { from: { sequence: 1, timeMs: 0, x: 0, y: 0, vx: 1000, vy: 0 },
      to: { sequence: 2, timeMs: 20, x: 20, y: 0, vx: 0, vy: 1000 }, ageMs: 0 });
    tracer.addSegment(1, { from: { sequence: 2, timeMs: 20, x: 20, y: 0, vx: 0, vy: 1000 },
      to: { sequence: 3, timeMs: 40, x: 20, y: 20, vx: 0, vy: 1000 }, ageMs: 0 });
    registry.update(0);
    const lane = findFakeLane(scene, 'flight-signature');
    expect(lane.edited).toHaveLength(2);
    const a = lane.members[lane.edited[0]], b = lane.members[lane.edited[1]];
    expect(evaluateFakeAnimation(a.x, 0)).toBe(10);
    expect(evaluateFakeAnimation(a.y, 0.5)).toBe(0);
    expect(evaluateFakeAnimation(b.x, 0.5)).toBe(20);
    expect(evaluateFakeAnimation(b.rotation, 0)).toBeCloseTo(Math.PI / 2);
    expect(evaluateFakeAnimation(a.scaleX, 0)).toBeCloseTo(20);
    tracer.destroyTracer(1); registry.update(1);
    expect(lane.edited).toHaveLength(2);
    tracer.destroyAll();
    expect(registry.getStats()!['flight-signature'].liveCount).toBe(0);
    qualityFactors.decorative = 1;
  });

  it('preserves fire identity on sampled paths and lets final fire outlive its source', () => {
    const { scene, registry } = setup();
    const burn = new ProjectileBurnRenderer(scene as never);
    burn.registerGpuVfx(registry);
    burn.emitTrailSegment(1, { from: { sequence: 1, timeMs: 0, x: 0, y: 0, vx: 1000, vy: 0 },
      to: { sequence: 2, timeMs: 20, x: 60, y: 0, vx: 1000, vy: 0 }, ageMs: 0 }, 6, 'void');
    burn.destroyVisual(1); registry.update(0);
    const lane = findFakeLane(scene, 'projectile-burn');
    expect(lane.edited.length).toBeGreaterThan(1);
    expect(lane.members[lane.edited[0]].frame).toContain('void');
    burn.destroyAll(); registry.update(0);
    expect(registry.getStats()!['projectile-burn'].liveCount).toBe(0);
  });
  it('cancels the shader repeats term so base + amplitude * ease(t) comes out exact', () => {
    // Alpha 0.95 -> 0 mit Quad.easeOut: ohne Korrektur addiert der Shader floor(-0.95) * -0.95.
    const base = gpuVfxEasedBase(0.95, -0.95);
    const quadOut = (t: number) => t * (2 - t);
    const shader = (t: number) => base + -0.95 * quadOut(t) + Math.floor(-0.95) * -0.95;

    expect(shader(0)).toBeCloseTo(0.95, 10);
    expect(shader(0.5)).toBeCloseTo(0.95 - 0.95 * quadOut(0.5), 10);
    expect(shader(1)).toBeCloseTo(0, 10);
  });

  it('is a no-op for amplitudes the shader does not round away', () => {
    expect(gpuVfxEasedBase(0.34, 0.46)).toBeCloseTo(0.34, 10);
  });

  it('also corrects amplitudes beyond one', () => {
    const shader = (t: number) => gpuVfxEasedBase(2, 1.5) + 1.5 * t + Math.floor(1.5) * 1.5;
    expect(shader(0)).toBeCloseTo(2, 10);
    expect(shader(1)).toBeCloseTo(3.5, 10);
  });
});
