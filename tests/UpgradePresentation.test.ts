import { describe, expect, it } from 'vitest';
import { getCatalog } from '../src/i18n';
import { formatUpgradeEffectValue } from '../src/i18n/format';
import { translateSegments } from '../src/i18n/catalog';
import {
  getUpgradeDescription,
  getUpgradeDescriptionSegments,
} from '../src/i18n/upgradePresentation';
import { getCoopDefenseUpgradeDefinition } from '../src/utils/coopDefenseUpgrades';
import type { CoopDefenseUpgradeEffectDefinition } from '../src/utils/coopDefenseUpgrades';

function effect(
  stat: string,
  value: number,
  mode: CoopDefenseUpgradeEffectDefinition['mode'] = 'add_per_level',
): CoopDefenseUpgradeEffectDefinition {
  return { stat, value, mode };
}

describe('upgrade presentation values', () => {
  it('formats signed percentages and decimals through Intl', () => {
    expect(formatUpgradeEffectValue(effect('player.runSpeed', 0.1, 'add_percent_per_level'), 'de')).toBe('+10 %');
    expect(formatUpgradeEffectValue(effect('player.runSpeed', -0.05, 'add_percent_per_level'), 'en')).toBe('-5 %');
    expect(formatUpgradeEffectValue(effect('player.hpRegenPerSecond', 1.5), 'de')).toBe('+1,5');
    expect(formatUpgradeEffectValue(effect('player.hpRegenPerSecond', 1.5), 'en')).toBe('+1.5');
  });

  it('formats semantic time and pixel units', () => {
    expect(formatUpgradeEffectValue(effect('player.dashGroundFireDurationMs', 1500), 'de')).toBe('+1,5 s');
    expect(formatUpgradeEffectValue(effect('player.dashGroundFireDurationMs', 1500), 'en')).toBe('+1.5 s');
    expect(formatUpgradeEffectValue(effect('weapon.TEST.radius', 24), 'en')).toBe('+24 px');
  });

  it('supports multiple dynamic values in one translated description', () => {
    const english = getUpgradeDescriptionSegments('airstrike_carpet_bombing', 'en');
    const german = getUpgradeDescriptionSegments('airstrike_carpet_bombing', 'de');
    expect(english.filter(({ dynamic }) => dynamic)).toHaveLength(5);
    expect(german.filter(({ dynamic }) => dynamic)).toHaveLength(5);
    expect(english.map(({ text }) => text).join('')).toBe(getUpgradeDescription('airstrike_carpet_bombing', 'en'));

    const reordered = translateSegments('en', 'upgrade.dash_impact.description', {
      value0Absolute: '30',
      value1Absolute: '400',
    });
    expect(reordered.filter(({ dynamic }) => dynamic).map(({ text }) => text)).toEqual(['30', '400']);
  });

  it('marks only resolved placeholders as rich-text dynamics', () => {
    const segments = getUpgradeDescriptionSegments('dash_impact', 'en');
    expect(segments.filter(({ dynamic }) => dynamic).map(({ text }) => text)).toEqual(['30', '400']);
    expect(segments.some(({ text, dynamic }) => !dynamic && text.includes('The dash deals'))).toBe(true);
  });

  it('derives the shown value from the live gameplay definition', () => {
    const definition = getCoopDefenseUpgradeDefinition('hp');
    if (!definition) throw new Error('Missing hp upgrade definition');
    const originalValue = definition.effects[0]?.value;
    if (originalValue === undefined) throw new Error('Missing hp upgrade effect');
    try {
      definition.effects[0].value = 42;
      expect(getUpgradeDescription('hp', 'en')).toContain('+42');
      expect(getUpgradeDescription('hp', 'de')).toContain('+42');
    } finally {
      definition.effects[0].value = originalValue;
    }
  });

  it('keeps upgrade translations free of legacy dummy text and balance literals', () => {
    const legacyEnglish = /Enhances |Schathe|properctile|thegroand|liwith|withe|Dachsbiss|Sekand|Einschießen/;
    for (const locale of ['de', 'en'] as const) {
      for (const [key, value] of Object.entries(getCatalog(locale))) {
        if (!key.startsWith('upgrade.') || !key.endsWith('.description')) continue;
        if (locale === 'en') expect(value, `${locale}:${key}`).not.toMatch(legacyEnglish);
        const withoutPlaceholders = value
          .replace(/\{[^}]+\}/g, '')
          .replace(/\b(?:Weapon|Waffe)[ -]*[12]\b/g, '')
          .replace(/\bP90\b/g, '')
          .replace(/\bAK-47\b/g, '');
        expect(withoutPlaceholders, `${locale}:${key}`).not.toMatch(/\d+(?:[.,]\d+)?/);
      }
    }
  });
});
