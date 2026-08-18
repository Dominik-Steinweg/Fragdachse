import { getDomainCatalog, getDomainKeys, translate, translateSegments, type TranslationSegment } from './catalog';
import { formatNumber, formatUpgradeEffectValue } from './format';
import type { Locale } from './types';
import { getCoopDefenseUpgradeDefinition, type CoopDefenseUpgradeDefinition } from '../utils/coopDefenseUpgrades';
import {
  COOP_DEFENSE_CONSTRUCTION_BASE_SLOTS,
  COOP_DEFENSE_CONSTRUCTION_MAX_SLOTS,
  COOP_DEFENSE_CONSTRUCTIONS,
  COOP_DEFENSE_REPAIR_DRONE_CONFIG,
  COOP_DEFENSE_UTILITY_CAPACITY_COSTS,
} from '../config/coopDefenseConstructions';

function upgradeText(key: string, locale: Locale): string {
  return getDomainCatalog('en', 'upgrades')[key] === undefined ? `⟦${key}⟧` : translate(locale, key);
}

function getUpgradeParams(
  definition: CoopDefenseUpgradeDefinition,
  locale: Locale,
): Record<string, string | number> {
  const params: Record<string, string | number> = {
    maxLevel: formatNumber(definition.maxLevel, locale, { useGrouping: false }),
  };
  definition.effects.forEach((effect, index) => {
    params[`value${index}`] = formatUpgradeEffectValue(effect, locale);
    params[`value${index}Unsigned`] = formatUpgradeEffectValue(effect, locale, 'unsigned');
    params[`value${index}Absolute`] = formatUpgradeEffectValue(
      { ...effect, value: Math.abs(effect.value) },
      locale,
      'unsigned',
    );
    params[`maxValue${index}`] = formatUpgradeEffectValue(
      { ...effect, value: effect.value * definition.maxLevel },
      locale,
      'unsigned',
    );
  });

  if (definition.id === 'inspector_construction_slots') {
    params.baseSlots = formatNumber(COOP_DEFENSE_CONSTRUCTION_BASE_SLOTS, locale, { useGrouping: false });
    params.maxSlots = formatNumber(COOP_DEFENSE_CONSTRUCTION_MAX_SLOTS, locale, { useGrouping: false });
  }
  if (definition.id === 'inspector_repair_drone') {
    params.repairPerSecond = formatNumber(COOP_DEFENSE_REPAIR_DRONE_CONFIG.repairPerSecond, locale, { useGrouping: false });
  }

  const constructionId = definition.id.replace(/^unlock_/, '');
  const construction = COOP_DEFENSE_CONSTRUCTIONS[constructionId as keyof typeof COOP_DEFENSE_CONSTRUCTIONS];
  if (construction) {
    params.capacity = formatNumber(construction.capacityCost, locale, { useGrouping: false });
  }
  const utilityCapacity = COOP_DEFENSE_UTILITY_CAPACITY_COSTS[definition.loadoutUnlock?.itemId ?? ''];
  if (utilityCapacity !== undefined) {
    params.capacity = formatNumber(utilityCapacity, locale, { useGrouping: false });
  }
  return params;
}

export function getUpgradeCategoryName(id: string, locale: Locale): string {
  return upgradeText(`upgradeCategory.${id}.name`, locale);
}

export function getUpgradeCategoryDescription(id: string, locale: Locale): string {
  return upgradeText(`upgradeCategory.${id}.description`, locale);
}

export function getUpgradeName(id: string, locale: Locale): string {
  return upgradeText(`upgrade.${id}.name`, locale);
}

export function getUpgradeDescription(id: string, locale: Locale): string {
  return getUpgradeDescriptionSegments(id, locale).map((segment) => segment.text).join('');
}

export function getUpgradeDescriptionSegments(id: string, locale: Locale): readonly TranslationSegment[] {
  const definition = getCoopDefenseUpgradeDefinition(id);
  return translateSegments(
    locale,
    `upgrade.${id}.description`,
    definition ? getUpgradeParams(definition, locale) : undefined,
  );
}

export function getUpgradePresentationKeys(): readonly string[] {
  return getDomainKeys('upgrades');
}
