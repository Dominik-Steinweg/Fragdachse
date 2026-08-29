import { fakeEntity } from './fakeEntity';
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
import { EMPTY_COOP_DEFENSE_EFFECT_TOTALS } from '../src/utils/coopDefenseStats';

const MISSION_PICKUP = {
  uid: 7,
  defId: 'HOLY_HAND_GRENADE',
  x: 0,
  y: 0,
  pickupKind: 'objective-placement' as const,
  objectiveId: 'hold-placement-reward-test',
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
  coordinator.ctx = {
    playerManager: {
      getPlayer: () => (fakeEntity({ active: true, x: 0, y: 0 })),
    },
    burrowSystem: null,
    leftPanel: { flashSlot: vi.fn() },
    inputSystem: { getSelectedRadialActionForHud: vi.fn(() => null) },
  };
  (coordinator as any).getLocalEffectTotals = () => EMPTY_COOP_DEFENSE_EFFECT_TOTALS;
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

  it('does not create local temporary state when the host rejects the claim', async () => {
    vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
    vi.spyOn(bridge, 'isHost').mockReturnValue(false);
    vi.spyOn(bridge, 'sendPickupPowerUp').mockResolvedValue(false);
    const coordinator = makeCoordinator();

    (coordinator as any).checkLocalPickup([MISSION_PICKUP]);
    await Promise.resolve();

    expect(coordinator.pendingPickupUids).not.toContain(MISSION_PICKUP.uid);
  });

  it('reconstructs the mission utility only from the host collection entry', async () => {
    vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
    vi.spyOn(bridge, 'isHost').mockReturnValue(false);
    vi.spyOn(bridge, 'sendPickupPowerUp').mockResolvedValue(true);
    const coordinator = makeCoordinator();

    (coordinator as any).checkLocalPickup([MISSION_PICKUP]);
    await Promise.resolve();
    const instance = {
      kind: 'objective-placement' as const,
      instanceId: 'temporary-utility-1',
      utilityId: 'COOP_DEFENSE_MISSION_PEDESTAL:hold-placement-reward-test',
      charges: 1,
      cooldownUntil: 0,
      cooldownDurationMs: 0,
      acquisitionOrder: 0,
      objectiveId: 'hold-placement-reward-test',
      powerUpDefId: 'HOLY_HAND_GRENADE',
    };
    vi.spyOn(bridge, 'getPlayerTemporaryUtilityInstances').mockReturnValue([instance]);
    coordinator.ctx.inputSystem.getSelectedRadialActionForHud.mockReturnValue({
      kind: 'temporary-utility', instanceId: instance.instanceId, utilityId: instance.utilityId,
    });

    expect(coordinator.getLocalUtilityConfig()).toEqual(
      createCoopDefensePlaceablePedestalUtility('hold-placement-reward-test', 'HOLY_HAND_GRENADE'),
    );
  });

  it('falls back when the selected temporary instance is no longer host-confirmed', () => {
    vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
    vi.spyOn(bridge, 'getPlayerTemporaryUtilityInstances').mockReturnValue([]);
    const coordinator = makeCoordinator();
    coordinator.ctx.inputSystem.getSelectedRadialActionForHud.mockReturnValue({
      kind: 'temporary-utility', instanceId: 'gone', utilityId: 'BFG',
    });
    vi.spyOn(bridge, 'getActiveGameMode').mockReturnValue('deathmatch');
    vi.spyOn(bridge, 'getActivityDescriptor').mockReturnValue(null);
    vi.spyOn(bridge, 'getPlayerLobbyLoadoutPreview').mockReturnValue(null);

    expect(coordinator.getLocalUtilityConfig()).toEqual(UTILITY_CONFIGS.HE_GRENADE);
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

  describe('temporäre Utility-Instanzen', () => {
    it.each(['BFG', 'HOLY_HAND_GRENADE'])('rekonstruiert %s erst aus der Host-Collection', async (utilityId) => {
      vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
      vi.spyOn(bridge, 'isHost').mockReturnValue(false);
      vi.spyOn(bridge, 'getGameMode').mockReturnValue('deathmatch');
      vi.spyOn(bridge, 'getActiveGameMode').mockReturnValue('deathmatch');
      const ack = deferred<boolean>();
      vi.spyOn(bridge, 'sendPickupPowerUp').mockReturnValue(ack.promise);
      const coordinator = makeCoordinator();

      (coordinator as any).checkLocalPickup([makePickup(utilityId)]);

      ack.resolve(true);
      await Promise.resolve();
      vi.spyOn(bridge, 'getPlayerTemporaryUtilityInstances').mockReturnValue([{
        kind: 'utility',
        instanceId: 'temporary-utility-2',
        utilityId,
        charges: 1,
        cooldownUntil: 0,
        cooldownDurationMs: UTILITY_CONFIGS[utilityId].cooldown,
        acquisitionOrder: 0,
      }]);
      coordinator.ctx.inputSystem.getSelectedRadialActionForHud.mockReturnValue({
        kind: 'temporary-utility', instanceId: 'temporary-utility-2', utilityId,
      });
      expect(coordinator.getLocalUtilityConfig()).toEqual(UTILITY_CONFIGS[utilityId]);
    });

    it('erzeugt bei abgelehntem Utility-Pickup keine lokale Instanz', async () => {
      vi.spyOn(bridge, 'getLocalPlayerId').mockReturnValue('player-a');
      vi.spyOn(bridge, 'isHost').mockReturnValue(false);
      vi.spyOn(bridge, 'sendPickupPowerUp').mockResolvedValue(false);
      vi.spyOn(bridge, 'getPlayerTemporaryUtilityInstances').mockReturnValue([]);
      const coordinator = makeCoordinator();

      (coordinator as any).checkLocalPickup([makePickup('BFG')]);
      await Promise.resolve();
      expect(bridge.getPlayerTemporaryUtilityInstances('player-a')).toEqual([]);
    });

    it('entfernt eine Instanz nicht lokal vor der Host-Bestätigung des Einsatzes', () => {
      vi.spyOn(bridge, 'getGamePhase').mockReturnValue('LOBBY');
      const coordinator = makeCoordinator();
      const instances = [{
        kind: 'utility' as const,
        instanceId: 'temporary-utility-3',
        utilityId: 'BFG',
        charges: 1,
        cooldownUntil: 0,
        cooldownDurationMs: UTILITY_CONFIGS.BFG.cooldown,
        acquisitionOrder: 0,
      }];
      vi.spyOn(bridge, 'getPlayerTemporaryUtilityInstances').mockReturnValue(instances);

      coordinator.notifyUtilityFired();

      expect(bridge.getPlayerTemporaryUtilityInstances('player-a')).toEqual(instances);
    });
  });
});
