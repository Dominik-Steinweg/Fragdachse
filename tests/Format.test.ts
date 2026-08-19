import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearFormatCache,
  formatDate,
  formatDuration,
  formatNumber,
  formatPercent,
  formatTime,
  formatUpgradeEffectValue,
  getDateTimeFormat,
  getNumberFormat,
} from '../src/i18n';
import type { CoopDefenseUpgradeEffectDefinition } from '../src/utils/coopDefenseUpgrades';

describe('i18n number and date formatting with caching', () => {
  beforeEach(() => {
    clearFormatCache();
  });

  describe('formatNumber', () => {
    it('formats basic integers and decimals consistently with Intl.NumberFormat', () => {
      expect(formatNumber(1234.5, 'de')).toBe('1.234,5');
      expect(formatNumber(1234.5, 'en')).toBe('1,234.5');
      expect(formatNumber(0, 'de')).toBe('0');
      expect(formatNumber(-42, 'de')).toBe('-42');
    });

    it('applies custom format options correctly', () => {
      expect(formatNumber(1234.5678, 'de', { maximumFractionDigits: 2 })).toBe('1.234,57');
      expect(formatNumber(1234.5678, 'en', { maximumFractionDigits: 2 })).toBe('1,234.57');
      expect(formatNumber(1234.5, 'de', { useGrouping: false })).toBe('1234,5');
      expect(formatNumber(1234.5, 'en', { useGrouping: false })).toBe('1234.5');
    });

    it('reuses the exact same Intl.NumberFormat instance for identical locale and options', () => {
      const first = getNumberFormat('de');
      const second = getNumberFormat('de');
      expect(first).toBe(second);

      const enFirst = getNumberFormat('en');
      const enSecond = getNumberFormat('en');
      expect(enFirst).toBe(enSecond);
      expect(first).not.toBe(enFirst);
    });

    it('caches separate instances for different options', () => {
      const defaultDe = getNumberFormat('de');
      const withOptions = getNumberFormat('de', { maximumFractionDigits: 1 });
      const noGrouping = getNumberFormat('de', { useGrouping: false });

      expect(defaultDe).not.toBe(withOptions);
      expect(withOptions).not.toBe(noGrouping);
    });

    it('reuses the cached instance regardless of option key order', () => {
      const inst1 = getNumberFormat('de', { maximumFractionDigits: 2, useGrouping: false });
      const inst2 = getNumberFormat('de', { useGrouping: false, maximumFractionDigits: 2 });
      expect(inst1).toBe(inst2);
    });

    it('treats undefined option values identically to omitted options', () => {
      const inst1 = getNumberFormat('de', { maximumFractionDigits: 2 });
      const inst2 = getNumberFormat('de', { maximumFractionDigits: 2, useGrouping: undefined });
      expect(inst1).toBe(inst2);
    });

    it('bounds cache size and does not crash or leak indefinitely under churn', () => {
      // Generate more entries than MAX_FORMAT_CACHE_SIZE (128)
      for (let i = 0; i < 150; i++) {
        const formatted = formatNumber(i, 'de', { minimumFractionDigits: 0, maximumFractionDigits: i % 20 });
        expect(formatted).toBeTruthy();
      }
      // Re-fetching an entry still works seamlessly
      expect(formatNumber(42, 'de')).toBe('42');
    });
  });

  describe('formatPercent', () => {
    it('formats percentages correctly for de and en locales', () => {
      expect(formatPercent(0.25, 'de')).toBe(new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 0 }).format(0.25));
      expect(formatPercent(0.25, 'en')).toBe('25%');
      expect(formatPercent(0.1234, 'de', 2)).toBe(new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 2 }).format(0.1234));
      expect(formatPercent(0.1234, 'en', 2)).toBe('12.34%');
    });

    it('reuses cached instances for repeated percent calls', () => {
      const inst1 = getNumberFormat('de', { style: 'percent', maximumFractionDigits: 0 });
      formatPercent(0.5, 'de');
      const inst2 = getNumberFormat('de', { style: 'percent', maximumFractionDigits: 0 });
      expect(inst1).toBe(inst2);
    });
  });

  describe('formatDate and formatTime', () => {
    const timestamp = Date.UTC(2026, 7, 19, 14, 30, 45); // 2026-08-19 14:30:45 UTC

    it('formats dates consistently in de and en', () => {
      const date = new Date(timestamp);
      const formattedDe = formatDate(date, 'de', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
      const formattedEn = formatDate(date, 'en', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' });
      expect(formattedDe).toBe('19.08.2026');
      expect(formattedEn).toBe('08/19/2026');
    });

    it('formats timestamps directly without requiring Date instance wrapping', () => {
      const formatted = formatDate(timestamp, 'de', { timeZone: 'UTC', year: 'numeric' });
      expect(formatted).toBe('2026');
    });

    it('formats time with default options and custom options', () => {
      const timeStr = formatTime(timestamp, 'de', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit' });
      expect(timeStr).toBe('14:30:45');
    });

    it('reuses DateTimeFormat instances in cache and respects option sorting', () => {
      const inst1 = getDateTimeFormat('de', { hour: '2-digit', minute: '2-digit' });
      const inst2 = getDateTimeFormat('de', { minute: '2-digit', hour: '2-digit' });
      expect(inst1).toBe(inst2);
    });
  });

  describe('formatDuration', () => {
    it('formats durations in mm:ss format', () => {
      expect(formatDuration(0, 'de')).toBe('0:00');
      expect(formatDuration(65, 'de')).toBe('1:05');
      expect(formatDuration(3600, 'en')).toBe('60:00');
      expect(formatDuration(-10, 'de')).toBe('0:00');
    });
  });

  describe('formatUpgradeEffectValue', () => {
    it('formats signed and unsigned upgrade stats', () => {
      const effect: CoopDefenseUpgradeEffectDefinition = {
        stat: 'player.runSpeed',
        value: 0.15,
        mode: 'add_percent_per_level',
      };
      expect(formatUpgradeEffectValue(effect, 'de', 'signed')).toBe('+15 %');
      expect(formatUpgradeEffectValue(effect, 'de', 'unsigned')).toBe('15 %');
      expect(formatUpgradeEffectValue(effect, 'en', 'signed')).toBe('+15 %');
    });
  });
});
