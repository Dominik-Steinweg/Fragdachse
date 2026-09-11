import { describe, expect, it } from 'vitest';
import { MG_TURRET_RULES } from '../src/config/mgTurretRules';
import { mgHarness, mgOwner, mgTarget } from './MgTurretTestHelper';

const duration = MG_TURRET_RULES.durationMs;
describe('MG attrition authority', () => {
  it('isolates turrets and combat incarnations and expires the entire refreshed value', () => {
    const h = mgHarness();
    for (let n = 0; n < 100; n++) h.runtime.hit('p1', 't1', h.target, 0);
    expect(h.runtime.getPercent('p1', 't1', h.target.ref, 0)).toBe(80);
    expect(h.runtime.getPercent('p1', 't2', h.target.ref, 0)).toBe(0);
    expect(h.runtime.getPercent('p1', 't1', mgTarget('e1', 0, 'enemy', 2).ref, 0)).toBe(0);
    h.runtime.hit('p1', 't1', h.target, duration - 10);
    expect(h.runtime.getPercent('p1', 't1', h.target.ref, duration * 2 - 11)).toBe(80);
    expect(h.runtime.getPercent('p1', 't1', h.target.ref, duration * 2 - 10)).toBe(0);
    h.runtime.advance(duration * 2 - 10);
    expect(h.runtime.snapshot(duration * 2 - 10).targets).toEqual([]);
  });
  it('shares only boss participants and selects each highest contribution independently', () => {
    const h = mgHarness([mgOwner('a', { network: true, maximumPercent: 110, bleedLevel: 1 }),
      mgOwner('b', { network: true, maximumPercent: 150, bleedLevel: 3, perHitPercent: 3, transferFraction: .6 }),
      mgOwner('c', { maximumPercent: 200 })]);
    h.runtime.hit('a', 'ta', h.target, 0); h.runtime.hit('b', 'tb', h.target, 0);
    expect(h.runtime.getPercent('a', 'anything', h.target.ref, 0)).toBe(5);
    expect(h.runtime.getPercent('c', 'tc', h.target.ref, 0)).toBe(0);
    for (let n = 0; n < 100; n++) h.runtime.hit('a', 'ta', h.target, 0);
    expect(h.runtime.getPercent('a', 'ta', h.target.ref, 0)).toBe(150);
    h.runtime.advance(250);
    expect(h.total()).toBeCloseTo(1.5 * 3 * .25);
    expect(h.damage[0].owner).toBe('b');
    h.runtime.hit('c', 'tc', h.target, duration - 1);
    expect(h.runtime.getPercent('a', 'ta', h.target.ref, duration)).toBe(0);
  });
  it('absorbs the highest value with its original expiry and starts fresh after leaving', () => {
    const h = mgHarness();
    h.runtime.hit('p1', 't1', h.target, 0); h.runtime.hit('p1', 't1', h.target, 0);
    h.runtime.hit('p1', 't2', h.target, 1000);
    h.runtime.setOwners([mgOwner('p1', { network: true })], 1100);
    expect(h.runtime.getPercent('p1', 't2', h.target.ref, 1100)).toBe(4);
    expect(h.runtime.snapshot(1100).targets[0].expiresAt).toBe(duration);
    h.runtime.setOwners([mgOwner()], 1200);
    expect(h.runtime.getPercent('p1', 't1', h.target.ref, 1200)).toBe(0);
  });
  it('integrates fractions across hits and rate changes without moving the tick clock', () => {
    const h = mgHarness([mgOwner('p1', { network: true, perHitPercent: 10, bleedLevel: 1 })]);
    h.runtime.hit('p1', 't1', h.target, 0); h.runtime.hit('p1', 't1', h.target, 100);
    h.runtime.advance(250);
    expect(h.total()).toBeCloseTo(.1 * .1 + .2 * .15);
    expect(h.damage[0].at).toBe(250);
    h.runtime.setOwners([mgOwner('p1', { network: true, perHitPercent: 10, bleedLevel: 3 })], 375);
    h.runtime.advance(duration + 100);
    expect(h.total()).toBeCloseTo(.1 * .1 + .2 * .275 + .6 * (duration + 100 - 375) / 1000);
    expect(h.runtime.snapshot(duration + 100).targets).toEqual([]);
  });
  it('adds transfers once per death, includes bases and processes bleed-death chains', () => {
    const h = mgHarness([mgOwner('p1', { network: true, perHitPercent: 20, bleedLevel: 1, transferFraction: .5 })]);
    const second = mgTarget('e2', 20), base = mgTarget('base', 40, 'base');
    h.setTargets([h.target, second, base]);
    h.runtime.hit('p1', 't1', h.target, 0); h.runtime.hit('p1', 't1', second, 0);
    h.setTargets([second, base]); h.runtime.death(h.target, 100); h.runtime.death(h.target, 100);
    expect(h.runtime.getPercent('p1', 't1', second.ref, 100)).toBe(30);
    expect(h.runtime.getPercent('p1', 't1', base.ref, 100)).toBe(10);
    expect(h.runtime.snapshot(100).transfers).toHaveLength(2);
    h.setDamageHandler((id, at) => { if (id === 'e2') { h.setTargets([base]); h.runtime.death(second, at); } });
    h.runtime.advance(250);
    expect(h.runtime.getPercent('p1', 't1', base.ref, 250)).toBe(25);
    expect(h.runtime.snapshot(250).transferSequence).toBe(3);
    h.setBlocked(true); h.setTargets([mgTarget('e3', 50)]); h.runtime.death(base, 251);
    expect(h.runtime.snapshot(251).transferSequence).toBe(3);
  });
  it('reclamps after contributor departure without extending time and clears an empty network', () => {
    const a = mgOwner('a', { network: true, maximumPercent: 40 });
    const h = mgHarness([a, mgOwner('b', { network: true, maximumPercent: 100 })]);
    for (let n = 0; n < 100; n++) h.runtime.hit('a', 't1', h.target, 0);
    h.runtime.setOwners([a], 1000);
    expect(h.runtime.getPercent('a', 't1', h.target.ref, 1000)).toBe(40);
    expect(h.runtime.snapshot(1000).targets[0].expiresAt).toBe(duration);
    h.runtime.setOwners([], 1001); expect(h.runtime.snapshot(1001).targets).toEqual([]);
  });
  it('does not transfer expired values or resurrect state after reentrant teardown', () => {
    const h = mgHarness([mgOwner('p1', { network: true, bleedLevel: 1, transferFraction: .5 })]);
    h.setTargets([h.target, mgTarget('e2', 20)]);
    h.runtime.hit('p1', 't1', h.target, 0); h.runtime.death(h.target, duration);
    expect(h.runtime.snapshot(duration).transfers).toEqual([]);
    h.runtime.hit('p1', 't1', h.target, duration + 1);
    h.setDamageHandler(() => h.runtime.clear()); h.runtime.advance(duration * 2);
    expect(h.runtime.snapshot(duration * 2).targets).toEqual([]);
  });
});
