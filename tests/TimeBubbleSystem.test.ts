import { resolveTimeBubblePrismEmitter } from '../src/loadout/TimeBubbleConfig';
import { describe, expect, it, vi } from 'vitest';
import { TimeBubbleSystem } from '../src/systems/TimeBubbleSystem';
import type { TimeBubbleEffectConfig, TimeBubblePrismEmitterConfig } from '../src/types';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals, getCoopDefenseUpgradeDefinition } from '../src/utils/coopDefenseUpgrades';
import { validateResolvedUtility } from '../src/loadout/content/LoadoutSchemas';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';
import { scalePortalDamagePayload } from '../src/combat/PortalDamagePayload';

const emitter: TimeBubblePrismEmitterConfig = {
  intervalMs: 80, rotationPeriodMs: 800, speed: 900, size: 3,
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
  it('inherits portal contributions through prism children and release without changing capacity or slow', () => {
    const { system, spawn } = harness();
    const portalDamage = [{ pairId: 'first', bonus: 0.6 }];
    const config = scalePortalDamagePayload(effect({ chargeCapacity: 40 }), 1.6);
    const released = vi.fn(); system.setReleaseHandler(released);
    const id = system.hostCreateBubble('owner', 0, 0, config, 1000, {
      gameplaySourceId: 'owner', attributionId: 'owner', allegiance: { ownerId: 'owner' }, portalDamage,
    });
    system.hostUpdate(1000);
    expect(spawn.mock.lastCall![0]).toMatchObject({ provenance: { portalDamage }, interaction: { directHit: {
      damage: emitter.damage * 1.6, slowFraction: emitter.slowFraction, slowDurationMs: emitter.slowDurationMs,
    } } });
    system.observeProjectile(7, 0, 0, 13, 1001);
    expect(system.hostUpdate(1001)[0]).toMatchObject({ charge: 13, chargeCapacity: 40 });
    system.removeBubble(id, 1002); system.flushReleases(1002);
    expect(released.mock.lastCall![0].charge).toBeCloseTo(13 * 1.6);
    system.destroyAll();
  });

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
    config.prismEmitter = undefined;
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

  it.each(['coop', 'team', 'free-for-all'])('exempts only friendly player movement in %s', mode => {
    const { system } = harness();
    system.setFriendlyResolver((owner, subject) => mode === 'coop'
      || (mode === 'team' && owner === 'owner' && subject === 'ally'));
    system.hostCreateBubble('owner', 0, 0, effect(), 0);
    expect(system.getPlayerMovementFactorAt(0, 0, 1, 'owner')).toBe(1);
    expect(system.getPlayerMovementFactorAt(0, 0, 1, 'ally')).toBe(mode === 'free-for-all' ? effect().playerSlowFactor : 1);
    expect(system.getPlayerMovementFactorAt(0, 0, 1)).toBe(effect().playerSlowFactor); // NPC
    expect(system.getProjectileMovementFactorAt(0, 0, 1)).toBe(effect().projectileSlowFactor);
    if (mode !== 'coop') {
      system.hostCreateBubble('enemy', 0, 0, effect({ playerSlowFactor: 0.2, projectileSlowFactor: 0.01 }), 0);
      expect(system.getPlayerMovementFactorAt(0, 0, 1, 'owner')).toBe(0.2);
      expect(system.getProjectileMovementFactorAt(0, 0, 1)).toBe(0.01);
    }
  });
});

