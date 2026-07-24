import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({}));

import {
  ABLATION_CATEGORIES,
  PerformanceAblationController,
} from '../src/scenes/arena/PerformanceAblation';
import { DEPTH } from '../src/config';

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
  const shadowCalls: boolean[] = [];
  const scene = { children: { list: children } } as never;
  const controller = new PerformanceAblationController(scene, {
    getQualityController: () => ({
      setAblationFiltersDisabled: (disabled: boolean) => { filterCalls.push(disabled); },
    }) as never,
    getShadowSystem: () => ({
      setVisible: (visible: boolean) => { shadowCalls.push(visible); },
    }),
  });
  return { controller, filterCalls, shadowCalls };
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

  it('drives filters and shadows through their system switches', () => {
    const { controller, filterCalls, shadowCalls } = makeController([]);
    controller.start(1000, 0);

    const filterStep = ABLATION_CATEGORIES.indexOf('filters') * 2 + 1;
    for (let step = 1; step <= filterStep; step++) controller.update(step * 1000);
    expect(filterCalls).toContain(true);

    const shadowStep = ABLATION_CATEGORIES.indexOf('shadows') * 2 + 1;
    for (let step = filterStep + 1; step <= shadowStep; step++) controller.update(step * 1000);
    expect(shadowCalls).toContain(false);

    controller.stop((shadowStep + 1) * 1000);
    // Nach dem Stopp ist alles wieder eingeschaltet.
    expect(filterCalls[filterCalls.length - 1]).toBe(false);
    expect(shadowCalls[shadowCalls.length - 1]).toBe(true);
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
