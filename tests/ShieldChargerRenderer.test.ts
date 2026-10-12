import { describe, expect, it, vi } from 'vitest';

// Headless: the GPU layer only creates its passes on a WebGL renderer, which this fixture lacks.
vi.mock('phaser', () => ({
  Scenes: { Events: { PRE_RENDER: 'prerender' } },
  Math: { Clamp: (v: number, min: number, max: number) => Math.min(max, Math.max(min, v)) },
}));
import { ShieldChargerRenderer } from '../src/effects/ShieldChargerRenderer';
import { SHIELD_CHARGER_BATCH_CAPACITY } from '../src/effects/gpu/ShieldChargerGpuLayer';
import { SHIELD_CHARGER_KIND } from '../src/effects/gpu/ShieldChargerShader';
import type { EnemyVisualSource } from '../src/entities/EnemyVisualSource';
import type { ShieldChargeState } from '../src/systems/ShieldChargeState';

const WORDS = 14, VERTICES = 6, KIND_WORD = 7, T_WORD = 8;
const lane = { originX: 0, originY: 0, angle: 0, length: 600, halfWidth: 15, startedAt: 1000, runAt: 1700, runEndsAt: 2400, recoverUntil: 3100 };

function fixture() {
  const listeners: (() => void)[] = [];
  const scene = {
    time: { now: 0 },
    cameras: { main: { width: 4000, height: 4000, originX: 0.5, originY: 0.5, zoom: 1, scrollX: -1000, scrollY: -2000 } },
    events: { on: (e: string, fn: () => void, ctx: unknown) => { if (e === 'prerender') listeners.push(fn.bind(ctx)); }, off: () => {} },
  };
  const renderer = new ShieldChargerRenderer(scene as never);
  let clock = 0;
  renderer.setClock(() => clock);
  const frame = () => (renderer as unknown as { layer: { frame: { data: Float32Array; count: number } } }).layer.frame;
  const items = () => { const f = frame(); return Array.from({ length: f.count }, (_, i) => ({
    kind: f.data[i * VERTICES * WORDS + KIND_WORD], t: f.data[i * VERTICES * WORDS + T_WORD] })); };
  return { renderer, scene, render: (at: number) => { clock = at; scene.time.now = at; listeners.forEach(fn => fn()); }, items };
}

function charger(id: string, state: () => ShieldChargeState, x = 0): EnemyVisualSource {
  return { id, kind: 'shield-charger-badger', faction: 'hostile', sprite: { active: true, x, y: 0 } as never,
    getHp: () => 120, isVulnerable: () => false, getNetSnapshot: () => ({ shieldCharge: state() }) as never };
}

describe('ShieldChargerRenderer', () => {
  it('draws the windup lane with host-clock progress and never drops it under batch pressure', () => {
    const f = fixture();
    const windup: ShieldChargeState = { revision: 1, phase: 'windup', lane };
    const running: ShieldChargeState = { revision: 1, phase: 'run', lane };
    const runners = Array.from({ length: SHIELD_CHARGER_BATCH_CAPACITY + 10 }, (_, i) => charger(`r${i}`, () => running, 100));
    f.renderer.setEnemySource(() => [...runners, charger('w', () => windup)]);
    f.render(1350);
    const items = f.items();
    expect(items).toHaveLength(SHIELD_CHARGER_BATCH_CAPACITY);
    const laneItem = items.find(item => item.kind === SHIELD_CHARGER_KIND.lane)!;
    expect(laneItem.t).toBeCloseTo(0.5);
  });

  it('leaves scuffs and a stop puff when a run ends, and no warning lane during recovery', () => {
    const f = fixture();
    let state: ShieldChargeState = { revision: 1, phase: 'run', lane };
    f.renderer.setEnemySource(() => [charger('e1', () => state, 300)]);
    f.render(1800);
    expect(f.items().some(item => item.kind === SHIELD_CHARGER_KIND.streak)).toBe(true);
    state = { revision: 2, phase: 'recover', lane: { ...lane, length: 420, runEndsAt: 2200 } };
    f.render(2200);
    const kinds = f.items().map(item => item.kind);
    expect(kinds).toContain(SHIELD_CHARGER_KIND.skid);
    expect(kinds).toContain(SHIELD_CHARGER_KIND.dust);
    expect(kinds).not.toContain(SHIELD_CHARGER_KIND.lane);
    f.renderer.clear();
    f.render(2300);
    expect(f.items()).toEqual([]);
  });
});
