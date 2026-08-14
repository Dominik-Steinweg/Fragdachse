import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS,
  COOP_DEFENSE_ITEM_OFFER_SIZE,
  COOP_DEFENSE_ITEM_RARITY_DEFINITIONS,
  COOP_DEFENSE_ITEM_SLOTS,
  COOP_DEFENSE_ITEM_SLOT_DEFINITIONS,
  COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT,
  getCoopDefenseItemAffixDefinition,
  getCoopDefenseItemAffixesForRoll,
} from '../src/config/coopDefenseItems';
import { getCoopDefenseConstructionCapacity } from '../src/config/coopDefenseConstructions';
import {
  addCoopDefenseItem,
  compareCoopDefenseItems,
  formatCoopDefenseItemValue,
  getCoopDefenseItemAffixIdsForSlot,
  pickWeightedDistinct,
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
        const rolled = rollCoopDefenseItem(slot, 1, null, random);
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
        const rolled = rollCoopDefenseItem(slot, 3, 'inspector_gadachs', random);
        const ids = rolled.affixes.map((affix) => affix.affixId);
        expect(new Set(ids).size).toBe(ids.length);
        for (const id of ids) expect(allowed.has(id)).toBe(true);
      }
    }
  });

  it('offers three items from three different categories', () => {
    for (let seed = 0; seed < 30; seed++) {
      const offer = rollCoopDefenseItemOffer(2, null, sequence([
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
      const low = rollCoopDefenseItem(slot, 1, null, sequence([0.5])).baseValue;
      const high = rollCoopDefenseItem(slot, 4, null, sequence([0.5])).baseValue;
      expect(high).toBeGreaterThan(low);

      // Ein schlechter Wurf auf hohem Level darf einen guten Wurf auf niedrigem Level
      // unterbieten - genau das haelt alte Items relevant.
      const bestLow = rollCoopDefenseItem(slot, 2, null, sequence([1])).baseValue;
      const worstHigh = rollCoopDefenseItem(slot, 2, null, sequence([0])).baseValue;
      expect(bestLow).toBeGreaterThan(worstHigh);
      expect(worstHigh).toBeGreaterThan(0);
      expect(definition.baseValueSpread).toBeGreaterThan(0);
    }
  });

  it('scales affix ranges with the item level', () => {
    for (const definition of COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS) {
      expect(definition.minAtLevel1).toBeLessThanOrEqual(definition.maxAtLevel1);
      expect(definition.weight).toBeGreaterThan(0);
      expect(definition.slots.length).toBeGreaterThan(0);
    }
  });

  it('draws affixes weighted, not uniformly', () => {
    // Zwei Handschuh-Affixe mit klar unterschiedlichem Gewicht: Schaden (80) muss deutlich
    // haeufiger fallen als Lifeleech (55). Verglichen wird nur die Rangfolge, nicht die Quote -
    // sonst waere der Test eine Kopie der Gewichtstabelle.
    const counts = new Map<string, number>();
    for (let seed = 0; seed < 600; seed++) {
      const rolled = rollCoopDefenseItem('gloves', 1, null, sequence([
        0.9,                       // Seltenheit: gelb
        (seed * 37 % 601) / 601,   // erste Affix-Ziehung
        0.5,                       // Wurfwert
        (seed * 91 % 599) / 599,   // zweite Affix-Ziehung
        0.5,
        0.5, 0.5,                  // UID
      ]));
      for (const affix of rolled.affixes) {
        counts.set(affix.affixId, (counts.get(affix.affixId) ?? 0) + 1);
      }
    }
    expect(counts.get('outgoing_damage') ?? 0).toBeGreaterThan(counts.get('life_leech') ?? 0);
  });

  it('never draws an affix with weight zero', () => {
    const pool = [{ id: 'never', weight: 0 }, { id: 'always', weight: 10 }];
    for (let seed = 0; seed < 50; seed++) {
      const picked = pickWeightedDistinct(pool, 2, (entry) => entry.weight, sequence([seed / 50]));
      expect(picked.map((entry) => entry.id)).toEqual(['always']);
    }
    // Ungueltige Gewichte zaehlen wie null, nicht wie "sehr klein".
    const broken = [{ id: 'nan', weight: Number.NaN }, { id: 'inf', weight: Number.POSITIVE_INFINITY }];
    expect(pickWeightedDistinct(broken, 2, (entry) => entry.weight, sequence([0.5]))).toEqual([]);
  });

  it('rolls class-bound affixes only for their class', () => {
    const capacity = getCoopDefenseItemAffixDefinition('construction_capacity')!;
    expect(capacity.classIds).toEqual(['inspector_gadachs']);
    expect(getCoopDefenseItemAffixesForRoll('gloves', 'inspector_gadachs')).toContain(capacity);
    for (const classId of ['dachs_nukem', 'dachs_of_steel', null] as const) {
      expect(getCoopDefenseItemAffixesForRoll('gloves', classId)).not.toContain(capacity);
    }
  });

  it('lets blue and yellow draw from the same pool', () => {
    // Die Seltenheit bestimmt ausschliesslich die Anzahl. Bei identischem Zufall traegt das
    // gelbe Item deshalb dieselbe erste Eigenschaft wie das blaue.
    const affixDraw = [0.31, 0.42, 0.77, 0.18];
    const blue = rollCoopDefenseItem('helmet', 1, null, sequence([0.6, ...affixDraw]));
    const yellow = rollCoopDefenseItem('helmet', 1, null, sequence([0.95, ...affixDraw]));

    expect(blue.rarity).toBe('blue');
    expect(yellow.rarity).toBe('yellow');
    expect(blue.affixes).toHaveLength(1);
    expect(yellow.affixes).toHaveLength(2);
    expect(yellow.affixes[0].affixId).toBe(blue.affixes[0].affixId);
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

  it('adds up without any ceiling', () => {
    // Konsequente Spezialisierung soll sich vollstaendig auszahlen: balanciert wird ueber
    // Affixwerte, Gewichte und Slots, nicht ueber eine Gesamtobergrenze.
    const overloaded = Array.from({ length: 8 }, (_, index) => item({
      uid: `b${index}`,
      slot: 'boots',
      baseValue: 0.05,
    }));
    expect(getCoopDefenseItemEffectTotals(overloaded).percentage['player.runSpeed']).toBeCloseTo(0.4, 10);
  });

  it('adds up negative affixes without any ceiling either', () => {
    const helmets = Array.from({ length: 12 }, (_, index) => item({
      uid: `h${index}`,
      slot: 'helmet',
      rarity: 'blue',
      baseValue: 0.06,
      affixes: [{ affixId: 'adrenaline_cost', value: -0.08 }],
    }));
    const totals = getCoopDefenseItemEffectTotals(helmets);
    expect(totals.percentage['player.adrenalineCost']).toBeCloseTo(-0.96, 10);
    expect(totals.percentage['player.adrenalineRegenRate']).toBeCloseTo(0.72, 10);
  });

  it('keeps high totals intact across items and upgrades', () => {
    const armorPieces = Array.from({ length: 4 }, (_, index) => item({
      uid: `a${index}`,
      slot: 'armor',
      rarity: 'yellow',
      baseValue: 100,
      affixes: [{ affixId: 'max_hp', value: 200 }, { affixId: 'max_armor', value: 200 }],
    }));
    const merged = mergeCoopDefenseEffectTotals(
      { additive: { 'player.maxHp': 500 }, percentage: {} },
      getCoopDefenseItemEffectTotals(armorPieces),
    );
    // 4 x (100 Grundwert + 200 Affix) + 500 aus Upgrades - nichts wird abgeschnitten.
    expect(merged.additive['player.maxHp']).toBe(1700);
    expect(merged.additive['player.maxArmor']).toBe(800);
  });

  it('keeps a high construction capacity intact', () => {
    const gloves = Array.from({ length: 5 }, (_, index) => item({
      uid: `g${index}`,
      slot: 'gloves',
      rarity: 'blue',
      baseValue: 0.08,
      affixes: [{ affixId: 'construction_capacity', value: 30 }],
    }));
    const bonus = getCoopDefenseItemEffectTotals(gloves).additive['construction.capacity'];
    expect(bonus).toBe(150);
    expect(getCoopDefenseConstructionCapacity(bonus)).toBe(250);
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

  it('includes special effects that are gained or lost in the comparison', () => {
    const candidate = item({
      uid: 'new',
      slot: 'gloves',
      baseValue: 0.09,
      affixes: [{ affixId: 'critical_damage', value: 0.16 }],
    });
    const equipped = item({
      uid: 'old',
      slot: 'gloves',
      baseValue: 0.081,
      affixes: [{ affixId: 'crossfire', value: 0.16 }],
    });

    const rows = compareCoopDefenseItems(candidate, equipped);

    expect(rows.find((row) => row.stat === 'affix.crossfire')).toMatchObject({
      label: 'Kreuzfeuer',
      candidateValue: 0,
      equippedValue: 0.16,
      delta: -0.16,
    });
    expect(rows.find((row) => row.stat === 'player.criticalDamage')).toMatchObject({
      candidateValue: 0.16,
      equippedValue: 0,
      delta: 0.16,
    });
  });

  it('rates a falling cost stat as an improvement', () => {
    expect(isCoopDefenseItemImprovement('player.adrenalineCost', -0.05)).toBe(true);
    expect(isCoopDefenseItemImprovement('player.adrenalineCost', 0.05)).toBe(false);
    expect(isCoopDefenseItemImprovement('player.maxHp', 8)).toBe(true);
    expect(isCoopDefenseItemImprovement('player.maxHp', -8)).toBe(false);
  });

  it('formats percent and flat values with a sign', () => {
    expect(formatCoopDefenseItemValue(0.085, true, 'de')).toBe('+8,5 %');
    expect(formatCoopDefenseItemValue(-0.05, true, 'de')).toBe('-5 %');
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
  it('only references stats that a resolver already consumes', () => {
    // Jeder Key muss auf der anderen Seite von einem Resolver gelesen werden, sonst ist das
    // Affix eine Zahl ohne Wirkung. `player.outgoingDamage`, `player.criticalChance`,
    // `player.criticalDamage`, `player.damageReduction` und `construction.capacity` sind die
    // eigens fuer Items eingefuehrten Keys.
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
      'player.burrowSpeed',
      'player.burrowCost',
      'player.outgoingDamage',
      'player.criticalChance',
      'player.criticalDamage',
      'player.damageReduction',
      'ultimate.maxRage',
      'ultimate.rageGainPerDamage',
      'utility.cooldown',
      'construction.capacity',
    ]);

    for (const definition of COOP_DEFENSE_ITEM_AFFIX_DEFINITIONS) {
      // Affixe ohne Stat wirken ueber einen Laufzeit-Handler und haben hier nichts zu suchen.
      if (!definition.stat) continue;
      expect(known.has(definition.stat)).toBe(true);
    }
    for (const slot of COOP_DEFENSE_ITEM_SLOTS as readonly CoopDefenseItemSlot[]) {
      expect(known.has(COOP_DEFENSE_ITEM_SLOT_DEFINITIONS[slot].baseStat)).toBe(true);
    }
  });
});
