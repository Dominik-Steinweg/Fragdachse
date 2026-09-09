import { describe, expect, it } from 'vitest';
import { acquirePortalDamage, findPortalCrossing, gatePortalExit, portalDamageMultiplier,
  releasePortalGates, type PortalPair, type PortalGates } from '../src/systems/PortalTraversal';
import { scalePortalDamagePayload } from '../src/combat/PortalDamagePayload';

const pair: PortalPair = { id: 'pair', ownerId: 'owner', a: { x: 50, y: 0 }, b: { x: 500, y: 100 },
  radius: 16, reentryDistance: 48, damageBonus: 0.6, createdAt: 0, expiresAt: 1000 };

describe('shared portal geometry and acquired damage', () => {
  it('sweeps fast travel and preserves the offset in both directions', () => {
    const forward = findPortalCrossing([pair], { x: 0, y: 8 }, { x: 100, y: 8 })!;
    expect(forward.source).toBe('a');
    expect(forward.exit.x - pair.b.x).toBeCloseTo(forward.entry.x - pair.a.x);
    expect(forward.exit.y - pair.b.y).toBe(8);
    const backward = findPortalCrossing([pair], { x: 450, y: 108 }, { x: 550, y: 108 })!;
    expect(backward.source).toBe('b');
    expect(backward.exit.y).toBe(8);
    expect(findPortalCrossing([pair], { x: 0, y: 17 }, { x: 100, y: 17 })).toBeNull();
  });

  it('captures opening overlaps and gates until the spatial release boundary', () => {
    const gates: PortalGates = new Map();
    const crossing = findPortalCrossing([pair], pair.a, pair.a)!;
    expect(crossing.fraction).toBe(0);
    gatePortalExit(gates, crossing);
    expect(findPortalCrossing([pair], pair.b, pair.b, { gates })).toBeNull();
    releasePortalGates(gates, { x: pair.b.x + pair.reentryDistance - 0.01, y: pair.b.y });
    expect(gates.size).toBe(1);
    releasePortalGates(gates, { x: pair.b.x + pair.reentryDistance, y: pair.b.y });
    expect(findPortalCrossing([pair], pair.b, pair.b, { gates })?.source).toBe('b');
  });

  it('chooses overlapping endpoints by stable identity regardless of input order', () => {
    const earlier = { ...pair, id: 'first' };
    const query = (pairs: PortalPair[]) => findPortalCrossing(pairs, { x: 0, y: 0 }, { x: 100, y: 0 })!;
    expect(query([pair, earlier]).pair.id).toBe('first');
    expect(query([earlier, pair]).pair.id).toBe('first');
    expect(findPortalCrossing([pair], pair.a, pair.a, { excludedPairs: new Set([pair.id]) })).toBeNull();
  });

  it('adds distinct friendly contributions without a cap or mutations of parent contexts', () => {
    const parent = acquirePortalDamage(undefined, pair, true)!;
    const child = acquirePortalDamage(parent, { ...pair, id: 'second', damageBonus: 4 }, true)!;
    expect(portalDamageMultiplier(child)).toBeCloseTo(5.6);
    expect(portalDamageMultiplier(parent)).toBeCloseTo(1.6);
    expect(acquirePortalDamage(child, pair, true)).toBe(child);
    expect(acquirePortalDamage(child, { ...pair, id: 'enemy' }, false)).toBe(child);
  });

  it('scales only damage, leaving support, physics and authored parents intact', () => {
    const source = { damage: 12, explosion: { minDamage: 3, radius: 50, knockback: 120 },
      burn: { damagePerTick: 7, durationMs: 500 }, healing: 20, repair: 30, slowFraction: 0.2 };
    expect(scalePortalDamagePayload(source, 2)).toEqual({ ...source, damage: 24,
      explosion: { ...source.explosion, minDamage: 6 }, burn: { ...source.burn, damagePerTick: 14 } });
    expect(source.damage).toBe(12);
    const smoke = scalePortalDamagePayload({ type: 'smoke', dotDamagePerTick: 5,
      sourceDamageMultiplier: 3, behavior: { dischargeDamage: 11 } }, 2);
    expect(smoke.dotDamagePerTick * smoke.sourceDamageMultiplier).toBe(30);
    expect(smoke.behavior.dischargeDamage * smoke.sourceDamageMultiplier).toBe(66);
  });
});
