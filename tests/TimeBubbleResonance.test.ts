import { describe, expect, it, vi } from 'vitest';
import { TimeBubbleSystem } from '../src/systems/TimeBubbleSystem';
import { meleeCircleContact } from '../src/systems/TimeBubbleChargePort';
import type { TimeBubbleEffectConfig } from '../src/types';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals, getCoopDefenseUpgradeDefinition,
  getSpentCoopDefenseBossPoints, sanitizeCoopDefenseUpgradeProfile, levelDownCoopDefenseUpgrade, getSpentCoopDefenseUpgradePoints } from '../src/utils/coopDefenseUpgrades';
import { validateResolvedUtility } from '../src/loadout/content/LoadoutSchemas';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';

const effect = (overrides: Partial<TimeBubbleEffectConfig> = {}): TimeBubbleEffectConfig => ({
  type: 'time_bubble', radius: 10, duration: 1000, chargeCapacity: 70,
  playerSlowFactor: 0.1, projectileSlowFactor: 0.05, trainSlowFactor: 0.1, ...overrides,
});
const profile = (levels: Record<string, number>) => ({ upgrades: Object.fromEntries(
  Object.entries(levels).map(([id, level]) => [id, { level, unlocked: level > 0 }])) });
const prerequisites = { unlock_time_bubble: 1, time_bubble_cooldown: 1, time_bubble_radius: 1, time_bubble_focus: 1, time_bubble_prism_spiral: 1 };

describe('Time Bubble resonance content', () => {
  it('resolves each capacity level, leaves defaults disabled and supplies translated tuning', () => {
    const node = getCoopDefenseUpgradeDefinition('time_bubble_resonance')!;
    expect(node).toMatchObject({ costPerLevel: 0, bossPointCostPerLevel: 1, refundable: true,
      requires: [{ upgradeId: 'time_bubble_radius', minLevel: 1 }, { upgradeId: 'time_bubble_prism_spiral', minLevel: 1 }] });
    const base = UTILITY_CONFIGS.TIME_BUBBLE;
    if (base.type !== 'time_bubble') throw Error('Expected TimeBubble');
    for (let level = 0; level <= node.maxLevel; level++) {
      const resolved = applyCoopDefenseModifiersToUtilityConfig(base,
        getCoopDefenseResolvedEffectTotals(profile({ ...prerequisites, time_bubble_resonance: level }), 'dachs_nukem'));
      expect(resolved).toMatchObject({ chargeCapacity: node.effects[0].value * level });
      expect(validateResolvedUtility(resolved)).toEqual([]);
    }
    expect(base.chargeCapacity).toBe(0);
    for (const chargeCapacity of [-1, NaN, Infinity, '50']) {
      expect(validateResolvedUtility({ ...base, chargeCapacity })).not.toEqual([]);
    }
    for (const locale of ['de', 'en'] as const) expect(getUpgradeDescription(node.id, locale)).not.toMatch(/[{}⟦⟧]/);
  });

  it('refunds normal and boss points through the existing level-down path', () => {
    const full = profile({ ...prerequisites, time_bubble_resonance: 1, time_bubble_overcharge: 1 });
    expect(levelDownCoopDefenseUpgrade(full, 'time_bubble_resonance')).toBeNull();
    const normalRefund = levelDownCoopDefenseUpgrade(full, 'time_bubble_overcharge')!;
    expect(getSpentCoopDefenseUpgradePoints(full) - getSpentCoopDefenseUpgradePoints(normalRefund)).toBe(1);
    const bossRefund = levelDownCoopDefenseUpgrade(normalRefund, 'time_bubble_resonance')!;
    expect(getSpentCoopDefenseBossPoints(normalRefund) - getSpentCoopDefenseBossPoints(bossRefund)).toBe(1);
  });

  it('freezes flow coefficients per bubble, sums owner contributions and excludes expired or removed bubbles', () => {
    const system = new TimeBubbleSystem();
    const config = effect({ resonanceRegenPerDamage: 0.02 });
    const first = system.hostCreateBubble('a', 0, 0, config, 100);
    config.resonanceRegenPerDamage = 99;
    system.hostCreateBubble('a', 0, 0, effect({ resonanceRegenPerDamage: 0.03 }), 200);
    system.hostCreateBubble('b', 0, 0, effect({ resonanceRegenPerDamage: 3 }), 200);
    system.observeProjectile(1, 0, 0, 10, 200);
    expect(system.getOwnerAdrenalineRegenMultiplier('a', 99)).toBe(1);
    expect(system.getOwnerAdrenalineRegenMultiplier('a', 200)).toBeCloseTo(1 + 10 * (0.02 + 0.03));
    expect(system.getOwnerAdrenalineRegenMultiplier('missing', 200)).toBe(1);
    system.removeBubble(first, 201, true);
    expect(system.getOwnerAdrenalineRegenMultiplier('a', 201)).toBeCloseTo(1 + 10 * 0.03);
    expect(system.getOwnerAdrenalineRegenMultiplier('a', 200 + effect().duration)).toBe(1);
    system.destroyAll();
    expect(system.getOwnerAdrenalineRegenMultiplier('b', 201)).toBe(1);
  });

  it('requires both branches for the boss and keeps its two children independent', () => {
    const full = { ...prerequisites, time_bubble_resonance: 1, time_bubble_overcharge: 2, time_bubble_resonance_flow: 3 };
    for (const missing of ['time_bubble_radius', 'time_bubble_prism_spiral']) {
      const invalid = sanitizeCoopDefenseUpgradeProfile(profile({ ...full, [missing]: 0 }), 'dachs_nukem');
      expect(invalid.upgrades.time_bubble_resonance.level).toBe(0);
      expect(invalid.upgrades.time_bubble_overcharge.level).toBe(0);
      expect(invalid.upgrades.time_bubble_resonance_flow.level).toBe(0);
      expect(getSpentCoopDefenseBossPoints(invalid, 'dachs_nukem')).toBe(0);
    }
    for (const absent of ['time_bubble_overcharge', 'time_bubble_resonance_flow']) {
      const valid = sanitizeCoopDefenseUpgradeProfile(profile({ ...full, [absent]: 0 }), 'dachs_nukem');
      const sibling = absent === 'time_bubble_overcharge' ? 'time_bubble_resonance_flow' : 'time_bubble_overcharge';
      expect(valid.upgrades[sibling].level).toBe(full[sibling]);
      expect(getSpentCoopDefenseBossPoints(valid, 'dachs_nukem')).toBe(1);
    }
  });
});

