import { describe, expect, it, vi } from 'vitest';
import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { getCoopDefenseResolvedEffectTotals, getCoopDefenseUpgradeDefinition } from '../src/utils/coopDefenseUpgrades';
import { resolveComboLightning, resolveDetonation, type DetonationEffectSink } from '../src/systems/DetonationResolver';
import type { DetonationEvent } from '../src/systems/DetonationSystem';
import { createSingleOwnerProvenance } from '../src/projectile/ProjectileSpawnRequest';
import { validateResolvedWeapon } from '../src/loadout/content/LoadoutSchemas';
import { getUpgradeDescription } from '../src/i18n/upgradePresentation';

function config(power: number, combo: number) {
  const levels: Record<string, number> = { asmd_secondary_arc_lightning: 1, asmd_secondary_arc_range: power,
    asmd_secondary_arc_damage: combo };
  function includeRequirements(id: string) {
    for (const requirement of getCoopDefenseUpgradeDefinition(id)!.requires) {
      levels[requirement.upgradeId] = Math.max(levels[requirement.upgradeId] ?? 0, requirement.minLevel);
      includeRequirements(requirement.upgradeId);
    }
  }
  for (const id of Object.keys(levels)) includeRequirements(id);
  const totals = getCoopDefenseResolvedEffectTotals({ upgrades: Object.fromEntries(
    Object.entries(levels).map(([id, level]) => [id, { unlocked: true, level }])) });
  return applyCoopDefenseModifiersToWeaponConfig(WEAPON_CONFIGS.ASMD_SEC, 'weapon2', totals);
}
function event(power = 0, combo = 0): DetonationEvent {
  const resolved = config(power, combo);
  return { projectileId: 9, x: 50, y: 70, projectileOwnerId: 'ball', detonatorOwnerId: 'shooter',
    sourceId: 'ASMD_SEC', effect: resolved.detonable!, pulseSource: {
      projectileId: 9, x: 50, y: 70, ownerId: 'ball', color: 0xabcdef, sourceId: 'ASMD_SEC',
      sourceSlot: 'weapon2', provenance: createSingleOwnerProvenance('ball'),
      proximityPulse: resolved.proximityPulse, rockDamageMult: 1.7, trainDamageMult: 0.6,
    } };
}
function sink(): DetonationEffectSink {
  return { spawnComboEssence: vi.fn(), applyComboLightning: vi.fn(), applyAoeDamage: vi.fn(),
    applyEnvironmentDamage: vi.fn(), applyRadialImpulse: vi.fn(), playExplosion: vi.fn(),
    spawnDotArea: vi.fn(), resolveOwnerColor: () => 0xffffff };
}

describe('ASMD secondary combo upgrades', () => {
  it('applies Storm Power to both pulse stats', () => {
    const base = config(0, 0);
    const upgrade = getCoopDefenseUpgradeDefinition('asmd_secondary_arc_range')!;
    for (let level = 1; level <= upgrade.maxLevel; level++) {
      const resolved = config(level, 0);
      for (const field of ['radius', 'damage'] as const) {
        const effect = upgrade.effects.find(e => e.stat.endsWith('.' + field))!;
        expect(effect).toBeDefined();
        expect(resolved.proximityPulse![field]).toBeCloseTo(base.proximityPulse![field] * (1 + effect.value * level));
      }
    }
  });

  it('keeps the general secondary damage modifier off the pulse stats', () => {
    const additive = { 'weapon.ASMD_SEC.proximityPulse.radius': 90,
      'weapon.ASMD_SEC.proximityPulse.damage': 7, 'weapon.ASMD_SEC.proximityPulse.scanIntervalMs': 300 };
    const base = applyCoopDefenseModifiersToWeaponConfig(WEAPON_CONFIGS.ASMD_SEC, 'weapon2', { additive, percentage: {} });
    const changed = applyCoopDefenseModifiersToWeaponConfig(WEAPON_CONFIGS.ASMD_SEC, 'weapon2', {
      additive, percentage: { 'weapon.ASMD_SEC.damage': 0.7 },
    });
    expect(changed.detonable!.aoeDamage).toBeGreaterThan(base.detonable!.aoeDamage);
    expect(changed.proximityPulse).toEqual(base.proximityPulse);
  });

  it.each([1, 2, 3])('scales damage but keeps double resolved range at combo level %i', level => {
    const input = event(2, level);
    const original = structuredClone(input);
    const pulse = resolveComboLightning(input)!;
    expect(pulse.proximityPulse!.damage).toBeCloseTo(input.pulseSource!.proximityPulse!.damage * (level + 1));
    expect(pulse.proximityPulse!.radius).toBeCloseTo(input.pulseSource!.proximityPulse!.radius * 2);
    expect(pulse).toMatchObject({ x: input.x, y: input.y, color: input.pulseSource!.color,
      rockDamageMult: input.pulseSource!.rockDamageMult, trainDamageMult: input.pulseSource!.trainDamageMult });
    expect(input).toEqual(original);
    const output = sink();
    resolveDetonation(output, input);
    expect(output.applyComboLightning).toHaveBeenCalledExactlyOnceWith(pulse, 'shooter');
    expect(vi.mocked(output.applyAoeDamage).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(output.applyComboLightning).mock.invocationCallOrder[0]);
  });

  it('requires both the combo upgrade and enabled standard beams', () => {
    expect(resolveComboLightning(event(2, 0))).toBeNull();
    const input = event(2, 1);
    expect(resolveComboLightning({ ...input, pulseSource: undefined })).toBeNull();
    expect(resolveComboLightning({ ...input, pulseSource: { ...input.pulseSource!,
      proximityPulse: { radius: 0, damage: 0, scanIntervalMs: 0 } } })).toBeNull();
  });

  it('emits essence at the explosion even without a hit, independently of the lightning upgrade', () => {
    const input = event();
    input.effect = { ...input.effect, comboAdrenalineGain: 19 };
    const output = sink();
    resolveDetonation(output, input);
    expect(output.spawnComboEssence).toHaveBeenCalledExactlyOnceWith(input, 19);
    expect(output.applyComboLightning).not.toHaveBeenCalled();
    const noReward = sink();
    resolveDetonation(noReward, { ...input, effect: { ...input.effect, comboAdrenalineGain: 0 } });
    expect(noReward.spawnComboEssence).not.toHaveBeenCalled();
  });

  it('validates the discrete combo level and renders its multipliers dynamically', () => {
    for (const level of [-1, 0.5, 4, Infinity]) {
      const weapon = { ...WEAPON_CONFIGS.ASMD_SEC, detonable: { ...WEAPON_CONFIGS.ASMD_SEC.detonable, comboLightningLevel: level } };
      expect(validateResolvedWeapon(weapon).some(issue => issue.includes('comboLightningLevel'))).toBe(true);
    }
    for (const locale of ['de', 'en'] as const) {
      expect(getUpgradeDescription('asmd_secondary_arc_damage', locale)).toContain('2 / 3 / 4');
    }
  });
});
