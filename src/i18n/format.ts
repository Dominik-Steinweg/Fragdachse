import type { Locale } from './types';

function localeTag(locale: Locale): string {
  return locale === 'de' ? 'de-DE' : 'en-US';
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(localeTag(locale), options).format(value);
}

export function formatPercent(value: number, locale: Locale, maximumFractionDigits = 0): string {
  return formatNumber(value, locale, { style: 'percent', maximumFractionDigits });
}

export function formatDate(value: Date | number, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat(localeTag(locale), options).format(value);
}

export function formatTime(valueMs: number, locale: Locale, options?: Intl.DateTimeFormatOptions): string {
  return formatDate(new Date(valueMs), locale, options ?? {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDuration(totalSeconds: number, locale: Locale): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  void locale;
  return `${minutes}:${String(remainder).padStart(2, '0')}`;
}
