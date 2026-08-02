import { describe, expect, it } from 'vitest';
import { applyCoopDefenseModifiersToUltimateConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { ULTIMATE_CONFIGS, type BuffUltimateConfig } from '../src/loadout/LoadoutConfig';
import type { CoopDefenseUpgradeProfile } from '../src/types';
import {
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';

const ARMAGEDDON_UPGRADE_IDS = [
    'unlock_armageddon',
    'armageddon_duration',
    'armageddon_damage',
    'armageddon_meteor_count',
    'armageddon_rage_required',
    'armageddon_radius',
    'armageddon_fire_chunks',
    'armageddon_comet_storm',
] as const;

function maxArmageddonProfile(): CoopDefenseUpgradeProfile {
  return {
    upgrades: Object.fromEntries(ARMAGEDDON_UPGRADE_IDS.map((id) => [
      id,
      { unlocked: true, level: getCoopDefenseUpgradeDefinition(id)?.maxLevel ?? 1 },
    ])),
  };
}

describe('Armageddon coop-defense upgrades', () => {
  it('forms two level-three chains which merge into comet storm', () => {
    expect(getCoopDefenseUpgradeDefinition('armageddon_duration')?.requires)
      .toEqual([{ upgradeId: 'unlock_armageddon', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('armageddon_damage')?.requires)
      .toEqual([{ upgradeId: 'armageddon_duration', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('armageddon_meteor_count')?.requires)
      .toEqual([{ upgradeId: 'armageddon_damage', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('armageddon_rage_required')?.requires)
      .toEqual([{ upgradeId: 'unlock_armageddon', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('armageddon_radius')?.requires)
      .toEqual([{ upgradeId: 'armageddon_rage_required', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('armageddon_fire_chunks')?.requires)
      .toEqual([{ upgradeId: 'armageddon_radius', minLevel: 1 }]);
    expect(getCoopDefenseUpgradeDefinition('armageddon_comet_storm')?.requires).toEqual([
      { upgradeId: 'armageddon_meteor_count', minLevel: 1 },
      { upgradeId: 'armageddon_fire_chunks', minLevel: 1 },
    ]);
  });

  it('resolves upgraded Armageddon fields relative to the current base config', () => {
    const totals = getCoopDefenseResolvedEffectTotals(maxArmageddonProfile());
    const base = ULTIMATE_CONFIGS.ARMAGEDDON as BuffUltimateConfig;
    const resolved = applyCoopDefenseModifiersToUltimateConfig(
      base,
      totals,
    ) as BuffUltimateConfig;

    const scaled = (stat: string, baseValue: number): number => (
      (baseValue + (totals.additive[stat] ?? 0)) * (1 + (totals.percentage[stat] ?? 0))
    );
    expect(resolved.duration).toBeCloseTo(scaled('ultimate.ARMAGEDDON.duration', base.duration));
    expect(resolved.rageDrainDuration).toBeCloseTo(scaled('ultimate.ARMAGEDDON.duration', base.rageDrainDuration));
    expect(resolved.rageRequired).toBeCloseTo(scaled('ultimate.ARMAGEDDON.rageRequired', base.rageRequired));
    expect(resolved.armageddon.meteorDamage).toBeCloseTo(
      scaled('ultimate.ARMAGEDDON.damage', base.armageddon.meteorDamage),
    );
    expect(resolved.armageddon.meteorDamageFalloff.minDamage).toBeCloseTo(
      scaled('ultimate.ARMAGEDDON.damage', base.armageddon.meteorDamageFalloff.minDamage),
    );
    expect(resolved.armageddon.meteorDamageRadius).toBeCloseTo(
      scaled('ultimate.ARMAGEDDON.radius', base.armageddon.meteorDamageRadius),
    );
    expect(resolved.armageddon.fireChunkBurst.count).toBe(
      scaled('ultimate.ARMAGEDDON.fireChunks', base.armageddon.fireChunkBurst.count),
    );
    expect(resolved.armageddon.meteorsPerSecond).toBeCloseTo(
      scaled('ultimate.ARMAGEDDON.meteorCount', base.armageddon.meteorsPerSecond),
    );
    expect(resolved.armageddon.cometStormEnabled).toBeGreaterThan(0);
    for (const key of [
      'cometSpawnRateDivisor',
      'cometFallDurationFactor',
      'cometRadiusFactor',
      'cometDamageFactor',
      'cometChunkCountFactor',
    ] as const) {
      expect(Number.isFinite(resolved.armageddon[key]), key).toBe(true);
      expect(resolved.armageddon[key], key).toBeGreaterThan(0);
    }
  });
});
