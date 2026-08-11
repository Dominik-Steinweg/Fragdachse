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
import { bridge } from '../src/network/bridge';
import { ClientUpdateCoordinator } from '../src/scenes/arena/ClientUpdateCoordinator';

const MISSION_PICKUP = {
  uid: 7,
  defId: 'HOLY_HAND_GRENADE',
  x: 0,
  y: 0,
  pickupKind: 'objective-placement' as const,
  objectiveId: 'hold-supply-base',
};

function makeCoordinator(): ClientUpdateCoordinator & {
  pickupCooldownUntil: number;
  pendingPickupUids: Set<number>;
  confirmedPickupUids: Set<number>;
  ctx: any;
} {
  const coordinator = Object.create(ClientUpdateCoordinator.prototype) as ClientUpdateCoordinator & {
    pickupCooldownUntil: number;
    pendingPickupUids: Set<number>;
    confirmedPickupUids: Set<number>;
    ctx: any;
  };
  coordinator.pickupCooldownUntil = 0;
  coordinator.pendingPickupUids = new Set();
  coordinator.confirmedPickupUids = new Set();
  coordinator.clientUtilityOverride = null;
  coordinator.ctx = {
    playerManager: {
      getPlayer: () => ({ sprite: { active: true, x: 0, y: 0 } }),
    },
    burrowSystem: null,
    leftPanel: { flashSlot: vi.fn() },
  };
  return coordinator;
}

describe('B6 client mission reward reconciliation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not create a local override when the host rejects the claim', async () => {
    vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
    vi.spyOn(bridge, 'isHost').mockReturnValue(false);
    vi.spyOn(bridge, 'getPlayerUtilityOverrideName').mockReturnValue('');
    vi.spyOn(bridge, 'sendPickupPowerUp').mockResolvedValue(false);
    const coordinator = makeCoordinator();

    (coordinator as any).checkLocalPickup([MISSION_PICKUP]);
    await Promise.resolve();

    expect(coordinator.clientUtilityOverride).toBeNull();
    expect(coordinator.confirmedPickupUids).toHaveLength(0);
  });

  it('reconstructs the mission utility only from the accepted host descriptor', async () => {
    vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
    vi.spyOn(bridge, 'isHost').mockReturnValue(false);
    vi.spyOn(bridge, 'getPlayerUtilityOverrideName').mockReturnValue('');
    vi.spyOn(bridge, 'sendPickupPowerUp').mockResolvedValue(true);
    const coordinator = makeCoordinator();

    (coordinator as any).checkLocalPickup([MISSION_PICKUP]);
    await Promise.resolve();
    expect(coordinator.clientUtilityOverride).toBeNull();

    vi.spyOn(bridge, 'getPlayerUtilityOverrideDescriptor').mockReturnValue({
      kind: 'objective-placement',
      objectiveId: 'hold-supply-base',
      powerUpDefId: 'HOLY_HAND_GRENADE',
    });
    (coordinator as any).reconcileClientMissionUtilityOverride();
    expect(coordinator.clientUtilityOverride).toEqual(
      createCoopDefensePlaceablePedestalUtility('hold-supply-base', 'HOLY_HAND_GRENADE'),
    );
  });

  it('keeps a carried mission override after a failed placement and clears it on host release', () => {
    vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
    vi.spyOn(bridge, 'getGamePhase').mockReturnValue('ARENA');
    vi.spyOn(bridge, 'canPlayerAct').mockReturnValue(true);
    vi.spyOn(bridge, 'getPlayerUtilityOverrideName').mockReturnValue('MISSIONS-PODEST PLATZIEREN');
    vi.spyOn(bridge, 'getPlayerUtilityOverrideDescriptor').mockReturnValue({
      kind: 'objective-placement',
      objectiveId: 'hold-supply-base',
      powerUpDefId: 'HOLY_HAND_GRENADE',
    });
    const coordinator = makeCoordinator();
    coordinator.clientUtilityOverride = createCoopDefensePlaceablePedestalUtility(
      'hold-supply-base',
      'HOLY_HAND_GRENADE',
    );

    coordinator.notifyUtilityFired();
    expect(coordinator.clientUtilityOverride?.type).toBe('placeable_pedestal');

    vi.spyOn(bridge, 'getPlayerUtilityOverrideName').mockReturnValue('');
    vi.spyOn(bridge, 'getPlayerUtilityOverrideDescriptor').mockReturnValue(null);
    (coordinator as any).reconcileClientMissionUtilityOverride();
    expect(coordinator.clientUtilityOverride).toBeNull();
  });
});
