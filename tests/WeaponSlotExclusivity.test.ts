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
import { PlayerActionRuntime } from '../src/world/PlayerActionRuntime';
import { SustainedWeaponBehaviorRuntime } from '../src/world/SustainedWeaponBehaviorRuntime';
import type { LoadoutUseParams } from '../src/types';

const PLAYER_ID = 'player-1';

function createManager(weapon1: WeaponConfig, weapon2: WeaponConfig) {
  const player = fakeEntity({ id: PLAYER_ID,
    color: 0xffffff, x: 0, y: 0, active: true });
  const playerManager = { getPlayer: vi.fn(() => player) };
  const resourceSystem = { getAdrenaline: vi.fn(() => 100) };
  const manager = new LoadoutManager(
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

function createActionRuntime(
  manager: LoadoutManager,
  behavior: SustainedWeaponBehaviorRuntime,
  playerManager: { getPlayer: ReturnType<typeof vi.fn> },
) {
  const weaponActivation = {
    activateWeapon: vi.fn(() => ({ ok: true })),
    noteWeaponFired: vi.fn(),
  };
  return {
    action: new PlayerActionRuntime({
    getPlayer: (playerId) => playerManager.getPlayer(playerId),
    canInteract: () => true,
    isAlive: () => true,
    isWeaponBlocked: () => false,
    isDashBurst: () => false,
    }, manager, behavior, weaponActivation),
    weaponActivation,
  };
}

function activateWeapon(
  action: PlayerActionRuntime,
  slot: 'weapon1' | 'weapon2',
  now: number,
  params?: LoadoutUseParams,
) {
  return action.execute({
    category: 'weapon',
    playerId: PLAYER_ID,
    slot,
    angle: 0,
    targetX: 100,
    targetY: 0,
    hostNowMs: now,
    params,
  });
}

describe('host-authoritative weapon slot exclusivity', () => {
  it('ends a weapon-2 Tesla channel immediately on a fast LMB switch, even when Waffe 1 is rejected', () => {
    const tesla = makeTeslaSystem();
    const { manager, playerManager, resourceSystem } = createManager(WEAPON_CONFIGS.GLOCK, WEAPON_CONFIGS.TESLA_DOME);
    const behavior = new SustainedWeaponBehaviorRuntime(manager, resourceSystem as never);
    behavior.setTeslaDomeSystem(tesla as never);
    const { action, weaponActivation } = createActionRuntime(manager, behavior, playerManager);

    activateWeapon(action, 'weapon2', 100);
    expect(tesla.hostRefresh).toHaveBeenCalledOnce();

    weaponActivation.activateWeapon.mockReturnValue({ ok: false, reason: 'cooldown' });
    const result = activateWeapon(action, 'weapon1', 116);

    expect(result).toEqual({ ok: false, reason: 'cooldown' });
    expect(tesla.hostDeactivateForPlayer).toHaveBeenCalledWith(PLAYER_ID);
  });

  it('keeps the switch exclusive in the reverse direction for a persistent weapon-1 channel', () => {
    const tesla = makeTeslaSystem();
    const { manager, playerManager, resourceSystem } = createManager(WEAPON_CONFIGS.TESLA_DOME, WEAPON_CONFIGS.GLOCK);
    const behavior = new SustainedWeaponBehaviorRuntime(manager, resourceSystem as never);
    behavior.setTeslaDomeSystem(tesla as never);
    const { action, weaponActivation } = createActionRuntime(manager, behavior, playerManager);

    activateWeapon(action, 'weapon1', 200);
    expect(tesla.hostRefresh).toHaveBeenCalledOnce();

    weaponActivation.activateWeapon.mockReturnValue({ ok: true });
    activateWeapon(action, 'weapon2', 216);

    expect(tesla.hostDeactivateForPlayer).toHaveBeenCalledWith(PLAYER_ID);
  });

  it('does not let an explicit autonomous energy-dome toggle get treated as a hold channel', () => {
    const player = fakeEntity({ id: PLAYER_ID,
      color: 0xffffff, x: 0, y: 0, active: true });
    const energyPlayerManager = { getPlayer: vi.fn(() => player) };
    const energyResourceSystem = { getAdrenaline: vi.fn(() => 100) };
    const energyShield = new EnergyShieldSystem(
      energyPlayerManager as never,
      energyResourceSystem as never,
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
    const { manager, playerManager, resourceSystem } = createManager(WEAPON_CONFIGS.GLOCK, toggleConfig);
    const behavior = new SustainedWeaponBehaviorRuntime(manager, resourceSystem as never);
    behavior.setEnergyShieldSystem(energyShield);
    const { action, weaponActivation } = createActionRuntime(manager, behavior, playerManager);

    activateWeapon(action, 'weapon2', 300, { inputStarted: true });
    expect(energyShield.isActive(PLAYER_ID)).toBe(true);

    weaponActivation.activateWeapon.mockReturnValue({ ok: true });
    activateWeapon(action, 'weapon1', 316);

    expect(energyShield.isActive(PLAYER_ID)).toBe(true);
  });
});
