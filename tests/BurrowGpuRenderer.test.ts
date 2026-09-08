import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ BlendModes: { NORMAL: 0, ADD: 1 }, Math: {
  Clamp: (n: number, a: number, b: number) => Math.max(a, Math.min(b, n)),
  Linear: (a: number, b: number, t: number) => a + (b - a) * t,
} }));
const quality = vi.hoisted(() => ({ decorative: 1, standard: 1, critical: 1, changed: () => {} }));
vi.mock('../src/graphics/GraphicsQuality', () => ({ getGraphicsQualityController: () => ({
  getProfile: () => ({ particleFactors: quality }),
  subscribe: (fn: () => void) => { quality.changed = fn; return () => {}; },
}) }));

import { BurrowGpuRenderer } from '../src/effects/BurrowGpuRenderer';
import { BURROW_FX } from '../src/config/burrowEffects';
import { GpuVfxSystem } from '../src/effects/gpu/GpuVfxSystem';
import { GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { evaluateFakeAnimation, findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

beforeEach(() => {
  resetGpuVfxAtlasForTests();
  quality.decorative = quality.standard = quality.critical = 1;
});
afterEach(() => vi.restoreAllMocks());

function setup(open = true) {
  const scene = makeFakeGpuVfxScene();
  const gpu = new GpuVfxSystem(scene as never);
  const renderer = new BurrowGpuRenderer(gpu);
  const world = {};
  if (open) renderer.openWorld(world);
  return { scene, gpu, renderer, world,
    flight: findFakeLane(scene, 'world-debris'), ground: findFakeLane(scene, 'movement-ground'),
    accent: findFakeLane(scene, 'explosion-accent') };
}

function undergroundTarget(x = 0) { return { x, y: 0, rotation: Math.PI / 2, active: true, visible: false }; }

function advanceFrames(gpu: GpuVfxSystem, durationMs: number, beforeFrame?: (index: number) => void, deltaMs = 16) {
  for (let i = 0; i < Math.ceil(durationMs / deltaMs); i++) { beforeFrame?.(i); gpu.update(deltaMs); }
}

describe('burrow GPU presentation', () => {
  it('keeps idempotently bound hidden underground players churning and lets emitted clods land after unbinding', () => {
    const h = setup(); const target = undergroundTarget();
    const layers = h.scene.layers.length;
    h.renderer.syncUnderground('player', target);
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 3, () => h.renderer.syncUnderground('player', target));
    const flying = h.flight.members.filter(m => m.frame === 'explosion-chunk');
    expect(flying.length).toBeGreaterThan(0);
    expect(h.flight.members.some(m => m.frame?.startsWith('death-dust-mote'))).toBe(true);
    expect(h.ground.members.some(m => m.frame === 'explosion-smoke')).toBe(true);
    expect(h.ground.members.some(m => m.frame === 'leaf-blower-dust')).toBe(true);
    expect(h.accent.members).toHaveLength(0);
    h.renderer.clearUnderground('player');
    const count = h.flight.members.length;
    expect(h.flight.visible).toBe(true);
    h.gpu.update(BURROW_FX.flightLifeMaxMs + 1);
    expect(h.flight.members).toHaveLength(count);
    expect(h.ground.members.filter(m => m.frame === 'explosion-chunk')).toHaveLength(flying.length);
    expect(h.scene.layers).toHaveLength(layers); expect(h.scene.emitters).toHaveLength(0);
    h.gpu.update(BURROW_FX.clodLifeMaxMs + 1);
    expect(h.flight.visible || h.ground.visible).toBe(false);
  });

  it('emits stronger directed moving churn, including render frames between fixed physics steps', () => {
    const stationary = setup(); const still = undergroundTarget();
    stationary.renderer.syncUnderground('still', still);
    const duration = BURROW_FX.underground.stationaryIntervalMs * 5;
    advanceFrames(stationary.gpu, duration);
    const standingCount = stationary.flight.members.length;
    stationary.renderer.destroy(); stationary.gpu.destroy();
    const h = setup(); const target = undergroundTarget();
    h.renderer.syncUnderground('moving', target);
    // A 240 Hz renderer can have several no-motion frames between simulation steps.
    advanceFrames(h.gpu, duration, i => {
      if (i % 2 === 0) target.x += 2;
      h.renderer.syncUnderground('moving', target);
    }, 1000 / 240);
    expect(h.flight.members.length).toBeGreaterThan(standingCount);
    expect(h.flight.members.every(m => m.x.amplitude < 0)).toBe(true);
    expect(h.flight.members.some(m => m.y.amplitude < 0)).toBe(true);
    expect(h.flight.members.some(m => m.y.amplitude > 0)).toBe(true);
    expect(h.accent.members).toHaveLength(0);
  });

  it('rebases continuous state across stalls, teleports, quality changes, clear, suppression and hidden presentation', () => {
    const h = setup(false); let visible = true;
    h.renderer.openWorld(h.world, () => visible);
    const target = undergroundTarget(); h.renderer.syncUnderground('player', target);
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 2);
    let count = h.flight.members.length;
    target.x += BURROW_FX.underground.teleportDistance * 2;
    h.gpu.update(16);
    expect(h.flight.members).toHaveLength(count);
    h.gpu.update(BURROW_FX.underground.maxFrameMs * 10);
    expect(h.flight.members).toHaveLength(count);
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 2);
    expect(h.flight.members.length).toBeGreaterThan(count);
    count = h.flight.members.length;
    quality.standard = quality.decorative = 0; quality.changed();
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 3, () => { target.x += 3; });
    expect(h.flight.members).toHaveLength(count);
    quality.standard = quality.decorative = 1; quality.changed();
    target.x += 3; h.gpu.update(16);
    expect(h.flight.members.length - count).toBeLessThanOrEqual(BURROW_FX.underground.moving.clods + BURROW_FX.underground.moving.grains);
    h.renderer.clear(); count = h.flight.members.length;
    h.gpu.update(0); expect(h.flight.members).toHaveLength(count);
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 2);
    expect(h.flight.members.length).toBeGreaterThan(count);
    h.gpu.setSuppressed(true); target.x += 400; h.gpu.update(500); h.gpu.setSuppressed(false);
    count = h.flight.members.length; h.gpu.update(16);
    expect(h.flight.members).toHaveLength(count);
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 2);
    expect(h.flight.members.length).toBeGreaterThan(count);
    visible = false; h.gpu.update(16); count = h.flight.members.length;
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 3, () => { target.x += 5; });
    visible = true; h.gpu.update(16);
    expect(h.flight.members).toHaveLength(count);
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 2);
    expect(h.flight.members.length).toBeGreaterThan(count);
    expect(h.flight.members.slice(count).every(m => Math.abs(evaluateFakeAnimation(m.x, 0) - target.x) < BURROW_FX.underground.teleportDistance)).toBe(true);
  });

  it('drops inactive and malformed underground targets and removes all bindings at phase and world teardown', () => {
    const h = setup(); const target = undergroundTarget();
    h.renderer.syncUnderground('player', target);
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 2);
    const count = h.flight.members.length;
    target.active = false; h.gpu.update(16); target.active = true;
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 2);
    expect(h.flight.members).toHaveLength(count);
    h.renderer.syncUnderground('player', target);
    target.rotation = NaN; h.gpu.update(16); target.rotation = Math.PI / 2;
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 2);
    expect(h.flight.members).toHaveLength(count);
    h.renderer.syncUnderground('player', target); h.renderer.clearAllUnderground();
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 2);
    expect(h.flight.members).toHaveLength(count);
    h.renderer.syncUnderground('player', target); h.renderer.closeWorld(h.world); h.renderer.openWorld({});
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 2);
    expect(h.flight.members).toHaveLength(count);
    h.renderer.syncUnderground('player', target); h.renderer.openWorld({});
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 2);
    expect(h.flight.members).toHaveLength(count);
    h.renderer.syncUnderground('player', target); h.renderer.destroy();
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 2);
    expect(h.flight.members).toHaveLength(count);
  });

  it('bounds underground bindings and shared particles, while a freed source slot accepts a new target', () => {
    const h = setup();
    for (let i = 0; i < BURROW_FX.underground.maxSources; i++) h.renderer.syncUnderground(String(i), undergroundTarget(i));
    const overflowX = BURROW_FX.underground.maxSources * 100;
    const overflow = undergroundTarget(overflowX);
    h.renderer.syncUnderground('overflow', overflow);
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs + 32);
    expect(h.flight.members.length).toBeGreaterThan(0);
    expect(h.flight.members.every(m => evaluateFakeAnimation(m.x, 0) < overflowX / 2)).toBe(true);
    // Source admission is independent of whether the previous crowd filled the particle pool.
    h.renderer.clear();
    h.renderer.clearUnderground('0'); h.renderer.syncUnderground('overflow', overflow); h.gpu.update(16);
    expect(h.flight.members.some(m => evaluateFakeAnimation(m.x, 0) > overflowX / 2)).toBe(true);
    advanceFrames(h.gpu, BURROW_FX.underground.stationaryIntervalMs * 5);
    expect(h.gpu.getStats()!['world-debris'].liveCount).toBeLessThanOrEqual(BURROW_FX.flightCapacity);
    expect(h.gpu.getStats()!['movement-ground'].liveCount).toBeLessThanOrEqual(BURROW_FX.groundCapacity);
    h.renderer.clearAllUnderground(); h.gpu.update(BURROW_FX.clodLifeMaxMs + 1);
    expect(h.flight.visible || h.ground.visible).toBe(false);
  });

  it('throws radial earth and layered dust using existing shared GPU lanes', () => {
    const h = setup();
    const timers = vi.spyOn(h.scene.time, 'delayedCall');
    const tweens = vi.spyOn(h.scene.tweens, 'add');
    const layers = h.scene.layers.length;
    h.renderer.playExit(100, 200);
    h.gpu.update(0);
    expect(h.flight.members.some(m => m.x.amplitude < 0)).toBe(true);
    expect(h.flight.members.some(m => m.x.amplitude > 0)).toBe(true);
    expect(h.flight.members.some(m => m.y.amplitude < 0)).toBe(true);
    expect(h.flight.members.some(m => m.y.amplitude > 0)).toBe(true);
    expect(h.flight.members.some(m => m.frame === 'explosion-chunk')).toBe(true);
    expect(h.flight.members.some(m => m.frame?.startsWith('death-dust-mote'))).toBe(true);
    expect(new Set(h.ground.members.map(m => m.frame)).size).toBeGreaterThan(1);
    expect(h.ground.members.every(m => evaluateFakeAnimation(m.scaleY, 0.9) > evaluateFakeAnimation(m.scaleY, 0))).toBe(true);
    expect(h.accent.members).toHaveLength(0); // The damage-ring is its own authoritative event.
    expect(h.scene.layers).toHaveLength(layers);
    expect(timers).not.toHaveBeenCalled(); expect(tweens).not.toHaveBeenCalled();
    expect(h.scene.emitters).toHaveLength(0);
  });

  it.each(['enter', 'exit'] as const)('lands accepted %s clods at precisely their GPU endpoint and keeps the pose still while fading', (kind) => {
    const h = setup();
    if (kind === 'enter') h.renderer.playEnter(37, -51, Math.PI / 2);
    else h.renderer.playExit(37, -51);
    h.gpu.update(0);
    const flying = h.flight.members.filter(m => m.frame === 'explosion-chunk');
    h.gpu.update(BURROW_FX.flightLifeMaxMs + 20);
    const landed = h.ground.members.filter(m => m.frame === 'explosion-chunk');
    expect(landed.length).toBeGreaterThan(0); expect(landed).toHaveLength(flying.length);
    for (const before of flying) {
      const x = evaluateFakeAnimation(before.x, 1 - 1e-9);
      const y = evaluateFakeAnimation(before.y, 1 - 1e-9);
      const after = landed.find(m => Math.abs(m.x.base - x) < 1e-5 && Math.abs(m.y.base - y) < 1e-5)!;
      expect(after).toBeDefined();
      expect(after.rotation.base).toBeCloseTo(evaluateFakeAnimation(before.rotation, 1 - 1e-9), 5);
      expect(after.scaleX.base).toBeCloseTo(evaluateFakeAnimation(before.scaleX, 1 - 1e-9), 5);
      expect(after.scaleY.base).toBeCloseTo(evaluateFakeAnimation(before.scaleY, 1 - 1e-9), 5);
      expect(after.tint).toBe(before.tint);
      expect(after.x.amplitude).toBe(0); expect(after.y.amplitude).toBe(0);
      expect(after.rotation.amplitude).toBe(0);
      expect(after.scaleX.amplitude).toBe(0); expect(after.scaleY.amplitude).toBe(0);
      expect(evaluateFakeAnimation(after.alpha, 0)).toBeCloseTo(evaluateFakeAnimation(before.alpha, 1 - 1e-9));
      expect(evaluateFakeAnimation(after.alpha, 0.9)).toBeLessThan(evaluateFakeAnimation(after.alpha, 0.1));
      expect(after.creationTime).toBeLessThan(0); // Frame overshoot ages the residue too.
    }
    h.gpu.update(BURROW_FX.clodLifeMaxMs);
    expect(h.flight.visible).toBe(false); expect(h.ground.visible).toBe(false);
  });

  it.each(['enter', 'exit'] as const)('aligns queued host %s births and landing transitions with the advanced Phaser layer clock', (kind) => {
    const h = setup(); vi.spyOn(Math, 'random').mockReturnValue(0.5);
    const frameMs = 16;
    // Phaser preUpdate happens before host gameplay queues its emergence and the GPU tick.
    for (const layer of h.scene.layers) layer.timeElapsed += frameMs;
    if (kind === 'enter') h.renderer.playEnter(100, 200, Math.PI / 3);
    else h.renderer.playExit(100, 200);
    h.renderer.playShockwave(100, 200, 80);
    expect(h.flight.members).toHaveLength(0); expect(h.accent.members).toHaveLength(0);
    h.gpu.update(frameMs);
    const flying = h.flight.members.filter(m => m.frame === 'explosion-chunk');
    expect(flying.length).toBeGreaterThan(0);
    expect(flying.every(m => m.creationTime === h.flight.timeElapsed)).toBe(true);
    expect(h.accent.members[0].creationTime).toBe(h.accent.timeElapsed);
    const duration = flying[0].x.duration;
    const advance = (delta: number) => {
      for (const layer of h.scene.layers) layer.timeElapsed += delta;
      h.gpu.update(delta);
    };
    advance(duration - 1);
    expect(h.flight.timeElapsed - flying[0].creationTime).toBe(duration - 1);
    expect(h.ground.members.some(m => m.frame === 'explosion-chunk')).toBe(false);
    advance(1);
    const landed = h.ground.members.filter(m => m.frame === 'explosion-chunk');
    expect(landed).toHaveLength(flying.length);
    expect(landed.every(m => m.creationTime === h.ground.timeElapsed)).toBe(true);
    for (const before of flying) {
      const x = evaluateFakeAnimation(before.x, 1 - 1e-9);
      const y = evaluateFakeAnimation(before.y, 1 - 1e-9);
      expect(landed.some(m => Math.abs(m.x.base - x) < 1e-5 && Math.abs(m.y.base - y) < 1e-5)).toBe(true);
    }
  });

  it.each([0, Math.PI / 2])('digs in from the front paws and throws two dirt fans behind facing %s without a damage ring', heading => {
    const h = setup();
    const layers = h.scene.layers.length;
    const x = 160, y = -75, nx = Math.cos(heading), ny = Math.sin(heading);
    h.renderer.playEnter(x, y, heading);
    expect(h.flight.members).toHaveLength(0);
    h.gpu.update(0);
    const clods = h.flight.members.filter(m => m.frame === 'explosion-chunk');
    expect(clods.length).toBeGreaterThan(0);
    expect(h.flight.members.some(m => m.frame?.startsWith('death-dust-mote'))).toBe(true);
    expect(new Set(h.ground.members.map(m => m.frame)).size).toBeGreaterThan(1);
    expect(h.flight.members.every(m => m.x.amplitude * nx + m.y.amplitude * ny < 0)).toBe(true);
    expect(clods.some(m => -m.x.amplitude * ny + m.y.amplitude * nx < 0)).toBe(true);
    expect(clods.some(m => -m.x.amplitude * ny + m.y.amplitude * nx > 0)).toBe(true);
    expect(clods.every(m => (evaluateFakeAnimation(m.x, 0) - x) * nx + (evaluateFakeAnimation(m.y, 0) - y) * ny > 0)).toBe(true);
    expect(h.ground.members.every(m => m.x.amplitude * nx + m.y.amplitude * ny < 0)).toBe(true);
    expect(h.accent.members).toHaveLength(0);
    expect(h.scene.layers).toHaveLength(layers); expect(h.scene.emitters).toHaveLength(0);
  });

  it('directs dash dirt backwards and sideways and preserves historical flight and resting ages', () => {
    const h = setup();
    const age = BURROW_FX.flightLifeMinMs / 2;
    h.renderer.playDashTrail(0, 0, 0, 32, age);
    expect(h.flight.members.length).toBeGreaterThan(0);
    expect(h.flight.members.every(m => m.x.amplitude < 0)).toBe(true);
    expect(h.flight.members.some(m => m.y.amplitude < 0)).toBe(true);
    expect(h.flight.members.some(m => m.y.amplitude > 0)).toBe(true);
    expect(h.flight.members.every(m => m.creationTime === -age)).toBe(true);
    expect(h.ground.members).toHaveLength(0);
    h.renderer.clear();
    const flights = h.flight.members.length;
    h.renderer.playDashTrail(0, 0, Math.PI, 32, BURROW_FX.flightLifeMaxMs + 20);
    expect(h.flight.members).toHaveLength(flights);
    expect(h.ground.members.length).toBeGreaterThan(0);
    expect(h.ground.members.every(m => m.x.amplitude === 0 && m.y.amplitude === 0 && m.creationTime < 0)).toBe(true);
    h.renderer.clear();
    const ground = h.ground.members.length;
    h.renderer.playDashTrail(0, 0, 0, 32, BURROW_FX.clodLifeMaxMs + 1);
    expect(h.flight.members).toHaveLength(flights); expect(h.ground.members).toHaveLength(ground);
  });

  it('does not create resting clods for rejected flights', () => {
    const h = setup();
    const spawn = h.gpu.spawn.bind(h.gpu);
    vi.spyOn(h.gpu, 'spawn').mockImplementation((spec, ...args) => spec.effect === GpuVfxEffectId.BurrowClod ? false : spawn(spec, ...args));
    h.renderer.playExit(0, 0);
    h.gpu.update(0);
    h.gpu.update(BURROW_FX.flightLifeMaxMs + 1);
    expect(h.ground.members.some(m => m.frame === 'explosion-chunk')).toBe(false);
  });

  it('protects main clods from decorative reduction and never catches up discarded emissions or landings', () => {
    const h = setup();
    quality.decorative = 0; quality.changed();
    h.renderer.playExit(0, 0);
    h.gpu.update(0);
    expect(h.flight.members.length).toBeGreaterThan(0);
    expect(h.flight.members.every(m => m.frame === 'explosion-chunk')).toBe(true);
    expect(h.ground.members).toHaveLength(0);
    quality.standard = 0; quality.changed();
    h.gpu.update(BURROW_FX.flightLifeMaxMs + 1);
    h.renderer.playDashTrail(0, 0, 0, 32, 0);
    const flightCount = h.flight.members.length;
    quality.standard = quality.decorative = 1; quality.changed();
    h.gpu.update(BURROW_FX.clodLifeMaxMs);
    expect(h.ground.members).toHaveLength(0); expect(h.flight.members).toHaveLength(flightCount);
    h.renderer.playDashTrail(0, 0, 0, 32, 0);
    expect(h.flight.members.length).toBeGreaterThan(flightCount);
  });

  it('bounds independently admitted flight and ground particles without creating more storage under repeated bursts', () => {
    const h = setup();
    const flightStorage = h.flight.added, groundStorage = h.ground.added;
    for (let i = 0; i < 200; i++) h.renderer.playExit(0, 0);
    h.gpu.update(0);
    expect(h.flight.members.length).toBeLessThanOrEqual(BURROW_FX.flightCapacity);
    expect(h.flight.members.length).toBeGreaterThan(0);
    h.gpu.update(BURROW_FX.flightLifeMaxMs + 1);
    expect(h.gpu.getStats()!['movement-ground'].liveCount).toBeLessThanOrEqual(BURROW_FX.groundCapacity);
    expect(h.ground.members.some(m => m.frame === 'explosion-chunk')).toBe(true);
    expect(h.flight.added).toBe(flightStorage); expect(h.ground.added).toBe(groundStorage);
    h.gpu.update(BURROW_FX.clodLifeMaxMs + 1);
    expect(h.gpu.getStats()!['movement-ground'].liveCount).toBe(0);
    const groundCount = h.ground.members.length;
    h.gpu.update(16);
    expect(h.ground.members).toHaveLength(groundCount);
  });

  it('bounds pending discrete events and discards overflow without replaying it later', () => {
    const h = setup();
    for (let i = 0; i < BURROW_FX.eventCapacity * 2; i++) h.renderer.playShockwave(i, 0, 80);
    expect(h.accent.members).toHaveLength(0);
    h.gpu.update(0);
    expect(h.accent.members).toHaveLength(BURROW_FX.eventCapacity);
    h.gpu.update(BURROW_FX.shockwave.lifeMs + 1);
    expect(h.accent.members).toHaveLength(BURROW_FX.eventCapacity);
    expect(h.accent.visible).toBe(false);
  });

  it('clears live effects and both queues when world presentation becomes hidden, without replay on reveal', () => {
    const h = setup(false);
    let visible = true;
    h.renderer.openWorld(h.world, () => visible);
    h.renderer.playExit(0, 0); h.renderer.playShockwave(0, 0, 80); h.gpu.update(0);
    expect(h.flight.visible && h.ground.visible && h.accent.visible).toBe(true);
    h.renderer.playEnter(0, 0, Math.PI / 2); h.renderer.playExit(0, 0); h.renderer.playShockwave(0, 0, 80);
    const flights = h.flight.members.length, ground = h.ground.members.length, rings = h.accent.members.length;
    const clearSources = vi.spyOn(h.gpu, 'clearSource');
    visible = false; h.gpu.update(1);
    expect(h.flight.visible || h.ground.visible || h.accent.visible).toBe(false);
    const clears = clearSources.mock.calls.length;
    expect(clears).toBeGreaterThan(0);
    h.renderer.playEnter(0, 0, Math.PI / 2); h.renderer.playExit(0, 0);
    h.renderer.playShockwave(0, 0, 80); h.renderer.playDashTrail(0, 0, 0, 32, 0);
    h.gpu.update(1);
    expect(clearSources).toHaveBeenCalledTimes(clears);
    visible = true; h.gpu.update(BURROW_FX.flightLifeMaxMs + 1);
    expect(h.flight.members).toHaveLength(flights); expect(h.ground.members).toHaveLength(ground);
    expect(h.accent.members).toHaveLength(rings);
    h.renderer.playExit(0, 0); h.gpu.update(0);
    expect(h.flight.members.length).toBeGreaterThan(flights);
    // A hidden request must also clear active material before the following GPU tick.
    visible = false; h.renderer.playExit(0, 0);
    expect(h.flight.visible || h.ground.visible || h.accent.visible).toBe(false);
  });

  it('invalidates deferred landings on suppression, world changes and destruction', () => {
    const h = setup(false);
    h.renderer.playExit(0, 0); expect(h.flight.members).toHaveLength(0);
    h.renderer.openWorld(h.world); h.renderer.playExit(0, 0); h.gpu.update(0);
    h.renderer.playExit(0, 0); // Both live material and the next queued event are invalidated.
    h.gpu.setSuppressed(true); h.gpu.setSuppressed(false);
    const groundCount = h.ground.members.length;
    h.gpu.update(BURROW_FX.flightLifeMaxMs + 1);
    expect(h.ground.members).toHaveLength(groundCount); expect(h.flight.visible).toBe(false);
    h.renderer.playExit(0, 0); h.gpu.update(0); h.renderer.playExit(0, 0);
    h.renderer.closeWorld(h.world);
    const closedCount = h.ground.members.length;
    h.gpu.update(BURROW_FX.flightLifeMaxMs + 1);
    expect(h.ground.members).toHaveLength(closedCount); expect(h.ground.visible).toBe(false);
    const nextWorld = {}; h.renderer.openWorld(nextWorld); h.renderer.closeWorld(h.world);
    h.renderer.playExit(0, 0); h.renderer.playShockwave(0, 0, 80);
    h.gpu.update(0);
    expect(h.flight.visible).toBe(true); expect(h.accent.visible).toBe(true);
    h.renderer.destroy(); h.renderer.destroy();
    const destroyedCount = h.ground.members.length;
    h.renderer.playExit(0, 0); h.gpu.update(BURROW_FX.flightLifeMaxMs + 1);
    expect(h.ground.members).toHaveLength(destroyedCount);
    expect(h.flight.visible || h.ground.visible || h.accent.visible).toBe(false);
  });

  it('uses the authoritative shockwave radius and keeps its critical GPU signal when decoration is disabled', () => {
    const h = setup(); quality.decorative = quality.standard = 0; quality.changed();
    const radius = 137;
    h.renderer.playShockwave(81, -23, radius);
    h.gpu.update(0);
    const ring = h.accent.members[0];
    expect(ring.frame).toBe('explosion-ring');
    expect(ring.x.base).toBe(81); expect(ring.y.base).toBe(-23);
    expect(evaluateFakeAnimation(ring.scaleY, 1 - 1e-9) * 32).toBeCloseTo(radius);
    expect(evaluateFakeAnimation(ring.scaleX, 1 - 1e-9) * 32).toBeCloseTo(radius);
    expect(h.flight.members).toHaveLength(0); expect(h.ground.members).toHaveLength(0);
  });
});
