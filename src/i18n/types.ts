export type Locale = 'de' | 'en';

export function isLocale(value: unknown): value is Locale {
  return value === 'de' || value === 'en';
}

/**
 * The browser locale is only a first-run hint. Persisted settings are resolved before this
 * function is used by the locale manager.
 */
export function resolveBrowserLocale(browserLocale: string | undefined = typeof navigator === 'undefined'
  ? undefined
  : navigator.language): Locale {
  return typeof browserLocale === 'string' && browserLocale.toLowerCase().startsWith('de') ? 'de' : 'en';
}
