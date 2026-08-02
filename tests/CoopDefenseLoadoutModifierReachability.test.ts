import { describe, expect, it } from 'vitest';
import type { CoopDefenseClassId } from '../src/types';
import { COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS } from '../src/config/coopDefenseItems';
import { COOP_DEFENSE_MAP_CONFIGS } from '../src/config/coopDefenseMaps';
import {
  CONFIG_STAT_DESCRIPTORS,
  applyCoopDefenseModifiersToUltimateConfig,
  applyCoopDefenseModifiersToUtilityConfig,
  applyCoopDefenseModifiersToWeaponConfig,
  type ConfigStatDescriptor,
  type CoopDefenseEffectTotalsSource,
} from '../src/loadout/CoopDefenseLoadoutModifiers';
import {
  getUtilityConfigLineage,
  ULTIMATE_CONFIGS,
  UTILITY_CONFIGS,
  WEAPON_CONFIGS,
} from '../src/loadout/LoadoutConfig';
import {
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  isCoopDefenseUpgradeAvailableForClass,
} from '../src/utils/coopDefenseUpgrades';

interface ReachableTotals {
  additive: number;
  percentage: number;
}

const CLASSES: readonly CoopDefenseClassId[] = [
  'dachs_nukem',
  'dachs_of_steel',
  'inspector_gadachs',
];

function isConfigStat(stat: string): boolean {
  return stat.startsWith('weapon1.')
    || stat.startsWith('weapon2.')
    || stat === 'utility.cooldown'
    || /^(?:weapon|utility|ultimate)\.[A-Z0-9_]+\./.test(stat);
}

function matchingConfigIds(descriptor: ConfigStatDescriptor): readonly string[] {
  if (descriptor.itemId && descriptor.kind === 'utility') {
    return Object.values(UTILITY_CONFIGS)
      .filter((config) => getUtilityConfigLineage(config.id).includes(descriptor.itemId!))
      .map((config) => config.id);
  }
  if (descriptor.itemId) return [descriptor.itemId];
  if (descriptor.kind === 'weapon') {
    return Object.values(WEAPON_CONFIGS)
      .filter((config) => !descriptor.slot || config.allowedSlots.includes(descriptor.slot))
      .map((config) => config.id);
  }
  if (descriptor.kind === 'utility') return Object.keys(UTILITY_CONFIGS);
  return Object.keys(ULTIMATE_CONFIGS);
}

function applyStat(
  descriptor: ConfigStatDescriptor,
  configId: string,
  totals: CoopDefenseEffectTotalsSource,
): unknown {
  if (descriptor.kind === 'weapon') {
    const slot = descriptor.slot === 'weapon1' ? 'weapon1' : 'weapon2';
    return applyCoopDefenseModifiersToWeaponConfig(WEAPON_CONFIGS[configId], slot, totals);
  }
  if (descriptor.kind === 'utility') {
    return applyCoopDefenseModifiersToUtilityConfig(UTILITY_CONFIGS[configId], totals);
  }
  return applyCoopDefenseModifiersToUltimateConfig(ULTIMATE_CONFIGS[configId], totals);
}

function enumerateReachableTotals(stat: string, classId: CoopDefenseClassId): readonly ReachableTotals[] {
  const producers = Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)
    .filter((upgrade) => isCoopDefenseUpgradeAvailableForClass(upgrade.id, classId))
    .map((upgrade) => ({
      upgrade,
      effects: upgrade.effects.filter((effect) => effect.stat === stat),
    }))
    .filter((producer) => producer.effects.length > 0);

  let reachable: ReachableTotals[] = [{ additive: 0, percentage: 0 }];
  for (const { upgrade, effects } of producers) {
    const next = new Map<string, ReachableTotals>();
    for (const current of reachable) {
      for (let level = upgrade.startingLevel; level <= upgrade.maxLevel; level += 1) {
        let additive = current.additive;
        let percentage = current.percentage;
        for (const effect of effects) {
          if (effect.mode === 'add_per_level') additive += effect.value * level;
          else percentage += effect.value * level;
        }
        next.set(`${additive}|${percentage}`, { additive, percentage });
      }
    }
    reachable = [...next.values()];
  }
  return reachable;
}

