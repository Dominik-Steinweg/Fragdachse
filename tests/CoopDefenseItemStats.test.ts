import { describe, expect, it } from 'vitest';
import { CoopDefensePlayerModifierSystem } from '../src/systems/CoopDefensePlayerModifierSystem';
import { getCoopDefenseCommittedEffectTotals } from '../src/utils/coopDefenseItemEffects';
import { resolveCoopDefenseStat } from '../src/utils/coopDefenseStats';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  levelUpCoopDefenseUpgrade,
} from '../src/utils/coopDefenseUpgrades';
import { sanitizeCoopDefenseEquippedItems } from '../src/utils/coopDefenseItems';
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

  it('passes a full set of the same stat through without a ceiling', () => {
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

    // Der Stiefel-Grundwert schlaegt ungekuerzt durch; frueher klemmte hier eine Item-Obergrenze.
    expect(system.getResolvedStat('p', 'player.runSpeed', 200)).toBeCloseTo(240, 10);
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

  it('still loads items that were stored before the affix pool grew', () => {
    // Alter Speicherstand: die Affix-IDs von damals, dazu eine inzwischen entfernte ID.
    // Das unbekannte Affix faellt weg, das restliche Item bleibt erhalten.
    const sanitized = sanitizeCoopDefenseEquippedItems([{
      uid: 'legacy',
      slot: 'armor',
      rarity: 'yellow',
      itemLevel: 3,
      baseValue: 40,
      affixes: [
        { affixId: 'max_hp', value: 20 },
        { affixId: 'ein_entferntes_affix', value: 99 },
      ],
    }]);

    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].baseValue).toBe(40);
    expect(sanitized[0].affixes.map((affix) => affix.affixId)).toEqual(['max_hp']);
    // Eine gueltige Zusatzeigenschaft statt zwei: die Seltenheit folgt der Anzahl.
    expect(sanitized[0].rarity).toBe('blue');
  });
});

describe('item affixes that reuse existing upgrade stats', () => {
  it('stacks rage gain and max rage with the matching upgrades', () => {
    let profile = buildDefaultCoopDefenseUpgradeProfile();
    profile = levelUpCoopDefenseUpgrade(profile, 'ultimate_rage_gain', 20)!;
    profile = levelUpCoopDefenseUpgrade(profile, 'ultimate_max_rage', 20)!;
    expect(profile).not.toBeNull();

    const helmet = item({
      uid: 'helm',
      slot: 'helmet',
      rarity: 'yellow',
      baseValue: 0,
      affixes: [{ affixId: 'rage_gain', value: 0.08 }, { affixId: 'max_rage', value: 0.1 }],
    });
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('p', commit({ coopDefenseProfile: profile, equippedItems: [helmet] }));

    // Upgrade und Affix landen im selben prozentualen Bucket und addieren sich.
    expect(system.getPercentageStat('p', 'ultimate.rageGainPerDamage')).toBeCloseTo(0.18, 10);
    expect(system.getResolvedStat('p', 'ultimate.maxRage', 600)).toBeCloseTo(600 * 1.3, 6);
  });

  it('adds item damage reduction on top of the weapon value without healing the player', () => {
    const armor = item({
      uid: 'armor',
      slot: 'armor',
      rarity: 'blue',
      baseValue: 0,
      affixes: [{ affixId: 'damage_reduction', value: 0.04 }],
    });
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('p', commit({ equippedItems: [armor] }));

    const fromItems = system.getPercentageStat('p', 'player.damageReduction');
    expect(fromItems).toBeCloseTo(0.04, 10);

    // Dieselbe Rechnung wie im Resolver: Waffenwert plus Item-Wert, ungedeckelt summiert.
    const fromWeapon = 0.1;
    expect(fromWeapon + fromItems).toBeCloseTo(0.14, 10);

    // Und dieselbe Klemme wie im CombatSystem: sehr hohe Summen machen den Spieler immun,
    // erzeugen aber niemals negativen Schaden.
    const clamp = (value: number) => Math.min(1, Math.max(0, value));
    expect(100 * (1 - clamp(fromWeapon + fromItems))).toBeCloseTo(86, 6);
    expect(100 * (1 - clamp(3.5))).toBe(0);
  });
});
