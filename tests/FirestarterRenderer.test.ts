import { describe, expect, it, vi } from 'vitest';

// Headless: the GPU layer only creates its passes on a WebGL renderer, which this fixture lacks.
vi.mock('phaser', () => ({
  Scenes: { Events: { PRE_RENDER: 'prerender' } },
  Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)) },
}));
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { FirestarterRenderer } from '../src/effects/FirestarterRenderer';
import { FIRESTARTER_BATCH_CAPACITY } from '../src/effects/gpu/FirestarterGpuLayer';
import { FIRESTARTER_KIND } from '../src/effects/gpu/FirestarterShader';
import type { EnemyVisualSource } from '../src/entities/EnemyVisualSource';

const WORDS = 14, VERTICES = 6, KIND_WORD = 7;

function fixture() {
  const listeners: (() => void)[] = [];
  const scene = {
    time: { now: 1000 },
    cameras: { main: { width: 4000, height: 4000, originX: 0.5, originY: 0.5, zoom: 1, scrollX: 0, scrollY: 0 } },
    events: {
      on: (event: string, fn: () => void, ctx: unknown) => { if (event === 'prerender') listeners.push(fn.bind(ctx)); },
      off: () => {},
    },
  };
  const renderer = new FirestarterRenderer(scene as never);
  const kinds = () => {
    const frame = (renderer as unknown as { layer: { frame: { data: Float32Array; count: number } } }).layer.frame;
    return Array.from({ length: frame.count }, (_, i) => frame.data[i * VERTICES * WORDS + KIND_WORD]);
  };
  return { renderer, render: () => listeners.forEach(fn => fn()), kinds };
}

function chargingFirestarter(id: string, x: number): EnemyVisualSource {
  return {
    id, kind: 'firestarter-badger', faction: 'hostile', sprite: { active: true, x, y: 0 } as never,
    getHp: () => 300, isVulnerable: () => false,
    getNetSnapshot: () => ({ kind: 'firestarter-badger', faction: 'hostile', specialAction: 'fire-lance-charge',
      gaussChargeProgress: 0.5, gaussAimAngle: 0 }) as never,
  };
}

describe('FirestarterRenderer', () => {
  it('never drops an active lance warning when orbs, shots and combos exceed the batch', () => {
    expect(getCoopDefenseEnemyConfig('firestarter-badger').firestarter).toBeDefined();
    const f = fixture();
    const enemies = Array.from({ length: 6 }, (_, i) => chargingFirestarter(`e${i}`, i * 40));
    f.renderer.setEnemySource(() => enemies);
    for (let i = 0; i < FIRESTARTER_BATCH_CAPACITY; i++) {
      f.renderer.createVisual(i, i % 50, 10, 24, 0xb347ff);
      f.renderer.playLance(0, 0, 300, 0, 0xb347ff);
      f.renderer.playCombo(100, 100, 125, 0xb347ff);
    }
    f.render();
    const kinds = f.kinds();
    expect(kinds).toHaveLength(FIRESTARTER_BATCH_CAPACITY);
    expect(kinds.filter(kind => kind === FIRESTARTER_KIND.telegraph)).toHaveLength(enemies.length);
    expect(kinds.filter(kind => kind === FIRESTARTER_KIND.orb)).toHaveLength(FIRESTARTER_BATCH_CAPACITY - enemies.length);
  });

  it('clear drops every orb, shot, combo and charge sample', () => {
    const f = fixture();
    f.renderer.createVisual(1, 0, 0, 24, 0xb347ff);
    f.renderer.playLance(0, 0, 100, 0, 0xb347ff);
    f.renderer.playCombo(0, 0, 125, 0xb347ff);
    f.renderer.clear();
    f.render();
    expect(f.kinds()).toEqual([]);
    expect(f.renderer.getActiveIds()).toEqual([]);
  });
});
