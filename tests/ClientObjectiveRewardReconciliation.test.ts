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
import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
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
  ctx: any;
} {
  const coordinator = Object.create(ClientUpdateCoordinator.prototype) as ClientUpdateCoordinator & {
    pickupCooldownUntil: number;
    pendingPickupUids: Set<number>;
    ctx: any;
  };
  coordinator.pickupCooldownUntil = 0;
  coordinator.pendingPickupUids = new Set();
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

function makePickup(defId: string, uid = 7) {
  return { uid, defId, x: 0, y: 0 };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => { resolve = nextResolve; });
  return { promise, resolve };
}

describe('B6 client mission reward reconciliation', () => {
  afterEach(() => vi.restoreAllMocks());

  it('does not create a local override when the host rejects the claim', async () => {
    vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
    vi.spyOn(bridge, 'isHost').mockReturnValue(false);
    vi.spyOn(bridge, 'getPlayerUtilityOverrideId').mockReturnValue('');
    vi.spyOn(bridge, 'sendPickupPowerUp').mockResolvedValue(false);
    const coordinator = makeCoordinator();

    (coordinator as any).checkLocalPickup([MISSION_PICKUP]);
    await Promise.resolve();

    expect(coordinator.clientUtilityOverride).toBeNull();
  });

  it('reconstructs the mission utility only from the accepted host descriptor', async () => {
    vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
    vi.spyOn(bridge, 'isHost').mockReturnValue(false);
    vi.spyOn(bridge, 'getPlayerUtilityOverrideId').mockReturnValue('');
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
    (coordinator as any).reconcileClientUtilityOverride();
    expect(coordinator.clientUtilityOverride).toEqual(
      createCoopDefensePlaceablePedestalUtility('hold-supply-base', 'HOLY_HAND_GRENADE'),
    );
  });

  it('keeps a carried mission override after a failed placement and clears it on host release', () => {
    vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
    vi.spyOn(bridge, 'getGamePhase').mockReturnValue('ARENA');
    vi.spyOn(bridge, 'canPlayerAct').mockReturnValue(true);
    vi.spyOn(bridge, 'getPlayerUtilityOverrideId').mockReturnValue('COOP_DEFENSE_MISSION_PEDESTAL:hold-supply-base');
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

    vi.spyOn(bridge, 'getPlayerUtilityOverrideId').mockReturnValue('');
    vi.spyOn(bridge, 'getPlayerUtilityOverrideDescriptor').mockReturnValue(null);
    (coordinator as any).reconcileClientUtilityOverride();
    expect(coordinator.clientUtilityOverride).toBeNull();
  });

  describe('generischer Pickup-Pfad', () => {
    it.each(['HEALTH_PACK', 'ARMOR'])('sendet für %s genau einen Request ohne lokale Wirkung', async (defId) => {
      vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
      vi.spyOn(bridge, 'isHost').mockReturnValue(false);
      const ack = deferred<boolean>();
      const send = vi.spyOn(bridge, 'sendPickupPowerUp').mockReturnValue(ack.promise);
      const coordinator = makeCoordinator();
      const tryPickup = vi.fn();
      coordinator.ctx.powerUpSystem = { tryPickup };

      (coordinator as any).checkLocalPickup([makePickup(defId)]);

      expect(send).toHaveBeenCalledOnce();
      expect(tryPickup).not.toHaveBeenCalled();
      expect(coordinator.clientUtilityOverride).toBeNull();

      ack.resolve(true);
      await Promise.resolve();
    });

    it('entfernt eine Ablehnung aus pending und erlaubt später einen neuen Request', async () => {
      vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
      vi.spyOn(bridge, 'isHost').mockReturnValue(false);
      const send = vi.spyOn(bridge, 'sendPickupPowerUp').mockResolvedValue(false);
      const coordinator = makeCoordinator();

      (coordinator as any).checkLocalPickup([makePickup('HEALTH_PACK')]);
      await Promise.resolve();
      expect(coordinator.pendingPickupUids).not.toContain(7);

      coordinator.pickupCooldownUntil = 0;
      (coordinator as any).checkLocalPickup([makePickup('HEALTH_PACK')]);
      expect(send).toHaveBeenCalledTimes(2);
    });

    it('verhindert parallele Requests derselben UID', () => {
      vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
      vi.spyOn(bridge, 'isHost').mockReturnValue(false);
      const ack = deferred<boolean>();
      const send = vi.spyOn(bridge, 'sendPickupPowerUp').mockReturnValue(ack.promise);
      const coordinator = makeCoordinator();

      (coordinator as any).checkLocalPickup([makePickup('HEALTH_PACK')]);
      coordinator.pickupCooldownUntil = 0;
      (coordinator as any).checkLocalPickup([makePickup('HEALTH_PACK')]);

      expect(send).toHaveBeenCalledOnce();
      expect(coordinator.pendingPickupUids).toContain(7);
      ack.resolve(false);
    });
  });

  describe('temporäre Utility-Overrides', () => {
    it.each(['BFG', 'HOLY_HAND_GRENADE'])('rekonstruiert %s erst aus dem Host-Descriptor', async (utilityId) => {
      vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
      vi.spyOn(bridge, 'isHost').mockReturnValue(false);
      vi.spyOn(bridge, 'getArenaDescriptor').mockReturnValue(null);
      vi.spyOn(bridge, 'getGameMode').mockReturnValue('deathmatch');
      const ack = deferred<boolean>();
      vi.spyOn(bridge, 'sendPickupPowerUp').mockReturnValue(ack.promise);
      const coordinator = makeCoordinator();

      (coordinator as any).checkLocalPickup([makePickup(utilityId)]);
      expect(coordinator.clientUtilityOverride).toBeNull();

      ack.resolve(true);
      await Promise.resolve();
      expect(coordinator.clientUtilityOverride).toBeNull();

      vi.spyOn(bridge, 'getPlayerUtilityOverrideDescriptor').mockReturnValue({
        kind: 'utility',
        utilityId,
      });
      (coordinator as any).reconcileClientUtilityOverride();
      expect(coordinator.clientUtilityOverride).toEqual(UTILITY_CONFIGS[utilityId]);
    });

    it('erzeugt bei abgelehntem Utility-Pickup keinen Override', async () => {
      vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
      vi.spyOn(bridge, 'isHost').mockReturnValue(false);
      vi.spyOn(bridge, 'sendPickupPowerUp').mockResolvedValue(false);
      vi.spyOn(bridge, 'getPlayerUtilityOverrideDescriptor').mockReturnValue(null);
      const coordinator = makeCoordinator();

      (coordinator as any).checkLocalPickup([makePickup('BFG')]);
      await Promise.resolve();
      (coordinator as any).reconcileClientUtilityOverride();

      expect(coordinator.clientUtilityOverride).toBeNull();
    });

    it('entfernt einen Utility-Override nicht lokal vor der Host-Bestätigung des Einsatzes', () => {
      vi.spyOn(bridge, 'getGamePhase').mockReturnValue('LOBBY');
      const coordinator = makeCoordinator();
      coordinator.clientUtilityOverride = UTILITY_CONFIGS.BFG;

      coordinator.notifyUtilityFired();

      expect(coordinator.clientUtilityOverride).toBe(UTILITY_CONFIGS.BFG);
    });
  });
});
