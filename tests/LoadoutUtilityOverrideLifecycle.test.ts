import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
    Distance: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.hypot(x2 - x1, y2 - y1),
    },
  },
}));

import { createCoopDefensePlaceablePedestalUtility } from '../src/loadout/CoopDefenseMissionUtility';
import { HeldItemSlotTracker } from '../src/loadout/HeldItemSlotTracker';
import { LoadoutManager } from '../src/loadout/LoadoutManager';
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';

afterEach(() => vi.restoreAllMocks());

function makeManager() {
  const bridge = {
    getGameMode: vi.fn(() => 'deathmatch' as const),
    publishUtilityCooldownUntil: vi.fn(),
    publishUtilityOverrideDescriptor: vi.fn(),
    publishUtilityOverrideId: vi.fn(),
  };
  const manager = Object.create(LoadoutManager.prototype) as any;
  manager.bridge = bridge;
  manager.loadouts = new Map();
  manager.savedUtilities = new Map();
  manager.utilityAmmo = new Map();
  manager.inspectorUtilities = new Map();
  manager.inspectorConstructionCooldowns = new Map();
  manager.ultimateStates = new Map();
  manager.aimNetStates = new Map();
  manager.heldFireSlots = new Map();
  manager.ak47States = new Map();
  manager.negevStates = new Map();
  manager.heldItemSlots = new HeldItemSlotTracker();
  manager.shotgunLightningQueue = [];
  manager.createWeapon = vi.fn((config: unknown) => ({ config }));
  manager.resetAk47State = vi.fn();
  manager.loadouts.set('player-a', {
    weapon1: { config: UTILITY_CONFIGS.HE_GRENADE },
    weapon2: { config: UTILITY_CONFIGS.HE_GRENADE },
    utility: {
      config: UTILITY_CONFIGS.HE_GRENADE,
      getLastUsedAt: () => 123,
    },
  });
  return { manager, bridge };
}

describe('temporäre Utility-Override-Lifecycle', () => {
  it('publiziert normale Utility-Pickups und leert sie beim Default-Loadout', () => {
    const { manager, bridge } = makeManager();

    expect(manager.overrideUtility('player-a', UTILITY_CONFIGS.BFG, 1)).toBe(true);
    expect(bridge.publishUtilityOverrideDescriptor).toHaveBeenLastCalledWith('player-a', {
      kind: 'utility',
      utilityId: 'BFG',
    });
    expect(manager.utilityAmmo.get('player-a')).toBe(1);

    manager.assignDefaultLoadout('player-a');

    expect(bridge.publishUtilityOverrideDescriptor).toHaveBeenLastCalledWith('player-a', null);
    expect(bridge.publishUtilityOverrideId).toHaveBeenLastCalledWith('player-a', '');
    expect(bridge.publishUtilityCooldownUntil).toHaveBeenLastCalledWith('player-a', 0, '__clear__');
    expect(manager.savedUtilities.has('player-a')).toBe(false);
    expect(manager.utilityAmmo.has('player-a')).toBe(false);
  });

  it('publiziert den B6-Descriptor und leert ihn genauso beim Round-Loadout-Reset', () => {
    const { manager, bridge } = makeManager();
    const missionUtility = createCoopDefensePlaceablePedestalUtility(
      'hold-supply-base',
      'HOLY_HAND_GRENADE',
    );

    expect(manager.overrideUtility('player-a', missionUtility, 1)).toBe(true);
    expect(bridge.publishUtilityOverrideDescriptor).toHaveBeenLastCalledWith('player-a', {
      kind: 'objective-placement',
      objectiveId: 'hold-supply-base',
      powerUpDefId: 'HOLY_HAND_GRENADE',
    });

    manager.assignDefaultLoadout('player-a');

    expect(bridge.publishUtilityOverrideDescriptor).toHaveBeenLastCalledWith('player-a', null);
    expect(manager.utilityAmmo.has('player-a')).toBe(false);
  });

  it('entfernt Descriptor, Name und Ammo auch beim Spieler-Entfernen', () => {
    const { manager, bridge } = makeManager();
    manager.overrideUtility('player-a', UTILITY_CONFIGS.BFG, 1);

    manager.removePlayer('player-a');

    expect(bridge.publishUtilityOverrideDescriptor).toHaveBeenLastCalledWith('player-a', null);
    expect(bridge.publishUtilityOverrideId).toHaveBeenLastCalledWith('player-a', '');
    expect(manager.savedUtilities.has('player-a')).toBe(false);
    expect(manager.utilityAmmo.has('player-a')).toBe(false);
  });
});
