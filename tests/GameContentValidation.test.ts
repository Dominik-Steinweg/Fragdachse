import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateResolvedUtility } from '../src/loadout/content/LoadoutSchemas';
import { applyCoopDefenseModifiersToUtilityConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { AUDIO_ASSETS, preloadAllAudio } from '../src/audio/AudioCatalog';
import {
  CONFIG_STAT_DESCRIPTORS,
  getLoadoutModifierTargetContracts,
} from '../src/loadout/CoopDefenseLoadoutModifiers';
import { validateGameContentReferences } from '../src/loadout/content/GameContentValidation';
import {
  DEFAULT_LOADOUT,
  getUtilityConfigLineage,
  LOADOUT_CATALOG_ENTRIES,
  ULTIMATE_CONFIGS,
  UTILITY_CONFIGS,
  WEAPON_CONFIGS,
} from '../src/loadout/content/LoadoutRegistry';
import { COOP_DEFENSE_UPGRADE_DEFINITIONS } from '../src/utils/coopDefenseUpgrades';
import { getUpgradeDescription, getUpgradeName } from '../src/i18n/upgradePresentation';
import { getLoadoutItemName } from '../src/i18n/contentPresentation';

function isConfigStat(stat: string): boolean {
  return stat.startsWith('weapon1.')
    || stat.startsWith('weapon2.')
    || stat === 'utility.cooldown'
    || /^(?:weapon|utility|ultimate)\.[A-Z0-9_]+\./.test(stat);
}

describe('game-wide loadout content validation', () => {
  it.each(['de', 'en'] as const)('resolves all Inspector ultimate text and config-derived values in %s', locale => {
    for (const id of ['HOLO_OFFENSIVE', 'BOMBER_SQUADRON']) {
      expect(getLoadoutItemName(id, locale)).not.toBe(id.replaceAll('_', ' '));
    }
    const nodes = Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)
      .filter(definition => /^(unlock_)?(holo_offensive|bomber_squadron)/.test(definition.id));
    expect(nodes.length).toBeGreaterThan(0);
    for (const { id } of nodes) {
      expect(getUpgradeName(id, locale), id).not.toMatch(/[⟦⟧{}]/);
      const description = getUpgradeDescription(id, locale);
      expect(description.length, id).toBeGreaterThan(0);
      expect(description, id).not.toMatch(/[⟦⟧{}]/);
    }
  });

  it.each(['constructor', 'toString', '__proto__'])('rejects inherited audio-catalog references: %s', successKey => {
    const weapons = { ...WEAPON_CONFIGS, GLOCK: { ...WEAPON_CONFIGS.GLOCK, shotAudio: { successKey } } };
    expect(() => validateGameContentReferences({
      WEAPON_CONFIGS: weapons, UTILITY_CONFIGS, ULTIMATE_CONFIGS,
      DEFAULT_LOADOUT: { ...DEFAULT_LOADOUT, weapon1: weapons[DEFAULT_LOADOUT.weapon1.id], weapon2: weapons[DEFAULT_LOADOUT.weapon2.id] },
      LOADOUT_CATALOG_ENTRIES,
      getUtilityConfigLineage, COOP_DEFENSE_UPGRADE_DEFINITIONS,
    })).toThrow('GLOCK.shotAudio.successKey');
  });

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
    const shippedKeys = new Set<string>();
    preloadAllAudio({ audio: (key: string) => shippedKeys.add(key) } as never);
    const configs = [
      ...Object.values(WEAPON_CONFIGS),
      ...Object.values(UTILITY_CONFIGS),
      ...Object.values(ULTIMATE_CONFIGS),
    ];
    for (const config of configs) {
      for (const key of Object.values(config.shotAudio ?? {})) {
        const assetPath = AUDIO_ASSETS[key as keyof typeof AUDIO_ASSETS];
        expect(assetPath, `${config.id}:${key}`).toBeDefined();
        const exists = existsSync(resolve('public', assetPath.replace(/^\.\//, '')));
        if (!exists && !shippedKeys.has(key)) continue;
        expect(exists, `${config.id}:${assetPath}`).toBe(true);
      }
    }
  });

  it('provides the Armageddon impact sound for normal and void meteors', () => {
    const assetPath = AUDIO_ASSETS.sfx_explosion_armageddon;
    expect(existsSync(resolve('public', assetPath.replace(/^\.\//, ''))), assetPath).toBe(true);
  });

  it('keeps every shipped audio file present with a recognized container header', () => {
    const shipped = new Map<string, string>();
    preloadAllAudio({ audio: (key: string, path: string) => shipped.set(key, path) } as never);
    for (const [key, assetPath] of shipped) {
      const filePath = resolve('public', assetPath.replace(/^\.\//, ''));
      expect(existsSync(filePath), `${key}:${assetPath}`).toBe(true);
      const header = readFileSync(filePath).subarray(0, 4).toString('ascii');
      expect(['OggS', 'RIFF'], `${key}:${assetPath} has unsupported header ${header}`).toContain(header);
    }
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


describe('fire-control content contracts', () => {
  const cases = [
    ['FIRE_CONTROL_RELAY', ['durationMs', 'maxCopies', 'ringRadiusPx', 'materializeMs']],
    ['FIRE_CONTROL_PORTAL', ['durationMs', 'projectileSpeed', 'projectileSize', 'stopSpeedThreshold']],
  ] as const;

  it.each(cases)('validates required positive finite values for %s', (id, fields) => {
    const config = UTILITY_CONFIGS[id];
    expect(validateResolvedUtility(config)).toEqual([]);
    for (const field of fields) {
      for (const invalid of [undefined, '1', 0, -1, NaN, Infinity]) {
        expect(validateResolvedUtility({ ...config, [field]: invalid }), field).not.toEqual([]);
      }
    }
    for (const invalid of [undefined, -1, 0.5, 2, NaN, Infinity]) {
      const flag = id === 'FIRE_CONTROL_RELAY' ? 'parallelEnabled' : 'localFireEnabled';
      expect(validateResolvedUtility({ ...config, [flag]: invalid }), flag).not.toEqual([]);
    }
    expect(validateResolvedUtility({ ...config, durationMs: 0.5 })).not.toEqual([]);
    expect(validateResolvedUtility({ ...config, activation: { type: 'instant' } })).not.toEqual([]);
    expect(validateResolvedUtility({ ...config, maxBounces: 1 })).not.toEqual([]);
    expect(validateResolvedUtility({ ...config, charges: undefined })).not.toEqual([]);
    expect(validateResolvedUtility({ ...config, skipCooldownPublish: false })).not.toEqual([]);
    expect(validateResolvedUtility({ ...config, placeable: {} })).not.toEqual([]);
  });

  it('rejects fractional copy counts and materialization that outlasts the deployment', () => {
    const relay = UTILITY_CONFIGS.FIRE_CONTROL_RELAY;
    if (relay.type !== 'fire_control_relay') throw new Error('Wrong relay type');
    expect(validateResolvedUtility({ ...relay, maxCopies: 1.5 })).not.toEqual([]);
    expect(validateResolvedUtility({ ...relay, materializeMs: 0.5 })).not.toEqual([]);
    expect(validateResolvedUtility({ ...relay, materializeMs: relay.durationMs })).not.toEqual([]);
  });

  it('requires real air deceleration and a nonnegative damage bonus', () => {
    const portal = UTILITY_CONFIGS.FIRE_CONTROL_PORTAL;
    for (const field of ['damageBonus', 'frictionDelayMs', 'bounceFrictionMultiplier']) {
      for (const invalid of [undefined, -1, NaN, Infinity])
        expect(validateResolvedUtility({ ...portal, [field]: invalid }), field).not.toEqual([]);
    }
    for (const invalid of [undefined, 0, 1, -1, NaN, Infinity])
      expect(validateResolvedUtility({ ...portal, airFrictionDecayPerSec: invalid })).not.toEqual([]);
  });

  it.each(cases)('resolves every authored upgrade through descriptors for %s', (id) => {
    const base = UTILITY_CONFIGS[id];
    const upgrades = Object.values(COOP_DEFENSE_UPGRADE_DEFINITIONS)
      .filter(definition => definition.effects.some(effect => effect.stat.startsWith('utility.' + id + '.')));
    expect(upgrades.length).toBeGreaterThan(0);
    const additive: Record<string, number> = {};
    for (const definition of upgrades) {
      for (let level = 1; level <= definition.maxLevel; level++) {
        for (const effect of definition.effects) additive[effect.stat] = effect.value * level;
        const resolved = applyCoopDefenseModifiersToUtilityConfig(base, { additive, percentage: {} });
        expect(validateResolvedUtility(resolved)).toEqual([]);
        for (const [stat, value] of Object.entries(additive)) {
          const field = stat.split('.').at(-1)!;
          expect((resolved as unknown as Record<string, number>)[field]).toBeCloseTo(
            (base as unknown as Record<string, number>)[field] + value);
        }
        expect(resolved.activation).toEqual(base.activation);
        expect(resolved.cooldown).toBe(base.cooldown);
      }
    }
  });
});
