import { describe, expect, it, vi } from 'vitest';
import { TimeBubbleSystem } from '../src/systems/TimeBubbleSystem';
import type { TimeBubbleEffectConfig, TimeBubblePrismEmitterConfig } from '../src/types';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals, getCoopDefenseUpgradeDefinition } from '../src/utils/coopDefenseUpgrades';
import { validateResolvedUtility } from '../src/loadout/content/LoadoutSchemas';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';

const emitter: TimeBubblePrismEmitterConfig = {
  enabled: 1, intervalMs: 80, rotationPeriodMs: 800, speed: 900, size: 3,
  rangePx: 600, damage: 1, slowFraction: 0.5, slowDurationMs: 2000,
  homing: { acquireDelayMs: 100, searchRadius: 300, retargetIntervalMs: 40,
    maxTurnDegreesPerStep: 10, targetTypes: ['enemies'], requireLineOfSight: true,
    excludeOwner: true, distanceWeight: 1, forwardWeight: 0.5 },
};
const effect = (overrides: Partial<TimeBubbleEffectConfig> = {}): TimeBubbleEffectConfig => ({
  type: 'time_bubble', radius: 100, duration: 2400,
  playerSlowFactor: 0.1, projectileSlowFactor: 0.05, trainSlowFactor: 0.1,
  prismEmitter: emitter, ...overrides,
});
function harness() {
  const system = new TimeBubbleSystem();
  const spawn = vi.fn();
  system.setPrismProjectileSpawner(spawn);
  return { system, spawn };
}

