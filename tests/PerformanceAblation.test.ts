import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));

import {
  ABLATION_CATEGORIES,
  PerformanceAblationController,
} from '../src/scenes/arena/PerformanceAblation';
import { DEPTH, DEPTH_LIGHTING } from '../src/config';

interface FakeObject {
  type?: string;
  visible: boolean;
  depth?: number;
  scrollFactorX?: number;
  texture?: { key: string };
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
  const scene = { children: { list: children } } as never;
  const controller = new PerformanceAblationController(scene, {
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
  });
  return { controller, filterCalls, staticShadowCalls, dynamicShadowCalls, lightCompositeCalls };
}

describe('performance ablation', () => {
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
    const { controller } = makeController([emitter]);

    controller.start(1000, 0);
    const step = ABLATION_CATEGORIES.indexOf('particles') * 2 + 1;
    for (let s = 1; s <= step; s++) controller.update(s * 1000);

    expect(emitter.visible).toBe(false);
    expect(active).toBe(false);

    controller.stop((step + 1) * 1000);
    expect(emitter.visible).toBe(true);
    expect(active).toBe(true);
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
