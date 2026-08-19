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
  }),
}));

import { RocketRenderer } from '../src/effects/RocketRenderer';
import { GpuVfxRegistry, gpuVfxEasedBase } from '../src/effects/gpu/GpuVfxRegistry';
import { DEPTH } from '../src/config';
import { evaluateFakeAnimation, makeFakeGpuVfxScene } from './fakeGpuVfxScene';

function setup() {
  const scene = makeFakeGpuVfxScene();
  const registry = new GpuVfxRegistry(scene as never);
  const renderer = new RocketRenderer(scene as never);
  renderer.generateTextures();
  renderer.initGpuLayers(registry);
  const smoke = scene.layers.find((layer) => layer.key === '__rocket_smoke')!;
  return { scene, registry, renderer, smoke };
}

/**
 * Fuehrt eine Rakete so weit, dass die distanz-/zeitbasierte Puff-Logik ausloest. Die Gate-Regel
 * bleibt unveraendert: `dist >= max(visualSize * 0.55, 5)` oder 22 ms seit dem letzten Puff.
 */
function flyRocket(renderer: RocketRenderer, id: number, steps: number): void {
  renderer.createVisual(id, 0, 0, 10, 0xff0000, 0x00ff00, 0x445566);
  for (let step = 1; step <= steps; step += 1) {
    renderer.updateVisual(id, step * 60, 0, 10, 200, 0);
  }
}

