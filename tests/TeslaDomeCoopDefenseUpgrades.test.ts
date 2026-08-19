import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { TeslaDomeWeaponFireConfig, WeaponConfig } from '../src/loadout/LoadoutConfig';
import {
  COOP_DEFENSE_UPGRADE_DEFINITIONS,
  getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeDefinition,
} from '../src/utils/coopDefenseUpgrades';
import { getCoopDefenseUpgradeTextureKey } from '../src/utils/coopDefenseUpgrades';
import { getUpgradeDescription, getUpgradeName } from '../src/i18n/upgradePresentation';
import type { CoopDefenseUpgradeProfile } from '../src/types';

function profile(levels: Readonly<Record<string, number>>): CoopDefenseUpgradeProfile {
  return {
    upgrades: Object.fromEntries(Object.entries(levels).map(([id, level]) => [
      id,
      { unlocked: true, level },
    ])),
  };
}

function teslaFire(levels: Readonly<Record<string, number>>): TeslaDomeWeaponFireConfig {
  const resolved = applyCoopDefenseModifiersToWeaponConfig(
    WEAPON_CONFIGS.TESLA_DOME,
    'weapon2',
    getCoopDefenseResolvedEffectTotals(profile(levels)),
  ) as WeaponConfig & { fire: TeslaDomeWeaponFireConfig };
  return resolved.fire;
}

const TESLA_NODES = [
  'tesla_dome_additional_beams',
  'tesla_dome_focused_conductivity',
  'tesla_dome_energy_efficiency',
  'tesla_dome_field_charge',
  'tesla_dome_field_stabilization',
  'tesla_dome_overcharge_pulse',
  'tesla_dome_thunderstorm',
  'tesla_dome_fast_charge',
  'tesla_dome_overcharge',
] as const;

const FULL_BUILD: Readonly<Record<string, number>> = {
  unlock_tesla_dome: 1,
  tesla_dome_additional_beams: 3,
  tesla_dome_focused_conductivity: 3,
  tesla_dome_energy_efficiency: 3,
  tesla_dome_field_charge: 1,
  tesla_dome_field_stabilization: 1,
  tesla_dome_overcharge_pulse: 1,
  tesla_dome_thunderstorm: 1,
  tesla_dome_fast_charge: 3,
  tesla_dome_overcharge: 3,
};

