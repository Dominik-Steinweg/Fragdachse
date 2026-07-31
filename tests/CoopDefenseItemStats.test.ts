import { describe, expect, it } from 'vitest';
import { CoopDefensePlayerModifierSystem } from '../src/systems/CoopDefensePlayerModifierSystem';
import { getCoopDefenseCommittedEffectTotals } from '../src/utils/coopDefenseItemEffects';
import { resolveCoopDefenseStat } from '../src/utils/coopDefenseStats';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  levelUpCoopDefenseUpgrade,
} from '../src/utils/coopDefenseUpgrades';
import { sanitizeCoopDefenseEquippedItems } from '../src/utils/coopDefenseItems';
import { getCoopDefenseItemAffixDefinition } from '../src/config/coopDefenseItems';
import type { CoopDefenseClassId, CoopDefenseItem, CoopDefenseUpgradeProfile, LoadoutCommitSnapshot } from '../src/types';

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

function commit(overrides: Partial<LoadoutCommitSnapshot> = {}): LoadoutCommitSnapshot {
  return {
    weapon1: 'GLOCK',
    weapon2: 'P90',
    utility: 'FELSEN',
    ultimate: 'GAUSS',
    coopDefenseClassId: null,
    coopDefenseProfile: buildDefaultCoopDefenseUpgradeProfile(),
    ...overrides,
  };
}

/** Der Client-Pfad: dieselben Totals, dieselbe Aufloesung, ohne das Host-System. */
function resolveLikeClient(
  profile: CoopDefenseUpgradeProfile | null,
  classId: CoopDefenseClassId | null,
  items: readonly CoopDefenseItem[],
  stat: string,
  baseValue: number,
): number {
  return resolveCoopDefenseStat(
    getCoopDefenseCommittedEffectTotals(profile, classId, items),
    classId,
    stat,
    baseValue,
  );
}

