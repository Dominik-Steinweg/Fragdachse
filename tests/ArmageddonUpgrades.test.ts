import { describe, expect, it } from 'vitest';
import { applyCoopDefenseModifiersToUltimateConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { ULTIMATE_CONFIGS, type BuffUltimateConfig } from '../src/loadout/LoadoutConfig';
import type { CoopDefenseUpgradeProfile } from '../src/types';
import {
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';

const MAX_ARMAGEDDON_PROFILE: CoopDefenseUpgradeProfile = {
  upgrades: Object.fromEntries([
    'unlock_armageddon',
    'armageddon_duration',
    'armageddon_damage',
    'armageddon_meteor_count',
    'armageddon_rage_required',
    'armageddon_radius',
    'armageddon_fire_chunks',
    'armageddon_comet_storm',
  ].map((id) => [id, { unlocked: true, level: id === 'unlock_armageddon' || id === 'armageddon_comet_storm' ? 1 : 3 }])),
};

describe('Armageddon coop-defense upgrades', () => {
  it('forms two level-three chains which merge into comet storm', () => {
    expect(getCoopDefenseUpgradeDefinition('armageddon_duration')?.requires)
      .toEqual([{ upgradeId: 'unlock_armageddon', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('armageddon_damage')?.requires)
      .toEqual([{ upgradeId: 'armageddon_duration', minLevel: 3 }]);
    expect(getCoopDefenseUpgradeDefinition('armageddon_meteor_count')?.requires)
      .toEqual([{ upgradeId: 'armageddon_damage', minLevel: 3 }]);
    expect(getCoopDefenseUpgradeDefinition('armageddon_rage_required')?.requires)
      .toEqual([{ upgradeId: 'unlock_armageddon', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('armageddon_radius')?.requires)
      .toEqual([{ upgradeId: 'armageddon_rage_required', minLevel: 3 }]);
    expect(getCoopDefenseUpgradeDefinition('armageddon_fire_chunks')?.requires)
      .toEqual([{ upgradeId: 'armageddon_radius', minLevel: 3 }]);
    expect(getCoopDefenseUpgradeDefinition('armageddon_comet_storm')?.requires).toEqual([
      { upgradeId: 'armageddon_meteor_count', minLevel: 3 },
      { upgradeId: 'armageddon_fire_chunks', minLevel: 3 },
    ]);
  });

  it('resolves the fully upgraded end values before comet storm runtime factors', () => {
    const totals = getCoopDefenseResolvedEffectTotals(MAX_ARMAGEDDON_PROFILE);
    const resolved = applyCoopDefenseModifiersToUltimateConfig(
      ULTIMATE_CONFIGS.ARMAGEDDON,
      totals,
    ) as BuffUltimateConfig;

    expect(resolved.duration).toBe(9100);
    expect(resolved.rageDrainDuration).toBe(9100);
    expect(resolved.rageRequired).toBeCloseTo(165);
    expect(resolved.armageddon).toMatchObject({
      meteorDamage: 156,
      meteorDamageFalloff: { minDamage: 104 },
      meteorDamageRadius: 139.2,
      fireChunkBurst: { count: 12 },
      cometStormEnabled: 1,
      cometSpawnRateDivisor: 3,
      cometFallDurationFactor: 0.25,
      cometRadiusFactor: 2,
      cometDamageFactor: 3,
      cometChunkCountFactor: 3,
    });
    expect(resolved.armageddon.meteorsPerSecond).toBeCloseTo(3.9);
  });
});