describe('Time Bubble prism emission', () => {
  it('does not recycle bubble identities when a binding is rebuilt while old requests or shots survive', () => {
    const original = new TimeBubbleSystem();
    const oldId = original.hostCreateBubble('owner', 0, 0, effect(), 1000);
    original.destroyAll();
    const rebuilt = new TimeBubbleSystem();
    const newId = rebuilt.hostCreateBubble('owner', 0, 0, effect(), 1001);
    expect(newId).not.toBe(oldId);
    expect(rebuilt.removeBubble(oldId, 1100)).toBeNull();
    expect(rebuilt.isBubbleActive(newId, 1100)).toBe(true);
    rebuilt.destroyAll();
  });
  it('starts at the center and derives cadence and a full turn from host time', () => {
    const { system, spawn } = harness();
    system.hostCreateBubble('owner', 23, 45, effect(), 1000);
    for (let elapsed = 0; elapsed <= emitter.rotationPeriodMs; elapsed += emitter.intervalMs) {
      expect(system.hostUpdate(1000 + elapsed)[0].prismActive).toBe(true);
      const shot = spawn.mock.lastCall![0];
      expect(shot.origin).toMatchObject({ x: 23, y: 45 });
      expect(shot.origin.angle).toBeCloseTo((elapsed % emitter.rotationPeriodMs) / emitter.rotationPeriodMs * Math.PI * 2);
      const count = spawn.mock.calls.length;
      system.hostUpdate(1000 + elapsed);
      system.hostUpdate(1000 + elapsed + emitter.intervalMs - 1);
      expect(spawn).toHaveBeenCalledTimes(count);
    }
    expect(spawn).toHaveBeenCalledTimes(emitter.rotationPeriodMs / emitter.intervalMs + 1);
    expect(spawn.mock.calls[0][0]).toMatchObject({
      provenance: { attributionId: 'owner', allegiance: { ownerId: 'owner' }, sourceSlot: 'utility', weaponSourceId: 'TIME_BUBBLE' },
      flight: { speed: emitter.speed, size: emitter.size, remainingRangePx: emitter.rangePx,
        homingExcludedCircle: { x: 23, y: 45, radius: 100, expiresAt: 3400 } },
      interaction: { directHit: { damage: emitter.damage, slowFraction: emitter.slowFraction, slowDurationMs: emitter.slowDurationMs } },
    });
  });

  it('bounds catch-up while preserving the newest scheduled angles', () => {
    const { system, spawn } = harness();
    system.hostCreateBubble('owner', 0, 0, effect(), 0);
    system.hostUpdate(emitter.intervalMs * 9);
    expect(spawn).toHaveBeenCalledTimes(4);
    const angles = spawn.mock.calls.map(([shot]) => shot.origin.angle);
    expect(angles).toEqual([6, 7, 8, 9].map(i => i * emitter.intervalMs / emitter.rotationPeriodMs * Math.PI * 2));
    system.hostUpdate(emitter.intervalMs * 9);
    expect(spawn).toHaveBeenCalledTimes(4);
  });

  it('keeps bubbles independent and captures their creation-time configuration', () => {
    const { system, spawn } = harness();
    const config = effect({ prismEmitter: { ...emitter } });
    system.hostCreateBubble('a', 10, 0, config, 1000);
    config.radius = 999;
    config.prismEmitter = { ...emitter, enabled: 0 };
    system.hostCreateBubble('b', 200, 0, effect(), 1000 + emitter.intervalMs / 2);
    system.hostUpdate(1000 + emitter.intervalMs);
    expect(spawn.mock.calls.map(([shot]) => [shot.provenance.attributionId, shot.origin.angle])).toEqual([
      ['b', 0], ['a', 0], ['a', emitter.intervalMs / emitter.rotationPeriodMs * Math.PI * 2],
    ]);
    expect(spawn.mock.calls[1][0].flight.homingExcludedCircle.radius).toBe(100);
  });

  it('does not emit for ordinary bubbles, after expiry, or after teardown', () => {
    const { system, spawn } = harness();
    system.hostCreateBubble('ordinary', 0, 0, effect({ prismEmitter: undefined }), 0);
    system.hostCreateBubble('disabled', 0, 0, effect({ prismEmitter: { ...emitter, enabled: 0 } }), 0);
    expect(system.hostUpdate(0).every(bubble => bubble.prismActive === undefined)).toBe(true);
    expect(spawn).not.toHaveBeenCalled();
    system.hostCreateBubble('expired', 0, 0, effect({ duration: emitter.intervalMs }), 0);
    system.hostUpdate(emitter.intervalMs);
    expect(spawn).not.toHaveBeenCalled();
    system.hostCreateBubble('removed', 0, 0, effect(), 0);
    system.destroyAll();
    expect(system.hostUpdate(0)).toEqual([]);
    expect(spawn).not.toHaveBeenCalled();
    system.setPrismProjectileSpawner(null);
    system.hostCreateBubble('detached', 0, 0, effect(), 0);
    system.hostUpdate(0);
    expect(spawn).not.toHaveBeenCalled();
  });

  it('uses ordinary friendly immunity and the strongest overlapping time field', () => {
    const { system } = harness();
    system.setFriendlyResolver((owner, subject) => owner === subject || subject === 'ally');
    system.hostCreateBubble('owner', 0, 0, effect(), 0);
    expect(system.getProjectileMovementFactorAt(0, 0, 1, 'owner')).toBe(effect().projectileSlowFactor);
    system.destroyAll();
    system.hostCreateBubble('owner', 0, 0, effect({ friendlyImmunity: 1 }), 0);
    expect(system.getProjectileMovementFactorAt(0, 0, 1, 'owner')).toBe(1);
    expect(system.getProjectileMovementFactorAt(0, 0, 1, 'ally')).toBe(1);
    system.hostCreateBubble('other', 0, 0, effect({ projectileSlowFactor: 0.2 }), 0);
    expect(system.getProjectileMovementFactorAt(0, 0, 1, 'owner')).toBe(0.2);
  });
});

