import { fakeEntity } from './fakeEntity';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
}));

import { EnergyShieldWeapon } from '../src/loadout/EnergyShieldWeapon';
import { GenericWeapon } from '../src/loadout/GenericWeapon';
import { TeslaDomeWeapon } from '../src/loadout/TeslaDomeWeapon';
import { WEAPON_CONFIGS, type WeaponConfig } from '../src/loadout/LoadoutConfig';
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { EnergyShieldSystem } from '../src/systems/EnergyShieldSystem';

const PLAYER_ID = 'player-1';

function createManager(weapon1: WeaponConfig, weapon2: WeaponConfig) {
  const player = fakeEntity({ id: PLAYER_ID,
    color: 0xffffff, x: 0, y: 0, active: true });
  const playerManager = { getPlayer: vi.fn(() => player) };
  const resourceSystem = { getAdrenaline: vi.fn(() => 100) };
  const manager = new LoadoutManager(
    playerManager as never,
    {} as never,
    resourceSystem as never,
    {} as never,
  );

  (manager as never as { loadouts: Map<string, unknown> }).loadouts.set(PLAYER_ID, {
    weapon1: weapon1.fire.type === 'tesla_dome'
      ? new TeslaDomeWeapon(weapon1 as WeaponConfig & { fire: typeof weapon1.fire })
      : weapon1.fire.type === 'energy_shield'
        ? new EnergyShieldWeapon(weapon1 as WeaponConfig & { fire: typeof weapon1.fire })
        : new GenericWeapon(weapon1),
    weapon2: weapon2.fire.type === 'tesla_dome'
      ? new TeslaDomeWeapon(weapon2 as WeaponConfig & { fire: typeof weapon2.fire })
      : weapon2.fire.type === 'energy_shield'
        ? new EnergyShieldWeapon(weapon2 as WeaponConfig & { fire: typeof weapon2.fire })
        : new GenericWeapon(weapon2),
    utility: {},
    ultimate: {},
  });

  return { manager, playerManager, resourceSystem };
}

function makeTeslaSystem() {
  return {
    hostRefresh: vi.fn(),
    hostDeactivateForPlayer: vi.fn(),
  };
}

function activateWeapon(
  manager: LoadoutManager,
  slot: 'weapon1' | 'weapon2',
  now: number,
  params?: Parameters<LoadoutManager['activateWeapon']>[9],
) {
  manager.claimWeaponAction(PLAYER_ID, slot, now, 0);
  const result = manager.activateWeapon(PLAYER_ID, slot, 0, 0, 0, 100, 0, now, undefined, params);
  if (result.ok) manager.completeWeaponAction(PLAYER_ID, slot, now);
  return result;
}

describe('host-authoritative weapon slot exclusivity', () => {
  it('ends a weapon-2 Tesla channel immediately on a fast LMB switch, even when Waffe 1 is rejected', () => {
    const tesla = makeTeslaSystem();
    const { manager } = createManager(WEAPON_CONFIGS.GLOCK, WEAPON_CONFIGS.TESLA_DOME);
    manager.setTeslaDomeSystem(tesla as never);

    activateWeapon(manager, 'weapon2', 100);
    expect(tesla.hostRefresh).toHaveBeenCalledOnce();

    vi.spyOn(manager as never, 'fireWeapon').mockReturnValue({ ok: false, reason: 'cooldown' });
    const result = activateWeapon(manager, 'weapon1', 116);

    expect(result).toEqual({ ok: false, reason: 'cooldown' });
    expect(tesla.hostDeactivateForPlayer).toHaveBeenCalledWith(PLAYER_ID);
  });

  it('keeps the switch exclusive in the reverse direction for a persistent weapon-1 channel', () => {
    const tesla = makeTeslaSystem();
    const { manager } = createManager(WEAPON_CONFIGS.TESLA_DOME, WEAPON_CONFIGS.GLOCK);
    manager.setTeslaDomeSystem(tesla as never);

    activateWeapon(manager, 'weapon1', 200);
    expect(tesla.hostRefresh).toHaveBeenCalledOnce();

    vi.spyOn(manager as never, 'fireWeapon').mockReturnValue({ ok: true });
    activateWeapon(manager, 'weapon2', 216);

    expect(tesla.hostDeactivateForPlayer).toHaveBeenCalledWith(PLAYER_ID);
  });

  it('does not let an explicit autonomous energy-dome toggle get treated as a hold channel', () => {
    const player = fakeEntity({ id: PLAYER_ID,
      color: 0xffffff, x: 0, y: 0, active: true });
    const playerManager = { getPlayer: vi.fn(() => player) };
    const resourceSystem = { getAdrenaline: vi.fn(() => 100) };
    const energyShield = new EnergyShieldSystem(
      playerManager as never,
      resourceSystem as never,
      {} as never,
      {} as never,
    );
    const toggleConfig = {
      ...WEAPON_CONFIGS.ENERGY_SHIELD,
      fire: {
        ...WEAPON_CONFIGS.ENERGY_SHIELD.fire,
        domeEnabled: 1,
        domeToggleEnabled: 1,
      },
    } as WeaponConfig;
    const { manager } = createManager(WEAPON_CONFIGS.GLOCK, toggleConfig);
    manager.setEnergyShieldSystem(energyShield);

    activateWeapon(manager, 'weapon2', 300, { inputStarted: true });
    expect(energyShield.isActive(PLAYER_ID)).toBe(true);

    vi.spyOn(manager as never, 'fireWeapon').mockReturnValue({ ok: true });
    activateWeapon(manager, 'weapon1', 316);

    expect(energyShield.isActive(PLAYER_ID)).toBe(true);
  });
});
