import type { Locale } from './types';
import type { CoopDefenseUpgradeEffectDefinition } from '../utils/coopDefenseUpgrades';

function localeTag(locale: Locale): string {
  return locale === 'de' ? 'de-DE' : 'en-US';
}

export function formatNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(localeTag(locale), options).format(value);
}

export function formatPercent(value: number, locale: Locale, maximumFractionDigits = 0): string {
  return formatNumber(value, locale, { style: 'percent', maximumFractionDigits });
}

export type UpgradeValueSign = 'signed' | 'unsigned';

type UpgradeValueUnit = 'number' | 'percent' | 'seconds' | 'px' | 'degrees';

function formatSigned(value: number, formatted: string, sign: UpgradeValueSign): string {
  if (sign === 'unsigned') return formatted;
  if (value > 0) return `+${formatted}`;
  if (value < 0 && !formatted.startsWith('-')) return `-${formatted}`;
  return formatted;
}

function getUpgradeValueUnit(
  stat: string,
  mode: CoopDefenseUpgradeEffectDefinition['mode'],
  value: number,
): UpgradeValueUnit {
  if (mode === 'add_percent_per_level') return 'percent';

  const normalized = stat.toLowerCase();
  const isAbsolutePerTickValue = /(?:damage|burndamage|healing|heal|repair)pertick$/.test(normalized);
  if (!isAbsolutePerTickValue && Math.abs(value) > 0 && Math.abs(value) < 1) return 'percent';
  if (/(fraction|multiplier|chance|reduction|retention|factor|bonus|slow|threshold)/.test(normalized)) {
    return 'percent';
  }
  if (/(duration|cooldown|interval|delay|lifetime|linger|warmup).*ms$/.test(normalized)) {
    return 'seconds';
  }
  if (/(duration|cooldown|interval|delay|lifetime|linger)$/.test(normalized)) {
    return 'seconds';
  }
  if (/(degrees|angle|spread)/.test(normalized)) return 'degrees';
  if (/(radius|range|offset|distance|cellsize|width|height)/.test(normalized)) return 'px';
  return 'number';
}

function formatUpgradeBaseValue(
  stat: string,
  mode: CoopDefenseUpgradeEffectDefinition['mode'],
  value: number,
  locale: Locale,
): { unit: UpgradeValueUnit; numericValue: number; text: string } {
  const unit = getUpgradeValueUnit(stat, mode, value);
  let numericValue = value;

  // Multiplier fields are stored as the final multiplier when their base config is
  // created by the upgrade. The readable bonus is therefore the distance from 1.
  if (unit === 'percent' && mode === 'add_per_level' && /multiplier$/i.test(stat)) {
    numericValue = value > 1 ? value - 1 : value;
  }

  switch (unit) {
    case 'percent':
      return {
        unit,
        numericValue,
        text: formatNumber(numericValue * 100, locale, {
          maximumFractionDigits: 2,
          useGrouping: false,
        }) + ' %',
      };
    case 'seconds':
      return {
        unit,
        numericValue,
        text: `${formatNumber(numericValue / 1000, locale, {
          maximumFractionDigits: 2,
          useGrouping: false,
        })} s`,
      };
    case 'px':
      return {
        unit,
        numericValue,
        text: `${formatNumber(numericValue, locale, {
          maximumFractionDigits: 2,
          useGrouping: false,
        })} px`,
      };
    case 'degrees':
      return {
        unit,
        numericValue,
        text: `${formatNumber(numericValue, locale, {
          maximumFractionDigits: 2,
          useGrouping: false,
        })}°`,
      };
    case 'number':
    default:
      return {
        unit,
        numericValue,
        text: formatNumber(numericValue, locale, {
          maximumFractionDigits: 2,
          useGrouping: false,
        }),
      };
  }
}

/** Formats an upgrade effect using the semantic unit encoded by its stat path. */
export function formatUpgradeEffectValue(
  effect: CoopDefenseUpgradeEffectDefinition,
  locale: Locale,
  sign: UpgradeValueSign = 'signed',
): string {
  const formatted = formatUpgradeBaseValue(effect.stat, effect.mode, effect.value, locale);
  return formatSigned(formatted.numericValue, formatted.text.replace(/^-/, ''), sign);
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
