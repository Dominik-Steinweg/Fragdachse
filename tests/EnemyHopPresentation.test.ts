import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ Scenes: { Events: { PRE_RENDER: 'prerender' } } }));
const draws = vi.hoisted(() => [] as unknown[][]);
vi.mock('../src/effects/RestHealTendrilRenderer', () => ({ RestHealTendrilRenderer: class {
  draw = (...args: unknown[]) => { draws.push(args); };
  setLightingSystem = vi.fn(); clear = vi.fn(); destroy = vi.fn();
} }));
import type * as Phaser from 'phaser';
import { EnemyHopPresentation } from '../src/effects/EnemyHopPresentation';
import type { EnemyVisualSource } from '../src/entities/EnemyVisualSource';
import type { EnemyHopState } from '../src/systems/EnemyHopState';

function fixture() {
  let render: () => void = () => {};
  const scene = { time: { now: 0 }, events: { on: (_: string, fn: () => void, ctx: unknown) => { render = fn.bind(ctx); }, off: vi.fn() } };
  const presentation = new EnemyHopPresentation(scene as unknown as Phaser.Scene);
  let hop: EnemyHopState = { revision: 1, jump: null, links: [] };
  const sprite = (x: number) => ({ active: true, visible: true, x, y: 0, texture: { key: 'none' }, frame: { name: 0 } });
  const toad = { id: 'toad', kind: 'plague-medic', faction: 'hostile', sprite: sprite(0), getHp: () => 100,
    getNetSnapshot: () => ({ rot: 0, hop }) };
  const ally = { id: 'ally', kind: 'zombie-badger', faction: 'hostile', sprite: sprite(80), getHp: () => 10, getNetSnapshot: () => ({}) };
  presentation.setEnemySource(() => [toad, ally] as unknown as EnemyVisualSource[]);
  let now = 0;
  presentation.setClock(() => now);
  const zones: unknown[] = [];
  presentation.setZoneSink((id, attack) => zones.push([id, attack]));
  return { presentation, render: (at: number) => { now = at; render(); }, setHop: (state: EnemyHopState) => { hop = state; }, zones };
}

describe('hop presentation', () => {
  it('announces only armed landings and releases the zone after the landing', () => {
    const f = fixture();
    const jump = { originX: 0, originY: 0, targetX: 100, targetY: 0, crouchAt: 1000, takeoffAt: 1180, landAt: 1600, settleUntil: 1760 };
    f.setHop({ revision: 2, jump: { ...jump, shock: false }, links: [] });
    f.render(1100);
    expect(f.zones).toEqual([]);
    f.setHop({ revision: 3, jump: { ...jump, shock: true }, links: [] });
    f.render(1200);
    expect(f.zones.at(-1)).toEqual(['toad', expect.objectContaining({ x: 100, y: 0, hitAt: 1600 })]);
    f.render(1700);
    expect(f.zones.at(-1)).toEqual(['toad', null]);
  });

  it('hands linked allies to the lazily loaded tendril renderer as one channel per healer', async () => {
    const f = fixture();
    f.setHop({ revision: 2, jump: null, links: ['ally'] });
    f.render(1000);
    await vi.dynamicImportSettled();
    f.render(1016);
    const [channels] = draws.at(-1)! as [{ id: string; targets: { id: string; x: number }[]; cross: { x: number } }[]];
    expect(channels).toHaveLength(1);
    expect(channels[0]!.targets).toEqual([{ id: 'ally', x: 80, y: 0 }]);
    // The back cross sits behind the body centre, opposite the facing.
    expect(channels[0]!.cross.x).toBeLessThan(0);
  });
});
