import { describe, expect, it } from 'vitest';

import { HostHeldActionSystem } from '../src/systems/HostHeldActionSystem';

describe('HostHeldActionSystem', () => {
  it('computes charge from host time and exposes an early gate commit', () => {
    const system = new HostHeldActionSystem();
    expect(system.start('p1', 'gate-1', 'charged_gate', 1_000, 5_000)).toBe(true);

    const result = system.consume('p1', 'gate-1', 'charged_gate', 1_000, 5_750);
    expect(result).toEqual({ elapsedMs: 750, chargeFraction: 0.75 });
    expect(result!.chargeFraction).toBeLessThan(1);
  });

  it('accepts a completed hold and consumes it exactly once', () => {
    const system = new HostHeldActionSystem();
    system.start('p1', 'all-1', 'global_dismantle', 1_000, 10_000);

    expect(system.consume('p1', 'all-1', 'global_dismantle', 1_000, 11_000))
      .toEqual({ elapsedMs: 1_000, chargeFraction: 1 });
    expect(system.consume('p1', 'all-1', 'global_dismantle', 1_000, 11_000)).toBeNull();
  });

  it('does not let a stale action id consume the newer action', () => {
    const system = new HostHeldActionSystem();
    system.start('p1', 'throw-old', 'charged_throw', 1_000, 1_000);
    system.start('p1', 'throw-new', 'charged_throw', 1_000, 2_000);

    expect(system.consume('p1', 'throw-old', 'charged_throw', 1_000, 3_000)).toBeNull();
    expect(system.consume('p1', 'throw-new', 'charged_throw', 1_000, 3_000)?.chargeFraction).toBe(1);
  });

  it('clears actions on cancel, player invalidation and timeout', () => {
    const system = new HostHeldActionSystem();
    system.start('p1', 'a', 'charged_throw', 1_000, 0);
    system.cancel('p1', 'a');
    expect(system.consume('p1', 'a', 'charged_throw', 1_000, 1_000)).toBeNull();

    system.start('p1', 'b', 'charged_throw', 1_000, 2_000);
    system.clearPlayer('p1');
    expect(system.consume('p1', 'b', 'charged_throw', 1_000, 3_000)).toBeNull();

    system.start('p1', 'c', 'charged_throw', 1_000, 4_000);
    system.clearExpired(7_001);
    expect(system.consume('p1', 'c', 'charged_throw', 1_000, 7_001)).toBeNull();
  });
});
