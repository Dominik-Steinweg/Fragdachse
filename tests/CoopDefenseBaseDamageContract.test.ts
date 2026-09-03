import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { applyCoopDefenseModifiersToWeaponConfig } from '../src/loadout/CoopDefenseLoadoutModifiers';
import { PlayerUtilityActionRuntime } from '../src/world/PlayerUtilityActionRuntime';
import { UTILITY_CONFIGS, WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import type { DamageGrenadeEffect } from '../src/types';

describe('Coop-Defense base damage payload contracts', () => {
  it('scales Rocket Launcher direct and impact damage together at +20%', () => {
    const base = WEAPON_CONFIGS.ROCKET_LAUNCHER;
    const resolved = applyCoopDefenseModifiersToWeaponConfig(base, 'weapon2', {
      additive: {},
      percentage: {
        'weapon.ROCKET_LAUNCHER.damage': 0.2,
        'weapon.ROCKET_LAUNCHER.impactExplosion.damage': 0.2,
      },
    });

    expect(resolved.damage).toBeCloseTo(base.damage * 1.2);
    expect(resolved.fire.type).toBe('projectile');
    if (resolved.fire.type !== 'projectile') return;
    expect(resolved.fire.impactExplosion?.maxDamage).toBeCloseTo(36);
    expect(resolved.fire.impactExplosion?.minDamage).toBeCloseTo(6);
  });

  it('keeps HE base damage on the primary and inherited cluster payload', () => {
    const grenade = UTILITY_CONFIGS.HE_GRENADE;
    expect(grenade.baseDamageMult).toBe(2);

    const buildGrenadeEffect = (
      PlayerUtilityActionRuntime.prototype as unknown as {
        buildGrenadeEffect(config: typeof grenade): DamageGrenadeEffect;
      }
    ).buildGrenadeEffect;
    const effect = buildGrenadeEffect.call(Object.create(PlayerUtilityActionRuntime.prototype), grenade);

    expect(effect.type).toBe('damage');
    expect(effect.baseDamageMult).toBe(2);
    expect(effect.clusterCount).toBe(grenade.clusterCount);
    expect(effect.clusterDamageFactor).toBe(grenade.clusterDamageFactor);
  });
});
