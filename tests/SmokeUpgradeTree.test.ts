import { describe, expect, it } from 'vitest';
import { getCoopDefenseUpgradeDefinition, getCoopDefenseUpgradeTextureKey } from '../src/utils/coopDefenseUpgrades';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';
import { validateResolvedUtility } from '../src/loadout/content/LoadoutSchemas';
import { fullSmokeLevels, resolvedSmoke } from './SmokeTestHelper';

describe('smoke upgrade tree', () => {
  it('requires both branches for the boss node, then unlocks two independent combo branches', () => {
    const boss = getCoopDefenseUpgradeDefinition('smoke_grenade_storm')!;
    expect(boss.requires).toEqual([{ upgradeId: 'smoke_grenade_duration', minLevel: 1 }, { upgradeId: 'smoke_grenade_vulnerability', minLevel: 1 }]);
    expect(boss.costPerLevel).toBe(0); expect(boss.bossPointCostPerLevel).toBe(1);
    for (const id of ['smoke_grenade_discharge', 'smoke_grenade_growth']) {
      const node = getCoopDefenseUpgradeDefinition(id)!;
      expect(node.requires).toEqual([{ upgradeId: boss.id, minLevel: 1 }]);
      expect(node.costPerLevel).toBe(1);
      expect(getCoopDefenseUpgradeTextureKey(id)).toBeTruthy();
    }
    expect(validateResolvedUtility(resolvedSmoke())).toEqual([]);
  });
  it.each(['de', 'en'] as const)('resolves configuration values in every %s description', locale => {
    for (const id of Object.keys(fullSmokeLevels)) expect(getUpgradeDescription(id, locale)).not.toMatch(/[{}⟦⟧]/);
    expect(getUpgradeDescription('smoke_grenade_disorientation', locale)).not.toContain('s ms');
  });
  it('rejects malformed combo counts, confusion fractions, intervals and flight speed', () => {
    const config = resolvedSmoke();
    for (const invalid of [{ dischargeCount: 1.2 }, { confusionFraction: 1.1 }, { growthMaxProcs: -1 },
      { directionMaxMs: config.smokeBehavior.directionMinMs - 1 }, { dischargeSpeed: 0 }, { aftereffectMs: NaN }]) {
      expect(validateResolvedUtility({ ...config, smokeBehavior: { ...config.smokeBehavior, ...invalid } }).length).toBeGreaterThan(0);
    }
  });
});
