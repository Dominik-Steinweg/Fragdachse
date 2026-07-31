import { describe, expect, it } from 'vitest';
import { CoopDefensePlayerModifierSystem } from '../src/systems/CoopDefensePlayerModifierSystem';
import {
  COOP_DEFENSE_PLAYER_STAT_OUTGOING_DAMAGE,
  EMPTY_COOP_DEFENSE_EFFECT_TOTALS,
  resolveCoopDefenseOutgoingDamage,
  resolveCoopDefenseStat,
} from '../src/utils/coopDefenseStats';
import {
  buildDefaultCoopDefenseUpgradeProfile,
  getCoopDefenseResolvedEffectTotals,
  levelUpCoopDefenseUpgrade,
} from '../src/utils/coopDefenseUpgrades';
import type { CoopDefenseClassId, CoopDefenseUpgradeProfile, LoadoutCommitSnapshot } from '../src/types';

function commit(
  classId: CoopDefenseClassId | null,
  profile: CoopDefenseUpgradeProfile = buildDefaultCoopDefenseUpgradeProfile(classId ?? undefined),
): LoadoutCommitSnapshot {
  return {
    weapon1: 'GLOCK',
    weapon2: classId === 'inspector_gadachs' ? 'OVERCHARGE_CORE' : 'P90',
    utility: 'FELSEN',
    ultimate: 'GAUSS',
    coopDefenseClassId: classId,
    coopDefenseProfile: profile,
  };
}

function totalsFor(classId: CoopDefenseClassId | null, profile: CoopDefenseUpgradeProfile) {
  return getCoopDefenseResolvedEffectTotals(profile, classId ?? undefined);
}

describe('coop-defense stat parity', () => {
  // Host und Client hatten je eine eigene Kopie der Formel. Der Client liess die
  // Klassenmultiplikatoren weg, wodurch die HUD z. B. unter dachs_of_steel ein halbes
  // Ruestungsmaximum anzeigte. Beide Seiten delegieren jetzt an resolveCoopDefenseStat.
  it('resolves the same value through the shared function as through the host system', () => {
    const cases: readonly { classId: CoopDefenseClassId; stat: string; base: number }[] = [
      { classId: 'dachs_of_steel', stat: 'player.maxArmor', base: 100 },
      { classId: 'dachs_of_steel', stat: 'player.maxHp', base: 100 },
      { classId: 'dachs_nukem', stat: 'player.runSpeed', base: 200 },
      { classId: 'dachs_nukem', stat: 'player.maxAdrenaline', base: 100 },
      { classId: 'inspector_gadachs', stat: 'ultimate.maxRage', base: 600 },
      { classId: 'inspector_gadachs', stat: 'player.adrenalineRegenRate', base: 10 },
    ];

    for (const { classId, stat, base } of cases) {
      const profile = buildDefaultCoopDefenseUpgradeProfile(classId);
      const system = new CoopDefensePlayerModifierSystem();
      system.syncPlayer('p', commit(classId, profile));

      expect(system.getResolvedStat('p', stat, base)).toBe(
        resolveCoopDefenseStat(totalsFor(classId, profile), classId, stat, base),
      );
    }
  });

  it('keeps the class multipliers in the shared resolver', () => {
    const empty = EMPTY_COOP_DEFENSE_EFFECT_TOTALS;
    expect(resolveCoopDefenseStat(empty, 'dachs_of_steel', 'player.maxArmor', 100)).toBe(200);
    expect(resolveCoopDefenseStat(empty, 'dachs_of_steel', 'player.maxHp', 100)).toBe(200);
    expect(resolveCoopDefenseStat(empty, 'dachs_nukem', 'player.runSpeed', 200)).toBe(240);

    // Ohne Klasse wirken ausschliesslich die Effekt-Summen.
    expect(resolveCoopDefenseStat(empty, null, 'player.maxArmor', 100)).toBe(100);
    expect(resolveCoopDefenseStat(empty, null, 'player.runSpeed', 200)).toBe(200);
  });

  it('stacks additive and percentage buckets without compounding', () => {
    const totals = {
      additive: { 'player.maxHp': 40 },
      percentage: { 'player.runSpeed': 0.2 + 0.1 },
    };
    // 20 % aus Upgrades plus 10 % aus Items ergeben x1.30, nicht x1.32.
    expect(resolveCoopDefenseStat(totals, null, 'player.runSpeed', 200)).toBeCloseTo(260, 10);
    expect(resolveCoopDefenseStat(totals, null, 'player.maxHp', 100)).toBe(140);
  });

  it('applies upgrade totals to the maximum health of the bonus-free default class', () => {
    const profile = levelUpCoopDefenseUpgrade(
      buildDefaultCoopDefenseUpgradeProfile(),
      'hp',
      20,
      0,
      'dachs_nukem',
    )!;
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('default', commit(null, profile));

    expect(system.getClassId('default')).toBeNull();
    expect(system.getMaxHp('default')).toBe(120);
  });
});

describe('coop-defense outgoing damage', () => {
  it('applies the damage bucket without a class instead of bailing out', () => {
    // Regression: der frühere Fruehausstieg bei classId === null hat Item- und Upgrade-Boni
    // genau fuer die Spieler verworfen, die noch keine Spezialisierung freigeschaltet haben.
    const totals = { additive: {}, percentage: { [COOP_DEFENSE_PLAYER_STAT_OUTGOING_DAMAGE]: 0.25 } };
    expect(resolveCoopDefenseOutgoingDamage(totals, null, 100, true, () => 0)).toEqual({
      amount: 125,
      isCritical: false,
    });
  });

  it('multiplies the damage bucket with the class multiplier', () => {
    const totals = { additive: {}, percentage: { [COOP_DEFENSE_PLAYER_STAT_OUTGOING_DAMAGE]: 0.2 } };
    // Nukem: 1.5 Klassenschaden * 1.2 aus dem Bucket.
    expect(resolveCoopDefenseOutgoingDamage(totals, 'dachs_nukem', 100, false, () => 0.5).amount)
      .toBeCloseTo(180, 10);
  });

  it('keeps the class critical roll deterministic and unchanged', () => {
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('nukem', commit('dachs_nukem'));

    expect(system.resolveOutgoingDamage('nukem', 'enemy', 100, true, () => 0.5)).toEqual({
      amount: 150,
      isCritical: false,
    });
    expect(system.resolveOutgoingDamage('nukem', 'enemy', 100, true, () => 0.05)).toEqual({
      amount: 300,
      isCritical: true,
    });
  });

  it('leaves self damage and non-positive amounts untouched', () => {
    const system = new CoopDefensePlayerModifierSystem();
    system.syncPlayer('nukem', commit('dachs_nukem'));

    expect(system.resolveOutgoingDamage('nukem', 'nukem', 100, true, () => 0)).toEqual({
      amount: 100,
      isCritical: false,
    });
    expect(system.resolveOutgoingDamage(undefined, 'enemy', 100, true, () => 0)).toEqual({
      amount: 100,
      isCritical: false,
    });
  });
});
