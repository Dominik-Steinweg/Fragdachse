import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS,
  COOP_DEFENSE_ITEM_OFFER_SIZE,
  COOP_DEFENSE_ITEM_RARITY_DEFINITIONS,
  COOP_DEFENSE_ITEM_SLOTS,
  COOP_DEFENSE_ITEM_SLOT_DEFINITIONS,
  COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT,
  getCoopDefenseItemAffixDefinition,
} from '../src/config/coopDefenseItems';
import {
  addCoopDefenseItem,
  compareCoopDefenseItems,
  formatCoopDefenseItemValue,
  getCoopDefenseItemAffixIdsForSlot,
  getCoopDefenseItemSalvageXp,
  getCoopDefenseItemStatLines,
  getCoopDefenseStashItems,
  getFreeCoopDefenseStashSlots,
  isCoopDefenseItemImprovement,
  rollCoopDefenseItem,
  rollCoopDefenseItemOffer,
  sanitizeCoopDefenseEquippedItemIds,
  sanitizeCoopDefenseItem,
  sanitizeCoopDefenseItems,
  sanitizeCoopDefensePendingItemReward,
  sortCoopDefenseItems,
  type CoopDefenseEquippedItemIds,
} from '../src/utils/coopDefenseItems';
import { getCoopDefenseItemEffectTotals, mergeCoopDefenseEffectTotals } from '../src/utils/coopDefenseItemEffects';
import type { CoopDefenseItem, CoopDefenseItemSlot } from '../src/types';

