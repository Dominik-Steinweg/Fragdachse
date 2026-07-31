import { describe, expect, it } from 'vitest';
import { areLoadoutConfigsEquivalent } from '../src/loadout/LoadoutRules';

describe('loadout config semantic equality', () => {
  it('ignores object-key order while preserving array order', () => {
    const left = { id: 'TEST', nested: { alpha: 1, beta: 2 }, values: [1, 2] };
    const reordered = { values: [1, 2], nested: { beta: 2, alpha: 1 }, id: 'TEST' };
    const changedArray = { values: [2, 1], nested: { beta: 2, alpha: 1 }, id: 'TEST' };
    expect(areLoadoutConfigsEquivalent(left, reordered)).toBe(true);
    expect(areLoadoutConfigsEquivalent(left, changedArray)).toBe(false);
  });
});
