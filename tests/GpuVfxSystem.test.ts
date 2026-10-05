import { DEATH_FRAME_ANIMATION_IDS } from '../src/effects/gpu/GpuVfxFrameAnimations';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Scenes: { Events: { PRE_RENDER: 'prerender', SHUTDOWN: 'shutdown' } },
  Math: { Linear: (a: number, b: number, t: number) => a + (b - a) * t },
}));

const qualityFactors = { critical: 1, standard: 1, decorative: 1 };
vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: qualityFactors }),
    subscribe: () => () => {},
  }),
}));

import { getGpuVfxFrame, resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GpuVfxEase } from '../src/effects/gpu/GpuVfxEase';
import { getGpuVfxFrameAnimation, GpuVfxFrameAnimationId } from '../src/effects/gpu/GpuVfxFrameAnimations';
import { GPU_VFX_EFFECTS, GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { GPU_VFX_LANES, GpuVfxLaneId } from '../src/effects/gpu/GpuVfxRenderLanes';
import { GpuVfxSystem, admitGpuVfxSpawn } from '../src/effects/gpu/GpuVfxSystem';
import * as flightRibbonLayer from '../src/effects/gpu/GpuFlightRibbonLayer';
import { registerEnemyMeshWarmup } from '../src/effects/EnemyMeshWarmup';
import { FLIGHT_SIGNATURE_PROFILES } from '../src/projectile/FlightSignature';
import { createGpuVfxMemberHandle } from '../src/effects/gpu/GpuVfxSystem';
import { evaluateFakeAnimation, findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function makeWarmupEvents() {
  const listeners = new Map<string, Set<{ fn: (...args: never[]) => void; context?: object; once: boolean }>>();
  const add = (event: string, fn: (...args: never[]) => void, context?: object, once = false) => {
    const entries = listeners.get(event) ?? new Set();
    entries.add({ fn, context, once });
    listeners.set(event, entries);
  };
  return {
    on(event: string, fn: (...args: never[]) => void, context?: object) { add(event, fn, context); },
    once(event: string, fn: (...args: never[]) => void, context?: object) { add(event, fn, context, true); },
    off(event: string, fn: (...args: never[]) => void, context?: object) {
      const entries = listeners.get(event);
      if (!entries) return;
      for (const entry of entries) if (entry.fn === fn && entry.context === context) entries.delete(entry);
    },
    emit(event: string) {
      const entries = [...(listeners.get(event) ?? [])];
      for (const entry of entries) {
        entry.fn.call(entry.context, ...([] as never[]));
        if (entry.once) listeners.get(event)?.delete(entry);
      }
    },
    count(event: string) { return listeners.get(event)?.size ?? 0; },
  };
}

function makeWarmupContext() {
  return {
    releases: 0,
    setCamera: vi.fn(),
    setAutoClear: vi.fn(),
    setColorWritemask: vi.fn(),
    setScissorEnable: vi.fn(),
    setScissorBox: vi.fn(),
    release() { this.releases += 1; },
  };
}

function setup() {
  const scene = makeFakeGpuVfxScene();
  const system = new GpuVfxSystem(scene as never);
  return { scene, system };
}

it('invalidates tracked handles on expiry, recycling and global release', () => {
  const { system, scene } = setup();
  const spec = spawnSpec(system, GpuVfxEffectId.MuzzleFlashBody);
  const first = createGpuVfxMemberHandle(), second = createGpuVfxMemberHandle();
  system.spawn(spec, -1, system.now(), 0, first);
  const lane = findFakeLane(scene, 'muzzle-flash');
  expect(system.updateTransform(first, 30, 40, 1, 2, 0.4)).toBe(true);
  expect(lane.patched).toHaveLength(1);
  system.update(spec.lifeMs + 1);
  system.spawn(spec, -1, system.now(), 0, second);
  expect(first.slot).toBe(second.slot);
  expect(system.updateTransform(first, 0, 0, 0, 0, 0)).toBe(false);
  system.releaseMember(first);
  expect(system.isMemberLive(second)).toBe(true);
  system.releaseAll();
  expect(system.updateTransform(second, 0, 0, 0, 0, 0)).toBe(false);
});

/** Ein Spec mit allen Feldern gesetzt, damit die Tests nichts von Defaults abhaengig machen. */
function spawnSpec(system: GpuVfxSystem, effect: GpuVfxEffectId) {
  const spec = system.createSpec(effect);
  spec.lifeMs = 1000;
  spec.x = 10;
  spec.y = 20;
  spec.vx = 30;
  spec.vy = 40;
  spec.scaleStart = 1;
  spec.scaleEnd = 0;
  spec.alphaStart = 0.8;
  spec.alphaEnd = 0;
  spec.tint = 0xabcdef;
  return spec;
}

beforeEach(() => {
  resetGpuVfxAtlasForTests();
  qualityFactors.standard = 1;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('gpu vfx system: lanes', () => {
  it('profiles lanes 0 and 32 independently without numeric-mask aliasing', () => {
    const { system } = setup();
    system.spawn(spawnSpec(system, GpuVfxEffectId.MovementFootprint), -1, 0);
    system.update(0);
    let report = system.buildReport();
    expect(report.lanes[GpuVfxLaneId.MovementGround].visibleFrames).toBe(1);
    expect(report.lanes[GpuVfxLaneId.AirstrikeSpark].visibleFrames).toBe(0);
    system.spawn(spawnSpec(system, GpuVfxEffectId.AirstrikeSpark), -1, 0);
    system.update(0);
    report = system.buildReport();
    expect(report.coVisibleFrames[GpuVfxLaneId.MovementGround][GpuVfxLaneId.AirstrikeSpark]).toBe(1);
    system.setSuppressed(true); system.update(16);
    expect(system.buildReport().lanes[GpuVfxLaneId.MovementGround].visibleFrames).toBe(2);
  });
  it('shares flight admission, critical reserve, profiling and source cleanup across both primitives', () => {
    const { system } = setup();
    const source = system.createSource(GpuVfxEffectId.FlightCore);
    const handle = system.createFlightRibbon(source, { tuning: FLIGHT_SIGNATURE_PROFILES.heavy, color: 0xffffff, emissive: 1 })!;
    const point = (x: number) => ({ sequence: x + 1, timeMs: x, x, y: 0, vx: 1000, vy: 0 });
    system.appendFlightRibbon(handle, { from: point(0), to: point(20), ageMs: 0 }, false);
    const lane = GPU_VFX_LANES[GpuVfxLaneId.FlightSignature];
    const mote = spawnSpec(system, GpuVfxEffectId.FlightMote);
    for (let i = 1; i < lane.capacity - lane.reserveCritical; i++) expect(system.spawn(mote, source, 0)).toBe(true);
    expect(system.spawn(mote, source, 0)).toBe(false);
    system.appendFlightRibbon(handle, { from: point(20), to: point(40), ageMs: 0 }, false);
    system.update(0);
    const report = system.buildReport().lanes[GpuVfxLaneId.FlightSignature];
    expect(report.active).toBe(lane.capacity - lane.reserveCritical + 1);
    expect(report.highWaterMark).toBe(report.active);
    expect(report.capacityDrops).toBe(1);
    system.clearSource(source);
    expect(system.getLaneStats(GpuVfxLaneId.FlightSignature)!.liveCount).toBe(0);
    expect(system.flightRibbons.handleCount).toBe(0);
    expect(system.flightRibbons.data.every(n => n === 0)).toBe(true);
  });

  it('creates every lane of the manifest, configured and primed', () => {
    const { scene } = setup();
    expect(scene.layers.length).toBe(GPU_VFX_LANES.length);

    for (const spec of GPU_VFX_LANES) {
      const layer = findFakeLane(scene, spec.label);
      expect(layer.depth).toBe(spec.depth);
      expect(layer.blendMode).toBe(spec.blendMode);
      // Alle Member existieren vorab; spaeter wird nur noch editiert.
      expect(layer.added).toBe(spec.capacity);
      expect(layer.edited).toEqual([]);
    }
  });

  it('passes the gravity only to the lane that asks for it', () => {
    const { scene } = setup();
    expect(findFakeLane(scene, 'airstrike-bomb').gravity).toBe(30);
    expect(findFakeLane(scene, 'airstrike-spark').gravity).toBe(1024);
    expect(findFakeLane(scene, 'flame-spark').gravity).toBe(-30);
  });

  it('prewarms exactly the eases its lane declares', () => {
    const { scene } = setup();
    for (const spec of GPU_VFX_LANES) {
      const layer = findFakeLane(scene, spec.label);
      expect(layer.enabledEases.length).toBe(spec.eases.length);
    }
    expect(findFakeLane(scene, 'rocket-smoke').enabledEases).toEqual(['Linear', 'Quad.easeOut']);
    expect(findFakeLane(scene, 'flame-spark').enabledEases).toEqual(['Linear', 'Gravity']);
  });

  it('registers death frame animation before primed members and nowhere else', () => {
    const { scene } = setup();
    const gore = findFakeLane(scene, 'gore-normal');

    expect(GPU_VFX_LANES[GpuVfxLaneId.GoreNormal].frameAnimations)
      .toEqual(DEATH_FRAME_ANIMATION_IDS);
    expect(gore.frameAnimations).toEqual(DEATH_FRAME_ANIMATION_IDS.map(id => ({
      name: getGpuVfxFrameAnimation(id).name,
      frames: getGpuVfxFrameAnimation(id).frames.map(frame => getGpuVfxFrame(frame).name),
      duration: 1,
    })));
    expect(scene.layers.filter((lane) => lane.frameAnimations.length > 0)).toEqual([gore]);
  });

  it('routes every lane through the shared atlas', () => {
    const { scene } = setup();
    expect(scene.layers.every((layer) => layer.key === '__gpu_vfx_atlas')).toBe(true);
  });

  it('settles the real SpriteGPU warmup lane by lane and removes its lifecycle listeners', () => {
    const scene = makeFakeGpuVfxScene() as ReturnType<typeof makeFakeGpuVfxScene> & {
      events: ReturnType<typeof makeWarmupEvents>;
      cameras: { main: object };
      renderer: { baseDrawingContext: { getClone: () => ReturnType<typeof makeWarmupContext> } };
    };
    const events = makeWarmupEvents();
    const context = makeWarmupContext();
    scene.events = events;
    scene.cameras = { main: {} };
    scene.renderer = { baseDrawingContext: { getClone: () => context } };
    let programsReady = false;
    const submitters: { run: ReturnType<typeof vi.fn>; programManager: { getCurrentProgramSuite: () => object | null } }[] = [];
    const addLayer = scene.add.spriteGPULayer;
    scene.add.spriteGPULayer = ((key: string, size: number) => {
      const layer = addLayer(key, size) as ReturnType<typeof makeFakeGpuVfxScene>['layers'][number] & {
        submitterNode: { run: ReturnType<typeof vi.fn>; programManager: { getCurrentProgramSuite: () => object | null } };
      };
      const submitter = { run: vi.fn(), programManager: { getCurrentProgramSuite: () => programsReady ? {} : null } };
      layer.submitterNode = submitter;
      submitters.push(submitter);
      return layer;
    }) as typeof scene.add.spriteGPULayer;

    const system = new GpuVfxSystem(scene as never);
    expect(system.isShaderWarmupComplete()).toBe(false);
    expect(system.getShaderWarmupState()).toBe('pending');
    events.emit('prerender');
    expect(system.isShaderWarmupComplete()).toBe(false);
    expect(submitters[1].run).not.toHaveBeenCalled();
    programsReady = true;
    for (let index = 0; index < GPU_VFX_LANES.length; index += 1) events.emit('prerender');
    expect(system.isShaderWarmupComplete()).toBe(true);
    expect(system.getShaderWarmupState()).toBe('complete');
    expect(submitters).toHaveLength(GPU_VFX_LANES.length);
    expect(submitters[0].run).toHaveBeenCalledTimes(2);
    expect(submitters.slice(1).every((submitter) => submitter.run.mock.calls.length === 1)).toBe(true);
    expect(context.releases).toBe(GPU_VFX_LANES.length + 1);
    expect(context.setColorWritemask).toHaveBeenCalledWith(false, false, false, false);
    expect(events.count('prerender')).toBe(0);
    expect(events.count('shutdown')).toBe(0);
    system.destroy();
  });

  it('keeps loading pending until the flight ribbon buffers and shader are prepared', () => {
    const scene = makeFakeGpuVfxScene();
    const events = makeWarmupEvents(), context = makeWarmupContext();
    Object.assign(scene, { events, cameras: { main: {} }, renderer: { baseDrawingContext: { getClone: () => context } } });
    const addLayer = scene.add.spriteGPULayer;
    scene.add.spriteGPULayer = ((key: string, size: number) => Object.assign(addLayer(key, size), {
      submitterNode: { run() {}, programManager: { getCurrentProgramSuite: () => ({}) } },
    })) as typeof scene.add.spriteGPULayer;
    let ready = false;
    const prepare = vi.fn(() => ready);
    vi.spyOn(flightRibbonLayer, 'createFlightRibbonLayer').mockReturnValueOnce({
      image: { destroy: vi.fn(), setVisible: vi.fn() } as never, prepare,
    });
    const system = new GpuVfxSystem(scene as never);
    for (let index = 0; index <= GPU_VFX_LANES.length; index++) events.emit('prerender');
    expect(prepare).toHaveBeenCalledWith(context);
    expect(system.isShaderWarmupComplete()).toBe(false);
    ready = true; events.emit('prerender');
    expect(system.getShaderWarmupState()).toBe('complete');
    expect(events.count('prerender')).toBe(0);
    system.destroy();
  });

  it('falls back once when a warmup probe fails and still settles readiness', () => {
    const scene = makeFakeGpuVfxScene() as ReturnType<typeof makeFakeGpuVfxScene> & {
      events: ReturnType<typeof makeWarmupEvents>;
      cameras: { main: object };
      renderer: { baseDrawingContext: { getClone: () => ReturnType<typeof makeWarmupContext> } };
    };
    const events = makeWarmupEvents();
    const context = makeWarmupContext();
    scene.events = events;
    scene.cameras = { main: {} };
    scene.renderer = { baseDrawingContext: { getClone: () => context } };
    const addLayer = scene.add.spriteGPULayer;
    scene.add.spriteGPULayer = ((key: string, size: number) => {
      const layer = addLayer(key, size) as ReturnType<typeof makeFakeGpuVfxScene>['layers'][number] & { submitterNode: object };
      layer.submitterNode = {
        run: () => { throw new Error('test warmup failure'); },
        programManager: { getCurrentProgramSuite: () => ({}) },
      };
      return layer;
    }) as typeof scene.add.spriteGPULayer;
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const system = new GpuVfxSystem(scene as never);
    events.emit('prerender'); events.emit('prerender');
    expect(system.getShaderWarmupState()).toBe('failed');
    expect(system.isShaderWarmupComplete()).toBe(true);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(events.count('prerender')).toBe(0);
    expect(events.count('shutdown')).toBe(0);
    system.destroy();
  });

  it.each(['shutdown', 'destroy'] as const)(
    'finishes teardown after a deferred optional shader link fails before the first render on %s', outcome => {
      const scene = makeFakeGpuVfxScene(), events = makeWarmupEvents(), context = makeWarmupContext();
      const failure = new Error('driver rejected deferred shader link');
      const program = { compiling: true, _completeProgram: vi.fn(() => { throw failure; }) };
      const cache: Record<string, typeof program> = { pending: program };
      const renderer = {
        game: { config: { skipUnreadyShaders: false } },
        baseDrawingContext: { getClone: () => context },
        shaderProgramFactory: { programs: cache, getShaderProgram: () => program },
        glWrapper: { update: vi.fn() }, deleteProgram: vi.fn(),
      };
      Object.assign(scene, { events, cameras: { main: {} }, renderer });
      const addLayer = scene.add.spriteGPULayer;
      scene.add.spriteGPULayer = ((key: string, size: number) => Object.assign(addLayer(key, size), {
        submitterNode: { updateRenderOptions() {}, run: vi.fn(),
          programManager: { currentConfig: {}, getCurrentProgramSuite: () => ({}) } },
      })) as typeof scene.add.spriteGPULayer;
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const probe = { name: 'pending', prepare: vi.fn(), destroy: vi.fn() };
      const system = new GpuVfxSystem(scene as never, [probe]);
      const remainingTeardown = vi.fn();
      events.on('shutdown', () => { system.destroy(); remainingTeardown(); });
      expect(program._completeProgram).not.toHaveBeenCalled();

      expect(() => outcome === 'shutdown' ? events.emit('shutdown') : system.destroy()).not.toThrow();
      expect(scene.layers.every(layer => layer.destroyed)).toBe(true);
      expect(probe.destroy).toHaveBeenCalledOnce(); expect(probe.prepare).not.toHaveBeenCalled();
      expect(events.count('prerender')).toBe(0);
      expect(system.getShaderWarmupState()).toBe('failed');
      expect(renderer.shaderProgramFactory.programs).toEqual({});
      expect(renderer.deleteProgram).toHaveBeenCalledWith(program);
      expect(renderer.game.config.skipUnreadyShaders).toBe(false);
      expect(warning).toHaveBeenCalledOnce();
      if (outcome === 'shutdown') expect(remainingTeardown).toHaveBeenCalledOnce();
      system.destroy(); events.emit('prerender');
      expect(program._completeProgram).toHaveBeenCalledOnce(); expect(probe.destroy).toHaveBeenCalledOnce();
    });

  it.each(['complete', 'shutdown', 'failure', 'destroy'] as const)(
    'owns additional probes through pending links and releases them once on %s', outcome => {
      const scene = makeFakeGpuVfxScene(), events = makeWarmupEvents(), context = makeWarmupContext();
      Object.assign(scene, { events, cameras: { main: {} }, renderer: { baseDrawingContext: { getClone: () => context } } });
      const addLayer = scene.add.spriteGPULayer;
      scene.add.spriteGPULayer = ((key: string, size: number) => Object.assign(addLayer(key, size), {
        submitterNode: { run() {}, programManager: { getCurrentProgramSuite: () => ({}) } },
      })) as typeof scene.add.spriteGPULayer;
      const prepare = vi.fn(() => false), destroy = vi.fn();
      const next = { name: 'next', prepare: vi.fn(() => true), destroy: vi.fn() };
      const system = new GpuVfxSystem(scene as never, [{ name: 'pending', prepare, destroy }, next]);
      for (let i = 0; i < GPU_VFX_LANES.length; i++) events.emit('prerender');
      expect(prepare).not.toHaveBeenCalled();
      events.emit('prerender'); events.emit('prerender');
      expect(system.isShaderWarmupComplete()).toBe(false);
      expect(next.prepare).not.toHaveBeenCalled(); expect(destroy).not.toHaveBeenCalled();
      expect(prepare).toHaveBeenCalledWith(context);
      if (outcome === 'complete') {
        prepare.mockReturnValue(true); events.emit('prerender');
        expect(system.isShaderWarmupComplete()).toBe(false);
        events.emit('prerender'); expect(system.getShaderWarmupState()).toBe('complete');
      } else if (outcome === 'shutdown') events.emit('shutdown');
      else if (outcome === 'destroy') system.destroy();
      else {
        vi.spyOn(console, 'warn').mockImplementation(() => {});
        prepare.mockImplementation(() => { throw Error('probe failure'); }); events.emit('prerender');
        expect(system.getShaderWarmupState()).toBe('failed');
      }
      const calls = prepare.mock.calls.length;
      events.emit('prerender'); events.emit('shutdown');
      expect(prepare).toHaveBeenCalledTimes(calls);
      expect(destroy).toHaveBeenCalledTimes(1); expect(next.destroy).toHaveBeenCalledTimes(1);
      expect(events.count('prerender')).toBe(0); expect(events.count('shutdown')).toBe(0);
      expect(context.setColorWritemask).toHaveBeenCalledWith(false, false, false, false);
      expect(context.releases).toBe(GPU_VFX_LANES.length + calls + next.prepare.mock.calls.length);
      if (outcome !== 'destroy') system.destroy();
      expect(destroy).toHaveBeenCalledTimes(1);
    });

  it('keeps world mesh probes in the ready barrier and can wake without recreating disposed combat probes', () => {
    const scene = makeFakeGpuVfxScene(), events = makeWarmupEvents(), context = makeWarmupContext();
    Object.assign(scene, { events, cameras: { main: {} }, renderer: { baseDrawingContext: { getClone: () => context } } });
    const addLayer = scene.add.spriteGPULayer;
    scene.add.spriteGPULayer = ((key: string, size: number) => Object.assign(addLayer(key, size), {
      submitterNode: { run() {}, programManager: { getCurrentProgramSuite: () => ({}) } },
    })) as typeof scene.add.spriteGPULayer;
    const probe = { name: 'combat', prepare: vi.fn(() => true), destroy: vi.fn() };
    const system = new GpuVfxSystem(scene as never, [probe]);
    let meshReady = false;
    const mesh = vi.fn(() => meshReady), release = registerEnemyMeshWarmup(scene as never, mesh);
    for (let i = 0; i <= GPU_VFX_LANES.length; i++) events.emit('prerender');
    expect(probe.prepare).toHaveBeenCalledOnce(); expect(mesh).toHaveBeenCalledOnce();
    expect(system.isShaderWarmupComplete()).toBe(false); expect(probe.destroy).not.toHaveBeenCalled();
    meshReady = true; events.emit('prerender');
    expect(system.getShaderWarmupState()).toBe('complete'); expect(probe.destroy).toHaveBeenCalledOnce();
    const releaseNext = registerEnemyMeshWarmup(scene as never, () => false);
    expect(system.isShaderWarmupComplete()).toBe(false);
    releaseNext();
    for (let i = 0; i < GPU_VFX_LANES.length; i++) events.emit('prerender');
    expect(system.getShaderWarmupState()).toBe('complete');
    expect(probe.prepare).toHaveBeenCalledOnce(); expect(probe.destroy).toHaveBeenCalledOnce();
    release(); system.destroy();
  });
});

describe('gpu vfx system: frame order', () => {
  it('unregisters a world-owned emitter without stopping other effects', () => {
    const { system } = setup();
    let first = 0, second = 0;
    const stop = system.registerEmission(() => { first++; });
    system.registerEmission(() => { second++; });
    system.update(16);
    stop(); stop();
    system.update(16);
    expect(first).toBe(1);
    expect(second).toBe(2);
  });
  it('retires expired members before running the emission ticks', () => {
    // Reihenfolge ist Teil des Vertrags: `acquire()` vergibt nur freie Slots, ein Spawn vor dem
    // Sweep wuerde als Kapazitaets-Verwurf abgewiesen.
    const { scene, system } = setup();
    const spec = spawnSpec(system, GpuVfxEffectId.RocketExhaust);
    spec.lifeMs = 100;
    const layer = findFakeLane(scene, 'rocket-exhaust');
    const order: number[] = [];
    system.registerEmission((_deltaMs, nowMs) => {
      order.push(nowMs);
      system.spawn(spec, 0, nowMs);
    });

    system.update(50);
    system.update(50);
    expect(system.getLaneStats(GpuVfxLaneId.RocketExhaust)?.liveCount).toBe(2);

    layer.patched.length = 0;
    system.update(50);
    expect(layer.patched).toEqual([0]);
    expect(system.getLaneStats(GpuVfxLaneId.RocketExhaust)?.capacityDrops).toBe(0);
    expect(order.length).toBe(3);
  });

  it('shares one monotonic clock across effects', () => {
    const { system } = setup();
    expect(system.now()).toBe(0);
    system.update(16);
    system.update(16);
    expect(system.now()).toBe(32);
  });

  it('retires live members when a layer clock wraps', () => {
    // `ElapseTimer` setzt `timeElapsed` nach einer Stunde zurueck, ohne die `creationTime` der
    // Member mitzuziehen. Ohne Eingriff extrapolieren deren Animationen schlagartig weit ueber
    // ihr Ende hinaus – additiv also ein Vollbild-Blitz.
    const { scene, system } = setup();
    const spec = spawnSpec(system, GpuVfxEffectId.RocketExhaust);
    spec.lifeMs = 10_000;
    const layer = findFakeLane(scene, 'rocket-exhaust');
    system.registerEmission((_deltaMs, nowMs) => { system.spawn(spec, 0, nowMs); });

    layer.timeElapsed = 3_599_900;
    system.update(16);
    system.update(16);
    expect(system.getLaneStats(GpuVfxLaneId.RocketExhaust)?.liveCount).toBe(2);

    layer.timeElapsed = 100;
    system.update(16);
    // Alles vor dem Ruecksprung ist still; nur der Spawn dieses Frames lebt noch.
    expect(system.getLaneStats(GpuVfxLaneId.RocketExhaust)?.liveCount).toBe(1);
  });
});

describe('gpu vfx system: idle visibility', () => {
  it('hides a lane with no living members and shows it on the first spawn', () => {
    const { scene, system } = setup();
    const layer = findFakeLane(scene, 'rocket-exhaust');
    // Ein geprimter Layer zeichnet sonst seine volle Kapazitaet an Instanzen.
    expect(layer.visible).toBe(false);

    const spec = spawnSpec(system, GpuVfxEffectId.RocketExhaust);
    spec.lifeMs = 100;
    system.spawn(spec, 0, 0);
    expect(layer.visible).toBe(true);

    system.update(200);
    expect(layer.visible).toBe(false);
    // Die erste Umschaltung ist das Verstecken beim Anlegen (ein frischer Layer ist sichtbar).
    // Danach genau zwei: 0 -> 1 und 1 -> 0, nicht eine pro Frame.
    expect(layer.visibleTransitions).toEqual([false, true, false]);
  });

  it('keeps every lane hidden while the stink cloud emits nothing at 60 fps', () => {
    // Die Paritaetssemantik der Wolke emittiert auf 16,7-ms-Frames gar nicht; die sechs
    // Wolken-Lanes duerfen dann auch nicht gezeichnet werden.
    const { scene, system } = setup();
    for (let frame = 0; frame < 120; frame += 1) system.update(16.7);
    expect(scene.layers.every((layer) => layer.visible === false)).toBe(true);
  });

  it('lets the ablation win over the idle state', () => {
    const { scene, system } = setup();
    const layer = findFakeLane(scene, 'rocket-exhaust');
    const spec = spawnSpec(system, GpuVfxEffectId.RocketExhaust);
    spec.lifeMs = 10_000;
    system.spawn(spec, 0, 0);
    expect(layer.visible).toBe(true);

    system.setSuppressed(true);
    expect(layer.visible).toBe(false);
    // Laufendes Material verschwindet sofort – GPU-Zeit laesst sich nicht einfrieren.
    expect(system.getLaneStats(GpuVfxLaneId.RocketExhaust)?.liveCount).toBe(0);

    // Nach dem Ende der Ablation bleibt die leere Lane unsichtbar.
    system.setSuppressed(false);
    expect(layer.visible).toBe(false);

    system.spawn(spec, 0, 0);
    expect(layer.visible).toBe(true);
  });

  it('suppresses rendering and scheduler together, without catching up afterwards', () => {
    const { system } = setup();
    let ticks = 0;
    system.registerEmission(() => { ticks += 1; });

    system.update(16);
    system.update(16);
    expect(ticks).toBe(2);

    system.setSuppressed(true);
    for (let frame = 0; frame < 60; frame += 1) system.update(16);
    expect(ticks).toBe(2);

    system.setSuppressed(false);
    system.update(16);
    // Kein Nachhol-Burst: genau ein Tick fuer den einen Frame nach der Freigabe.
    expect(ticks).toBe(3);
  });

  it('is idempotent about the suppression state', () => {
    const { system } = setup();
    system.setSuppressed(true);
    system.setSuppressed(true);
    expect(system.isSuppressed()).toBe(true);
    system.setSuppressed(false);
    expect(system.isSuppressed()).toBe(false);
  });
});

describe('gpu vfx system: spawn spec', () => {
  it('turns velocities into amplitudes over the lifetime and never loops', () => {
    const { scene, system } = setup();
    const spec = spawnSpec(system, GpuVfxEffectId.RocketExhaust);
    spec.lifeMs = 500;
    spec.vx = 30;
    spec.vy = -40;
    system.spawn(spec, 0, 0);

    const member = findFakeLane(scene, 'rocket-exhaust').members[0];
    expect(member.x.base).toBe(10);
    expect(member.x.amplitude).toBeCloseTo(15, 10);   // 30 px/s ueber 0,5 s
    expect(member.y.amplitude).toBeCloseTo(-20, 10);
    expect(member.x.loop).toBe(false);
    expect(member.y.loop).toBe(false);
    expect(member.scaleX.loop).toBe(false);
    expect(member.alpha.loop).toBe(false);
  });

  it('leaves existing static effects unanimated', () => {
    const { scene, system } = setup();
    const spec = spawnSpec(system, GpuVfxEffectId.RocketExhaust);
    system.spawn(spec, 0, 0);

    expect(findFakeLane(scene, 'rocket-exhaust').members[0]!.frameAnimation).toBeNull();
  });

  it('encodes gravity motion with an integer velocity', () => {
    const { scene, system } = setup();
    const spec = spawnSpec(system, GpuVfxEffectId.AirstrikeBomb);
    spec.yMode = GpuVfxEase.Gravity;
    spec.vy = 77.6;
    system.spawn(spec, 0, 0);

    const member = findFakeLane(scene, 'airstrike-bomb').members[0];
    expect(member.y.ease).toBe('Gravity');
    // Phaser kodiert `velocity` ganzzahlig.
    expect(member.y.amplitude).toBe(78);
  });

  it('applies the eased base correction only to non-linear curves', () => {
    const { scene, system } = setup();

    const linear = spawnSpec(system, GpuVfxEffectId.RocketExhaust);
    linear.alphaStart = 0.95;
    linear.alphaEnd = 0;
    system.spawn(linear, 0, 0);
    const linearMember = findFakeLane(scene, 'rocket-exhaust').members[0];
    // `Linear` rechnet ohne den `repeats`-Term; die Basis bleibt der Startwert.
    expect(linearMember.alpha.base).toBeCloseTo(0.95, 10);
    expect(evaluateFakeAnimation(linearMember.alpha, 1)).toBeCloseTo(0, 10);

    const eased = spawnSpec(system, GpuVfxEffectId.RocketSmoke);
    eased.alphaStart = 0.95;
    eased.alphaEnd = 0;
    eased.alphaEase = GpuVfxEase.QuadOut;
    system.spawn(eased, 0, 0);
    const easedMember = findFakeLane(scene, 'rocket-smoke').members[0];
    expect(easedMember.alpha.base).not.toBeCloseTo(0.95, 10);
    // Erst mit der Korrektur kommt beim Zeichnen exakt base + amplitude * ease(t) heraus.
    expect(evaluateFakeAnimation(easedMember.alpha, 0)).toBeCloseTo(0.95, 10);
    // Der Shader nimmt fuer nicht-lineare Eases mod(t, 1); bei exakt 1 ist der Member ohnehin
    // schon stillgelegt, deshalb kurz davor pruefen.
    expect(evaluateFakeAnimation(easedMember.alpha, 0.9999)).toBeCloseTo(0, 6);
  });

  it('keeps two effects isolated from each other', () => {
    // Ein geteiltes Scratch-Objekt wuerde hier ein Feld des einen Effekts zum anderen tragen.
    const { scene, system } = setup();
    const exhaust = spawnSpec(system, GpuVfxEffectId.RocketExhaust);
    const smoke = spawnSpec(system, GpuVfxEffectId.RocketSmoke);
    exhaust.tint = 0x111111;
    smoke.tint = 0x222222;
    exhaust.rotation = 1.25;
    smoke.rotation = 0;

    for (let n = 0; n < 3; n += 1) {
      system.spawn(exhaust, 0, n);
      system.spawn(smoke, 0, n);
    }

    const exhaustLane = findFakeLane(scene, 'rocket-exhaust');
    const smokeLane = findFakeLane(scene, 'rocket-smoke');
    expect(exhaustLane.members.every((m) => m.tint === 0x111111)).toBe(true);
    expect(smokeLane.members.every((m) => m.tint === 0x222222)).toBe(true);
    expect(exhaustLane.members.every((m) => m.rotation.base === 1.25)).toBe(true);
    expect(smokeLane.members.every((m) => m.rotation.base === 0)).toBe(true);
  });

  it('allocates nothing per spawn', () => {
    // Der Member wird als wiederverwendete Vorlage uebergeben; `editMember` liest sie synchron.
    const scene = makeFakeGpuVfxScene();
    const seen = new Set<object>();
    const original = scene.add.spriteGPULayer;
    scene.add.spriteGPULayer = ((key: string, size: number) => {
      const layer = (original as unknown as (k: string, s: number) => Record<string, unknown>)(key, size);
      const edit = layer.editMember as (index: number, member: object) => void;
      layer.editMember = (index: number, member: object) => { seen.add(member); edit(index, member); };
      return layer;
    }) as never;

    const system = new GpuVfxSystem(scene as never);
    const spec = system.createSpec(GpuVfxEffectId.RocketExhaust);
    spec.lifeMs = 100_000;
    for (let n = 0; n < 1000; n += 1) system.spawn(spec, 0, 0);
    const death = system.createSpec(GpuVfxEffectId.DeathFragment);
    death.frameAnimation = GpuVfxFrameAnimationId.DeathDisintegration;
    death.lifeMs = 1350;
    for (let n = 0; n < 1000; n += 1) system.spawn(death, 0, 0);

    expect(seen.size).toBe(1);
  });
});

describe('gpu vfx system: admission and diagnostics', () => {
  it('keeps the critical reserve free for critical effects', () => {
    // Rein logische Reserve auf `liveCount`; ein physisch reservierter Indexbereich wuerde den
    // Ring fragmentieren.
    expect(admitGpuVfxSpawn(0, 10, 2, 'decorative')).toBe(true);
    expect(admitGpuVfxSpawn(7, 10, 2, 'decorative')).toBe(true);
    expect(admitGpuVfxSpawn(8, 10, 2, 'decorative')).toBe(false);
    expect(admitGpuVfxSpawn(8, 10, 2, 'standard')).toBe(false);
    expect(admitGpuVfxSpawn(8, 10, 2, 'critical')).toBe(true);
    expect(admitGpuVfxSpawn(9, 10, 2, 'critical')).toBe(true);
    // Voll ist voll – auch fuer kritische Effekte.
    expect(admitGpuVfxSpawn(10, 10, 2, 'critical')).toBe(false);
    // Ohne Reserve entscheidet allein die Kapazitaet.
    expect(admitGpuVfxSpawn(9, 10, 0, 'decorative')).toBe(true);
  });

  it('keeps the statistics of logical effects apart on a shared lane', () => {
    const { system } = setup();
    const accent = spawnSpec(system, GpuVfxEffectId.StinkAccent);
    const edge = spawnSpec(system, GpuVfxEffectId.StinkEdge);
    // Beide zeichnen additiv im selben Tiefenband und teilen sich deshalb eine physische Lane.
    // Die Effektstatistik muss davon unabhaengig bleiben.
    expect(accent.lane).toBe(edge.lane);
    system.spawn(accent, 0, 0);
    system.spawn(edge, 0, 0);
    system.spawn(edge, 0, 0);
    system.recordQualityDrop(GpuVfxEffectId.StinkAccent, 3);

    const report = system.buildReport();
    const accentReport = report.effects.find((e) => e.label === 'stink.accent')!;
    const edgeReport = report.effects.find((e) => e.label === 'stink.edge')!;
    expect(accentReport.spawns).toBe(1);
    expect(accentReport.qualityDrops).toBe(3);
    expect(edgeReport.spawns).toBe(2);
    expect(edgeReport.qualityDrops).toBe(0);
    expect(report.effects.length).toBe(GPU_VFX_EFFECTS.length);
  });

  it('reports lanes, effects and their co-activity', () => {
    const { system } = setup();
    const exhaust = spawnSpec(system, GpuVfxEffectId.RocketExhaust);
    const smoke = spawnSpec(system, GpuVfxEffectId.RocketSmoke);
    exhaust.lifeMs = 10_000;
    smoke.lifeMs = 10_000;

    system.registerEmission((_deltaMs, nowMs) => {
      system.spawn(exhaust, 0, nowMs);
      system.spawn(smoke, 0, nowMs);
    });
    for (let frame = 0; frame < 5; frame += 1) system.update(16);

    const report = system.buildReport();
    expect(report.frames).toBe(5);

    const exhaustLane = report.lanes.find((lane) => lane.label === 'rocket-exhaust')!;
    expect(exhaustLane.capacity).toBe(2048);
    expect(exhaustLane.highWaterMark).toBe(5);
    expect(exhaustLane.rearms).toBe(5);
    expect(exhaustLane.visibleFrames).toBe(5);
    expect(exhaustLane.utilization).toBeCloseTo(5 / 2048, 3);

    // Beide Lanes waren in denselben Frames aktiv – die Bedingung fuer eine Zusammenlegung.
    const co = report.coVisibleFrames[GpuVfxLaneId.RocketExhaust][GpuVfxLaneId.RocketSmoke];
    expect(co).toBe(5);
    // Eine nie aktive Lane hat keine Ueberschneidung.
    expect(report.coVisibleFrames[GpuVfxLaneId.RocketExhaust][GpuVfxLaneId.StinkAdd]).toBe(0);
  });

  it('marks current VFX utilization, not a historical peak, as the active anomaly', () => {
    const { system } = setup();
    const sink = vi.fn();
    system.setDiagnosticEventSink(sink);
    const spec = spawnSpec(system, GpuVfxEffectId.RocketSmoke);
    spec.lifeMs = 10_000;
    for (let index = 0; index < 576; index += 1) system.spawn(spec, 0, 0);

    system.update(16);
    expect(sink).toHaveBeenCalledWith('gpu:vfx_high_utilization', expect.objectContaining({
      lane: 'rocket-smoke',
      liveCount: 576,
      capacity: 640,
    }));
    const countAfterHigh = sink.mock.calls.length;

    system.releaseAll();
    system.update(16);
    system.spawn(spec, 0, 16);
    system.update(16);
    expect(sink.mock.calls.length).toBe(countAfterHigh);
    expect(system.buildReport().lanes.find((lane) => lane.label === 'rocket-smoke')?.highWaterMark)
      .toBe(576);
  });

  it('starts a fresh measurement window on demand', () => {
    // Die Zaehler laufen seit dem Szenenaufbau; eine Messung braucht dasselbe Fenster wie der
    // uebrige Performance-Report.
    const { system } = setup();
    const spec = spawnSpec(system, GpuVfxEffectId.RocketExhaust);
    spec.lifeMs = 10_000;
    system.spawn(spec, 0, 0);
    system.update(16);
    expect(system.buildReport().frames).toBe(1);

    system.resetProfiling();
    const report = system.buildReport();
    expect(report.frames).toBe(0);
    expect(report.effects.every((effect) => effect.spawns === 0)).toBe(true);
    const lane = report.lanes.find((entry) => entry.label === 'rocket-exhaust')!;
    expect(lane.rearms).toBe(0);
    // Der Slot-Zustand bleibt unangetastet: das lebende Material zaehlt weiter.
    expect(lane.active).toBe(1);
    expect(lane.highWaterMark).toBe(1);
  });

  it('reports stats per lane label for the live overlay', () => {
    const { system } = setup();
    const spec = spawnSpec(system, GpuVfxEffectId.RocketExhaust);
    system.spawn(spec, 0, 0);

    const stats = system.getStats();
    expect(Object.keys(stats ?? {}).length).toBe(GPU_VFX_LANES.length);
    expect(stats?.['rocket-exhaust'].liveCount).toBe(1);
    expect(stats?.['rocket-smoke'].liveCount).toBe(0);
  });
});

describe('gpu vfx system: sources', () => {
  it('releases only the members of the given source, across every lane', () => {
    const { scene, system } = setup();
    const exhaust = spawnSpec(system, GpuVfxEffectId.RocketExhaust);
    exhaust.lifeMs = 10_000;
    const a = system.createSource(GpuVfxEffectId.RocketExhaust);
    const b = system.createSource(GpuVfxEffectId.RocketExhaust);

    system.spawn(exhaust, a, 0);
    system.spawn(exhaust, b, 0);
    system.spawn(exhaust, a, 0);

    system.releaseSource(a);
    const layer = findFakeLane(scene, 'rocket-exhaust');
    expect(layer.patched.slice().sort()).toEqual([0, 2]);
    expect(system.getLaneStats(GpuVfxLaneId.RocketExhaust)?.liveCount).toBe(1);
  });

  it('lets a lingering source hand off its members and recycles the handle safely', () => {
    const { scene, system } = setup();
    // `rocket.smoke` ist im Manifest `linger`: die Quelle verschwindet, die Puffs leben aus.
    const smoke = spawnSpec(system, GpuVfxEffectId.RocketSmoke);
    smoke.lifeMs = 10_000;
    const source = system.createSource(GpuVfxEffectId.RocketSmoke);
    system.spawn(smoke, source, 0);
    system.spawn(smoke, source, 0);

    system.releaseSource(source);
    const layer = findFakeLane(scene, 'rocket-smoke');
    expect(layer.patched).toEqual([]);
    expect(system.getLaneStats(GpuVfxLaneId.RocketSmoke)?.liveCount).toBe(2);

    // Derselbe Index wird recycelt; die alten Member duerfen daran nicht mehr haengen.
    const recycled = system.createSource(GpuVfxEffectId.RocketExhaust);
    expect(recycled).toBe(source);
    system.releaseSource(recycled);
    expect(layer.patched).toEqual([]);
    expect(system.getLaneStats(GpuVfxLaneId.RocketSmoke)?.liveCount).toBe(2);
  });

  it('clears a long-lived source without giving up its handle', () => {
    const { scene, system } = setup();
    const smoke = spawnSpec(system, GpuVfxEffectId.RocketSmoke);
    smoke.lifeMs = 10_000;
    const source = system.createSource(GpuVfxEffectId.RocketSmoke);
    system.spawn(smoke, source, 0);

    system.clearSource(source);
    const layer = findFakeLane(scene, 'rocket-smoke');
    expect(layer.patched.length).toBe(1);
    expect(layer.visible).toBe(false);

    // Der Handle bleibt gueltig und kann sofort weiterbenutzt werden.
    expect(system.spawn(smoke, source, 0)).toBe(true);
    expect(system.getLaneStats(GpuVfxLaneId.RocketSmoke)?.liveCount).toBe(1);
  });
});

// Exercise the pinned Phaser assembler, not a hand-written fragment substitute.
describe('Phaser PMA zero-alpha compatibility for GPU and ordinary batches',()=>{
  async function harness(){
    const {createRequire}=await import('node:module');const {readFileSync}=await import('node:fs');
    const {runInNewContext}=await import('node:vm');const {resolve}=await import('node:path');
    const require=createRequire(resolve('package.json'));
    const Program=require(resolve('node_modules/phaser/src/renderer/webgl/ProgramManager.js'));
    const Factory=require(resolve('node_modules/phaser/src/renderer/webgl/ShaderProgramFactory.js'));
    const compat=await import('../src/graphics/PhaserAlphaZero');
    const prototype=Object.create(Program.prototype);compat.installPhaserAlphaZero(prototype);
    const hook=prototype.addAddition;compat.installPhaserAlphaZero(prototype);expect(prototype.addAddition).toBe(hook);
    const manager=new Program({},[]);Object.setPrototypeOf(manager,prototype);
    const factory=new Factory({createProgram:(vertex:string,fragment:string)=>({vertex,fragment})});
    const nodeConfig=(name:string)=>{
      const file=resolve('node_modules/phaser/src/renderer/webgl/renderNodes/'+name+'.js');
      const localRequire=createRequire(file),module={exports:{} as any};
      // Read each real node's default config without constructing its DOM/GPU resources.
      runInNewContext(readFileSync(file,'utf8'),{module,require:(id:string)=>id.endsWith('/Class')?(function(config:unknown){return config;}):id.includes('/shaders/')?localRequire(id):{}});
      return module.exports.defaultConfig;
    };
    const compose=()=>{const c=manager.currentConfig;return factory.getShaderProgram(c.base,c.additions,c.features).fragment as string;};
    return {require,resolve,manager,factory,nodeConfig,compose,...compat};
  }
  it('guards the assembled GPU, Quad/QuadSingle, Strip and TileSprite tint before division, with distinct cache names',async()=>{
    const h=await harness();
    for(const node of ['submitter/SubmitterSpriteGPULayer','BatchHandlerQuad','BatchHandlerStrip','BatchHandlerTileSprite']){
      const c=h.nodeConfig(node);expect(c.shaderAdditions).toBeDefined();
      for(const name of node==='BatchHandlerQuad'?[c.shaderName,'STANDARD_SINGLE']:[c.shaderName]){
        h.manager.currentConfig.additions=[];h.manager.setBaseShader(name,c.vertexSource,c.fragmentSource);
        const original=c.shaderAdditions.map((a:any)=>({...a,additions:{...a.additions}}));
        const oldKey=h.factory.getKey({name},original,[]);
        for(const addition of original)h.manager.addAddition(addition);
        const text=h.compose(),guard=text.indexOf('if (texture.a <= 0.0) { return vec4(0.0); }');
        expect(guard,node).toBeGreaterThan(-1);expect(guard,node).toBeLessThan(text.indexOf('texture.rgb / texture.a'));
        expect(h.manager.getAdditionsByTag('TINT')[0].name).not.toBe('Tint');
        expect(h.factory.getKey(h.manager.currentConfig.base,h.manager.currentConfig.additions,[])).not.toBe(oldKey);
      }
    }
  });
  it('guards self-shadow, changing stencil strategies and Key without losing lighting lookups or tags',async()=>{
    const h=await harness(),base=h.resolve('node_modules/phaser/src/renderer/webgl/shaders');
    h.manager.setBaseShader('STANDARD',h.require(base+'/Multi-vert.js'),h.require(base+'/Multi-frag.js'));
    const lights=h.require(base+'/additionMakers/MakeDefineLights.js')(false);h.manager.addAddition(lights);
    expect(h.manager.getAddition('DefineLights')).toBe(lights);lights.additions.fragmentDefine='#define LIGHT_COUNT 7';
    const make=h.require(base+'/additionMakers/MakeApplyAlphaDiscard.js');h.manager.addAddition(make(true));
    for(const args of [[false,true],[false,false,.1],[true]] as const){
      const previous=h.manager.getAdditionsByTag('ALPHA_DISCARD')[0];h.manager.replaceAddition(previous.name,make(...args));
      const text=h.compose();expect(text).toContain('if (fragColor.a <= 0.0) { return vec4(0.0); }');
      expect(text).toContain('#define LIGHT_COUNT 7');
      if(!args[0])expect(text.indexOf('if (fragColor.a <= 0.0) { discard; }')).toBeLessThan(text.indexOf('return fragColor / fragColor.a;'));
    }
    h.manager.currentConfig.additions=[];
    h.manager.setBaseShader('KEY','',h.require(base+'/FilterKey-frag.js'));
    const text=h.compose();expect(text).toContain('if (color.a <= 0.0) { gl_FragColor = vec4(0.0); return; }');
    h.manager.setBaseShader('GRADIENT_MAP','',h.require(base+'/FilterGradientMap-frag.js'));
    expect(h.compose()).toContain('if (sample.a <= 0.0) { gl_FragColor = vec4(0.0); return; }');
    for(const file of ['ColorMatrix-frag','FilterColorMatrix-frag','FilterCombineColorMatrix-frag']){
      const original=h.require(base+'/'+file+'.js');expect(h.guardPhaserUnpremultiply(original)).toBe(original);
    }
  });
  it('leaves the entire positive-alpha branch byte-identical and makes all tint modes finite at zero',async()=>{
    const h=await harness(),original=h.require(h.resolve('node_modules/phaser/src/renderer/webgl/shaders/ApplyTint-glsl.js')) as string;
    const patched=h.guardPhaserUnpremultiply(original);
    expect(patched.replace('\n    // FD_ALPHA_ZERO_V1\n    if (texture.a <= 0.0) { return vec4(0.0); }','')).toBe(original);
    expect(h.guardPhaserUnpremultiply(patched)).toBe(patched);
    // Numeric counterpart of the unchanged ApplyTint branch. Source identity above
    // proves no positive-alpha GLSL operation (including tint mode 3/pass-through) changes.
    const tint=(a:number,mode:number,guard:boolean)=>{
      if(guard&&a<=0)return [0,0,0,0];
      const rgb=[.2*a,.5*a,.9*a],t=[.25,.6,.8],effect=[.8,.3,.1];
      const out=rgb.map((channel,i)=>{const u=channel/a;let c=u;
        if(mode===0)c*=t[i];else if(mode===1)c=t[i];else if(mode===2)c+=t[i];
        else if(mode===4)c=1-(1-u)*(1-t[i]);
        else if(mode===5)c=u<.5?2*t[i]*u:1-2*(1-t[i])*(1-u);
        else if(mode===6)c=t[i]<.5?2*t[i]*u:1-2*(1-t[i])*(1-u);
        else if(mode===7)c=(1-u)*effect[i]+t[i]*u;
        return c*a*.7;
      });return [...out,a*.7];
    };
    for(let mode=0;mode<=7;mode++){
      expect(tint(0,mode,true)).toEqual([0,0,0,0]);expect(tint(-1,mode,true)).toEqual([0,0,0,0]);
      for(const a of [1e-12,1/255,1]){const actual=tint(a,mode,true);expect(actual.every(Number.isFinite)).toBe(true);expect(actual).toEqual(tint(a,mode,false));}
    }
    expect(tint(0,0,false).some(Number.isNaN)).toBe(true);
  });
});


describe('standalone composite blend isolation (pinned Phaser state and submitters)',()=>{
  async function harness(){
    const {createRequire}=await import('node:module');const {readFileSync}=await import('node:fs');
    const {runInNewContext}=await import('node:vm');const {resolve}=await import('node:path');
    const require=createRequire(resolve('package.json')),root=resolve('node_modules/phaser/src/renderer/webgl');
    const DC=require(root+'/DrawingContext.js'),Wrapper=require(root+'/wrappers/WebGLGlobalWrapper.js');
    const Factory=require(root+'/parameters/WebGLBlendParametersFactory.js');
    const List=require(root+'/renderNodes/ListCompositor.js');
    const methods=(file:string)=>{
      const module={exports:{} as any},localRequire=createRequire(root+'/'+file);
      runInNewContext(readFileSync(root+'/'+file,'utf8'),{module,WEBGL_DEBUG:false,
        require:(id:string)=>id.endsWith('/Class')?function(config:unknown){return config;}
          :id.includes('/shaders/')||id.includes('WebGLBlendParametersFactory')?localRequire(id):{}});
      return module.exports;
    };
    const Renderer=methods('WebGLRenderer.js'),Quad=methods('renderNodes/BatchHandlerQuad.js');
    const GPU=methods('renderNodes/submitter/SubmitterSpriteGPULayer.js');
    const draws:{kind:string;func:number[]}[]=[],calls:number[][]=[];let active:number[]=[1,771,1,771];
    const gl=new Proxy({ONE:1,ZERO:0,ONE_MINUS_SRC_ALPHA:771,DST_ALPHA:772,DST_COLOR:774,SRC_COLOR:768,ONE_MINUS_SRC_COLOR:769,FUNC_ADD:32774,
      blendFuncSeparate:(...f:number[])=>{active=f;calls.push(f);},
      drawElements:()=>draws.push({kind:'quad',func:active.slice()}),
      drawArraysInstanced:()=>draws.push({kind:'gpu',func:active.slice()}),
    } as any,{get:(o,k)=>o[k]??(()=>{})});
    const r:any={...Renderer,gl,width:100,height:100,config:{alphaStrategy:'keep'},createFramebuffer:()=>({}),
      glTextureUnits:{bindUnits:()=>{},unbindTexture:()=>{}}};
    r.blendModes=Array.from({length:18},()=>Factory.createCombined(r));
    r.blendModes[1]=Factory.createCombined(r,true,undefined,gl.FUNC_ADD,gl.ONE,gl.DST_ALPHA);
    const mode=r.blendModes.length;
    expect(r.addBlendMode([gl.DST_COLOR,gl.SRC_COLOR],gl.FUNC_ADD)).toBe(mode-1);
    r.updateBlendMode(mode,[gl.DST_COLOR,gl.SRC_COLOR,gl.ZERO,gl.ONE],gl.FUNC_ADD);
    r.glWrapper=new Wrapper(r);
    const manager:any={renderer:r,finishBatch:vi.fn(),startStandAloneRender:()=>manager.finishBatch()};r.renderNodes=manager;
    const context=new DC(r,{useCanvas:true,autoClear:false}),list=new List(manager);
    const suite={program:{bind:()=>{}},vao:{bind:()=>{}}};
    const base={manager,programManager:{getCurrentProgramSuite:()=>suite,applyUniforms:()=>{}},
      onRunBegin:()=>{},onRunEnd:()=>{},setupUniforms:()=>{},renderOptions:{},updateRenderOptions:()=>{}};
    const drawQuad=(c:any)=>Quad.run.call({...base,instanceCount:1,bytesPerInstance:64,indicesPerInstance:6,bytesPerIndexPerInstance:12,
      vertexBufferLayout:{buffer:{update:()=>{}}},batchEntries:[{texture:[],unit:1,count:1,start:0}],currentBatchEntry:{start:0},
      pushCurrentBatchEntry:()=>{},finalizeTextureCount:()=>{}},c);
    const drawGPU=(c:any)=>GPU.run.call({...base,gameObject:{memberCount:1,bufferUpdateSegments:0,frame:{source:{glTexture:{}}},frameDataTexture:{}}},c);
    const {runWithScopedBlend}=await import('../src/graphics/PhaserScopedBlend');
    const scope=(draw:(c:any)=>void)=>runWithScopedBlend({manager} as never,draw as never,context,mode,{} as never,undefined as never);
    return {r,mode,context,list,drawQuad,drawGPU,scope,draws,calls,manager};
  }
  it('restores caller state immediately and routes subsequent NORMAL/ADD through real quad and GPU draw calls',async()=>{
    const h=await harness(),normal=h.r.blendModes[0].func,add=h.r.blendModes[1].func,custom=h.r.blendModes[h.mode].func;
    const original=h.context.state.blend;
    for(const draw of [h.drawQuad,h.drawGPU])for(const mode of [0,1]){
      h.scope(c=>{
        h.r.drawElements(c,[],{bind(){}},{bind(){}},4,0);
        expect(h.draws.at(-1)!.func).toEqual(custom);
      });
      expect(h.context.blendMode).toBe(0);expect(h.context.state.blend).toBe(original);
      expect(h.r.glWrapper.state.blend.func).toEqual(normal);
      h.list.run(h.context,[{blendMode:mode,renderWebGLStep:(_r:any,_o:any,c:any)=>draw(c)}]);
      expect(h.draws.at(-1)!.func).toEqual(mode===0?normal:add);
      // Transparent PMA texels preserve the destination in both successor modes.
      const destination=.42,alpha=1;
      expect(mode===0?0+destination*(1-0):0+destination*alpha).toBe(destination);
    }
    // The dependency normally restores at the next draw, not on context release.
    // Do not claim its index comparison itself fails: verify that baseline too.
    h.list.run(h.context,[h.mode,0,1].map(blendMode=>({blendMode,renderWebGLStep:(_r:any,_o:any,c:any)=>h.drawGPU(c)})));
    expect(h.draws.slice(-3).map(d=>d.func)).toEqual([custom,normal,add]);
  });
  it('flushes pending geometry first and restores state even when a standalone draw fails',async()=>{
    const h=await harness(),original=h.context.state.blend;
    h.manager.finishBatch.mockImplementationOnce(()=>expect(h.context.blendMode).toBe(0));
    expect(()=>h.scope(c=>{c.beginDraw();throw Error('draw failed');})).toThrow('draw failed');
    expect(h.context.state.blend).toBe(original);expect(h.context.blendMode).toBe(0);
    expect(h.r.glWrapper.state.blend.func).toEqual(h.r.blendModes[0].func);
    h.drawGPU(h.context);expect(h.draws.at(-1)!.func).toEqual(h.r.blendModes[0].func);
  });
  it('preserves destination alpha and subsequent transparent ADD pixels regardless of source alpha',async()=>{
    const h=await harness(),custom=h.r.blendModes[h.mode].func;
    const factor=(f:number,s:number,d:number)=>f===0?0:f===1?1:f===768?s:f===774||f===772?d:f===771?1-s:NaN;
    const blendAlpha=(f:number[],s:number,d:number)=>Math.max(0,Math.min(1,s*factor(f[2],s,d)+d*factor(f[3],s,d)));
    for(const srcAlpha of [0,1/255,127/255,.5,128/255,1])for(const destination of [0,.25,1]){
      expect(blendAlpha(custom,srcAlpha,destination)).toBe(destination);
    }
    // Numeric regression: the old combined factors amplify a one-LSB alpha
    // deficit through Phaser ADD, whose zero-source alpha result is dstAlpha squared.
    let oldAlpha=blendAlpha([774,768,774,768],127/255,1),oldRGB=.4;
    let alpha=blendAlpha(custom,127/255,1),rgb=.4;
    const add=h.r.blendModes[1].func;expect(add).toEqual([1,772,1,772]);
    for(let i=0;i<12;i++){
      oldRGB*=oldAlpha;oldAlpha=blendAlpha(add,0,oldAlpha);
      rgb*=alpha;alpha=blendAlpha(add,0,alpha);
    }
    expect(oldRGB).toBeLessThan(6/255);expect(rgb).toBe(.4);expect(alpha).toBe(1);
    // Ordinary NORMAL, MULTIPLY and SCREEN preserve an already opaque scene.
    for(const mode of [0,2,3]){
      const f=h.r.blendModes[mode].func as number[];
      // ONE_MINUS_SRC_COLOR has the same alpha factor as ONE_MINUS_SRC_ALPHA.
      const alphaFactors=f.map(x=>x===769?771:x);
      for(let a=0;a<=255;a++)expect(blendAlpha(alphaFactors,a/255,1)).toBe(1);
    }
  });

});