describe('Time Bubble passive damage storage', () => {
  it('counts current projectile positions once per bubble, including edges and inside spawns', () => {
    const system = new TimeBubbleSystem();
    system.hostCreateBubble('a', 0, 0, effect(), 0);
    system.hostCreateBubble('b', 20, 0, effect(), 0);
    system.observeProjectile(1, 10, 0, 3, 1);
    system.observeProjectile(1, 10, 0, 9, 1);
    system.observeProjectile(1, 100, 0, 9, 2);
    system.observeProjectile(1, 0, 0, 9, 3);
    system.observeProjectile(2, 0, 0, 1, 3);
    system.observeProjectile(3, -11, 0, 10, 4);
    system.observeProjectile(3, 11, 0, 10, 5); // Crossing between updates does not charge a.
    expect(system.hostUpdate(5).map(b => b.charge)).toEqual([4, 13]);
  });

  it('caps charge without ending, snapshots capacity, and ignores inactive/ordinary bubbles', () => {
    const system = new TimeBubbleSystem();
    const config = effect();
    const id = system.hostCreateBubble('a', 0, 0, config, 100);
    system.hostCreateBubble('ordinary', 0, 0, effect({ chargeCapacity: undefined }), 100);
    config.chargeCapacity = 999;
    system.observeProjectile(1, 0, 0, 30, 99);
    expect(system.hostUpdate(100)[0].charge).toBe(0);
    system.observeProjectile(1, 0, 0, 1000, 101);
    const full = system.hostUpdate(101)[0];
    expect(full.charge).toBe(effect().chargeCapacity);
    expect(full.chargeCapacity).toBe(effect().chargeCapacity);
    expect(system.isBubbleActive(id, 101)).toBe(true);
    expect(system.hostUpdate(101)[1].charge).toBeUndefined();
    system.observeProjectile(2, 0, 0, Infinity, 102);
    expect(system.hostUpdate(102)[0].charge).toBe(full.charge);
  });

  it('uses clipped hitscan segments and thickness, including misses and tangent contact', () => {
    const system = new TimeBubbleSystem();
    system.hostCreateBubble('a', 0, 0, effect(), 0);
    system.observeHitscan(-30, 0, -11, 0, 0, 20, 1);
    system.observeHitscan(-30, 12, 30, 12, 2, 20, 1);
    expect(system.hostUpdate(1)[0].charge).toBe(0);
    system.observeHitscan(-30, 12, 30, 12, 4, 7, 1);
    system.observeHitscan(-30, 0, 30, 0, 1, 9, 1);
    expect(system.hostUpdate(1)[0].charge).toBe(16);
  });

  it('finds melee edge contacts even when the center is outside the swing, and respects blockers', () => {
    const halfArc = Math.PI / 4;
    const center = { x: 40 * Math.cos(halfArc + 0.1), y: 40 * Math.sin(halfArc + 0.1) };
    expect(meleeCircleContact(0, 0, 0, 45, halfArc, center.x, center.y, 10)).not.toBeNull();
    expect(meleeCircleContact(0, 0, 0, 20, halfArc, center.x, center.y, 10)).toBeNull();
    expect(meleeCircleContact(0, 0, Math.PI, 45, halfArc, center.x, center.y, 10)).toBeNull();
    const system = new TimeBubbleSystem();
    system.hostCreateBubble('a', center.x, center.y, effect(), 0);
    const blocked = vi.fn(() => true);
    system.observeMelee(0, 0, 0, 45, halfArc, 9, 1, blocked);
    expect(blocked).toHaveBeenCalledOnce();
    expect(system.hostUpdate(1)[0].charge).toBe(0);
    system.observeMelee(0, 0, 0, 45, halfArc, 9, 2, () => false);
    expect(system.hostUpdate(2)[0].charge).toBe(9);
  });

  it('charges explosions at the nearest bubble surface with their existing falloff', () => {
    const system = new TimeBubbleSystem();
    system.hostCreateBubble('a', 0, 0, effect(), 0);
    system.observeExplosion(0, 0, 20, 10, 1, { minDamage: 2 });
    system.observeExplosion(20, 0, 20, 10, 1, { minDamage: 2 });
    system.observeExplosion(30, 0, 20, 10, 1, { minDamage: 2 });
    system.observeExplosion(31, 0, 20, 10, 1);
    expect(system.hostUpdate(1)[0].charge).toBe(10 + 6 + 2);
  });

  it('releases once at expiry and only charges neighbours that are still active', () => {
    const system = new TimeBubbleSystem();
    const a = system.hostCreateBubble('a', 0, 0, effect(), 0);
    const b = system.hostCreateBubble('b', 0, 0, effect(), 0);
    system.observeProjectile(1, 0, 0, 7, 1);
    system.hostCreateBubble('c', 0, 0, effect({ duration: 2000 }), 2);
    const release = vi.fn((r, now) => {
      expect(system.isBubbleActive(r.id, now)).toBe(false);
      system.observeExplosion(r.x, r.y, r.radius, r.charge, now);
    });
    system.setReleaseHandler(release);
    const ended = vi.fn(); system.setEndListener(ended);
    system.observeProjectile(2, 0, 0, 8, effect().duration);
    const snapshots = system.hostUpdate(effect().duration);
    expect(release.mock.calls.map(([r]) => r.charge)).toEqual([7, 7]);
    expect(snapshots[0].charge).toBe(8 + 14);
    expect(ended.mock.calls).toEqual([[a, effect().duration], [b, effect().duration]]);
    system.hostUpdate(effect().duration); system.flushReleases(effect().duration);
    expect(release).toHaveBeenCalledTimes(2);
    const c = snapshots[0].id;
    system.removeBubble(c, 1100);
    expect(release).toHaveBeenCalledTimes(2); // Manual focus decides when redirection has finished.
    system.flushReleases(1100);
    expect(release).toHaveBeenCalledTimes(3);
    system.removeBubble(c, 1101); system.flushReleases(1101);
    expect(release).toHaveBeenCalledTimes(3);
  });

  it('keeps empty expiry, silent removal and teardown silent', () => {
    const system = new TimeBubbleSystem(); const release = vi.fn(); system.setReleaseHandler(release);
    system.hostCreateBubble('empty', 0, 0, effect(), 0);
    system.hostUpdate(1000);
    const id = system.hostCreateBubble('silent', 0, 0, effect(), 1000);
    system.observeProjectile(1, 0, 0, 5, 1001);
    system.removeBubble(id, 1002, true); system.flushReleases(1002);
    const next = system.hostCreateBubble('pending', 0, 0, effect(), 1000);
    system.observeProjectile(2, 0, 0, 5, 1001);
    system.removeBubble(next, 1002); system.destroyAll(); system.flushReleases(1002);
    expect(release).not.toHaveBeenCalled();
  });
});