/** Deterministischer Ersatz für Math.random: zyklisch über die übergebenen Werte. */
function sequence(values: readonly number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

function item(overrides: Partial<CoopDefenseItem> = {}): CoopDefenseItem {
  return {
    uid: 'it_test',
    slot: 'armor',
    rarity: 'white',
    itemLevel: 1,
    baseValue: 25,
    affixes: [],
    ...overrides,
  };
}

describe('coop-defense item rolls', () => {
  it('derives the affix count from the rarity alone', () => {
    for (const slot of COOP_DEFENSE_ITEM_SLOTS) {
      for (const random of [sequence([0]), sequence([0.6]), sequence([0.95])]) {
        const rolled = rollCoopDefenseItem(slot, 1, random);
        expect(rolled.affixes).toHaveLength(
          COOP_DEFENSE_ITEM_RARITY_DEFINITIONS[rolled.rarity].affixCount,
        );
      }
    }
  });

  it('never repeats an affix and only uses the category pool', () => {
    for (const slot of COOP_DEFENSE_ITEM_SLOTS) {
      const allowed = new Set(getCoopDefenseItemAffixIdsForSlot(slot));
      for (let seed = 0; seed < 40; seed++) {
        const random = sequence([
          (seed * 7 % 100) / 100,
          (seed * 13 % 100) / 100,
          (seed * 29 % 100) / 100,
          (seed * 41 % 100) / 100,
        ]);
        const rolled = rollCoopDefenseItem(slot, 3, random);
        const ids = rolled.affixes.map((affix) => affix.affixId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(allowed.has(id)).toBe(true);
      }
    }
  });

  it('offers three items from three different categories', () => {
    for (let seed = 0; seed < 30; seed++) {
      const offer = rollCoopDefenseItemOffer(2, sequence([
        (seed * 11 % 100) / 100,
        (seed * 23 % 100) / 100,
        (seed * 37 % 100) / 100,
      ]));
      expect(offer).toHaveLength(COOP_DEFENSE_ITEM_OFFER_SIZE);
      expect(new Set(offer.map((entry) => entry.slot)).size).toBe(COOP_DEFENSE_ITEM_OFFER_SIZE);
      expect(new Set(offer.map((entry) => entry.uid)).size).toBe(COOP_DEFENSE_ITEM_OFFER_SIZE);
    }
  });

  it('scales the base value with the item level while keeping the spread', () => {
    for (const slot of COOP_DEFENSE_ITEM_SLOTS) {
      const definition = COOP_DEFENSE_ITEM_SLOT_DEFINITIONS[slot];
      // Gleicher Wurf, unterschiedliches Item-Level: der Nominalwert steigt monoton.
      const low = rollCoopDefenseItem(slot, 1, sequence([0.5])).baseValue;
      const high = rollCoopDefenseItem(slot, 4, sequence([0.5])).baseValue;
      expect(high).toBeGreaterThan(low);

      // Ein schlechter Wurf auf hohem Level darf einen guten Wurf auf niedrigem Level
      // unterbieten - genau das haelt alte Items relevant.
      const bestLow = rollCoopDefenseItem(slot, 2, sequence([1])).baseValue;
      const worstHigh = rollCoopDefenseItem(slot, 2, sequence([0])).baseValue;
      expect(bestLow).toBeGreaterThan(worstHigh);
      expect(worstHigh).toBeGreaterThan(0);
      expect(definition.baseValueSpread).toBeGreaterThan(0);
    }
  });

  it('scales affix ranges with the item level', () => {
    for (const definition of COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS) {
      expect(definition.minAtLevel1).toBeLessThanOrEqual(definition.maxAtLevel1);
      expect(definition.maxTotalFromItems).toBeGreaterThan(0);
      expect(definition.slots.length).toBeGreaterThan(0);
    }
  });

  it('keeps every affix pool large enough for a yellow item', () => {
    for (const slot of COOP_DEFENSE_ITEM_SLOTS) {
      expect(getCoopDefenseItemAffixIdsForSlot(slot).length).toBeGreaterThanOrEqual(
        COOP_DEFENSE_ITEM_RARITY_DEFINITIONS.yellow.affixCount,
      );
    }
  });
});

describe('coop-defense item effect totals', () => {
  it('writes the category base value and the affixes into the shared buckets', () => {
    const gloves = item({
      uid: 'g1',
      slot: 'gloves',
      rarity: 'blue',
      baseValue: 0.08,
      affixes: [{ affixId: 'life_leech', value: 0.02 }],
    });
    const totals = getCoopDefenseItemEffectTotals([gloves]);

    expect(totals.percentage['player.outgoingDamage']).toBeCloseTo(0.08, 10);
    expect(totals.additive['player.lifeLeechFraction']).toBeCloseTo(0.02, 10);
  });

  it('sums two items on the same stat instead of compounding', () => {
    const boots = item({ uid: 'b1', slot: 'boots', baseValue: 0.05 });
    const moreBoots = item({
      uid: 'b2',
      slot: 'boots',
      rarity: 'blue',
      baseValue: 0.04,
      affixes: [{ affixId: 'max_hp', value: 20 }],
    });
    const totals = getCoopDefenseItemEffectTotals([boots, moreBoots]);

    expect(totals.percentage['player.runSpeed']).toBeCloseTo(0.09, 10);
    expect(totals.additive['player.maxHp']).toBe(20);
  });

  it('caps a stat at the configured item ceiling', () => {
    const cap = getCoopDefenseItemAffixDefinition('run_speed')!.maxTotalFromItems;
    const overloaded = Array.from({ length: 8 }, (_, index) => item({
      uid: `b${index}`,
      slot: 'boots',
      baseValue: 0.05,
    }));
    expect(getCoopDefenseItemEffectTotals(overloaded).percentage['player.runSpeed']).toBe(cap);
  });

  it('caps negative affixes by magnitude', () => {
    const cap = getCoopDefenseItemAffixDefinition('adrenaline_cost')!.maxTotalFromItems;
    const helmets = Array.from({ length: 12 }, (_, index) => item({
      uid: `h${index}`,
      slot: 'helmet',
      rarity: 'blue',
      baseValue: 0.06,
      affixes: [{ affixId: 'adrenaline_cost', value: -0.08 }],
    }));
    expect(getCoopDefenseItemEffectTotals(helmets).percentage['player.adrenalineCost']).toBe(-cap);
  });

  it('returns the untouched source when only one contributes', () => {
    const totals = getCoopDefenseItemEffectTotals([item({ slot: 'armor', baseValue: 25 })]);
    const upgrades = { additive: {}, percentage: {} };
    expect(mergeCoopDefenseEffectTotals(upgrades, totals)).toBe(totals);
  });

  it('merges upgrade and item buckets additively', () => {
    const upgrades = { additive: { 'player.maxHp': 60 }, percentage: { 'player.runSpeed': 0.15 } };
    const items = getCoopDefenseItemEffectTotals([
      item({ uid: 'a1', slot: 'armor', baseValue: 25 }),
      item({ uid: 'b1', slot: 'boots', baseValue: 0.05 }),
    ]);
    const merged = mergeCoopDefenseEffectTotals(upgrades, items);

    expect(merged.additive['player.maxHp']).toBe(85);
    expect(merged.percentage['player.runSpeed']).toBeCloseTo(0.2, 10);
  });
});

describe('coop-defense item inventory', () => {
  const equipped: CoopDefenseEquippedItemIds = { armor: 'equipped-armor' };

  it('excludes the equipped item from the category limit', () => {
    const items = [
      item({ uid: 'equipped-armor', slot: 'armor' }),
      ...Array.from({ length: COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT }, (_, index) => item({
        uid: `stash-${index}`,
        slot: 'armor',
      })),
    ];

    expect(getCoopDefenseStashItems(items, equipped, 'armor')).toHaveLength(
      COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT,
    );
    expect(getFreeCoopDefenseStashSlots(items, equipped, 'armor')).toBe(0);
    expect(getFreeCoopDefenseStashSlots(items, equipped, 'boots')).toBe(
      COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT,
    );
  });

  it('assigns a fresh uid when one collides', () => {
    const items = [item({ uid: 'dup' })];
    const grown = addCoopDefenseItem(items, item({ uid: 'dup' }));
    expect(grown).toHaveLength(2);
    expect(new Set(grown.map((entry) => entry.uid)).size).toBe(2);
  });

  it('sorts by rarity and item level', () => {
    const items = [
      item({ uid: 'a', rarity: 'white', itemLevel: 3 }),
      item({ uid: 'b', rarity: 'yellow', itemLevel: 1 }),
      item({ uid: 'c', rarity: 'blue', itemLevel: 2 }),
    ];
    expect(sortCoopDefenseItems(items, 'rarity').map((entry) => entry.uid)).toEqual(['b', 'c', 'a']);
    expect(sortCoopDefenseItems(items, 'itemLevel').map((entry) => entry.uid)).toEqual(['a', 'c', 'b']);
  });

  it('grants more salvage xp for higher rarity and level, but stays a minor source', () => {
    const white = getCoopDefenseItemSalvageXp(item({ rarity: 'white', itemLevel: 1 }));
    const blue = getCoopDefenseItemSalvageXp(item({ rarity: 'blue', itemLevel: 1 }));
    const yellow = getCoopDefenseItemSalvageXp(item({ rarity: 'yellow', itemLevel: 1 }));
    const yellowHigh = getCoopDefenseItemSalvageXp(item({ rarity: 'yellow', itemLevel: 5 }));

    expect(white).toBeLessThan(blue);
    expect(blue).toBeLessThan(yellow);
    expect(yellow).toBeLessThan(yellowHigh);
    // Ein einzelner Bossgegner bringt 100-400 XP; Zerlegen darf das nicht ersetzen.
    expect(yellowHigh).toBeLessThan(100);
  });
});

describe('coop-defense item presentation', () => {
  it('lists the base stat first and every known affix afterwards', () => {
    const lines = getCoopDefenseItemStatLines(item({
      slot: 'boots',
      rarity: 'yellow',
      baseValue: 0.05,
      affixes: [{ affixId: 'max_hp', value: 20 }, { affixId: 'dash_range', value: 0.06 }],
    }));

    expect(lines[0]).toMatchObject({ stat: 'player.runSpeed', isBaseStat: true });
    expect(lines.map((line) => line.stat)).toEqual([
      'player.runSpeed',
      'player.maxHp',
      'player.dashRange',
    ]);
  });

  it('compares against the equipped item and reports the delta per stat', () => {
    const candidate = item({
      uid: 'new',
      slot: 'armor',
      rarity: 'blue',
      baseValue: 30,
      affixes: [{ affixId: 'max_armor', value: 20 }],
    });
    const equipped = item({ uid: 'old', slot: 'armor', baseValue: 22 });
    const rows = compareCoopDefenseItems(candidate, equipped);

    expect(rows.find((row) => row.stat === 'player.maxHp')).toMatchObject({
      candidateValue: 30,
      equippedValue: 22,
      delta: 8,
    });
    expect(rows.find((row) => row.stat === 'player.maxArmor')).toMatchObject({
      candidateValue: 20,
      equippedValue: 0,
      delta: 20,
    });
  });

  it('compares against an empty slot', () => {
    const rows = compareCoopDefenseItems(item({ slot: 'armor', baseValue: 25 }), null);
    expect(rows).toHaveLength(1);
    expect(rows[0].equippedValue).toBe(0);
  });

  it('rates a falling cost stat as an improvement', () => {
    expect(isCoopDefenseItemImprovement('player.adrenalineCost', -0.05)).toBe(true);
    expect(isCoopDefenseItemImprovement('player.adrenalineCost', 0.05)).toBe(false);
    expect(isCoopDefenseItemImprovement('player.maxHp', 8)).toBe(true);
    expect(isCoopDefenseItemImprovement('player.maxHp', -8)).toBe(false);
  });

  it('formats percent and flat values with a sign', () => {
    expect(formatCoopDefenseItemValue(0.085, true)).toBe('+8.5 %');
    expect(formatCoopDefenseItemValue(-0.05, true)).toBe('-5 %');
    expect(formatCoopDefenseItemValue(25, false)).toBe('+25');
  });
});

describe('coop-defense item sanitising', () => {
  it('rejects structurally invalid items', () => {
    expect(sanitizeCoopDefenseItem(null)).toBeNull();
    expect(sanitizeCoopDefenseItem({ uid: '', slot: 'armor', rarity: 'white' })).toBeNull();
    expect(sanitizeCoopDefenseItem({ uid: 'x', slot: 'hat', rarity: 'white' })).toBeNull();
    expect(sanitizeCoopDefenseItem({ uid: 'x', slot: 'armor', rarity: 'orange' })).toBeNull();
  });

  it('drops affixes that do not belong to the category and downgrades the rarity', () => {
    const sanitized = sanitizeCoopDefenseItem({
      uid: 'x',
      slot: 'armor',
      rarity: 'yellow',
      itemLevel: 1,
      baseValue: 25,
      // life_leech ist ein Handschuh-Affix und darf auf einer Ruestung nicht bestehen bleiben.
      affixes: [{ affixId: 'life_leech', value: 0.5 }, { affixId: 'max_armor', value: 20 }],
    })!;

    expect(sanitized.affixes.map((affix) => affix.affixId)).toEqual(['max_armor']);
    expect(sanitized.rarity).toBe('blue');
  });

  it('clamps inflated values back into the rollable range', () => {
    const sanitized = sanitizeCoopDefenseItem({
      uid: 'x',
      slot: 'gloves',
      rarity: 'blue',
      itemLevel: 1,
      baseValue: 99,
      affixes: [{ affixId: 'outgoing_damage', value: 99 }],
    })!;

    const affixDefinition = getCoopDefenseItemAffixDefinition('outgoing_damage')!;
    expect(sanitized.affixes[0].value).toBeCloseTo(affixDefinition.maxAtLevel1, 10);
    const slotDefinition = COOP_DEFENSE_ITEM_SLOT_DEFINITIONS.gloves;
    expect(sanitized.baseValue).toBeLessThanOrEqual(
      slotDefinition.baseValueAtLevel1 * (1 + slotDefinition.baseValueSpread) + 1e-9,
    );
  });

  it('enforces the category limit and drops duplicate uids while keeping the equipped item', () => {
    const raw = [
      item({ uid: 'equipped', slot: 'armor' }),
      ...Array.from({ length: 15 }, (_, index) => item({ uid: `s${index}`, slot: 'armor' })),
      item({ uid: 's0', slot: 'armor' }),
    ];
    const sanitized = sanitizeCoopDefenseItems(raw, { armor: 'equipped' });

    expect(sanitized).toHaveLength(COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT + 1);
    expect(sanitized.some((entry) => entry.uid === 'equipped')).toBe(true);
    expect(new Set(sanitized.map((entry) => entry.uid)).size).toBe(sanitized.length);
  });

  it('drops equipped ids without a matching owned item of that slot', () => {
    const items = [item({ uid: 'a', slot: 'armor' }), item({ uid: 'b', slot: 'boots' })];
    const equipped = sanitizeCoopDefenseEquippedItemIds(
      { armor: 'a', boots: 'a', helmet: 'missing', gloves: 42 },
      items,
    );
    expect(equipped).toEqual({ armor: 'a' });
  });

  it('keeps a pending reward only when it carries a round and at least one offer', () => {
    expect(sanitizeCoopDefensePendingItemReward(null)).toBeNull();
    expect(sanitizeCoopDefensePendingItemReward({ roundEndedAt: 0, offers: [item()] })).toBeNull();
    expect(sanitizeCoopDefensePendingItemReward({ roundEndedAt: 10, offers: [] })).toBeNull();

    const reward = sanitizeCoopDefensePendingItemReward({
      roundEndedAt: 10,
      offers: [item({ uid: 'o1' }), { uid: '', slot: 'armor' }],
    });
    expect(reward).toMatchObject({ roundEndedAt: 10 });
    expect(reward?.offers).toHaveLength(1);
  });
});

describe('coop-defense item configuration', () => {
  it('only references player stats that the upgrade tree already knows', () => {
    // player.outgoingDamage ist der einzige neu eingefuehrte Key.
    const known = new Set([
      'player.maxHp',
      'player.hpRegenPerSecond',
      'player.maxArmor',
      'player.armorGain',
      'player.armorRegenPerSecond',
      'player.lifeLeechFraction',
      'player.runSpeed',
      'player.maxAdrenaline',
      'player.adrenalineRegenRate',
      'player.adrenalineGain',
      'player.adrenalineCost',
      'player.dashRange',
      'player.outgoingDamage',
    ]);

    for (const definition of COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS) {
      expect(known.has(definition.stat)).toBe(true);
    }
    for (const slot of COOP_DEFENSE_ITEM_SLOTS as readonly CoopDefenseItemSlot[]) {
      expect(known.has(COOP_DEFENSE_ITEM_SLOT_DEFINITIONS[slot].baseStat)).toBe(true);
    }
  });
});
