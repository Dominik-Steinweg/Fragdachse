import {
  getStoredLocale,
  setStoredLocale,
} from '../utils/localPreferences';
import { en } from './catalogs/en';
import { de } from './catalogs/de';
import { getContentTranslation, getContentTranslationKeys } from './contentPresentation';
import { formatDate, formatDuration, formatNumber, formatPercent, formatTime } from './format';
import { isLocale, resolveBrowserLocale, type Locale } from './types';
import {
  getUpgradeCategoryDescription,
  getUpgradeCategoryName,
  getUpgradeDescription,
  getUpgradeName,
  getUpgradePresentationKeys,
} from './upgradePresentation';

export type { Locale } from './types';
export { isLocale, resolveBrowserLocale } from './types';
export { formatDate, formatDuration, formatNumber, formatPercent, formatTime } from './format';

const catalogs: Record<Locale, Record<string, string>> = {
  de: { ...(de as Record<string, string>) },
  en: { ...en },
};
const generatedPresentationKeys = [...getContentTranslationKeys(), ...getUpgradePresentationKeys()];

function getGeneratedTranslation(key: string, locale: Locale): string | undefined {
  const content = getContentTranslation(key, locale);
  if (content !== undefined) return content;
  const categoryName = /^upgradeCategory\.([^.]+)\.name$/.exec(key);
  if (categoryName) return getUpgradeCategoryName(categoryName[1], locale);
  const categoryDescription = /^upgradeCategory\.([^.]+)\.description$/.exec(key);
  if (categoryDescription) return getUpgradeCategoryDescription(categoryDescription[1], locale);
  const upgradeName = /^upgrade\.([^.]+)\.name$/.exec(key);
  if (upgradeName) return getUpgradeName(upgradeName[1], locale);
  const upgradeDescription = /^upgrade\.([^.]+)\.description$/.exec(key);
  if (upgradeDescription) return getUpgradeDescription(upgradeDescription[1], locale);
  return undefined;
}

for (const key of generatedPresentationKeys) {
  const german = getGeneratedTranslation(key, 'de');
  const english = getGeneratedTranslation(key, 'en');
  if (german !== undefined) catalogs.de[key] = german;
  if (english !== undefined) catalogs.en[key] = english;
}
const localeListeners = new Set<(locale: Locale) => void>();
let activeLocale: Locale = getStoredLocale() ?? resolveBrowserLocale();

function interpolate(value: string, params: Record<string, string | number> | undefined): string {
  if (!params) return value;
  return value.replace(/\{([a-zA-Z0-9_]+)\}/g, (match, name: string) => (
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match
  ));
}

/** Resolves a semantic presentation key in the currently selected player language. */
export function t(key: string, params?: Record<string, string | number>): string {
  const value = catalogs[activeLocale][key]
    ?? getGeneratedTranslation(key, activeLocale)
    ?? catalogs.en[key]
    ?? getGeneratedTranslation(key, 'en')
    ?? `⟦${key}⟧`;
  return interpolate(value, params);
}

export function getLocale(): Locale {
  return activeLocale;
}

export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  const value = catalogs[locale][key]
    ?? getGeneratedTranslation(key, locale)
    ?? catalogs.en[key]
    ?? getGeneratedTranslation(key, 'en')
    ?? `⟦${key}⟧`;
  return interpolate(value, params);
}

export function setLocale(locale: Locale): void {
  if (!isLocale(locale) || locale === activeLocale) return;
  activeLocale = locale;
  setStoredLocale(locale);
  for (const listener of localeListeners) listener(locale);
}

export function subscribeLocale(listener: (locale: Locale) => void): () => void {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}

export function getCatalog(locale: Locale = activeLocale): Readonly<Record<string, string>> {
  return catalogs[locale];
}

export function getTranslationParityIssues(): string[] {
  const issues: string[] = [];
  const deKeys = new Set(Object.keys(catalogs.de));
  const enKeys = new Set(Object.keys(catalogs.en));
  for (const key of deKeys) if (!enKeys.has(key)) issues.push(`Missing en key: ${key}`);
  for (const key of enKeys) if (!deKeys.has(key)) issues.push(`Missing de key: ${key}`);
  for (const key of deKeys) {
    const deParams = [...catalogs.de[key].matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
    const enParams = [...(en[key] ?? '').matchAll(/\{([a-zA-Z0-9_]+)\}/g)].map((match) => match[1]).sort();
    if (deParams.join('|') !== enParams.join('|')) issues.push(`Parameter mismatch: ${key}`);
  }
  return issues;
}
