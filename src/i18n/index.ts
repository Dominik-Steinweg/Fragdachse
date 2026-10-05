import {
  getCatalog as getCatalogForLocale,
  translate as resolveTranslation,
} from './catalog';
import {
  getStoredLocale,
  setStoredLocale,
} from '../utils/localPreferences';
import { isLocale, resolveBrowserLocale, type Locale } from './types';

export type { Locale } from './types';
export { isLocale, resolveBrowserLocale } from './types';
export {
  clearFormatCache,
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTime,
  formatUpgradeEffectValue,
  getDateTimeFormat,
  getNumberFormat,
} from './format';
export {
  getTranslationKeySources,
  getTranslationParityIssues,
  getTranslationSourceCollisions,
  translateSegments,
} from './catalog';
export type { TranslationSegment } from './catalog';

let activeLocale: Locale = getStoredLocale() ?? resolveBrowserLocale();

/** Resolves a semantic presentation key in the currently selected player language. */
export function t(key: string, params?: Record<string, string | number>): string {
  return resolveTranslation(activeLocale, key, params);
}

export function getLocale(): Locale {
  return activeLocale;
}

export function getCatalog(locale: Locale = activeLocale): Readonly<Record<string, string>> {
  return getCatalogForLocale(locale);
}

export function translate(locale: Locale, key: string, params?: Record<string, string | number>): string {
  return resolveTranslation(locale, key, params);
}

export function setLocale(locale: Locale): void {
  if (!isLocale(locale) || locale === activeLocale) return;
  activeLocale = locale;
  setStoredLocale(locale);
}
