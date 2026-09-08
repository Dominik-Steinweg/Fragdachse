import { describe, expect, it } from 'vitest';
import { getCoopDefenseUpgradeDefinition, getCoopDefenseUpgradeTextureKey } from '../src/utils/coopDefenseUpgrades';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';
import { validateResolvedUtility } from '../src/loadout/content/LoadoutSchemas';
import { fullDecoyLevels, resolvedDecoy } from './DecoyTestHelper';

describe('Decoy upgrade contracts', () => {
  it('gates the boss through both branches and allows both fire branches together', () => {
    const boss = getCoopDefenseUpgradeDefinition('decoy_explosive_dummy')!;
    expect(boss.requires).toEqual([{ upgradeId: 'decoy_irresistible_lure', minLevel: 1 },
      { upgradeId: 'decoy_shadow_regeneration', minLevel: 1 }]);
    expect(boss.costPerLevel).toBe(0); expect(boss.bossPointCostPerLevel).toBe(1);
    for (const id of ['decoy_fire_chunks', 'decoy_fire_trail']) {
      const node = getCoopDefenseUpgradeDefinition(id)!;
      expect(node.requires).toEqual([{ upgradeId: boss.id, minLevel: 1 }]);
      expect(node.costPerLevel).toBe(1); expect(node.maxLevel).toBe(3);
      expect(getCoopDefenseUpgradeTextureKey(id)).toBeTruthy();
    }
    expect(validateResolvedUtility(resolvedDecoy())).toEqual([]);
    expect(resolvedDecoy().fireTrailDurationMs).toBeGreaterThan(0);
    expect(resolvedDecoy().fireChunkBurst.count).toBeGreaterThan(0);
  });
  it.each(['de', 'en'] as const)('resolves authored values in every %s description', locale => {
    for (const id of Object.keys(fullDecoyLevels)) expect(getUpgradeDescription(id, locale)).not.toMatch(/[{}⟦⟧]/);
  });
  it('rejects invalid radii, fractional chunks, negative regeneration and inverted damage falloff', () => {
    const config = resolvedDecoy();
    for (const change of [{ refundRadius: -1 }, { lureRadius: NaN }, { stealthHpRegenPerSecond: -1 },
      { explosionMinDamage: config.explosionDamage! + 1 }, { fireChunkBurst: { ...config.fireChunkBurst, count: 0.5 } }]) {
      expect(validateResolvedUtility({ ...config, ...change }).length).toBeGreaterThan(0);
    }
  });
});