describe('coop-defense loadout modifier reachability', () => {
  it('keeps every discrete shipped upgrade level combination schema-valid', () => {
    for (const [stat, descriptor] of Object.entries(CONFIG_STAT_DESCRIPTORS)) {
      if (!isConfigStat(stat)) continue;
      for (const classId of CLASSES) {
        const reachable = enumerateReachableTotals(stat, classId);
        for (const values of reachable) {
          if (values.additive === 0 && values.percentage === 0) continue;
          const totals = {
            additive: { [stat]: values.additive },
            percentage: { [stat]: values.percentage },
          };
          for (const configId of matchingConfigIds(descriptor)) {
            expect(
              () => applyStat(descriptor, configId, totals),
              `${classId}:${stat}:${configId}:${values.additive}/${values.percentage}`,
            ).not.toThrow();
          }
        }
      }
    }
  });

  it('keeps the combined maximum shipped effects schema-valid for every class', () => {
    for (const classId of CLASSES) {
      const additive: Record<string, number> = {};
      const percentage: Record<string, number> = {};
      for (const upgrade of Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)) {
        if (!isCoopDefenseUpgradeAvailableForClass(upgrade.id, classId)) continue;
        for (const effect of upgrade.effects) {
          if (!isConfigStat(effect.stat)) continue;
          const bucket = effect.mode === 'add_per_level' ? additive : percentage;
          bucket[effect.stat] = (bucket[effect.stat] ?? 0) + effect.value * upgrade.maxLevel;
        }
      }
      const totals = { additive, percentage };
      for (const config of Object.values(WEAPON_CONFIGS)) {
        if (config.allowedSlots.includes('weapon1')) {
          expect(() => applyCoopDefenseModifiersToWeaponConfig(config, 'weapon1', totals), `${classId}:weapon1:${config.id}`).not.toThrow();
        }
        if (config.allowedSlots.includes('weapon2')) {
          expect(() => applyCoopDefenseModifiersToWeaponConfig(config, 'weapon2', totals), `${classId}:weapon2:${config.id}`).not.toThrow();
        }
      }
      for (const config of Object.values(UTILITY_CONFIGS)) {
        expect(() => applyCoopDefenseModifiersToUtilityConfig(config, totals), `${classId}:utility:${config.id}`).not.toThrow();
      }
      for (const config of Object.values(ULTIMATE_CONFIGS)) {
        expect(() => applyCoopDefenseModifiersToUltimateConfig(config, totals), `${classId}:ultimate:${config.id}`).not.toThrow();
      }
    }
  });

  it('accepts every quantized loadout-affix value from every shipped item level', () => {
    const itemLevels = [...new Set(COOP_DEFENSE_MAP_CONFIGS.flatMap((map) => (
      map.itemDrop ? [map.itemDrop.itemLevel] : []
    )))];
    for (const affix of COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS) {
      if (!affix.stat || !isConfigStat(affix.stat)) continue;
      const descriptor = CONFIG_STAT_DESCRIPTORS[affix.stat];
      expect(descriptor, `${affix.id}:${affix.stat}`).toBeDefined();
      for (const itemLevel of itemLevels) {
        const lower = affix.minAtLevel1 + affix.perLevel * (itemLevel - 1);
        const upper = affix.maxAtLevel1 + affix.perLevel * (itemLevel - 1);
        const quantizedLower = Math.round(Math.min(lower, upper) * 1000);
        const quantizedUpper = Math.round(Math.max(lower, upper) * 1000);
        for (let milliValue = quantizedLower; milliValue <= quantizedUpper; milliValue += 1) {
          const value = milliValue / 1000;
          const totals = affix.mode === 'add_per_level'
            ? { additive: { [affix.stat]: value }, percentage: {} }
            : { additive: {}, percentage: { [affix.stat]: value } };
          for (const configId of matchingConfigIds(descriptor)) {
            expect(
              () => applyStat(descriptor, configId, totals),
              `${affix.id}:L${itemLevel}:${configId}:${value}`,
            ).not.toThrow();
          }
        }
      }
    }
  });

  it('always reapplies from the frozen registry base instead of compounding', () => {
    const totals = { additive: {}, percentage: { 'weapon1.damage': 0.25 } };
    const base = WEAPON_CONFIGS.GLOCK;
    const once = applyCoopDefenseModifiersToWeaponConfig(base, 'weapon1', totals);
    const twice = applyCoopDefenseModifiersToWeaponConfig(once, 'weapon1', totals);
    expect(twice).toEqual(once);
    expect(WEAPON_CONFIGS.GLOCK.damage).toBe(base.damage);
  });

  it('throws in development for fractional integer targets', () => {
    expect(() => applyCoopDefenseModifiersToWeaponConfig(
      WEAPON_CONFIGS.P90,
      'weapon2',
      { additive: { 'weapon.P90.pelletCount': 0.5 }, percentage: {} },
    )).toThrow(/muss ganzzahlig sein/);
  });
});