beforeEach(() => {
  qualityFactors.standard = 1;
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('rocket smoke gpu particles', () => {
  it('replaces the shared emitter with one normally blended layer', () => {
    const { scene, smoke } = setup();
    // Der Smoke-Emitter hatte keinen Blend-Mode im Config, zeichnete also normal statt additiv.
    expect(smoke.blendMode).toBe(0);
    expect(smoke.enabledEases).toEqual(['Linear', 'Quad.easeOut']);
    expect(smoke.added).toBe(smoke.size);
    // Entspricht dem bisherigen maxAliveParticles-Deckel.
    expect(smoke.size).toBe(640);
    expect(scene.emitters.length).toBe(0);
  });

  it('keeps DEPTH.FIRE without an epsilon offset', () => {
    // Anders als der Exhaust entstand der geteilte Smoke-Emitter schon beim Szenenaufbau und
    // lag bei gleicher Depth ohnehin unter allem zur Laufzeit Erzeugten.
    const { smoke } = setup();
    expect(smoke.depth).toBe(DEPTH.FIRE);
  });

  it('emits a puff per trigger of the unchanged distance gate', () => {
    const { renderer, smoke } = setup();
    // createVisual ruft updateVisual einmal mit Distanz 0 – der Zeit-Gate greift dort bereits.
    flyRocket(renderer, 1, 4);
    expect(smoke.edited.length).toBe(5);
  });

  it('reproduces the legacy scale, alpha and velocity curves on the gpu', () => {
    const { renderer, smoke } = setup();
    // FloatBetween ist auf die Mitte gemockt: speedX 0, speedY -6.
    renderer.createVisual(1, 50, 70, 10, 0xff0000, 0x00ff00, 0x445566);
    const puff = smoke.members[0];

    // Startscale max(visualSize/28, 0.28) mit visualSize = 10 -> 0.357…
    const startScale = Math.max(10 / 28, 0.28);
    const legacyScale = (t: number) => startScale * (1 + t * (2 - t) * 1.3);
    for (const t of [0, 0.25, 0.5, 0.75]) {
      expect(evaluateFakeAnimation(puff.scaleX, t)).toBeCloseTo(legacyScale(t), 10);
    }

    // alpha: { start: 0.95, end: 0, ease: 'Quad.easeOut' }
    const legacyAlpha = (t: number) => 0.95 - 0.95 * t * (2 - t);
    for (const t of [0, 0.25, 0.5, 0.75]) {
      expect(evaluateFakeAnimation(puff.alpha, t)).toBeCloseTo(legacyAlpha(t), 10);
    }

    // speedX/speedY sind nicht-radial und wirken ueber die konstante Lebenszeit von 1000 ms.
    expect(evaluateFakeAnimation(puff.x, 0)).toBeCloseTo(50 - 10 * 0.9, 10);
    expect(evaluateFakeAnimation(puff.y, 1) - evaluateFakeAnimation(puff.y, 0)).toBeCloseTo(-6, 10);
    expect(puff.tint).toBe(0x445566);
  });

  it('never touches a spawned puff again', () => {
    const { registry, renderer, smoke } = setup();
    flyRocket(renderer, 1, 4);
    const spawned = smoke.edited.length;

    for (let frame = 0; frame < 20; frame += 1) registry.update(16);
    // Kein Edit ausserhalb der Spawns; nur Retire-Patches nach Ablauf der Lebenszeit.
    expect(smoke.edited.length).toBe(spawned);
  });

  it('reproduces the fractional carry of the quality-scaled manual emission', () => {
    // `emitParticleAt` wurde vom Quality-Controller gewrappt: pro Aufruf waechst der Uebertrag
    // um `factor`, emittiert wird der ganzzahlige Anteil. Bei 0.5 also jeder zweite Puff.
    qualityFactors.standard = 0.5;
    const { renderer, smoke } = setup();
    flyRocket(renderer, 1, 9);
    expect(smoke.edited.length).toBe(5);
  });

  it('stops emitting smoke when the quality factor is zero', () => {
    qualityFactors.standard = 0;
    const { renderer, smoke } = setup();
    flyRocket(renderer, 1, 20);
    expect(smoke.edited.length).toBe(0);
  });

  it('lets the puffs of a single destroyed rocket run out', () => {
    // Der geteilte Emitter kannte keine Zugehoerigkeit; seine Schwaden liefen weiter.
    const { renderer, smoke } = setup();
    flyRocket(renderer, 1, 4);
    flyRocket(renderer, 2, 4);
    const spawned = smoke.edited.length;

    renderer.destroyVisual(1);
    expect(smoke.patched).toEqual([]);
    expect(smoke.edited.length).toBe(spawned);
  });

  it('clears every puff on teardown', () => {
    const { registry, renderer, smoke } = setup();
    flyRocket(renderer, 1, 4);
    const spawned = smoke.edited.length;

    renderer.destroyAll();
    expect(smoke.patched.length).toBe(spawned);
    expect(registry.getStats()?.['rocket-smoke'].activeSlots).toBe(0);
  });

  it('retires puffs after their 1000 ms lifespan', () => {
    const { registry, renderer, smoke } = setup();
    flyRocket(renderer, 1, 1);
    const spawned = smoke.edited.length;
    expect(spawned).toBeGreaterThan(0);

    registry.update(500);
    expect(smoke.patched.length).toBe(0);
    registry.update(500);
    expect(smoke.patched.length).toBe(spawned);
  });

  it('drops puffs at the pool limit instead of overwriting living ones', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { registry, renderer, smoke } = setup();
    // Deutlich mehr Puffs als der 640er-Deckel traegt, alle innerhalb einer Lebenszeit.
    for (let id = 1; id <= 40; id += 1) flyRocket(renderer, id, 30);

    const stats = registry.getStats()?.['rocket-smoke'];
    expect(stats!.activeSlots).toBeLessThanOrEqual(640);
    expect(stats!.overruns).toBeGreaterThan(0);
    // Jeder Edit gehoert zu genau einem Rearm: kein lebender Slot wurde ueberschrieben.
    expect(smoke.edited.length).toBe(stats!.rearms);
    warn.mockRestore();
  });

  it('does not spawn smoke or advance emission carry while the registry is suppressed', () => {
    qualityFactors.standard = 0.5;
    const { registry, renderer, smoke } = setup();

    // 1 Vorab-Puff bei 0.5 Factor (Schritt 1: carry 0.5, Schritt 2: carry 1.0 -> 1 Puff)
    flyRocket(renderer, 1, 2);
    expect(smoke.edited.length).toBe(1);

    // Ablation aktivieren
    registry.setSuppressed(true);
    expect(registry.getStats()?.['rocket-smoke'].activeSlots).toBe(0);

    // Waehrend der Ablation fliegen: weder Spawns noch Carry-Akkumulation
    flyRocket(renderer, 2, 20);
    renderer.playSpentDestruction(100, 100, 0xff0000);
    expect(smoke.edited.length).toBe(1);
    expect(registry.getStats()?.['rocket-smoke'].activeSlots).toBe(0);

    // Ablation deaktivieren
    registry.setSuppressed(false);

    // Nach Ende der Ablation: Kein Catch-up-Burst aus den 20 unterdrueckten Schritten.
    // Carry stand vor Ablation nach Step 2 auf 0.5.
    // Neuer Flugschritt bringt +0.5 -> Carry erreicht 1.0 -> genau 1 Puff (insgesamt 2).
    // Folgeschritt bringt +0.5 -> Carry 0.5 -> kein neuer Puff (bleibt bei 2).
    // Weiterer Schritt bringt +0.5 -> Carry 1.0 -> weiterer Puff (insgesamt 3).
    renderer.updateVisual(1, 300, 0, 10, 200, 0);
    expect(smoke.edited.length).toBe(2);
    renderer.updateVisual(1, 360, 0, 10, 200, 0);
    expect(smoke.edited.length).toBe(2);
    renderer.updateVisual(1, 420, 0, 10, 200, 0);
    expect(smoke.edited.length).toBe(3);
  });
});

describe('gpu vfx eased base', () => {
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
