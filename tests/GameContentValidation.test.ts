import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIO_ASSETS } from '../src/audio/AudioCatalog';
import {
  CONFIG_STAT_DESCRIPTORS,
  getLoadoutModifierTargetContracts,
} from '../src/loadout/CoopDefenseLoadoutModifiers';
import { validateGameContentReferences } from '../src/loadout/content/GameContentValidation';
import {
  LOADOUT_CATALOG_ENTRIES,
  ULTIMATE_CONFIGS,
  UTILITY_CONFIGS,
  WEAPON_CONFIGS,
} from '../src/loadout/content/LoadoutRegistry';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS } from '../src/utils/coopDefenseUpgrades';
import { getUpgradeName } from '../src/i18n/upgradePresentation';

function isConfigStat(stat: string): boolean {
  return stat.startsWith('weapon1.')
    || stat.startsWith('weapon2.')
    || stat === 'utility.cooldown'
    || /^(?:weapon|utility|ultimate)\.[A-Z0-9_]+\./.test(stat);
}

describe('game-wide loadout content validation', () => {
  it('accepts every shipped cross-content reference', () => {
    expect(() => validateGameContentReferences()).not.toThrow();
  });

  it('has a real file for every declared loadout icon', () => {
    for (const entry of LOADOUT_CATALOG_ENTRIES) {
      if (entry.iconKey === null) continue;
      expect(
        existsSync(resolve('public/assets/sprites/Loadout', `${entry.iconKey}.png`)),
        `${entry.slot}:${entry.id} -> ${entry.iconKey}`,
      ).toBe(true);
    }
  });

  it('has an audio-catalog entry and file for every referenced shot sound', () => {
    const configs = [
      ...Object.values(WEAPON_CONFIGS),
      ...Object.values(UTILITY_CONFIGS),
      ...Object.values(ULTIMATE_CONFIGS),
    ];
    for (const config of configs) {
      for (const key of Object.values(config.shotAudio ?? {})) {
        const assetPath = AUDIO_ASSETS[key as keyof typeof AUDIO_ASSETS];
        expect(assetPath, `${config.id}:${key}`).toBeDefined();
        expect(existsSync(resolve('public', assetPath.replace(/^\.\//, ''))), `${config.id}:${assetPath}`).toBe(true);
      }
    }
  });

  it('provides the Armageddon impact sound for normal and void meteors', () => {
    const assetPath = AUDIO_ASSETS.sfx_explosion_armageddon;
    expect(existsSync(resolve('public', assetPath.replace(/^\.\//, ''))), assetPath).toBe(true);
  });

  it('gives every loadout upgrade effect an explicit compatible descriptor', () => {
    const contracts = getLoadoutModifierTargetContracts();
    for (const upgrade of Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)) {
      for (const effect of upgrade.effects) {
        if (!isConfigStat(effect.stat)) continue;
        expect(CONFIG_STAT_DESCRIPTORS[effect.stat], `${upgrade.id}:${effect.stat}`).toBeDefined();
        const requiredOperation = effect.mode === 'add_per_level' ? 'additive' : 'percentage';
        expect(contracts[effect.stat]?.every((contract) => contract.operations.includes(requiredOperation)), `${upgrade.id}:${effect.stat}`).toBe(true);
      }
    }
  });

  it('keeps representative German upgrade labels intact', () => {
    expect(getUpgradeName('hp', 'de')).toBe('Vitalität');
    expect(getUpgradeName('max_armor', 'de')).toBe('Rüstungsmaximum');
  });

  it('publishes finite, bounded contracts for every modifier target', () => {
    for (const [stat, contracts] of Object.entries(getLoadoutModifierTargetContracts())) {
      expect(contracts.length, stat).toBeGreaterThan(0);
      for (const contract of contracts) {
        expect(contract.path.length, stat).toBeGreaterThan(0);
        expect(contract.minimum, stat).toBe(0);
        expect(Number.isInteger(contract.stage), stat).toBe(true);
        expect(contract.operations.length, stat).toBeGreaterThan(0);
      }
    }
  });
});
