import { describe, expect, it, vi } from 'vitest';
import { planFireControlCopies, type FireControlCopyPlanInput, type FireControlConstructionFacts } from '../src/systems/fireControl/FireControlCopyPlan';

export const copyFacts = (overrides: Partial<FireControlConstructionFacts> = {}): FireControlConstructionFacts => ({
  id: 7, ownerId: 'inspector', baseOwned: false, constructionId: 'machine_gun_turret', weaponFireType: 'projectile',
  combatReady: true, manned: false, x: 0, y: 0, angle: .7, weaponId: 'TURRET_MG', ...overrides,
});
const input = (overrides: Partial<FireControlCopyPlanInput> = {}): FireControlCopyPlanInput => ({
  ownerId: 'inspector', playerX: 0, playerY: 0, pointX: 100, pointY: 0,
  constructions: [copyFacts()], slotOrder: [], pausedOriginalIds: new Set(),
  config: { buildRangePx: 200, maxCopies: 3, parallel: false, ringRadiusPx: 36, clearanceRadiusPx: 16, singleCopyOffsetPx: 30 },
  isPointFree: () => true, ...overrides,
});

describe('copy placement decision shared by host and preview', () => {
  it('checks invalid then range then eligibility before querying geometry', () => {
    const isPointFree = vi.fn(() => false);
    expect(planFireControlCopies(input({ pointX: NaN, constructions: [], isPointFree }))).toEqual({ ok: false, reason: 'invalid', candidates: [] });
    expect(planFireControlCopies(input({ pointX: 201, constructions: [], isPointFree }))).toEqual({ ok: false, reason: 'range', candidates: [] });
    expect(planFireControlCopies(input({ constructions: [], isPointFree }))).toEqual({ ok: false, reason: 'no_fire_sources', candidates: [] });
    expect(isPointFree).not.toHaveBeenCalled();
  });

  it.each([false, true])('selects occupied originals only with parallel=%s', parallel => {
    const args = input({ constructions: [copyFacts({ manned: true })] });
    expect(planFireControlCopies({ ...args, config: { ...args.config, parallel } })).toMatchObject(parallel ? { ok: true, copies: [{ originalId: 7 }] } : { ok: false, reason: 'no_fire_sources' });
  });

  it('retains selected candidate order on placement failure and is independent of enumeration', () => {
    const constructions = [copyFacts({ id: 3 }), copyFacts({ id: 2, constructionId: 'rocket_turret' }), copyFacts({ id: 1 })];
    const args = input({ constructions, slotOrder: ['rocket_turret', 'machine_gun_turret'], isPointFree: () => false });
    expect(planFireControlCopies(args)).toEqual({ ok: false, reason: 'placement', candidates: [2, 1, 3] });
    expect(planFireControlCopies({ ...args, constructions: [...constructions].reverse() })).toEqual(planFireControlCopies(args));
  });

  it('filters foreign, base-owned, paused, unready and excluded sources before selection', () => {
    const args = input({ constructions: [copyFacts(), copyFacts({ id: 1, ownerId: 'other' }), copyFacts({ id: 2, baseOwned: true }),
      copyFacts({ id: 3, combatReady: false }), copyFacts({ id: 4, constructionId: 'tesla_turret' }),
      copyFacts({ id: 5, weaponFireType: 'hitscan' }), copyFacts({ id: 6 })], pausedOriginalIds: new Set([6]) });
    expect(planFireControlCopies(args)).toEqual({ ok: true, copies: [{ originalId: 7, x: 130, y: 0 }] });
  });

  it('passes authored clearance for projector and copy, with north fallback at zero distance', () => {
    const isPointFree = vi.fn(() => true);
    const result = planFireControlCopies(input({ pointX: 0, pointY: 0, isPointFree }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.copies[0].x).toBeCloseTo(0);
    expect(result.copies[0].y).toBe(-30);
    expect(isPointFree.mock.calls).toHaveLength(2);
    expect(isPointFree.mock.calls.every(call => call[2] === 16)).toBe(true);
    expect(planFireControlCopies(input({ isPointFree: x => x <= 100 }))).toMatchObject({ reason: 'placement', candidates: [7] });
  });
});
