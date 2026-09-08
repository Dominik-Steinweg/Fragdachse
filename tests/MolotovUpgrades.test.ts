import { describe, expect, it } from 'vitest';
import { getCoopDefenseUpgradeDefinition, getCoopDefenseUpgradeTextureKey } from '../src/utils/coopDefenseUpgrades';
import { validateResolvedUtility } from '../src/loadout/content/LoadoutSchemas';
import { resolveMolotovFireEffect } from '../src/loadout/resolveMolotovFireEffect';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';
import { molotovLevels, resolvedMolotov } from './MolotovTestHelper';

describe('Molotov follow-up upgrade contracts', () => {
  it('offers two independent ordinary-point branches after Wildfire', () => {
    for (const id of ['molotov_wildfire_chunks', 'molotov_firewalker']) {
      const node = getCoopDefenseUpgradeDefinition(id)!;
      expect(node.requires).toEqual([{ upgradeId: 'molotov_wildfire', minLevel: 1 }]);
      expect(node.costPerLevel).toBe(1);
      expect(node.bossPointCostPerLevel).toBe(0);
      expect(getCoopDefenseUpgradeTextureKey(id)).toBeTruthy();
      for (const locale of ['de', 'en'] as const)
        expect(getUpgradeDescription(id, locale)).not.toMatch(/[{}⟦⟧]/);
    }
    expect(validateResolvedUtility(resolvedMolotov())).toEqual([]);
    const chunksOnly = resolveMolotovFireEffect(resolvedMolotov({ ...molotovLevels, molotov_firewalker: 0 }));
    expect(chunksOnly.wildfire?.deathBurst).toBeDefined();
    expect(chunksOnly.firewalker).toBeUndefined();
    const walkerOnly = resolveMolotovFireEffect(resolvedMolotov({ ...molotovLevels, molotov_wildfire_chunks: 0 }));
    expect(walkerOnly.wildfire?.deathBurst).toBeUndefined();
    expect(walkerOnly.firewalker).toBeDefined();
    expect(resolveMolotovFireEffect(resolvedMolotov({})).wildfire).toBeUndefined();
  });

  it('carries resolved burn tuning to both follow-ups without enabling propagation', () => {
    const cfg = resolvedMolotov();
    const effect = resolveMolotovFireEffect(cfg);
    expect(effect.firewalker).toMatchObject({ durationMs: cfg.firewalkerDurationMs,
      trailDurationMs: cfg.wildfireTrailDurationMs, trailDamagePerTick: cfg.wildfireTrailDamagePerTick,
      burn: { durationMs: cfg.fireBurnDurationMs, damagePerTick: cfg.fireBurnDamagePerTick } });
    expect(effect.wildfire?.deathBurst).toMatchObject({ count: cfg.wildfireChunkCount,
      durationMs: cfg.wildfireTrailDurationMs, burnDurationMs: cfg.fireBurnDurationMs,
      burnDamagePerTick: cfg.fireBurnDamagePerTick, igniteCenter: false });
    expect(effect.wildfire?.deathBurst).not.toHaveProperty('wildfire');
    expect(effect.wildfire?.deathBurst).not.toHaveProperty('firewalker');
  });

  it('rejects fractional chunks and invalid authored parameters', () => {
    for (const change of [{ wildfireChunkCount: 0.5 }, { wildfireChunkRadius: -1 },
      { wildfireChunkFlightMs: NaN }, { firewalkerDurationMs: -1 }])
      expect(validateResolvedUtility({ ...resolvedMolotov(), ...change }).length).toBeGreaterThan(0);
  });
});
