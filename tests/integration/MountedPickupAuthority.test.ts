import { afterEach, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => ({
  ...(await import('../fakeArenaRenderScene')).createFakePhaserModule(), Scene: class {},
  Filters: { Displacement: class {}, ParallelFilters: class {} },
}));
const bridge = vi.hoisted(() => ({
  isHost: () => true, getLocalPlayerId: () => 'pilot', isArenaCountdownActive: () => false,
  registerPickupPowerUpHandler: vi.fn(),
}));
vi.mock('../../src/network/bridge', () => ({ bridge }));

import { TurretControlSystem } from '../../src/systems/TurretControlSystem';
import { PowerUpSystem } from '../../src/powerups/PowerUpSystem';
import { ArenaLifecycleCoordinator } from '../../src/scenes/arena/ArenaLifecycleCoordinator';
import { HostUpdateCoordinator } from '../../src/scenes/arena/HostUpdateCoordinator';
import { RpcCoordinator } from '../../src/scenes/arena/RpcCoordinator';

afterEach(() => vi.restoreAllMocks());

it.each(['HEALTH_PACK', 'ARMOR'])('keeps local and remote %s pickups behind the same turret occupancy rule', defId => {
  const player = { id: 'pilot', x: 0, y: 0, angle: 0, active: true };
  const turret = { id: 1, x: 10, y: 0, ownerId: 'pilot', ownerColor: 1 };
  const occupancy = new TurretControlSystem({ getTurrets: () => [turret], getActor: () => player,
    canOccupy: () => true, canEnter: () => true, isFriendly: () => true, getInput: () => null,
    enter() {}, exit() {}, pin() {} });
  expect(occupancy.request('pilot', { action: 'enter', turretId: 1 })).toBe(true);
  const gameplay = { isBurrowed: () => false, isControllingTurret: (id: string) => occupancy.isOccupied(id) };
  const flow = Object.assign(Object.create(ArenaLifecycleCoordinator.prototype), {
    isArenaEntryProtected: () => false, getWorldParticipation: () => 'interactive',
    worldLifecycle: { activity: { kind: 'coop-mission' } },
  });
  Object.defineProperty(flow, 'worldPlayerGameplayRuntime', { value: gameplay });
  expect(flow.getPlayerCapabilities('pilot').canInteract).toBe(false);
  const apply = vi.fn();
  const powerups = new PowerUpSystem({ getPlayer: () => player } as never, {
    isAlive: () => true, isBurrowed: () => false, healToFull: apply, addArmor: apply,
  } as never, { seed: 1, rocks: [], trees: [], tracks: [], dirt: [], powerUpPedestals: [] } as never);
  const uid = powerups.spawnPickup(defId, 0, 0)!;
  const manager = { getPlayer: () => player };
  const rpc = Object.assign(Object.create(RpcCoordinator.prototype), {
    capabilities: { get: (id: string) => flow.getPlayerCapabilities(id) }, playerManager: manager,
    playerLoadout: { tryPickupPowerUp: (id: string, pickup: number, x: number, y: number) => powerups.tryPickup(id, pickup, x, y) },
  });
  rpc.registerPickupPowerUpHandler();
  expect(bridge.registerPickupPowerUpHandler.mock.calls.at(-1)![0](uid, 'pilot')).toBe(false);
  expect(apply).not.toHaveBeenCalled();
  const host = Object.assign(Object.create(HostUpdateCoordinator.prototype), {
    ctx: { playerManager: manager },
    playerFramePort: { getPlayerGameplayRuntime: () => gameplay, getPowerUpRuntime: () => ({ system: powerups }) },
  });
  host.setPlayerCapabilitiesResolver((id: string) => flow.getPlayerCapabilities(id));
  host.checkLocalPickup(powerups.getWorldItemSnapshot());
  expect(apply).not.toHaveBeenCalled();
  expect(powerups.getWorldItemSnapshot()).toHaveLength(1);
  const state = occupancy.getState('pilot')!;
  expect(occupancy.request('pilot', { action: 'exit', ...state })).toBe(true);
  expect(flow.getPlayerCapabilities('pilot').canInteract).toBe(true);
  host.checkLocalPickup(powerups.getWorldItemSnapshot());
  expect(apply).toHaveBeenCalledOnce();
  expect(apply.mock.calls[0][0]).toBe('pilot');
  expect(powerups.getWorldItemSnapshot()).toHaveLength(0);
  // An ordinary subsequent pickup remains available through the same local path.
  powerups.spawnPickup(defId, 0, 0);
  host.checkLocalPickup(powerups.getWorldItemSnapshot());
  expect(apply).toHaveBeenCalledTimes(2);
  expect(powerups.getWorldItemSnapshot()).toHaveLength(0);
});
