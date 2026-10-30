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
  const marks: [string, EnemyLandingMark | null][] = [];
  const auras: { strength: number; turn: number }[] = [];
  presentation.setMarkSink((id, mark) => marks.push([id, mark]));
  presentation.setAuraSink((_x, _y, _size, strength, _color, turn) => auras.push({ strength, turn }));
  return { render: (at: number) => { now = at; render(); }, set: (state: EnemyPounceState) => { pounce = state; }, marks, auras };
}

const aim = { target: { kind: 'player' as const, id: 'p1' }, originX: 0, originY: 0, aimAt: 1000, lockAt: 1300 };
const takeoffAt = aim.lockAt + config.lockMs;
const landing = { x: 180, y: 90, takeoffAt, landAt: takeoffAt + 400, recoverUntil: takeoffAt + 850, armed: true };

describe('pounce presentation', () => {
  it('marks nothing on the ground while aiming, only the charge aura around the body', () => {
    const f = fixture();
    f.set({ revision: 1, pounce: { ...aim, landing: null } });
    for (let at = 1000; at <= 1290; at += 16) f.render(at);
    expect(f.marks.filter(([, mark]) => mark !== null)).toHaveLength(0);
    expect(f.auras.length).toBeGreaterThan(0);
    expect(f.auras.at(-1)!.strength).toBeGreaterThan(f.auras[0]!.strength);
  });

  it('announces the landing from the lock while the aura grows, and ends the aura at the take-off', () => {
    const f = fixture();
    f.set({ revision: 2, pounce: { ...aim, landing } });
    f.render(aim.lockAt + 16);
    expect(f.marks.at(-1)).toEqual(['r', expect.objectContaining({ x: 180, y: 90, startedAt: aim.lockAt, hitAt: landing.landAt,
      radius: config.impact.radiusPx })]);
    const locked = f.auras.at(-1)!.strength;
    f.render(takeoffAt - 200);
    expect(f.auras.at(-1)!.strength).toBeGreaterThan(locked);
    expect(new Set(f.auras.map(aura => aura.turn)).size).toBe(1);
    const emitted = f.auras.length;
    f.render(takeoffAt + 100);
    expect(f.auras).toHaveLength(emitted);
    expect(new Set(f.marks.map(([, mark]) => mark?.attackId).filter(Boolean)).size).toBe(1);
  });

  it('hides unarmed landings and releases after the impact', () => {
    const f = fixture();
    f.set({ revision: 2, pounce: { ...aim, landing } });
    f.render(1500);
    f.render(landing.landAt + 200);
    expect(f.marks.at(-1)).toEqual(['r', null]);
    f.set({ revision: 3, pounce: { ...aim, landing: { ...landing, armed: false } } });
    f.render(1500);
    expect(f.marks.at(-1)).toEqual(['r', null]);
  });

  it('lights the body up from the aim, peaks before the take-off and lets it die away after the landing', () => {
    const state = (landed: typeof landing | null): EnemyPounceState => ({ revision: 1, pounce: { ...aim, landing: landed } });
    expect(pounceMenace(state(null), 900).glow).toBe(0);
    const aiming = pounceMenace(state(null), 1250);
    const locked = pounceMenace(state(landing), aim.lockAt + 100);
    const crouching = pounceMenace(state(landing), takeoffAt - 170);
    expect(aiming.glow).toBeGreaterThan(0.3);
    expect(locked.glow).toBeGreaterThan(aiming.glow);
    expect(crouching.glow).toBeGreaterThan(locked.glow);
    expect(crouching.coil).toBeGreaterThan(locked.coil);
    expect(pounceMenace(state(landing), landing.landAt - 50).glow).toBeLessThan(crouching.glow);
    expect(pounceMenace(state(landing), landing.recoverUntil + 50)).toEqual({ glow: 0, light: 0, coil: 0 });
  });
});
