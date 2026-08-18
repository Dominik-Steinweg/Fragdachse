import { describe, expect, it } from 'vitest';
import { getCatalog, getTranslationParityIssues, t } from '../src/i18n';
import { getTranslationKeySources, getTranslationSourceCollisions } from '../src/i18n/catalog';
import { getContentDisplayName, getContentTranslationKeys, getSourceName } from '../src/i18n/contentPresentation';
import { getUpgradePresentationKeys } from '../src/i18n/upgradePresentation';

describe('player locale catalogs', () => {
  it('keeps German and English catalogs structurally identical', () => {
    expect(getTranslationParityIssues()).toEqual([]);
  });

  it('assigns every translation key to exactly one domain source per locale', () => {
    expect(getTranslationSourceCollisions()).toEqual([]);
    for (const locale of ['de', 'en'] as const) {
      const owners = getTranslationKeySources(locale);
      for (const [key, domains] of Object.entries(owners)) {
        expect(domains, `${locale}:${key}`).toHaveLength(1);
      }
    }
  });

  it('has a concrete value for every registered content key in both locales', () => {
    for (const key of getContentTranslationKeys()) {
      expect(getCatalog('de')[key]).toBeTruthy();
      expect(getCatalog('en')[key]).toBeTruthy();
      expect(t(key, { name: 'Test', value: 1, percent: 50 })).not.toContain('⟦');
    }
  });

  it('has a concrete value for every registered upgrade presentation key in both locales', () => {
    for (const key of getUpgradePresentationKeys()) {
      expect(getCatalog('de')[key]).toBeTruthy();
      expect(getCatalog('en')[key]).toBeTruthy();
      if (key.endsWith('.description')) {
        expect(getCatalog('en')[key]).not.toMatch(/^Enhances /);
      }
    }
  });

  it('resolves semantic combat sources locally in either player language', () => {
    expect(getSourceName('weapon.grenade', 'de')).toBe('Granate');
    expect(getSourceName('weapon.grenade', 'en')).toBe('Grenade');
    expect(getSourceName('powerup.NUKE', 'de')).toBe('Atombombe');
    expect(getSourceName('powerup.NUKE', 'en')).toBe('Nuke');
    expect(getSourceName('weapon.grenade:imbued', 'de')).toContain('entzündet');
    expect(getSourceName('weapon.grenade:imbued', 'en')).toContain('imbued');
    expect(getContentDisplayName('ARMOR', 'de')).toBe('Rüstung');
    expect(getContentDisplayName('ARMOR', 'en')).toBe('Armor');
  });
});
