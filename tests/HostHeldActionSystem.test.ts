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

  it('keeps a duplicate start idempotent and preserves its original host start time', () => {
    const system = new HostHeldActionSystem();
    expect(system.start('p1', 'retry', 'charged_throw', 1_000, 5_000)).toBe(true);
    expect(system.start('p1', 'retry', 'charged_throw', 1_000, 5_500)).toBe(true);

    expect(system.consume('p1', 'retry', 'charged_throw', 1_000, 5_750))
      .toEqual({ elapsedMs: 750, chargeFraction: 0.75 });
  });

  it('does not consume a held action for a rejected identity or duration', () => {
    const system = new HostHeldActionSystem();
    system.start('p1', 'retry', 'charged_gate', 1_000, 5_000, { temporaryUtilityInstanceId: 'bfg-a' });

    expect(system.consume('p1', 'retry', 'charged_gate', 900, 5_900, { temporaryUtilityInstanceId: 'bfg-a' }))
      .toBeNull();
    expect(system.consume('p1', 'retry', 'charged_gate', 1_000, 6_000, { temporaryUtilityInstanceId: 'bfg-a' }))
      .toEqual({ elapsedMs: 1_000, chargeFraction: 1 });
  });

  it('binds a charged action to the temporary utility instance that started it', () => {
    const system = new HostHeldActionSystem();
    const bfgA = { temporaryUtilityInstanceId: 'temporary-utility-a' } as const;
    const bfgB = { temporaryUtilityInstanceId: 'temporary-utility-b' } as const;

    expect(system.start('p1', 'bfg-a', 'charged_gate', 1_000, 5_000, bfgA)).toBe(true);
    expect(system.consume('p1', 'bfg-a', 'charged_gate', 1_000, 6_000, bfgA))
      .toEqual({ elapsedMs: 1_000, chargeFraction: 1 });

    expect(system.start('p1', 'bfg-a-again', 'charged_gate', 1_000, 7_000, bfgA)).toBe(true);
    expect(system.consume('p1', 'bfg-a-again', 'charged_gate', 1_000, 8_000, bfgB)).toBeNull();
  });

  it('keeps equal utility types distinct through their instance identities', () => {
    const system = new HostHeldActionSystem();
    expect(system.start(
      'p1',
      'bfg-b',
      'charged_gate',
      1_000,
      10_000,
      { temporaryUtilityInstanceId: 'temporary-utility-2' },
    )).toBe(true);

    expect(system.consume(
      'p1',
      'bfg-b',
      'charged_gate',
      1_000,
      11_000,
      { temporaryUtilityInstanceId: 'temporary-utility-1' },
    )).toBeNull();
  });

  it('invalidates an action from Activity A before Activity B can consume it', () => {
    const system = new HostHeldActionSystem();
    system.start('p1', 'activity-a', 'charged_throw', 1_000, 1_000);

    system.reset();

    expect(system.consume('p1', 'activity-a', 'charged_throw', 1_000, 2_000)).toBeNull();
    expect(system.start('p1', 'activity-b', 'charged_throw', 1_000, 2_000)).toBe(true);
    expect(system.consume('p1', 'activity-b', 'charged_throw', 1_000, 3_000))
      .toEqual({ elapsedMs: 1_000, chargeFraction: 1 });
  });

  it('invalidates an action when Activity A ends without a successor', () => {
    const system = new HostHeldActionSystem();
    system.start('p1', 'activity-a', 'global_dismantle', 1_000, 5_000);

    system.reset();

    expect(system.consume('p1', 'activity-a', 'global_dismantle', 1_000, 6_000)).toBeNull();
  });

  it('invalidates only the leaving player action', () => {
    const system = new HostHeldActionSystem();
    system.start('leaving', 'leave-action', 'charged_gate', 1_000, 8_000);
    system.start('staying', 'stay-action', 'charged_gate', 1_000, 8_000);

    system.clearPlayer('leaving');

    expect(system.consume('leaving', 'leave-action', 'charged_gate', 1_000, 9_000)).toBeNull();
    expect(system.consume('staying', 'stay-action', 'charged_gate', 1_000, 9_000))
      .toEqual({ elapsedMs: 1_000, chargeFraction: 1 });
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
