import { describe, expect, it } from 'vitest';
import { UTILITY_CONFIGS } from '../../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToUtilityConfig } from '../../src/loadout/CoopDefenseLoadoutModifiers';
import { getCoopDefenseResolvedEffectTotals, getCoopDefenseUpgradeDefinition } from '../../src/utils/coopDefenseUpgrades';

describe('Translocator approved progression', () => {
  it('resolves both branches together with linear bonuses from the authored base', () => {
    const base = UTILITY_CONFIGS.TRANSLOCATOR;
    if (base.type !== 'translocator') throw Error('Expected Translocator');
    for (let level = 0; level <= 3; level++) {
      const ids = ['translocator_cooldown', 'translocator_phase_boost', 'translocator_phase_regeneration',
        'translocator_telefrag_radius', 'translocator_rift_collapse', 'translocator_portal_penetration'];
      const profile = { upgrades: Object.fromEntries([
        ...ids.map(id => [id, { unlocked: level > 0, level }]),
        ['unlock_translocator', { unlocked: true, level: 1 }],
        ['translocator_portal_pair', { unlocked: level > 0, level: level > 0 ? 1 : 0 }],
      ]) };
      const cfg = applyCoopDefenseModifiersToUtilityConfig(base,
        getCoopDefenseResolvedEffectTotals(profile, 'dachs_nukem'));
      if (cfg.type !== 'translocator') throw Error('Expected Translocator');
      expect(cfg.cooldown).toBeCloseTo(base.cooldown * (1 - level * 0.2));
      expect(cfg.telefragRadius).toBeCloseTo(base.telefragRadius * (1 + level * 0.2));
      expect(cfg.phaseMoveSpeedBonus).toBeCloseTo(level * 0.1);
      expect(cfg.phaseHpRegenPerSecond).toBe(level * 10);
      expect(cfg.portalEnabled).toBe(level > 0 ? 1 : 0);
      expect(cfg.portalDamageBonus).toBeCloseTo(level * 0.2);
      expect(cfg.collapseSlowFraction).toBeCloseTo(level * 0.2);
      if (level) expect(cfg.collapseRadius).toBe(50 + level * 50);
      expect(cfg.telefragDamage).toBe(base.telefragDamage);
      for (const id of ids) expect(getCoopDefenseUpgradeDefinition(id)?.maxLevel).toBe(3);
    }
  });
});
