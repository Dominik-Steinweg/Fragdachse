import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import { HeldItemSlotTracker } from '../src/loadout/HeldItemSlotTracker';
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { ULTIMATE_CONFIGS, UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { POWERUP_DEFS } from '../src/powerups/PowerUpConfig';
import { PowerUpSystem } from '../src/powerups/PowerUpSystem';
import type { PlayerManager } from '../src/entities/PlayerManager';

function makeLoadoutHookHarness() {
  const manager = Object.create(LoadoutManager.prototype) as any;
  manager.okResult = { ok: true };
  manager.bridge = {
    publishUtilityCooldownUntil: vi.fn(),
  };
  manager.heldItemSlots = new HeldItemSlotTracker();
  manager.decoySystem = { activate: vi.fn(() => true) };
  manager.placeableRockHandler = vi.fn(() => true);
  manager.utilityUsedCallback = vi.fn();
  manager.utilityUsedObserver = vi.fn();
  manager.ultimateUsedObserver = vi.fn();
  manager.ultimateStates = new Map();
  manager.projectileManager = { spawnProjectile: vi.fn() };
  manager.physicsSystem = { addRecoil: vi.fn() };
  manager.resourceSystem = {
    getRage: vi.fn(() => 200),
    addRage: vi.fn(),
  };
  return manager;
}

function fakeUtility(config: any) {
  return {
    config,
    isOnCooldown: vi.fn(() => false),
    recordUse: vi.fn(),
  };
}

describe('room-statistics gameplay hooks', () => {
  it('observes successful utilities, preserves the existing callback and ignores blocked use', () => {
    const manager = makeLoadoutHookHarness();
    const existingCallback = manager.utilityUsedCallback;
    const utility = fakeUtility(UTILITY_CONFIGS.DECOY);

    expect((manager as any).useUtility(utility, 0, 0, 0, 10, 10, 'p1', 100, 0xffffff)).toBe(true);
    expect(existingCallback).toHaveBeenCalledWith('p1', 'decoy');
    expect(manager.utilityUsedObserver).toHaveBeenCalledWith('p1', 'decoy');

    utility.isOnCooldown.mockReturnValue(true);
    expect((manager as any).useUtility(utility, 0, 0, 0, 10, 10, 'p1', 200, 0xffffff)).toBe(false);
    expect(manager.utilityUsedObserver).toHaveBeenCalledOnce();
    expect(existingCallback).toBe(manager.utilityUsedCallback);
  });

  it('observes construction-mode utility only after its placement handler succeeds', () => {
    const manager = makeLoadoutHookHarness();
    const utility = fakeUtility(UTILITY_CONFIGS.SPORE_TURRET);

    expect((manager as any).useUtility(utility, 0, 0, 0, 10, 10, 'p1', 100, 0xffffff)).toBe(true);
    expect(manager.utilityUsedObserver).toHaveBeenCalledWith('p1', 'placeable_turret');

    manager.utilityUsedObserver.mockClear();
    manager.placeableRockHandler.mockReturnValue(false);
    expect((manager as any).useUtility(utility, 0, 0, 0, 10, 10, 'p1', 200, 0xffffff)).toBe(false);
    expect(manager.utilityUsedObserver).not.toHaveBeenCalled();
  });

  it('counts Gauss only on a fully charged release, never on press or aborted charge', () => {
    const manager = makeLoadoutHookHarness();
    const cfg = ULTIMATE_CONFIGS.GAUSS_RIFLE;

    expect((manager as any).handleGaussUltimateUse(
      cfg, 'p1', 0, 0, 0, 1000, 0xffffff, undefined, { ultimateAction: 'press' },
    )).toEqual({ ok: true });
    expect(manager.ultimateUsedObserver).not.toHaveBeenCalled();
    expect((manager as any).handleGaussUltimateUse(
      cfg, 'p1', 0, 0, 0, 1100, 0xffffff, manager.ultimateStates.get('p1'),
      { ultimateAction: 'release', ultimateChargeFraction: 0.5 },
    ).ok).toBe(false);
    expect(manager.ultimateUsedObserver).not.toHaveBeenCalled();

    expect((manager as any).handleGaussUltimateUse(
      cfg, 'p1', 0, 0, 0, 2000, 0xffffff, manager.ultimateStates.get('p1'), { ultimateAction: 'press' },
    ).ok).toBe(true);
    expect((manager as any).handleGaussUltimateUse(
      cfg, 'p1', 0, 0, 0, 3600, 0xffffff, manager.ultimateStates.get('p1'),
      { ultimateAction: 'release', ultimateChargeFraction: 1 },
    ).ok).toBe(true);
    expect(manager.ultimateUsedObserver).toHaveBeenCalledOnce();
    expect(manager.projectileManager.spawnProjectile).toHaveBeenCalledOnce();
  });

  it('notifies pickup collection only after a real item is consumed', () => {
    const collected = vi.fn();
    const combat = {
      healToFull: vi.fn(),
      addArmor: vi.fn(),
      isAlive: vi.fn(() => true),
      isBurrowed: vi.fn(() => false),
      applyDamage: vi.fn(),
      applyExplosionDamage: vi.fn(),
    };
    const system = new PowerUpSystem(
      { getAllPlayers: () => [] } as unknown as PlayerManager,
      combat,
      { seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [] },
      { onPickupCollected: collected },
    );
    const uid = (system as any).spawnPowerUpDef(POWERUP_DEFS.HEALTH_PACK, 200, 240);

    expect(system.tryPickup('p1', uid, 200, 240)).toBe(true);
    expect(collected).toHaveBeenCalledOnce();
    expect(system.tryPickup('p1', uid, 200, 240)).toBe(false);
    expect(collected).toHaveBeenCalledOnce();
  });
});
