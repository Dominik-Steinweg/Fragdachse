import {
  getCatalog as getCatalogForLocale,
  getTranslationParityIssues,
  translate as resolveTranslation,
} from './catalog';
import {
  getStoredLocale,
  setStoredLocale,
} from '../utils/localPreferences';
import { formatDate, formatDuration, formatNumber, formatPercent, formatTime } from './format';
import { isLocale, resolveBrowserLocale, type Locale } from './types';

export type { Locale } from './types';
export { isLocale, resolveBrowserLocale } from './types';
export { formatDate, formatDuration, formatNumber, formatPercent, formatTime } from './format';
export {
  getTranslationKeySources,
  getTranslationParityIssues,
  getTranslationSourceCollisions,
} from './catalog';

let activeLocale: Locale = getStoredLocale() ?? resolveBrowserLocale();
const localeListeners = new Set<(locale: Locale) => void>();

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
  for (const listener of localeListeners) listener(locale);
}

export function subscribeLocale(listener: (locale: Locale) => void): () => void {
  localeListeners.add(listener);
  return () => localeListeners.delete(listener);
}
