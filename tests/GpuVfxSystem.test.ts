import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { NORMAL: 0, ADD: 1 },
  Math: { Linear: (a: number, b: number, t: number) => a + (b - a) * t },
}));

const qualityFactors = { critical: 1, standard: 1, decorative: 1 };
vi.mock('../src/graphics/GraphicsQuality', () => ({
  getGraphicsQualityController: () => ({
    getProfile: () => ({ particleFactors: qualityFactors }),
    subscribe: () => () => {},
  }),
}));

import { resetGpuVfxAtlasForTests } from '../src/effects/gpu/GpuVfxAtlas';
import { GpuVfxEase } from '../src/effects/gpu/GpuVfxEase';
import { GPU_VFX_EFFECTS, GpuVfxEffectId } from '../src/effects/gpu/GpuVfxEffects';
import { GPU_VFX_LANES, GpuVfxLaneId } from '../src/effects/gpu/GpuVfxRenderLanes';
import { GpuVfxSystem, admitGpuVfxSpawn } from '../src/effects/gpu/GpuVfxSystem';
import { evaluateFakeAnimation, findFakeLane, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function setup() {
  const scene = makeFakeGpuVfxScene();
  const system = new GpuVfxSystem(scene as never);
  return { scene, system };
}

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
  });

  it('prewarms exactly the eases its lane declares', () => {
    const { scene } = setup();
    for (const spec of GPU_VFX_LANES) {
      const layer = findFakeLane(scene, spec.label);
      expect(layer.enabledEases.length).toBe(spec.eases.length);
    }
    expect(findFakeLane(scene, 'rocket-smoke').enabledEases).toEqual(['Linear', 'Quad.easeOut']);
  });

  it('routes every lane through the shared atlas', () => {
    const { scene } = setup();
    expect(scene.layers.every((layer) => layer.key === '__gpu_vfx_atlas')).toBe(true);
  });
});

describe('gpu vfx system: frame order', () => {
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
