import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ Math: { Clamp: (v: number, a: number, b: number) => Math.max(a, Math.min(b, v)) } }));
import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { resolveRocketExplosion, validateRocketLauncherConfig } from '../src/loadout/RocketLauncherConfig';
import { getCoopDefenseUpgradeDefinition as definition, getCoopDefenseResolvedEffectTotals,
  getCoopDefenseUpgradeTextureKey, sanitizeCoopDefenseUpgradeProfile, getSpentCoopDefenseUpgradePoints,
  getSpentCoopDefenseBossPoints } from '../src/utils/coopDefenseUpgrades';

const ids = ['unlock_rocket_launcher', 'rocket_launcher_adrenaline_cost', 'rocket_launcher_rocket_jump',
  'rocket_launcher_explosive_medicine', 'rocket_launcher_pressure_shield', 'rocket_launcher_heavy_charge',
  'rocket_launcher_magazine', 'rocket_launcher_aftershock', 'rocket_launcher_more_chunks', 'rocket_launcher_targeted_scatter'];
const profile = (levels = 1) => ({ upgrades: Object.fromEntries(ids.map(id => [id, { unlocked: true,
  level: Math.min(levels, definition(id)!.maxLevel) }])) });

describe('Rocket authored upgrade contract', () => {
  it('unlocks the whole tree at predecessor level one and prices the two boss nodes separately', () => {
    const p = sanitizeCoopDefenseUpgradeProfile(profile());
    for (const id of ids) expect(p.upgrades[id].level).toBe(1);
    expect(getSpentCoopDefenseBossPoints(p)).toBe(2);
    for (const missing of ['rocket_launcher_pressure_shield', 'rocket_launcher_magazine']) {
      const raw = profile(); raw.upgrades[missing].level = 0;
      const cleaned = sanitizeCoopDefenseUpgradeProfile(raw);
      expect(cleaned.upgrades.rocket_launcher_aftershock.level).toBe(0);
    }
    for (const id of ids.filter(id => id.startsWith('rocket_launcher_'))) {
      expect(getCoopDefenseUpgradeTextureKey(id)).toBe(`UPGRADE_${id.toUpperCase()}`);
    }
  });

  it('retains unlock and R1 while releasing all removed normal and boss investments', () => {
    const kept = { upgrades: Object.fromEntries(ids.slice(0, 2).map(id => [id, { unlocked: true, level: 1 }])) };
    const raw = { upgrades: { ...kept.upgrades, rocket_launcher_black_hole: { unlocked: true, level: 1 },
      rocket_launcher_burning_explosion: { unlocked: true, level: 3 }, rocket_launcher_direct_damage: { unlocked: true, level: 3 } } };
    const cleaned = sanitizeCoopDefenseUpgradeProfile(raw);
    expect(cleaned).toEqual(sanitizeCoopDefenseUpgradeProfile(kept));
    expect(getSpentCoopDefenseUpgradePoints(cleaned)).toBe(getSpentCoopDefenseUpgradePoints(kept));
    expect(getSpentCoopDefenseBossPoints(cleaned)).toBe(0);
  });

  it('resolves tuning through modifiers and gives aftershocks neither healing nor another cascade', () => {
    const base = WEAPON_CONFIGS.ROCKET_LAUNCHER;
    const resolved = applyCoopDefenseModifiersToWeaponConfig(base, 'weapon2', getCoopDefenseResolvedEffectTotals(profile(3)));
    expect(validateRocketLauncherConfig(resolved.rocketLauncher)).toEqual([]);
    expect(resolved.adrenalinCost).toBeLessThan(base.adrenalinCost);
    expect(resolved.damage).toBe(base.damage); expect(resolved.cooldown).toBe(base.cooldown);
    if (base.fire.type !== 'projectile' || resolved.fire.type !== 'projectile') throw Error('rocket must be a projectile');
    const effect = resolveRocketExplosion(resolved.fire.impactExplosion!, resolved.rocketLauncher!);
    expect(effect.selfKnockbackMult).toBe(resolved.rocketLauncher!.jumpMultiplier);
    expect(resolved.shotRecoilForce).toBe(base.shotRecoilForce);
    expect(effect.fireChunkBurst!.landingExplosion).toMatchObject({ excludeFriendlyPlayers: true, knockback: 0, rocketSupport: { healFraction: 0 } });
    expect(effect.fireChunkBurst!.landingExplosion).not.toHaveProperty('fireChunkBurst');
    expect(effect.fireChunkBurst!.nearbyChunksPerTarget).toBe(resolved.rocketLauncher!.targetedExtraChunksPerEnemy);
    const untargeted = resolveRocketExplosion(resolved.fire.impactExplosion!, { ...resolved.rocketLauncher!, targetedChunks: 0 });
    expect(untargeted.fireChunkBurst!.nearbyChunksPerTarget).toBeUndefined();
    expect(effect.fireChunkBurst!.count).toBe(base.rocketLauncher!.chunkCount + definition('rocket_launcher_more_chunks')!.maxLevel * definition('rocket_launcher_more_chunks')!.effects[0].value);
    expect(resolveRocketExplosion(base.fire.impactExplosion!, base.rocketLauncher!).fireChunkBurst).toBeUndefined();
  });
});


it('scales only the main explosion radius and shares that resolved radius with the chunk search', () => {
  const base = WEAPON_CONFIGS.ROCKET_LAUNCHER;
  if (base.fire.type !== 'projectile') throw Error('rocket');
  const radiusEffect = definition('rocket_launcher_pressure_shield')!.effects.find(e => e.stat.endsWith('.radius'))!;
  const durationEffect = definition('rocket_launcher_pressure_shield')!.effects.find(e => e.stat.endsWith('.pressureShieldDurationMs'))!;
  for (let level = 0; level <= definition('rocket_launcher_pressure_shield')!.maxLevel; level++) {
    const raw = profile(3);
    raw.upgrades.rocket_launcher_pressure_shield.level = level;
    const resolved = applyCoopDefenseModifiersToWeaponConfig(base, 'weapon2', getCoopDefenseResolvedEffectTotals(raw));
    if (resolved.fire.type !== 'projectile') throw Error('rocket');
    const main = resolved.fire.impactExplosion!;
    expect(main.radius).toBeCloseTo(base.fire.impactExplosion!.radius * (1 + level * radiusEffect.value));
    expect(main.maxDamage).toBe(base.fire.impactExplosion!.maxDamage);
    expect(main.minDamage).toBe(base.fire.impactExplosion!.minDamage);
    expect(resolved.rocketLauncher!.pressureShieldReduction).toBe(base.rocketLauncher!.pressureShieldReduction);
    expect(resolved.rocketLauncher!.pressureShieldDurationMs).toBe(level * durationEffect.value);
    const effect = resolveRocketExplosion(main, { ...resolved.rocketLauncher!, aftershockEnabled: 1 });
    expect(effect.fireChunkBurst!.searchRadius).toBe(main.radius);
    expect(effect.fireChunkBurst!.landingExplosion!.radius).toBe(base.rocketLauncher!.aftershockRadius);
  }
});

it.each([-1, 0.5, Infinity, NaN, undefined])('rejects an invalid nearby chunk quota (%s)', targetedExtraChunksPerEnemy => {
  expect(validateRocketLauncherConfig({ ...WEAPON_CONFIGS.ROCKET_LAUNCHER.rocketLauncher!, targetedExtraChunksPerEnemy }))
    .toContainEqual(expect.stringContaining('targetedExtraChunksPerEnemy'));
});
