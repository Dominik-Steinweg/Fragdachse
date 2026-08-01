import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_AFFIX_RULES,
  COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS,
  getCoopDefenseItemAffixDefinition,
} from '../src/config/coopDefenseItems';
import { CoopDefenseItemRuntimeSystem } from '../src/systems/CoopDefenseItemRuntimeSystem';
import { CoopDefensePlayerModifierSystem } from '../src/systems/CoopDefensePlayerModifierSystem';
import { getCoopDefenseItemAffixLines, getCoopDefenseItemStatLines } from '../src/utils/coopDefenseItems';
import {
  COOP_DEFENSE_BASE_CRITICAL_DAMAGE_MULTIPLIER,
  resolveCoopDefenseOutgoingDamage,
} from '../src/utils/coopDefenseStats';
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

describe('Krit-Affixe', () => {
  const always = () => 0;

  it('macht Krit-Chance ohne Klasse und ohne Klassen-Krit nutzbar', () => {
    const totals = { additive: { 'player.criticalChance': 0.25 }, percentage: {} };
    // Ohne Grundwert waere der Multiplikator 1 und der Krit ein normaler Treffer.
    const result = resolveCoopDefenseOutgoingDamage(totals, null, 100, true, always);
    expect(result.isCritical).toBe(true);
    expect(result.amount).toBeCloseTo(100 * COOP_DEFENSE_BASE_CRITICAL_DAMAGE_MULTIPLIER, 10);
  });

  it('addiert Krit-Schaden auf den Multiplikator statt auf den Schaden', () => {
    const totals = {
      additive: { 'player.criticalChance': 0.25, 'player.criticalDamage': 0.5 },
      percentage: {},
    };
    expect(resolveCoopDefenseOutgoingDamage(totals, null, 100, true, always).amount)
      .toBeCloseTo(100 * (COOP_DEFENSE_BASE_CRITICAL_DAMAGE_MULTIPLIER + 0.5), 10);
  });

  it('laesst Krit-Schaden ohne jede Krit-Chance wirkungslos', () => {
    const totals = { additive: { 'player.criticalDamage': 5 }, percentage: {} };
    const result = resolveCoopDefenseOutgoingDamage(totals, null, 100, true, always);
    expect(result.isCritical).toBe(false);
    expect(result.amount).toBe(100);
  });

  it('addiert die Item-Chance auf den Klassenwert und behaelt den hoeheren Klassenmultiplikator', () => {
    const totals = { additive: { 'player.criticalChance': 0.05 }, percentage: {} };
    // Dachs Nukem: 10 % Klassenchance + 5 % aus Items, Klassenmultiplikator 2 schlaegt den Grundwert.
    expect(resolveCoopDefenseOutgoingDamage(totals, 'dachs_nukem', 100, true, () => 0.14).isCritical).toBe(true);
    expect(resolveCoopDefenseOutgoingDamage(totals, 'dachs_nukem', 100, true, () => 0.16).isCritical).toBe(false);
    const critical = resolveCoopDefenseOutgoingDamage(totals, 'dachs_nukem', 100, true, always);
    // Der Klassenschadensmultiplikator wirkt zusaetzlich, deshalb der Vergleich gegen den Nicht-Krit.
    const normal = resolveCoopDefenseOutgoingDamage(totals, 'dachs_nukem', 100, false, always);
    expect(critical.amount).toBeCloseTo(normal.amount * 2, 10);
  });

  it('aendert ohne Krit-Affixe nichts am bisherigen Verhalten', () => {
    const empty = { additive: {}, percentage: {} };
    expect(resolveCoopDefenseOutgoingDamage(empty, 'dachs_of_steel', 100, true, always).isCritical).toBe(false);
    expect(resolveCoopDefenseOutgoingDamage(empty, 'dachs_nukem', 100, true, always).isCritical).toBe(true);
  });
});

