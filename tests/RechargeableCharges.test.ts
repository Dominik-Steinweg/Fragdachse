import { describe, expect, it } from 'vitest';
import { RechargeableCharges, type RechargeableChargeConfig } from '../src/systems/RechargeableCharges';

const base: RechargeableChargeConfig = { maxCharges: 3, rechargeIntervalMs: 2000, rechargeMode: 'preserve-progress' };

describe('RechargeableCharges', () => {
  it.each(['preserve-progress', 'restart-on-consume'] as const)('regenerates discrete stock with %s', (rechargeMode) => {
    const stock = new RechargeableCharges({ ...base, rechargeMode }, 0);
    expect(stock.getAvailableCharges(0)).toBe(3);
    for (const now of [0, 400, 800]) expect(stock.consume(now)).toBe(true);
    const next = rechargeMode === 'preserve-progress' ? 2000 : 2800;
    expect(stock.consume(1000)).toBe(false);
    expect(stock.getSnapshot(1000).nextChargeAt).toBe(next);
    expect(stock.getAvailableCharges(next - 1)).toBe(0);
    expect(stock.getAvailableCharges(next)).toBe(1);
    expect(stock.getAvailableCharges(next + 2000)).toBe(2);
    expect(stock.getAvailableCharges(next + 4000)).toBe(3);
    expect(stock.getSnapshot(next + 100000).nextChargeAt).toBeNull();
    stock.consume(next + 100000);
    expect(stock.getSnapshot(next + 100000).nextChargeAt).toBe(next + 102000);
  });

  it.each(['preserve-progress', 'restart-on-consume'] as const)('handles another use during %s regeneration', (rechargeMode) => {
    const stock = new RechargeableCharges({ ...base, rechargeMode, startCharges: 1 }, 0);
    stock.consume(1000);
    expect(stock.getSnapshot(1000).nextChargeAt).toBe(rechargeMode === 'preserve-progress' ? 2000 : 3000);
  });

  it('starts partial, resets explicitly and catches up without per-charge timers', () => {
    const stock = new RechargeableCharges({ ...base, startCharges: 0 }, 100);
    expect(stock.getAvailableCharges(2099)).toBe(0);
    expect(stock.getAvailableCharges(100000)).toBe(3);
    stock.reset(100000);
    expect(stock.getSnapshot(100000)).toMatchObject({ availableCharges: 0, nextChargeAt: 102000 });
  });

  it('preserves relative progress, clamps reductions and leaves increased capacity empty', () => {
    const stock = new RechargeableCharges(base, 0);
    stock.consume(0);
    stock.reconfigure({ ...base, rechargeIntervalMs: 1000, maxCharges: 4 }, 1000);
    expect(stock.getSnapshot(1000)).toMatchObject({ availableCharges: 2, nextChargeAt: 1500 });
    expect(stock.getAvailableCharges(1500)).toBe(3);
    stock.reconfigure({ ...base, maxCharges: 1 }, 1500);
    expect(stock.getSnapshot(1500)).toMatchObject({ availableCharges: 1, nextChargeAt: null });
    stock.reconfigure({ ...base, maxCharges: 2 }, 2000);
    expect(stock.getSnapshot(2000)).toMatchObject({ availableCharges: 1, nextChargeAt: 4000 });
  });

  it('does not enforce cadence or share stock between instances', () => {
    const first = new RechargeableCharges(base, 0);
    const second = new RechargeableCharges(base, 0);
    for (let i = 0; i < base.maxCharges; i++) expect(first.consume(0)).toBe(true);
    expect(first.consume(0)).toBe(false);
    expect(second.getAvailableCharges(0)).toBe(base.maxCharges);
  });

  it('supports zero recharge intervals without an infinite loop', () => {
    const stock = new RechargeableCharges({ ...base, startCharges: 0, rechargeIntervalMs: 0 }, 0);
    expect(stock.consume(0)).toBe(true);
    expect(stock.getAvailableCharges(0)).toBe(base.maxCharges);
  });

  it('rejects invalid stock and time configuration', () => {
    for (const config of [{ ...base, maxCharges: 0 }, { ...base, startCharges: 4 }, { ...base, rechargeIntervalMs: Infinity }]) {
      expect(() => new RechargeableCharges(config, 0)).toThrow();
    }
    expect(() => new RechargeableCharges(base, NaN)).toThrow();
  });
});