describe('Time Bubble upgrade tree', () => {
  const profile = (levels: Record<string, number>) => ({ upgrades: Object.fromEntries(
    Object.entries(levels).map(([id, level]) => [id, { unlocked: level > 0, level }])) });
  const nodes = [
    ['time_bubble_cooldown', 3, ['unlock_time_bubble']],
    ['time_bubble_radius', 3, ['time_bubble_cooldown']],
    ['time_bubble_focus', 1, ['unlock_time_bubble']],
    ['time_bubble_prism_spiral', 3, ['time_bubble_focus']],
    ['time_bubble_resonance', 1, ['time_bubble_radius', 'time_bubble_prism_spiral']],
    ['time_bubble_overcharge', 3, ['time_bubble_resonance']],
    ['time_bubble_resonance_flow', 3, ['time_bubble_resonance']],
  ] as const;
  it.each(nodes)('uses the common tree, costs, requirements and descriptions for %s', (id, maxLevel, requires) => {
    const boss = id === 'time_bubble_resonance';
    expect(getCoopDefenseUpgradeDefinition(id)).toMatchObject({ maxLevel, refundable: true,
      costPerLevel: boss ? 0 : 1, bossPointCostPerLevel: boss ? 1 : 0,
      requires: requires.map(upgradeId => ({ upgradeId, minLevel: 1 })) });
    for (const locale of ['de', 'en'] as const) expect(getUpgradeDescription(id, locale)).not.toMatch(/[{}⟦⟧]/);
  });

  it('resolves all levels from authored tuning and leaves ordinary bubbles disabled', () => {
    const base = UTILITY_CONFIGS.TIME_BUBBLE;
    if (base.type !== 'time_bubble') throw Error('Expected TimeBubble');
    expect(resolveTimeBubblePrismEmitter(base.prismEmitter)).toBeUndefined();
    expect(base.focusEnabled).toBe(0);
    const value = (id: string) => getCoopDefenseUpgradeDefinition(id)!.effects[0].value;
    for (let level = 1; level <= getCoopDefenseUpgradeDefinition('time_bubble_prism_spiral')!.maxLevel; level++) {
      const levels = Object.fromEntries(nodes.map(([id, max]) => [id, Math.min(level, max)]));
      const resolved = applyCoopDefenseModifiersToUtilityConfig(base,
        getCoopDefenseResolvedEffectTotals(profile({ unlock_time_bubble: 1, ...levels }), 'dachs_nukem'));
      if (resolved.type !== 'time_bubble') throw Error('Expected TimeBubble');
      expect(resolved.cooldown).toBeCloseTo(base.cooldown * (1 + value('time_bubble_cooldown') * level));
      expect(resolved.bubbleRadius).toBeCloseTo(base.bubbleRadius * (1 + value('time_bubble_radius') * level));
      expect(resolved.bubbleDuration).toBe(base.bubbleDuration);
      expect(resolved.projectileSlowFactor).toBe(base.projectileSlowFactor);
      expect(resolved.playerSlowFactor).toBe(base.playerSlowFactor);
      expect(resolved.focusEnabled).toBe(1);
      expect(resolved.chargeCapacity).toBe(value('time_bubble_resonance') + value('time_bubble_overcharge') * level);
      expect(resolved.resonanceRegenPerDamage).toBe(value('time_bubble_resonance_flow') * level);
      const emitter = resolveTimeBubblePrismEmitter(resolved.prismEmitter)!;
      expect(emitter.intervalMs).toBe(base.prismEmitter!.intervalsMs[level - 1]);
      expect(emitter).not.toHaveProperty('level');
      const { system, spawn } = harness();
      system.hostCreateBubble('owner', 0, 0, effect({ prismEmitter: emitter }), 0);
      system.hostUpdate(0);
      system.hostUpdate(emitter.intervalMs - 1);
      expect(spawn).toHaveBeenCalledTimes(1);
      system.hostUpdate(emitter.intervalMs);
      expect(spawn).toHaveBeenCalledTimes(2);
      expect(validateResolvedUtility(resolved)).toEqual([]);
    }
    expect(base.prismEmitter?.level).toBe(0);
    expect(base.chargeCapacity).toBe(0);
    expect(base.resonanceRegenPerDamage).toBe(0);
  });

  it('rejects invalid levels, interval tables, coefficients and homing', () => {
    const base = UTILITY_CONFIGS.TIME_BUBBLE;
    if (base.type !== 'time_bubble') throw Error('Expected TimeBubble');
    for (const invalid of [{ level: -1 }, { level: 4 }, { level: 1.5 }, { intervalsMs: [10, 20] },
      { intervalsMs: [10, 0, 30] }, { rotationPeriodMs: -1 }, { speed: 0 }, { rangePx: Infinity },
      { size: 0 }, { slowFraction: 1 }, { slowDurationMs: NaN },
      { homing: { ...emitter.homing, retargetIntervalMs: 0 } },
      { homing: { ...emitter.homing, targetTypes: ['players'] } }]) {
      expect(validateResolvedUtility({ ...base, prismEmitter: { ...base.prismEmitter, ...invalid } }).length).toBeGreaterThan(0);
    }
    for (const resonanceRegenPerDamage of [-1, NaN, Infinity, '1'])
      expect(validateResolvedUtility({ ...base, resonanceRegenPerDamage }).length).toBeGreaterThan(0);
    expect(validateResolvedUtility({ ...base, focusEnabled: 2 }).length).toBeGreaterThan(0);
  });
});
