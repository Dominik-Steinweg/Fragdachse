import { getDomainCatalog, getDomainKeys, translate } from './catalog';
import type { Locale } from './types';

function upgradeText(key: string, locale: Locale): string {
  return getDomainCatalog('en', 'upgrades')[key] === undefined ? `⟦${key}⟧` : translate(locale, key);
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
  return upgradeText(`upgrade.${id}.description`, locale);
}

export function getUpgradePresentationKeys(): readonly string[] {
  return getDomainKeys('upgrades');
}
