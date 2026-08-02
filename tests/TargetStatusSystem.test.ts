import { describe, expect, it } from 'vitest';
import {
  TargetStatusSystem,
  VULNERABILITY_INCOMING_DAMAGE_BONUS,
} from '../src/systems/TargetStatusSystem';

describe('general target vulnerability', () => {
  it('applies exactly 20 percent to enemies and hostile bases without stacking', () => {
    const system = new TargetStatusSystem();

    system.applyVulnerability({ targetType: 'enemy', targetId: 'boss-1' }, 1_000, 1_000);
    system.applyVulnerability({ targetType: 'enemy', targetId: 'boss-1' }, 1_000, 1_200);
    system.applyVulnerability({ targetType: 'base', targetId: 'base-red' }, 1_000, 1_200);

    expect(VULNERABILITY_INCOMING_DAMAGE_BONUS).toBe(0.2);
    expect(system.getIncomingDamageMultiplier({ targetType: 'enemy', targetId: 'boss-1' }, 1_500)).toBe(1.2);
    expect(system.getIncomingDamageMultiplier({ targetType: 'base', targetId: 'base-red' }, 1_500)).toBe(1.2);
    expect(system.getSnapshot(1_500)).toHaveLength(2);
  });

  it('refreshes duration instead of adding stacks and cleans up expired targets', () => {
    const system = new TargetStatusSystem();
    const target = { targetType: 'enemy' as const, targetId: 'enemy-1' };

    expect(system.applyVulnerability(target, 1_000, 1_000)?.expiresAt).toBe(2_000);
    expect(system.applyVulnerability(target, 1_000, 1_500)?.expiresAt).toBe(2_500);
    expect(system.getSnapshot(2_499)).toHaveLength(1);
    expect(system.getIncomingDamageMultiplier(target, 2_500)).toBe(1);
    expect(system.getSnapshot(2_500)).toEqual([]);

    system.applyVulnerability(target, 1_000, 3_000);
    system.removeTarget(target);
    expect(system.getSnapshot(3_000)).toEqual([]);
  });

  it('round-trips absolute expiry times for clients and latejoiners', () => {
    const host = new TargetStatusSystem();
    host.applyVulnerability({ targetType: 'base', targetId: 'base-red' }, 7_000, 10_000);
    host.applyVulnerability({ targetType: 'construction', targetId: '42' }, 6_000, 10_000);

    const client = new TargetStatusSystem();
    client.syncFromSnapshot(host.getSnapshot(12_000));

    expect(client.getIncomingDamageMultiplier({ targetType: 'base', targetId: 'base-red' }, 16_999)).toBe(1.2);
    expect(client.getIncomingDamageMultiplier({ targetType: 'construction', targetId: '42' }, 16_000)).toBe(1);
    expect(client.getSnapshot(17_000)).toEqual([]);
  });
});