describe('Kreuzfeuer', () => {
  function runtime(crossfireValue: number): CoopDefenseItemRuntimeSystem {
    return new CoopDefenseItemRuntimeSystem({
      getAffixValue: (_playerId, affixId) => (affixId === 'crossfire' ? crossfireValue : 0),
      getPlayerHp: () => ({ hp: 70, maxHp: 100 }),
    });
  }

  it('erhoeht nach dem Einsatz von Waffe 2 ausschliesslich den Schaden von Waffe 1', () => {
    const system = runtime(0.15);
    const now = 10_000;
    system.registerWeaponFired('p', 'weapon2', now);

    expect(system.getConditionalOutgoingDamageBonus('p', 'weapon1', now + 1)).toBeCloseTo(0.15, 10);
    expect(system.getConditionalOutgoingDamageBonus('p', 'weapon2', now + 1)).toBe(0);
    expect(system.getConditionalOutgoingDamageBonus('p', 'ultimate', now + 1)).toBe(0);
    // Ohne bekannten Slot – Umgebungs- und Faehigkeitsschaden – bleibt es beim alten Verhalten.
    expect(system.getConditionalOutgoingDamageBonus('p', undefined, now + 1)).toBe(0);
  });

  it('laeuft nach der festgelegten Dauer aus', () => {
    const system = runtime(0.15);
    const now = 10_000;
    system.registerWeaponFired('p', 'weapon2', now);

    const end = now + COOP_DEFENSE_AFFIX_RULES.crossfireDurationMs;
    expect(system.getConditionalOutgoingDamageBonus('p', 'weapon1', end - 1)).toBeCloseTo(0.15, 10);
    expect(system.getConditionalOutgoingDamageBonus('p', 'weapon1', end)).toBe(0);
  });

  it('verlaengert nur die Dauer, statt die Staerke zu stapeln', () => {
    const system = runtime(0.15);
    system.registerWeaponFired('p', 'weapon2', 10_000);
    system.registerWeaponFired('p', 'weapon2', 12_000);

    expect(system.getConditionalOutgoingDamageBonus('p', 'weapon1', 12_001)).toBeCloseTo(0.15, 10);
    expect(system.getConditionalOutgoingDamageBonus(
      'p',
      'weapon1',
      12_000 + COOP_DEFENSE_AFFIX_RULES.crossfireDurationMs,
    )).toBe(0);
  });

  it('oeffnet ohne das Affix und ohne Waffe 2 gar kein Fenster', () => {
    const withoutAffix = runtime(0);
    withoutAffix.registerWeaponFired('p', 'weapon2', 10_000);
    expect(withoutAffix.getConditionalOutgoingDamageBonus('p', 'weapon1', 10_001)).toBe(0);

    const withAffix = runtime(0.15);
    withAffix.registerWeaponFired('p', 'weapon1', 10_000);
    expect(withAffix.getConditionalOutgoingDamageBonus('p', 'weapon1', 10_001)).toBe(0);
  });

  it('addiert sich mit den HP-abhaengigen Boni statt sie zu ersetzen', () => {
    const system = new CoopDefenseItemRuntimeSystem({
      getAffixValue: (_playerId, affixId) => {
        if (affixId === 'crossfire') return 0.15;
        if (affixId === 'high_hp_damage') return 0.1;
        return 0;
      },
      getPlayerHp: () => ({ hp: 100, maxHp: 100 }),
    });
    system.registerWeaponFired('p', 'weapon2', 10_000);
    expect(system.getConditionalOutgoingDamageBonus('p', 'weapon1', 10_001)).toBeCloseTo(0.25, 10);
  });

  it('nimmt das Fenster nicht in die naechste Runde mit', () => {
    const system = runtime(0.15);
    system.registerWeaponFired('p', 'weapon2', 10_000);
    system.clear();
    expect(system.getConditionalOutgoingDamageBonus('p', 'weapon1', 10_001)).toBe(0);

    system.registerWeaponFired('p', 'weapon2', 10_000);
    system.removePlayer('p');
    expect(system.getConditionalOutgoingDamageBonus('p', 'weapon1', 10_001)).toBe(0);
  });
});

describe('Definitionen der Laufzeit-Affixe', () => {
  const runtimeAffixIds = [
    'adrenaline_kill_charge', 'adrenaline_from_damage',
    'primary_vulnerability', 'primary_culling', 'low_hp_blood_rage',
    'primary_kill_fire_chunks', 'primary_slow', 'high_hp_damage',
    'out_of_combat_armor_repair', 'damage_reflection', 'low_hp_speed', 'low_hp_damage_reduction',
    'dash_speed', 'movement_charge_damage', 'crossfire', 'glutwanderer', 'remote_control', 'surrounded',
  ] as const;

  it('umfasst den vollstaendigen Pool aus 40 Affixen', () => {
    expect(COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS).toHaveLength(40);
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

  it('bindet die neuen Affixe an die vorgesehenen Slots und Klassen', () => {
    expect(getCoopDefenseItemAffixDefinition('glutwanderer')?.slots).toEqual(['boots']);
    expect(getCoopDefenseItemAffixDefinition('surrounded')?.slots).toEqual(['armor']);
    expect(getCoopDefenseItemAffixDefinition('remote_control')?.slots).toEqual(['gloves']);
    expect(getCoopDefenseItemAffixDefinition('remote_control')?.classIds).toEqual(['inspector_gadachs']);
  });
});
