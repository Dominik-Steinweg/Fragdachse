import { describe, expect, it } from 'vitest';
import { getCoopDefenseUpgradeDefinition } from '../src/utils/coopDefenseUpgrades';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { validateResolvedUtility } from '../src/loadout/content/LoadoutSchemas';
import { fullHeProfile, resolvedHe } from './HeGrenadeTestHelper';

describe('HE upgrade tree', () => {
  it('requires both pre-boss branches and permits both post-boss branches', () => {
    const boss = getCoopDefenseUpgradeDefinition('he_grenade_cluster')!;
    expect(boss.requires).toEqual([
      { upgradeId: 'he_grenade_charges', minLevel: 1 },
      { upgradeId: 'he_grenade_impact_fuse', minLevel: 1 },
    ]);
    expect(boss.costPerLevel).toBe(0);
    expect(boss.bossPointCostPerLevel).toBe(1);
    expect(getCoopDefenseUpgradeDefinition('he_grenade_radius')).toBeNull();
    const config = resolvedHe();
    expect(config.charges!.maxCharges).toBeGreaterThan(1);
    expect(config.impactFuseEnabled).toBe(1);
    expect(config.clusterCount).toBeGreaterThan(5);
    expect(config.demolitionLevel).toBe(3);
    expect(validateResolvedUtility(config)).toEqual([]);
  });

  it('scales damage, absolute falloff, radius and maximum speed together while retaining throw charge time', () => {
    const config = resolvedHe();
    const base = UTILITY_CONFIGS.HE_GRENADE;
    if (base.type !== 'explosive') throw new Error('wrong HE type');
    expect(config.aoeDamage / base.aoeDamage).toBeCloseTo(config.aoeRadius / base.aoeRadius);
    expect(config.damageFalloff!.minDamage / base.damageFalloff!.minDamage).toBeCloseTo(config.aoeDamage / base.aoeDamage);
    expect(config.projectileSpeed).toBeGreaterThan(base.projectileSpeed);
    expect(config.cooldown).toBeLessThan(base.cooldown);
    expect(config.activation).toEqual(base.activation);
  });

  it.each(['de', 'en'] as const)('resolves all configured numbers in %s descriptions', locale => {
    for (const id of Object.keys(fullHeProfile.upgrades).filter(id => id.startsWith('he_grenade_'))) {
      const description = getUpgradeDescription(id, locale);
      expect(description).not.toMatch(/[{}⟦⟧]/);
      expect(description.length).toBeGreaterThan(30);
    }
    const table = resolvedHe().fragmentation!.demolition.damageFactors;
    for (const factor of table) expect(getUpgradeDescription('he_grenade_demolition_cluster', locale)).toContain(String(factor * 100));
  });

  it('rejects invalid stock and fragmentation definitions', () => {
    const config = resolvedHe();
    expect(validateResolvedUtility({ ...config, charges: { maxCharges: 1.5, burstLockoutMs: 100 } }).length).toBeGreaterThan(0);
    expect(validateResolvedUtility({ ...config, demolitionLevel: 99 }).length).toBeGreaterThan(0);
    expect(validateResolvedUtility({ ...config, fragmentation: { ...config.fragmentation, shortDistance: [1, 0] } }).length).toBeGreaterThan(0);
  });
});
