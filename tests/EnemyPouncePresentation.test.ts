import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ Scenes: { Events: { PRE_RENDER: 'prerender' } } }));
import type * as Phaser from 'phaser';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import { EnemyPouncePresentation } from '../src/effects/EnemyPouncePresentation';
import type { EnemyVisualSource } from '../src/entities/EnemyVisualSource';
import type { EnemyPounceState } from '../src/systems/EnemyPounceState';

const config = getCoopDefenseEnemyConfig('rabid-rabbit').pounce!;

function fixture() {
  let render: () => void = () => {};
  const scene = { time: { now: 0 }, events: { on: (_: string, fn: () => void, ctx: unknown) => { render = fn.bind(ctx); }, off: vi.fn() } };
  const presentation = new EnemyPouncePresentation(scene as unknown as Phaser.Scene);
  let pounce: EnemyPounceState = { revision: 0, pounce: null };
  const rabbit = { id: 'r', kind: 'rabid-rabbit', faction: 'hostile', sprite: { active: true, visible: true, x: 0, y: 0 },
    getHp: () => 20, getNetSnapshot: () => ({}), getPounceState: () => pounce };
  presentation.setEnemySource(() => [rabbit] as unknown as EnemyVisualSource[]);
  let now = 0;
  presentation.setClock(() => now);
  const player = { x: 200, y: 0 };
  presentation.setTargetResolver(() => ({ ...player }));
  const zones: [string, { attackId: string; x: number; y: number; hitAt: number } | null][] = [];
  const lanes: [string, unknown][] = [];
  presentation.setSinks((id, attack) => lanes.push([id, attack]), (id, attack) => zones.push([id, attack as never]));
  return { render: (at: number) => { now = at; render(); }, set: (state: EnemyPounceState) => { pounce = state; }, player, zones, lanes };
}

const aim = { target: { kind: 'player' as const, id: 'p1' }, originX: 0, originY: 0, aimAt: 1000, lockAt: 1450 };

describe('pounce presentation', () => {
  it('predicts the landing from the target course while aiming and flashes at the lock', () => {
    const f = fixture();
    f.set({ revision: 1, pounce: { ...aim, landing: null } });
    f.render(1000);
    expect(f.zones.at(-1)).toEqual(['r', expect.objectContaining({ x: 200, y: 0, hitAt: aim.lockAt })]);
    // The target runs south: the zone leads it, within the pounce range.
    for (let at = 1016; at <= 1300; at += 16) { f.player.y += 280 * 0.016; f.render(at); }
    const [, leading] = f.zones.at(-1)!;
    expect(leading!.y).toBeGreaterThan(f.player.y + 20);
    expect(Math.hypot(leading!.x, leading!.y)).toBeLessThanOrEqual(config.maxRangePx + 1e-6);
    expect(f.lanes.at(-1)).toEqual(['r', expect.objectContaining({ x: 0, y: 0 })]);
  });

  it('holds the locked landing until the impact, hides unarmed landings and releases afterwards', () => {
    const f = fixture();
    const landing = { x: 180, y: 90, takeoffAt: 1700, landAt: 2100, recoverUntil: 2550, armed: true };
    f.set({ revision: 2, pounce: { ...aim, landing } });
    f.render(1500);
    expect(f.zones.at(-1)).toEqual(['r', expect.objectContaining({ x: 180, y: 90, hitAt: landing.landAt })]);
    f.player.x = 600;
    f.render(1900);
    expect(f.zones.at(-1)).toEqual(['r', expect.objectContaining({ x: 180, y: 90 })]);
    f.render(2300);
    expect(f.zones.at(-1)).toEqual(['r', null]);
    f.set({ revision: 3, pounce: { ...aim, landing: { ...landing, armed: false } } });
    f.render(1900);
    expect(f.zones.filter(([, zone]) => zone !== null && zone.x === 180 && zone.hitAt === 2100)).toHaveLength(2);
    expect(f.zones.at(-1)).toEqual(['r', null]);
  });
});