describe('Prism Spiral upgrade content', () => {
  it('unlocks focus after Prism Spiral and resolves it independently of Eigenzeit', () => {
    const node = getCoopDefenseUpgradeDefinition('time_bubble_focus')!;
    expect(node).toMatchObject({ maxLevel: 1, costPerLevel: 0, bossPointCostPerLevel: 1, refundable: true,
      requires: [{ upgradeId: 'time_bubble_prism_spiral', minLevel: 1 }] });
    const base = UTILITY_CONFIGS.TIME_BUBBLE;
    if (base.type !== 'time_bubble') throw Error('Expected TimeBubble');
    expect(base.focusEnabled).toBe(0);
    for (const immunity of [0, 1]) {
      const levels = { unlock_time_bubble: 1, time_bubble_radius: 1, time_bubble_duration: 1,
        time_bubble_resonance: 1, time_bubble_prism_spiral: 1, time_bubble_focus: 1, time_bubble_slow_strength: 1, time_bubble_projectile_slow: immunity };
      const profile = { upgrades: Object.fromEntries(Object.entries(levels).map(([id, level]) => [id, { unlocked: level > 0, level }])) };
      const resolved = applyCoopDefenseModifiersToUtilityConfig(base, getCoopDefenseResolvedEffectTotals(profile, 'dachs_nukem'));
      expect(resolved).toMatchObject({ focusEnabled: 1, prismEmitter: { enabled: 1 } });
      expect(resolved.type === 'time_bubble' && (resolved.friendlyImmunity ?? 0)).toBe(immunity);
    }
    expect(base.focusEnabled).toBe(0);
    expect(validateResolvedUtility({ ...base, focusEnabled: 2 }).length).toBeGreaterThan(0);
    for (const locale of ['de', 'en'] as const) expect(getUpgradeDescription(node.id, locale)).not.toMatch(/[{}⟦⟧]/);
  });
  it('resolves behind duration, independently from friendly immunity, without mutating authored defaults', () => {
    const node = getCoopDefenseUpgradeDefinition('time_bubble_prism_spiral')!;
    expect(node.requires).toEqual([{ upgradeId: 'time_bubble_resonance', minLevel: 1 }]);
    expect(node).toMatchObject({ maxLevel: 1, costPerLevel: 0, bossPointCostPerLevel: 1, refundable: true });
    const base = UTILITY_CONFIGS.TIME_BUBBLE;
    if (base.type !== 'time_bubble') throw Error('Expected Time Bubble');
    expect(base.prismEmitter?.enabled).toBe(0);
    for (const immunity of [0, 1]) {
      const levels = { unlock_time_bubble: 1, time_bubble_radius: 1, time_bubble_duration: 1,
        time_bubble_resonance: 1, time_bubble_slow_strength: 1, time_bubble_projectile_slow: immunity, time_bubble_prism_spiral: 1 };
      const profile = { upgrades: Object.fromEntries(Object.entries(levels).map(([id, level]) => [id, { unlocked: level > 0, level }])) };
      const resolved = applyCoopDefenseModifiersToUtilityConfig(base, getCoopDefenseResolvedEffectTotals(profile, 'dachs_nukem'));
      if (resolved.type !== 'time_bubble') throw Error('Expected Time Bubble');
      expect(resolved.prismEmitter?.enabled).toBe(1);
      expect(resolved.friendlyImmunity ?? 0).toBe(immunity);
      expect(validateResolvedUtility(resolved)).toEqual([]);
    }
    expect(base.prismEmitter?.enabled).toBe(0);
  });

  it.each(['de', 'en'] as const)('formats the %s description from authored values', locale => {
    expect(getUpgradeDescription('time_bubble_prism_spiral', locale)).not.toMatch(/[{}⟦⟧]/);
  });

  it('rejects malformed emitter and guidance settings', () => {
    const base = UTILITY_CONFIGS.TIME_BUBBLE;
    for (const invalid of [{ enabled: 2 }, { intervalMs: 0 }, { rotationPeriodMs: -1 }, { speed: 0 },
      { rangePx: Infinity }, { size: 0 }, { slowFraction: 1 }, { slowDurationMs: NaN },
      { homing: { ...emitter.homing, retargetIntervalMs: 0 } },
      { homing: { ...emitter.homing, targetTypes: ['players'] } }]) {
      expect(validateResolvedUtility({ ...base, prismEmitter: { ...emitter, ...invalid } }).length).toBeGreaterThan(0);
    }
  });
});