describe('equipped items in the runtime stat pipeline', () => {
  it('feeds the item base value into max health without extra wiring', () => {
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('p', commit({ equippedItems: [item({ baseValue: 30 })] }));

    expect(system.getMaxHp('p')).toBe(130);
  });

  it('adds item affixes to the same buckets the upgrade tree uses', () => {
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('p', commit({
      equippedItems: [item({
        uid: 'boots',
        slot: 'boots',
        rarity: 'blue',
        baseValue: 0.05,
        affixes: [{ affixId: 'hp_regen', value: 3 }],
      })],
    }));

    expect(system.getResolvedStat('p', 'player.runSpeed', 200)).toBeCloseTo(210, 10);
    expect(system.getHpRegenPerSecond('p')).toBe(3);
  });

  it('stacks upgrades and items additively rather than multiplicatively', () => {
    // 3 Stufen Laufgeschwindigkeit = +15 %, dazu +5 % aus den Stiefeln.
    let profile = buildDefaultCoopDefenseUpgradeProfile();
    for (let level = 0; level < 3; level++) {
      profile = levelUpCoopDefenseUpgrade(profile, 'run_speed', 20, 0, 'dachs_nukem')!;
    }
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('p', commit({
      coopDefenseProfile: profile,
      equippedItems: [item({ uid: 'boots', slot: 'boots', baseValue: 0.05 })],
    }));

    // x1.20, nicht x1.15 * x1.05 = x1.2075.
    expect(system.getResolvedStat('p', 'player.runSpeed', 200)).toBeCloseTo(240, 10);
  });

  it('applies the damage affix with and without a class', () => {
    const gloves = item({
      uid: 'gloves',
      slot: 'gloves',
      rarity: 'blue',
      baseValue: 0.1,
      affixes: [{ affixId: 'outgoing_damage', value: 0.05 }],
    });

    const withoutClass = new CoopDefensePlayerModifierSystem();
    withoutClass.syncPlayer('p', commit({ equippedItems: [gloves] }));
    expect(withoutClass.resolveOutgoingDamage('p', 'enemy', 100, false, () => 0.5).amount)
      .toBeCloseTo(115, 10);

    const withClass = new CoopDefensePlayerModifierSystem();
    withClass.syncPlayer('p', commit({
      coopDefenseClassId: 'dachs_nukem',
      coopDefenseProfile: buildDefaultCoopDefenseUpgradeProfile('dachs_nukem'),
      equippedItems: [gloves],
    }));
    // Nukem: 1.5 Klassenschaden * 1.15 aus der Ausruestung.
    expect(withClass.resolveOutgoingDamage('p', 'enemy', 100, false, () => 0.5).amount)
      .toBeCloseTo(172.5, 10);
  });

  it('enforces the item ceiling even with a full set of the same stat', () => {
    const cap = getCoopDefenseItemAffixDefinition('run_speed')!.maxTotalFromItems;
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('p', commit({
      equippedItems: [item({
        uid: 'boots',
        slot: 'boots',
        rarity: 'yellow',
        baseValue: 0.2,
        affixes: [{ affixId: 'max_hp', value: 25 }, { affixId: 'dash_range', value: 0.1 }],
      })],
    }));

    expect(system.getResolvedStat('p', 'player.runSpeed', 200)).toBeCloseTo(200 * (1 + cap), 10);
  });

  it('keeps modifiers when only items are committed and drops them when nothing is', () => {
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('p', commit({ coopDefenseProfile: null, equippedItems: [item({ baseValue: 30 })] }));
    expect(system.getMaxHp('p')).toBe(130);

    system.syncPlayer('p', commit({ coopDefenseProfile: null, equippedItems: [] }));
    expect(system.getMaxHp('p')).toBe(100);
  });

  it('resolves identically on the host and on the client path', () => {
    const profile = levelUpCoopDefenseUpgrade(
      buildDefaultCoopDefenseUpgradeProfile('dachs_of_steel'),
      'max_armor',
      20,
      0,
      'dachs_of_steel',
    )!;
    const items = [
      item({ uid: 'a', rarity: 'blue', baseValue: 25, affixes: [{ affixId: 'max_armor', value: 20 }] }),
      item({ uid: 'b', slot: 'boots', baseValue: 0.05 }),
    ];
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('p', commit({
      coopDefenseClassId: 'dachs_of_steel',
      coopDefenseProfile: profile,
      equippedItems: items,
    }));

    for (const [stat, base] of [
      ['player.maxArmor', 100],
      ['player.runSpeed', 200],
      ['player.maxAdrenaline', 100],
    ] as const) {
      expect(system.getResolvedStat('p', stat, base)).toBe(
        resolveLikeClient(profile, 'dachs_of_steel', items, stat, base),
      );
    }
    expect(system.getMaxHp('p')).toBe(
      resolveLikeClient(profile, 'dachs_of_steel', items, 'player.maxHp', 100),
    );
  });
});

describe('equipped items at the network boundary', () => {
  it('keeps at most one item per category and drops invalid entries', () => {
    const sanitized = sanitizeCoopDefenseEquippedItems([
      item({ uid: 'a', slot: 'armor' }),
      item({ uid: 'b', slot: 'armor' }),
      item({ uid: 'c', slot: 'boots', baseValue: 0.05 }),
      { uid: 'd', slot: 'cape' },
      null,
    ]);

    // Ausgabe folgt der Slot-Reihenfolge (Helm, Handschuhe, Ruestung, Stiefel).
    expect(sanitized.map((entry) => entry.uid)).toEqual(['a', 'c']);
  });

  it('clamps a manipulated item back into its rollable range', () => {
    const sanitized = sanitizeCoopDefenseEquippedItems([
      item({ uid: 'a', slot: 'armor', baseValue: 99999 }),
    ]);
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('p', commit({ equippedItems: sanitized }));

    expect(system.getMaxHp('p')).toBeLessThan(140);
  });

  it('treats a missing item list as no equipment', () => {
    expect(sanitizeCoopDefenseEquippedItems(undefined)).toEqual([]);
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('p', commit());
    expect(system.getMaxHp('p')).toBe(100);
  });
});
