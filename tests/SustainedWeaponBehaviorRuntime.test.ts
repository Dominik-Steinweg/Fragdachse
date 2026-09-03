import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    DegToRad: (value: number) => value * Math.PI / 180,
    Angle: { Wrap: (value: number) => value },
  },
}));

import { WEAPON_CONFIGS, type WeaponConfig } from '../src/loadout/LoadoutConfig';
import { EnergyShieldSystem } from '../src/systems/EnergyShieldSystem';
import { SustainedWeaponBehaviorRuntime } from '../src/world/SustainedWeaponBehaviorRuntime';

const PLAYER_ID = 'player-1';

function makeRuntime(adrenaline = 100) {
  const loadout = {
    getEquippedWeaponConfig: vi.fn((_playerId: string, slot: 'weapon1' | 'weapon2') => (
      slot === 'weapon1' ? WEAPON_CONFIGS.GLOCK : WEAPON_CONFIGS.TESLA_DOME
    )),
  };
  const resource = { getAdrenaline: vi.fn(() => adrenaline) };
  const tesla = {
    hostRefresh: vi.fn(),
    hostDeactivateForPlayer: vi.fn(),
    getMovementSlowFactor: vi.fn(() => 0.65),
  };
  const behavior = new SustainedWeaponBehaviorRuntime(loadout, resource as never);
  behavior.setTeslaDomeSystem(tesla as never);
  return { behavior, loadout, resource, tesla };
}

function request(config: WeaponConfig = WEAPON_CONFIGS.TESLA_DOME) {
  return {
    playerId: PLAYER_ID,
    slot: 'weapon2' as const,
    config,
    x: 12,
    y: 34,
    angle: 0.5,
    nowMs: 1_000,
    playerColor: 0xffffff,
  };
}

describe('SustainedWeaponBehaviorRuntime', () => {
  it('refreshes Tesla through the effect owner and stops it at the resource gate', () => {
    const { behavior, tesla } = makeRuntime();

    behavior.claimWeaponAction(PLAYER_ID, 'weapon2', 1_000, 0.5);
    expect(behavior.activateWeapon(request())).toEqual({ ok: true });
    expect(tesla.hostRefresh).toHaveBeenCalledWith(
      PLAYER_ID,
      12,
      34,
      1_000,
      WEAPON_CONFIGS.TESLA_DOME,
      expect.any(Number),
      0.5,
    );

    const gated = makeRuntime(0);
    gated.behavior.claimWeaponAction(PLAYER_ID, 'weapon2', 1_000, 0.5);
    expect(gated.behavior.activateWeapon(request())).toEqual({ ok: true });
    expect(gated.tesla.hostRefresh).not.toHaveBeenCalled();
    expect(gated.tesla.hostDeactivateForPlayer).toHaveBeenCalledWith(PLAYER_ID);
  });

  it('owns channel movement reads and player teardown without moving effect state ownership', () => {
    const { behavior, tesla } = makeRuntime();

    behavior.claimWeaponAction(PLAYER_ID, 'weapon2', 1_000, 0.5);
    expect(behavior.getMovementSlowFactor(PLAYER_ID, 1_050)).toBe(0.65);
    expect(behavior.getMovementSlowFactor(PLAYER_ID, 1_100)).toBeNull();

    behavior.resetPlayer(PLAYER_ID);
    expect(tesla.hostDeactivateForPlayer).toHaveBeenCalledWith(PLAYER_ID);
    behavior.removePlayer(PLAYER_ID);
    behavior.destroy();
    behavior.destroy();
    expect(tesla.hostDeactivateForPlayer).toHaveBeenCalledTimes(2);
  });

  it('passes Energy Shield press/refresh semantics to the existing effect owner', () => {
    const player = { id: PLAYER_ID, x: 0, y: 0, rotation: 0, active: true };
    const resource = { getAdrenaline: vi.fn(() => 100) };
    const energyShield = new EnergyShieldSystem(
      { getPlayer: vi.fn(() => player) } as never,
      resource as never,
      {} as never,
      {} as never,
    );
    const config = WEAPON_CONFIGS.ENERGY_SHIELD;
    const loadout = {
      getEquippedWeaponConfig: vi.fn(() => config),
    };
    const behavior = new SustainedWeaponBehaviorRuntime(loadout, resource as never);
    behavior.setEnergyShieldSystem(energyShield);

    behavior.claimWeaponAction(PLAYER_ID, 'weapon2', 2_000, 0);
    expect(behavior.activateWeapon({
      ...request(config),
      nowMs: 2_000,
      params: { inputStarted: true },
    })).toEqual({ ok: true });
    expect(energyShield.isActive(PLAYER_ID)).toBe(true);
    expect(behavior.getMovementSlowFactor(PLAYER_ID, 2_050)).toBe(config.fire.movementSlowFactor);

    behavior.removePlayer(PLAYER_ID);
    expect(energyShield.isActive(PLAYER_ID)).toBe(false);
  });
});
