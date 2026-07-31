import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_AFFIX_RULES,
  COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS,
  getCoopDefenseItemAffixDefinition,
} from '../src/config/coopDefenseItems';
import { CoopDefensePlayerModifierSystem } from '../src/systems/CoopDefensePlayerModifierSystem';
import { getCoopDefenseItemAffixLines, getCoopDefenseItemStatLines } from '../src/utils/coopDefenseItems';
import { resolveCoopDefenseOutgoingDamage } from '../src/utils/coopDefenseStats';
import { buildDefaultCoopDefenseUpgradeProfile } from '../src/utils/coopDefenseUpgrades';
import type { CoopDefenseItem, LoadoutCommitSnapshot } from '../src/types';

function item(overrides: Partial<CoopDefenseItem> = {}): CoopDefenseItem {
  return {
    uid: 'it_test',
    slot: 'armor',
    rarity: 'white',
    itemLevel: 1,
    baseValue: 0,
    affixes: [],
    ...overrides,
  };
}

function commit(equippedItems: readonly CoopDefenseItem[]): LoadoutCommitSnapshot {
  return {
    weapon1: 'GLOCK',
    weapon2: 'P90',
    utility: 'FELSEN',
    ultimate: 'GAUSS',
    coopDefenseClassId: null,
    coopDefenseProfile: buildDefaultCoopDefenseUpgradeProfile(),
    equippedItems,
  };
}

describe('Zugriff auf gewuerfelte Affixwerte', () => {
  it('summiert dasselbe Affix ueber mehrere Ausruestungsteile', () => {
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('p', commit([
      item({ uid: 'helm', slot: 'helmet', affixes: [{ affixId: 'adrenaline_from_damage', value: 0.07 }] }),
      item({ uid: 'brust', slot: 'armor', affixes: [{ affixId: 'adrenaline_from_damage', value: 0.09 }] }),
    ]));

    // Das Beispiel aus dem Entwurf: 7 % + 9 % = 16 %.
    expect(system.getItemAffixValue('p', 'adrenaline_from_damage')).toBeCloseTo(0.16, 10);
    expect(system.hasItemAffix('p', 'adrenaline_from_damage')).toBe(true);
  });

  it('meldet ein nicht getragenes Affix als null', () => {
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('p', commit([item({ affixes: [{ affixId: 'max_hp', value: 20 }] })]));
    expect(system.getItemAffixValue('p', 'primary_culling')).toBe(0);
    expect(system.hasItemAffix('p', 'primary_culling')).toBe(false);
    // Auch fuer einen voellig unbekannten Spieler.
    expect(system.getItemAffixValue('fremd', 'max_hp')).toBe(0);
  });

  it('vergisst die Affixwerte beim Zuruecksetzen', () => {
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('p', commit([item({ affixes: [{ affixId: 'max_hp', value: 20 }] })]));
    system.clear();
    expect(system.getItemAffixValue('p', 'max_hp')).toBe(0);
  });
});

describe('Bedingter Schadensbonus im gemeinsamen Bucket', () => {
  const empty = { additive: {}, percentage: {} };

  it('addiert sich auf den prozentualen Bucket statt sich zu verketten', () => {
    const totals = { additive: {}, percentage: { 'player.outgoingDamage': 0.05 } };
    // 5 % aus dem Bucket + 10 % bedingt = x1.15, nicht x1.05 * x1.10.
    expect(resolveCoopDefenseOutgoingDamage(totals, null, 100, false, Math.random, 0.1).amount)
      .toBeCloseTo(115, 10);
  });

  it('verhaelt sich ohne Zuschlag exakt wie zuvor', () => {
    expect(resolveCoopDefenseOutgoingDamage(empty, null, 100, false).amount).toBe(100);
    expect(resolveCoopDefenseOutgoingDamage(empty, null, 100, false, Math.random, 0).amount).toBe(100);
  });
});

describe('Definitionen der Laufzeit-Affixe', () => {
  const runtimeAffixIds = [
    'adrenaline_kill_charge', 'adrenaline_from_damage',
    'primary_vulnerability', 'primary_culling', 'low_hp_blood_rage',
    'primary_kill_fire_chunks', 'primary_slow', 'high_hp_damage',
    'out_of_combat_armor_repair', 'damage_reflection', 'low_hp_speed', 'low_hp_damage_reduction',
    'dash_speed', 'movement_charge_damage',
  ] as const;

  it('umfasst den vollstaendigen Pool aus 32 Affixen', () => {
    expect(COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS).toHaveLength(32);
    // Versorgungsmunition ist bewusst zurueckgestellt und darf nicht rollen.
    expect(getCoopDefenseItemAffixDefinition('primary_ally_heal')).toBeUndefined();
  });

  it('traegt fuer jedes Laufzeit-Affix eine Erklaerung und keinen Stat', () => {
    for (const affixId of runtimeAffixIds) {
      const definition = getCoopDefenseItemAffixDefinition(affixId);
      expect(definition, affixId).toBeDefined();
      // Ohne Stat schreiben sie in keinen Bucket – ihre Wirkung kommt vom Laufzeitsystem.
      expect(definition?.stat, affixId).toBeUndefined();
      expect(definition?.mode, affixId).toBeUndefined();
      expect(definition?.weight, affixId).toBeGreaterThan(0);
      expect(definition?.shortText, affixId).toBeTypeOf('function');
      expect(definition?.shortText?.(definition.maxAtLevel1).length, affixId).toBeGreaterThan(10);
    }
  });

  it('erklaert statlose Affixe im UI, statt sie zu verschlucken', () => {
    const gloves = item({
      slot: 'gloves',
      rarity: 'yellow',
      baseValue: 0.08,
      affixes: [
        { affixId: 'outgoing_damage', value: 0.05 },
        { affixId: 'primary_vulnerability', value: 0.032 },
      ],
    });

    // Der Zahlenpfad kennt nur den Grundwert und das Stat-Affix …
    expect(getCoopDefenseItemStatLines(gloves).map((line) => line.stat))
      .toEqual(['player.outgoingDamage', 'player.outgoingDamage']);
    // … das statlose Affix erscheint stattdessen mit vollstaendiger Erklaerung.
    const affixLines = getCoopDefenseItemAffixLines(gloves);
    expect(affixLines).toHaveLength(1);
    expect(affixLines[0].affixId).toBe('primary_vulnerability');
    expect(affixLines[0].text).toContain('3,2 %');
    expect(affixLines[0].text).toContain('20 %');
  });

  it('liest feste Parameter aus derselben Quelle wie das Laufzeitsystem', () => {
    // Sonst koennten Tooltip-Text und tatsaechliches Verhalten auseinanderlaufen.
    const text = getCoopDefenseItemAffixDefinition('primary_slow')?.shortText?.(0.1) ?? '';
    expect(text).toContain(`${COOP_DEFENSE_AFFIX_RULES.suppressionSlowFraction * 100} %`);
    expect(text).toContain(`${COOP_DEFENSE_AFFIX_RULES.suppressionSlowDurationMs / 1000} s`);
  });
});
