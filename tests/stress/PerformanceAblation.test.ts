import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));

import {
  ABLATION_CATEGORIES,
  ABLATION_CODES,
  ABLATION_LABELS,
  PerformanceAblationController,
} from '../../src/scenes/arena/PerformanceAblation';
import {
  countSceneDisplayObjects,
  forEachAblationDisplayObject,
  forEachSceneDisplayObject,
} from '../../src/scenes/arena/sceneDisplayObjects';
import { DEPTH, DEPTH_LIGHTING } from '../../src/config';

interface FakeObject {
  type?: string;
  visible: boolean;
  active?: boolean;
  depth?: number;
  scrollFactorX?: number;
  texture?: { key: string };
  list?: FakeObject[];
  setVisible: (visible: boolean) => void;
}

function fakeObject(partial: Partial<FakeObject> & { texture?: { key: string } }): FakeObject {
  const object: FakeObject = {
    visible: true,
    setVisible: (visible: boolean) => { object.visible = visible; },
    ...partial,
  } as FakeObject;
  return object;
}

function makeController(children: FakeObject[]) {
  const filterCalls: boolean[] = [];
  const staticShadowCalls: boolean[] = [];
  const dynamicShadowCalls: boolean[] = [];
  const lightCompositeCalls: boolean[] = [];
  const gpuParticleCalls: boolean[] = [];
  const vectorEffectSystemCalls: boolean[] = [];
  const vectorLightingCalls: boolean[] = [];
  const vectorTreeTrunkCalls: boolean[] = [];
  const vectorPowerUpCalls: boolean[] = [];
  const scene = { children: { list: children } } as never;
  const controller = new PerformanceAblationController(scene, {
    getGpuParticleSuppressor: () => ({
      setSuppressed: (suppressed: boolean) => { gpuParticleCalls.push(suppressed); },
    }),
    getQualityController: () => ({
      setAblationFiltersDisabled: (disabled: boolean) => { filterCalls.push(disabled); },
    }) as never,
    getShadowSystem: () => ({
      setStaticVisible: (visible: boolean) => { staticShadowCalls.push(visible); },
      setDynamicVisible: (visible: boolean) => { dynamicShadowCalls.push(visible); },
    }),
    getLightingSystem: () => ({
      setCompositeSuppressed: (suppressed: boolean) => { lightCompositeCalls.push(suppressed); },
    }),
    getVectorEffectSystem: () => ({
      setSuppressed: (suppressed: boolean) => { vectorEffectSystemCalls.push(suppressed); },
    }),
    getVectorLighting: () => ({
      setSuppressed: (suppressed: boolean) => { vectorLightingCalls.push(suppressed); },
    }),
    getVectorTreeTrunks: () => ({
      setSuppressed: (suppressed: boolean) => { vectorTreeTrunkCalls.push(suppressed); },
    }),
    getVectorPowerUpEffects: () => ({
      setSuppressed: (suppressed: boolean) => { vectorPowerUpCalls.push(suppressed); },
    }),
  });
  return {
    controller,
    filterCalls,
    staticShadowCalls,
    dynamicShadowCalls,
    lightCompositeCalls,
    gpuParticleCalls,
    vectorEffectSystemCalls,
    vectorLightingCalls,
    vectorTreeTrunkCalls,
    vectorPowerUpCalls,
  };
}

