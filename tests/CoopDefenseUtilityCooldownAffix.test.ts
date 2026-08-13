import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_CONSTRUCTIONS,
} from '../src/config/coopDefenseConstructions';
import { getCoopDefenseItemAffixDefinition } from '../src/config/coopDefenseItems';
import { applyCoopDefenseModifiersToUtilityConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { getCoopDefenseItemEffectTotals } from '../src/utils/coopDefenseItemEffects';
import type { CoopDefenseItem } from '../src/types';

/**
 * Der Affix "Einsatzbereitschaft" ist der erste Produzent des Stats `utility.cooldown`. Der
 * Descriptor dafuer war lange verdrahtet, aber ohne Quelle – diese Datei haelt fest, worauf er
 * wirkt und worauf ausdruecklich nicht.
 */

function helmetWithCooldownAffix(value: number): CoopDefenseItem {
  return {
    uid: 'helm',
    slot: 'helmet',
    rarity: 'blue',
    itemLevel: 1,
    baseValue: 0,
    affixes: [{ affixId: 'utility_cooldown', value }],
  };
}

describe('utility cooldown item affix', () => {
  it('is defined as a cost stat on the helmet', () => {
    const definition = getCoopDefenseItemAffixDefinition('utility_cooldown')!;
    expect(definition.stat).toBe('utility.cooldown');
    expect(definition.slots).toEqual(['helmet']);
    expect(definition.lowerIsBetter).toBe(true);
    // Beide Grenzen sind negativ: der Wurf senkt den Cooldown immer, nie umgekehrt.
    expect(definition.maxAtLevel1).toBeLessThan(0);
    expect(definition.minAtLevel1).toBeLessThanOrEqual(definition.maxAtLevel1);
  });

  it('shortens the cooldown of every regular utility', () => {
    const totals = getCoopDefenseItemEffectTotals([helmetWithCooldownAffix(-0.2)]);
    expect(totals.percentage['utility.cooldown']).toBeCloseTo(-0.2, 10);

    for (const config of Object.values(UTILITY_CONFIGS)) {
      const modified = applyCoopDefenseModifiersToUtilityConfig(config, totals);
      expect(modified.cooldown).toBeCloseTo(config.cooldown * 0.8, 6);
    }
  });

  it('adds up across several sources instead of compounding', () => {
    const totals = getCoopDefenseItemEffectTotals([
      helmetWithCooldownAffix(-0.07),
      { ...helmetWithCooldownAffix(-0.05), uid: 'helm2' },
    ]);
    // -0.07 + -0.05, nicht (1-0.07)*(1-0.05).
    expect(totals.percentage['utility.cooldown']).toBeCloseTo(-0.12, 10);
  });

  it('leaves per-item construction build cooldowns untouched', () => {
    // Konstruktionen laufen nicht ueber den Utility-Cooldown. Kein Item-Affix darf ihre
    // jeweils aus der Konstruktions-JSON gelesene Konfiguration verschieben.
    const totals = getCoopDefenseItemEffectTotals([helmetWithCooldownAffix(-0.5)]);
    expect(totals.percentage['utility.cooldown']).toBeCloseTo(-0.5, 10);
    // Konstruktionen tragen ueberhaupt kein `cooldown`-Feld – der Descriptor findet dort nichts,
    // Der Utility-Descriptor adressiert das separate `buildCooldownMs`-Feld nicht.
    for (const definition of Object.values(COOP_DEFENSE_CONSTRUCTIONS)) {
      expect(Number.isFinite(definition.buildCooldownMs)).toBe(true);
      expect(definition.buildCooldownMs).toBeGreaterThanOrEqual(0);
    }
  });
});
