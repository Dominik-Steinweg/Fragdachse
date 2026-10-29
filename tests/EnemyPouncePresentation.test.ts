import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ Scenes: { Events: { PRE_RENDER: 'prerender' } } }));
import type * as Phaser from 'phaser';
import { pounceMenace } from '../src/animations/EnemyPounceAnimation';
import { getCoopDefenseEnemyConfig } from '../src/config/coopDefenseEnemies';
import type { EnemyLandingMark } from '../src/effects/EnemyClawRenderer';
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
  const marks: [string, EnemyLandingMark | null][] = [];
  presentation.setMarkSink((id, mark) => marks.push([id, mark]));
  return { render: (at: number) => { now = at; render(); }, set: (state: EnemyPounceState) => { pounce = state; }, player, marks };
}

const aim = { target: { kind: 'player' as const, id: 'p1' }, originX: 0, originY: 0, aimAt: 1000, lockAt: 1450 };
const landing = { x: 180, y: 90, takeoffAt: 1700, landAt: 2100, recoverUntil: 2550, armed: true };

describe('pounce presentation', () => {
  it('lets the aiming hint lead the target course within the pounce range, landing estimated after the lock', () => {
    const f = fixture();
    f.set({ revision: 1, pounce: { ...aim, landing: null } });
    f.render(1000);
    const [, first] = f.marks.at(-1)!;
    expect(first).toEqual(expect.objectContaining({ x: 200, y: 0, radius: config.impact.radiusPx, lockAt: aim.lockAt }));
    expect(first!.hitAt).toBeGreaterThan(aim.lockAt + config.lockMs);
    // The target runs south: the hint leads it, within the pounce range.
    for (let at = 1016; at <= 1440; at += 16) { f.player.y += 280 * 0.016; f.render(at); }
    const [, leading] = f.marks.at(-1)!;
    expect(leading!.y).toBeGreaterThan(f.player.y + 20);
    expect(Math.hypot(leading!.x, leading!.y)).toBeLessThanOrEqual(config.maxRangePx + 1e-6);
  });

  it('keeps one identity across the lock and lands exactly on the announced point', () => {
    const f = fixture();
    f.set({ revision: 1, pounce: { ...aim, landing: null } });
    for (let at = 1000; at <= 1440; at += 16) f.render(at);
    const aimId = f.marks.at(-1)![1]!.attackId;
    f.set({ revision: 2, pounce: { ...aim, landing } });
    f.player.x = 600;
    for (let at = 1456; at < landing.landAt; at += 16) f.render(at);
    f.render(landing.landAt);
    const [, landed] = f.marks.at(-1)!;
    expect(landed).toEqual(expect.objectContaining({ attackId: aimId, x: 180, y: 90, hitAt: landing.landAt }));
    expect(new Set(f.marks.map(([, mark]) => mark?.attackId).filter(Boolean)).size).toBe(1);
  });

  it('hides unarmed landings and releases after the impact', () => {
    const f = fixture();
    f.set({ revision: 2, pounce: { ...aim, landing } });
    f.render(1500);
    expect(f.marks.at(-1)).toEqual(['r', expect.objectContaining({ x: 180, y: 90 })]);
    f.render(2300);
    expect(f.marks.at(-1)).toEqual(['r', null]);
    f.set({ revision: 3, pounce: { ...aim, landing: { ...landing, armed: false } } });
    f.render(1900);
    expect(f.marks.at(-1)).toEqual(['r', null]);
  });

  it('builds the take-off signal on the body and lets it die away after the landing', () => {
    const state = (landed: typeof landing | null): EnemyPounceState => ({ revision: 1, pounce: { ...aim, landing: landed } });
    expect(pounceMenace(state(null), 900).glow).toBe(0);
    const aiming = pounceMenace(state(null), 1300);
    const locked = pounceMenace(state(landing), 1500);
    const crouching = pounceMenace(state(landing), 1690);
    expect(aiming.glow).toBeGreaterThan(0);
    expect(locked.glow).toBeGreaterThan(aiming.glow);
    expect(crouching.glow).toBeGreaterThan(locked.glow);
    expect(crouching.coil).toBeGreaterThan(locked.coil);
    expect(pounceMenace(state(landing), 2000).glow).toBeLessThan(crouching.glow);
    expect(pounceMenace(state(landing), 2600)).toEqual({ glow: 0, light: 0, coil: 0 });
  });
});