describe('performance ablation', () => {
  it('keeps the general scan flat while the ablation scan reaches nested containers', () => {
    const nestedGraphics = fakeObject({ type: 'Graphics' });
    const deepContainer = fakeObject({ type: 'Container', list: [nestedGraphics] });
    const containerArc = fakeObject({ type: 'Arc' });
    const outerContainer = fakeObject({ type: 'Container', list: [containerArc, deepContainer] });
    const layerArc = fakeObject({ type: 'Arc' });
    const layer = fakeObject({ type: 'Layer', list: [layerArc] });
    const scene = { children: { list: [outerContainer, layer] } } as never;
    const generalObjects: FakeObject[] = [];
    const ablationObjects: FakeObject[] = [];

    forEachSceneDisplayObject(scene, (object) => generalObjects.push(object as never));
    forEachAblationDisplayObject(scene, (object) => ablationObjects.push(object as never));

    expect(generalObjects).toEqual([outerContainer, layer, layerArc]);
    expect(ablationObjects).toEqual([
      outerContainer,
      containerArc,
      deepContainer,
      nestedGraphics,
      layer,
      layerArc,
    ]);
    expect(countSceneDisplayObjects(scene)).toBe(3);
  });

  it('publishes separate append-only codes and labels for the new categories', () => {
    expect(ABLATION_CODES).toMatchObject({
      baseline: 0,
      postFx: 13,
      gpuParticles: 14,
      vectorShapes: 15,
    });
    expect(ABLATION_LABELS.particles).toBe('Klassische Partikel (ParticleEmitter)');
    expect(ABLATION_LABELS.gpuParticles).toBe('SpriteGPU-VFX (SpriteGPULayer)');
    expect(ABLATION_LABELS.vectorShapes).toBe('Arc/Graphics-Rendering');
    expect(ABLATION_CATEGORIES.slice(0, 4)).toEqual([
      'filters',
      'particles',
      'gpuParticles',
      'vectorShapes',
    ]);
  });

  it('wertet im inaktiven Zustand keine Default-Zeit aus', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(123);
    const { controller } = makeController([]);

    controller.update();

    expect(now).not.toHaveBeenCalled();
  });

  it('alternates baseline and ablation so every measurement has an adjacent baseline', () => {
    const { controller } = makeController([]);
    controller.start(1000, 0);

    const seen: string[] = [controller.getCurrentCategory()];
    for (let step = 1; step <= ABLATION_CATEGORIES.length * 2; step++) {
      controller.update(step * 1000);
      seen.push(controller.getCurrentCategory());
    }

    // 0=baseline, 1=erste Kategorie, 2=baseline, 3=zweite Kategorie, ...
    expect(seen[0]).toBe('baseline');
    expect(seen[1]).toBe(ABLATION_CATEGORIES[0]);
    expect(seen[2]).toBe('baseline');
    expect(seen[3]).toBe(ABLATION_CATEGORIES[1]);
    // Jede Kategorie hat eine Baseline davor, plus die abschliessende an gerader Position.
    expect(seen.filter((entry) => entry === 'baseline').length).toBe(ABLATION_CATEGORIES.length + 1);
  });

  it('covers every category within one full cycle', () => {
    const { controller } = makeController([]);
    controller.start(1000, 0);
    const cycleSteps = controller.getCycleDurationMs() / 1000;
    const seen = new Set<string>([controller.getCurrentCategory()]);
    for (let step = 1; step <= cycleSteps; step++) {
      controller.update(step * 1000);
      seen.add(controller.getCurrentCategory());
    }
    for (const category of ABLATION_CATEGORIES) expect(seen.has(category)).toBe(true);
  });

  it('hides only matching objects and restores exactly those it hid', () => {
    const blood = fakeObject({ texture: { key: '__blood_stain' } });
    const rock = fakeObject({ texture: { key: 'rocks' } });
    const alreadyHidden = fakeObject({ texture: { key: '__blood_streak' }, visible: false });
    const { controller } = makeController([blood, rock, alreadyHidden]);

    controller.start(1000, 0);
    // Segment 0 ist baseline: nichts wird versteckt.
    controller.update(0);
    expect(blood.visible).toBe(true);

    // Bis zum 'blood'-Segment vorspulen.
    const bloodIndex = ABLATION_CATEGORIES.indexOf('blood');
    const targetStep = bloodIndex * 2 + 1;
    for (let step = 1; step <= targetStep; step++) controller.update(step * 1000);
    expect(controller.getCurrentCategory()).toBe('blood');

    expect(blood.visible).toBe(false);
    expect(rock.visible).toBe(true);

    controller.stop((targetStep + 1) * 1000);
    expect(blood.visible).toBe(true);
    // Vom Spiel bereits verstecktes Objekt darf die Ablation nicht sichtbar machen.
    expect(alreadyHidden.visible).toBe(false);
  });

  it('drives filters and both shadow groups through their system switches', () => {
    const { controller, filterCalls, staticShadowCalls, dynamicShadowCalls } = makeController([]);
    controller.start(1000, 0);

    const filterStep = ABLATION_CATEGORIES.indexOf('filters') * 2 + 1;
    for (let step = 1; step <= filterStep; step++) controller.update(step * 1000);
    expect(filterCalls).toContain(true);

    // Statische und dynamische Schatten sind getrennt schaltbar: Im staticShadows-Segment
    // darf ausschliesslich der statische Schalter fallen, sonst ist der Rest nicht zuzuordnen.
    const staticStep = ABLATION_CATEGORIES.indexOf('staticShadows') * 2 + 1;
    for (let step = filterStep + 1; step <= staticStep; step++) controller.update(step * 1000);
    expect(staticShadowCalls).toContain(false);
    expect(dynamicShadowCalls).not.toContain(false);

    const dynamicStep = ABLATION_CATEGORIES.indexOf('dynamicShadows') * 2 + 1;
    for (let step = staticStep + 1; step <= dynamicStep; step++) controller.update(step * 1000);
    expect(dynamicShadowCalls).toContain(false);

    controller.stop((dynamicStep + 1) * 1000);
    // Nach dem Stopp ist alles wieder eingeschaltet.
    expect(filterCalls[filterCalls.length - 1]).toBe(false);
    expect(staticShadowCalls[staticShadowCalls.length - 1]).toBe(true);
    expect(dynamicShadowCalls[dynamicShadowCalls.length - 1]).toBe(true);
  });

  it('suppresses the lightmap composite through its own switch', () => {
    // Über den generischen Sichtbarkeits-Scan ist das Composite nicht abzuschalten:
    // `LightingSystem.update()` setzt die Sichtbarkeit des Overlays jeden Frame neu.
    const { controller, lightCompositeCalls } = makeController([]);
    controller.start(1000, 0);

    const lightStep = ABLATION_CATEGORIES.indexOf('lights') * 2 + 1;
    for (let step = 1; step <= lightStep; step++) controller.update(step * 1000);
    expect(lightCompositeCalls).toContain(true);

    controller.stop((lightStep + 1) * 1000);
    expect(lightCompositeCalls[lightCompositeCalls.length - 1]).toBe(false);
  });

  it('keeps the baked canopy shadow out of the lights category', () => {
    // Der Kronenschatten liegt auf DEPTH_LIGHTING - 0.1 und gehört zu `staticShadows`;
    // läge er im Lichtband, würde das Segment teils den falschen Aufwand messen.
    const canopyShadow = fakeObject({ depth: DEPTH_LIGHTING - 0.1 });
    const occluderScratch = fakeObject({ depth: DEPTH_LIGHTING - 0.01 });
    const { controller } = makeController([canopyShadow, occluderScratch]);
    controller.start(1000, 0);

    const lightStep = ABLATION_CATEGORIES.indexOf('lights') * 2 + 1;
    for (let step = 1; step <= lightStep; step++) controller.update(step * 1000);

    expect(canopyShadow.visible).toBe(true);
    expect(occluderScratch.visible).toBe(false);

    controller.stop((lightStep + 1) * 1000);
  });

  it('records one segment per elapsed slice for the export', () => {
    const { controller } = makeController([]);
    controller.start(1000, 0);
    for (let step = 1; step <= 4; step++) controller.update(step * 1000);
    controller.stop(5000);

    const segments = controller.getSegments();
    expect(segments.length).toBe(5);
    expect(segments[0]).toMatchObject({ atMs: 0, durationMs: 1000, category: 'baseline' });
    expect(segments[1].category).toBe(ABLATION_CATEGORIES[0]);
  });

  it('deactivates particle emitters, not just hides them', () => {
    // Phasers UpdateList prueft `active`, nicht `visible`: Ein nur unsichtbarer Emitter
    // simuliert weiter, und die Kategorie wuerde ausschliesslich die Renderkosten messen.
    const emitter = fakeObject({ type: 'ParticleEmitter' });
    let active = true;
    (emitter as unknown as { active: boolean }).active = active;
    (emitter as unknown as { setActive: (v: boolean) => void }).setActive = (v: boolean) => {
      active = v;
      (emitter as unknown as { active: boolean }).active = v;
    };
    const { controller, gpuParticleCalls } = makeController([emitter]);

    controller.start(1000, 0);
    const step = ABLATION_CATEGORIES.indexOf('particles') * 2 + 1;
    for (let s = 1; s <= step; s++) controller.update(s * 1000);

    expect(emitter.visible).toBe(false);
    expect(active).toBe(false);
    expect(gpuParticleCalls).toEqual([]);

    controller.stop((step + 1) * 1000);
    expect(emitter.visible).toBe(true);
    expect(active).toBe(true);
  });

  it('switches GPU particles independently from classic emitters', () => {
    // GPU-Partikel sind Member eines SpriteGPULayer und liegen nicht als `ParticleEmitter` in
    // der Display-Liste; die eigene Kategorie verwendet deshalb den zentralen Hook.
    const emitter = fakeObject({ type: 'ParticleEmitter' });
    emitter.active = true;
    (emitter as unknown as { setActive: (v: boolean) => void }).setActive = (v: boolean) => {
      emitter.active = v;
    };
    const { controller, gpuParticleCalls } = makeController([emitter]);

    controller.start(1000, 0);
    expect(gpuParticleCalls).toEqual([]);

    const step = ABLATION_CATEGORIES.indexOf('gpuParticles') * 2 + 1;
    for (let s = 1; s <= step; s++) controller.update(s * 1000);
    expect(gpuParticleCalls).toEqual([true]);
    expect(emitter.visible).toBe(true);
    expect(emitter.active).toBe(true);

    controller.stop((step + 1) * 1000);
    expect(gpuParticleCalls).toEqual([true, false]);
    expect(emitter.visible).toBe(true);
    expect(emitter.active).toBe(true);
  });

  it('runs the targeted vector ablations through their narrow switches', () => {
    const {
      controller,
      vectorEffectSystemCalls,
      vectorLightingCalls,
      vectorTreeTrunkCalls,
      vectorPowerUpCalls,
    } = makeController([]);
    controller.start(1000, 0);
    const categories = [
      ['vectorEffectSystem', vectorEffectSystemCalls],
      ['vectorLighting', vectorLightingCalls],
      ['vectorTreeTrunks', vectorTreeTrunkCalls],
      ['vectorPowerUpEffects', vectorPowerUpCalls],
    ] as const;

    for (const [category, calls] of categories) {
      const step = ABLATION_CATEGORIES.indexOf(category) * 2 + 1;
      for (let time = 1; time <= step; time += 1) controller.update(time * 1000);
      expect(controller.getCurrentCategory()).toBe(category);
      expect(calls).toContain(true);
    }

    controller.stop((ABLATION_CATEGORIES.length * 2 + 1) * 1000);
    expect(vectorEffectSystemCalls.at(-1)).toBe(false);
    expect(vectorLightingCalls.at(-1)).toBe(false);
    expect(vectorTreeTrunkCalls.at(-1)).toBe(false);
    expect(vectorPowerUpCalls.at(-1)).toBe(false);
  });

  it('hides Arc and Graphics in nested containers for rendering only', () => {
    const arc = fakeObject({ type: 'Arc', active: true });
    const graphics = fakeObject({ type: 'Graphics', active: true });
    const deepGraphics = fakeObject({ type: 'Graphics', active: true });
    const deepContainer = fakeObject({ type: 'Container', list: [deepGraphics] });
    const container = fakeObject({ type: 'Container', list: [arc, graphics, deepContainer] });
    const alreadyHidden = fakeObject({ type: 'Arc', visible: false, active: true });
    const unrelatedShape = fakeObject({ type: 'Rectangle', active: true });
    const { controller } = makeController([container, alreadyHidden, unrelatedShape]);

    controller.start(1000, 0);
    controller.update(0); // Baseline uses the same recursive scan without hiding.
    expect(arc.visible).toBe(true);
    expect(graphics.visible).toBe(true);
    expect(deepGraphics.visible).toBe(true);

    const vectorStep = ABLATION_CATEGORIES.indexOf('vectorShapes') * 2 + 1;
    for (let step = 1; step <= vectorStep; step++) controller.update(step * 1000);

    expect(controller.getCurrentCategory()).toBe('vectorShapes');
    expect(arc.visible).toBe(false);
    expect(graphics.visible).toBe(false);
    expect(deepGraphics.visible).toBe(false);
    expect(arc.active).toBe(true);
    expect(graphics.active).toBe(true);
    expect(deepGraphics.active).toBe(true);
    expect(alreadyHidden.visible).toBe(false);
    expect(unrelatedShape.visible).toBe(true);

    const newGraphics = fakeObject({ type: 'Graphics', active: true });
    deepContainer.list?.push(newGraphics);
    controller.update(vectorStep * 1000 + 1);
    expect(newGraphics.visible).toBe(false);
    expect(newGraphics.active).toBe(true);

    controller.stop((vectorStep + 1) * 1000);
    expect(arc.visible).toBe(true);
    expect(graphics.visible).toBe(true);
    expect(deepGraphics.visible).toBe(true);
    expect(newGraphics.visible).toBe(true);
    expect(alreadyHidden.visible).toBe(false);
    expect(unrelatedShape.visible).toBe(true);
  });

  it('classifies HUD by screen-fixed scroll factor and depth', () => {
    const hudFixed = fakeObject({ scrollFactorX: 0, texture: { key: 'hud' } });
    const hudDeep = fakeObject({ depth: DEPTH.LOCAL_UI, texture: { key: 'panel' } });
    const world = fakeObject({ scrollFactorX: 1, depth: DEPTH.PLAYERS, texture: { key: 'badger' } });
    const { controller } = makeController([hudFixed, hudDeep, world]);

    controller.start(1000, 0);
    const hudStep = ABLATION_CATEGORIES.indexOf('hud') * 2 + 1;
    for (let step = 1; step <= hudStep; step++) controller.update(step * 1000);

    expect(hudFixed.visible).toBe(false);
    expect(hudDeep.visible).toBe(false);
    expect(world.visible).toBe(true);
  });
});