describe('Tesla dome coop-defense upgrade tree', () => {
  it('ships exactly the reworked node set with two boss upgrades', () => {
    const ids = Object.keys(COOP_DEFENSE_UPGRADE_DEFINITIONS)
      .filter(id => id.startsWith('tesla_dome_'));

    expect(new Set(ids)).toEqual(new Set(TESLA_NODES));
    const bossNodes = ids.filter(id => getCoopDefenseUpgradeDefinition(id)!.bossPointCostPerLevel > 0);
    expect(new Set(bossNodes)).toEqual(new Set(['tesla_dome_overcharge_pulse', 'tesla_dome_thunderstorm']));
  });

  it('wires the prerequisite chain from the GDD', () => {
    const requires = (id: string) =>
      (getCoopDefenseUpgradeDefinition(id)?.requires ?? []).map(entry => entry.upgradeId).sort();

    expect(requires('tesla_dome_additional_beams')).toEqual(['unlock_tesla_dome']);
    expect(requires('tesla_dome_focused_conductivity')).toEqual(['tesla_dome_additional_beams']);
    expect(requires('tesla_dome_energy_efficiency')).toEqual(['tesla_dome_focused_conductivity']);
    expect(requires('tesla_dome_field_charge')).toEqual(['unlock_tesla_dome']);
    expect(requires('tesla_dome_field_stabilization')).toEqual(['tesla_dome_field_charge']);
    expect(requires('tesla_dome_overcharge_pulse')).toEqual(['tesla_dome_field_stabilization']);
    // Boss 2 verlangt den linken Ast und Boss 1.
    expect(requires('tesla_dome_thunderstorm')).toEqual([
      'tesla_dome_energy_efficiency',
      'tesla_dome_overcharge_pulse',
    ]);
    expect(requires('tesla_dome_fast_charge')).toEqual(['tesla_dome_thunderstorm']);
    expect(requires('tesla_dome_overcharge')).toEqual(['tesla_dome_thunderstorm']);
    // Jeder Nachfolger genügt sich mit Level 1 des Vorgängers.
    for (const id of TESLA_NODES) {
      for (const entry of getCoopDefenseUpgradeDefinition(id)?.requires ?? []) {
        expect(entry.minLevel).toBe(1);
      }
    }
  });

  it('keeps the unupgraded dome at the unchanged PvP baseline', () => {
    const fire = teslaFire({ unlock_tesla_dome: 1 });
    const baseFire = WEAPON_CONFIGS.TESLA_DOME.fire;

    expect(fire.radius).toBe(baseFire.radius);
    expect(fire.damagePerTick).toBe(baseFire.damagePerTick);
    expect(fire.tickInterval).toBe(baseFire.tickInterval);
    expect(fire.adrenalineDrainPerSecond).toBe(baseFire.adrenalineDrainPerSecond);
    expect(fire.movementSlowFactor).toBe(baseFire.movementSlowFactor);
    expect(fire.requireLineOfSight).toBe(baseFire.requireLineOfSight);
    // Target-Limit und Locking gelten auch ohne Upgrades.
    expect(fire.maxTargets).toBe(baseFire.maxTargets);
    // Ohne Feldaufladung gibt es keine Ladung und keinen Puls.
    expect(fire.maxChargeStacks).toBe(0);
    expect(fire.overchargePulseEnabled).toBe(0);
    expect(fire.stormEnabled).toBe(0);
  });

  it('resolves the fully upgraded dome to the GDD target values', () => {
    const fire = teslaFire(FULL_BUILD);
    const baseFire = WEAPON_CONFIGS.TESLA_DOME.fire;
    const totals = getCoopDefenseResolvedEffectTotals(profile(FULL_BUILD));

    const expectedMaxTargets = (baseFire.maxTargets ?? 0) + (totals.additive['weapon.TESLA_DOME.fire.maxTargets'] ?? 0);
    expect(fire.maxTargets).toBe(expectedMaxTargets);

    const expectedFocusedDamageBonus = (baseFire.focusedDamageBonusPerFreeTarget ?? 0)
      + (totals.additive['weapon.TESLA_DOME.fire.focusedDamageBonusPerFreeTarget'] ?? 0);
    expect(fire.focusedDamageBonusPerFreeTarget).toBeCloseTo(expectedFocusedDamageBonus, 10);
    expect((fire.maxTargets! - 1) * fire.focusedDamageBonusPerFreeTarget!).toBeCloseTo(
      (expectedMaxTargets - 1) * expectedFocusedDamageBonus,
      10,
    );

    const expectedDrain = baseFire.adrenalineDrainPerSecond
      * (1 + (totals.percentage['weapon.TESLA_DOME.adrenalineDrain'] ?? 0));
    expect(fire.adrenalineDrainPerSecond).toBeCloseTo(expectedDrain, 10);

    const expectedChargeInterval = (baseFire.chargeIntervalMs ?? 0)
      + (totals.additive['weapon.TESLA_DOME.fire.chargeIntervalMs'] ?? 0);
    expect(fire.chargeIntervalMs).toBe(expectedChargeInterval);

    const expectedMaxCharge = (baseFire.maxChargeStacks ?? 0)
      + (totals.additive['weapon.TESLA_DOME.fire.maxChargeStacks'] ?? 0);
    expect(fire.maxChargeStacks).toBe(expectedMaxCharge);

    const expectedRadiusBonus = (baseFire.radiusBonusPerCharge ?? 0)
      + (totals.additive['weapon.TESLA_DOME.fire.radiusBonusPerCharge'] ?? 0);
    expect(fire.radiusBonusPerCharge).toBeCloseTo(expectedRadiusBonus, 10);

    const expectedMovementRecovery = (baseFire.movementRecoveryPerCharge ?? 0)
      + (totals.additive['weapon.TESLA_DOME.fire.movementRecoveryPerCharge'] ?? 0);
    expect(fire.movementRecoveryPerCharge).toBeCloseTo(expectedMovementRecovery, 10);

    expect(fire.overchargePulseEnabled).toBe(1);
    expect(fire.stormEnabled).toBe(1);

    // Auf MaxCharge erreicht die Kuppel den skalierten Radius und skalierten Bewegungsfaktor.
    expect(fire.radius * (1 + expectedMaxCharge * fire.radiusBonusPerCharge!)).toBeCloseTo(
      baseFire.radius * (1 + expectedMaxCharge * expectedRadiusBonus),
      10,
    );
    expect(Math.min(1, fire.movementSlowFactor + expectedMaxCharge * fire.movementRecoveryPerCharge!)).toBeCloseTo(
      Math.min(1, baseFire.movementSlowFactor + expectedMaxCharge * expectedMovementRecovery),
      10,
    );
  });

  it('leaves the shared Tesla variants untouched by the player tree', () => {
    const totals = getCoopDefenseResolvedEffectTotals(profile(FULL_BUILD));
    for (const id of ['MINI_TESLA_DOME', 'TURRET_TESLA'] as const) {
      const base = WEAPON_CONFIGS[id] as WeaponConfig & { fire: TeslaDomeWeaponFireConfig };
      const resolved = applyCoopDefenseModifiersToWeaponConfig(base, 'weapon2', totals) as
        WeaponConfig & { fire: TeslaDomeWeaponFireConfig };
      expect(resolved.fire).toEqual(base.fire);
      expect(resolved.fire.maxTargets).toBeUndefined();
      expect(resolved.fire.maxChargeStacks).toBe(0);
    }
  });

  it('reuses only fitting legacy icons and lets the rest fall back to text', () => {
    // Nur die Symbole der ersetzten Vorgänger, deren Motiv fachlich weiterträgt.
    expect(getCoopDefenseUpgradeTextureKey('tesla_dome_energy_efficiency')).toBe('UPGRADE_TESLA_DOME_ADRENALIN_DRAIN');
    expect(getCoopDefenseUpgradeTextureKey('tesla_dome_field_charge')).toBe('UPGRADE_TESLA_DOME_HIGH_VOLTAGE');
    expect(getCoopDefenseUpgradeTextureKey('tesla_dome_field_stabilization')).toBe('UPGRADE_TESLA_DOME_MOVEMENT_SLOW');
    expect(getCoopDefenseUpgradeTextureKey('tesla_dome_overcharge_pulse')).toBe('UPGRADE_TESLA_DOME_DAMAGE');
    expect(getCoopDefenseUpgradeTextureKey('tesla_dome_overcharge')).toBe('UPGRADE_TESLA_DOME_RADIUS');

    // Ohne passendes Motiv bewusst kein Alias: der Baum zeigt dann den Namen als Text.
    for (const id of [
      'tesla_dome_additional_beams',
      'tesla_dome_focused_conductivity',
      'tesla_dome_thunderstorm',
      'tesla_dome_fast_charge',
    ]) {
      expect(getCoopDefenseUpgradeTextureKey(id)).toBe(`UPGRADE_${id.toUpperCase()}`);
    }
  });

  it('carries German and English presentation for every node', () => {
    for (const id of TESLA_NODES) {
      for (const locale of ['de', 'en'] as const) {
        expect(getUpgradeName(id, locale)).not.toMatch(/^⟦/);
        const description = getUpgradeDescription(id, locale);
        expect(description).not.toMatch(/^⟦/);
        expect(description).not.toMatch(/\{[a-zA-Z0-9]+\}/);
      }
    }
  });
});
