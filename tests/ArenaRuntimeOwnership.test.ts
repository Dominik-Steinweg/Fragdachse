import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', async () => {
  const { createFakePhaserModule } = await import('./fakeArenaRenderScene');
  return createFakePhaserModule();
});

import { ArenaRuntime } from '../src/scenes/arena/ArenaRuntime';

function fakeFrameCoordinator() {
  return {
    activityFramePort: null as { getStep(): unknown } | null,
    worldFramePort: null as object | null,
    setActivityFramePort(port: { getStep(): unknown }) { this.activityFramePort = port; },
    setWorldFramePort(port: object) { this.worldFramePort = port; },
    setPlayerFramePort: vi.fn(),
    setCombatFramePort: vi.fn(),
    runHostUpdate: vi.fn(),
    runClientUpdate: vi.fn(),
  };
}

function createArenaRuntime() {
  const hostUpdate = fakeFrameCoordinator();
  const clientUpdate = fakeFrameCoordinator();
  const runtime = new ArenaRuntime({
    scene: { time: { delayedCall: vi.fn() }, game: { events: { emit: vi.fn() } } } as never,
    ctx: {} as never,
    renderers: {} as never,
    rockVisualHelper: {} as never,
    placementPreview: {} as never,
    persistentBasePreviewRenderer: {} as never,
    persistentBaseVisuals: {} as never,
    lobbyOverlay: {} as never,
    hostUpdate: hostUpdate as never,
    clientUpdate: clientUpdate as never,
    roomQualityMonitor: {} as never,
    getLocalPlayerId: () => 'local',
    getSynchronizedNow: () => 1000,
    getSpectatorCameraInput: () => undefined,
  });
  return { runtime, hostUpdate, clientUpdate };
}

describe('ArenaRuntime – Ownership und Frame-Orchestrierung', () => {
  it('bündelt Flow und raumlanglebigen Persistent-Base-Owner', () => {
    const { runtime } = createArenaRuntime();
    const flow = (runtime as any).flow;

    expect(flow).toBeDefined();
    expect(runtime.persistentBase).toBeDefined();
    expect(flow.persistentBaseWorldPorts.getWorldBinding()).toBeNull();
    expect(flow.persistentBaseWorldPorts.getConstructionRuntime()).toBeNull();
  });

  it('meldet das Weapon Balance Lab erst mit Player- und Enemy-Runtime als bereit', () => {
    const { runtime } = createArenaRuntime();
    const flow = (runtime as any).flow;

    vi.spyOn(flow, 'getWorldPlayerGameplayRuntime').mockReturnValue(null);
    vi.spyOn(flow, 'getCoopMissionRuntime').mockReturnValue({ enemyManager: {} } as never);
    expect(runtime.weaponBalanceLabPort.isReady()).toBe(false);

    flow.getWorldPlayerGameplayRuntime.mockReturnValue({ systems: {} });
    flow.getCoopMissionRuntime.mockReturnValue(null);
    expect(runtime.weaponBalanceLabPort.isReady()).toBe(false);

    flow.getCoopMissionRuntime.mockReturnValue({ enemyManager: null });
    expect(runtime.weaponBalanceLabPort.isReady()).toBe(false);

    flow.getCoopMissionRuntime.mockReturnValue({ enemyManager: {} });
    expect(runtime.weaponBalanceLabPort.isReady()).toBe(true);
  });

  it('reicht den aktiven Activity-Schritt an beide Frame-Phasen weiter', () => {
    const { runtime, hostUpdate, clientUpdate } = createArenaRuntime();

    expect(hostUpdate.activityFramePort?.getStep()).toBeNull();
    expect(clientUpdate.activityFramePort?.getStep()).toBeNull();
    expect(runtime.runHostFrame(16, true)).toBeNull();

    const step = {
      hostResolveCompletion: vi.fn(() => 'victory' as const),
      hostApplyDebugBaseDamage: vi.fn(),
    };
    vi.spyOn((runtime as any).flow, 'getActivityStep').mockReturnValue(step as never);

    expect(hostUpdate.activityFramePort?.getStep()).toBe(step);
    expect(clientUpdate.activityFramePort?.getStep()).toBe(step);
    runtime.applyDebugBaseDamage(50);
    expect(step.hostApplyDebugBaseDamage).toHaveBeenCalledWith(50);
  });

  it('fragt den Rundenabschluss nur bei aktivem Gameplay ab und wendet ihn nicht selbst an', () => {
    const { runtime, hostUpdate } = createArenaRuntime();
    const step = { hostResolveCompletion: vi.fn(() => 'defeat' as const) };
    vi.spyOn((runtime as any).flow, 'getActivityStep').mockReturnValue(step as never);
    const completeRound = vi.spyOn((runtime as any).flow, 'hostCompleteRound').mockImplementation(() => {});

    expect(runtime.runHostFrame(16)).toBeNull();
    expect(hostUpdate.runHostUpdate).toHaveBeenCalledWith(16);
    expect(step.hostResolveCompletion).not.toHaveBeenCalled();

    expect(runtime.runHostFrame(16, true)).toBe('defeat');
    expect(step.hostResolveCompletion).toHaveBeenCalledTimes(1);
    expect(completeRound).not.toHaveBeenCalled();
  });

  it('taktet die raumlanglebigen Owner genau einmal pro Sync', () => {
    const { runtime } = createArenaRuntime();
    const contributions = vi.spyOn((runtime as any).persistentBaseOwner, 'syncPersistentBaseContributions')
      .mockImplementation(() => {});
    const rewards = vi.spyOn((runtime as any).persistentBaseOwner, 'syncPersistentBaseRewards')
      .mockImplementation(() => {});

    runtime.syncRoomOwners();

    expect(contributions).toHaveBeenCalledTimes(1);
    expect(rewards).toHaveBeenCalledTimes(1);
  });

  it('taktet World-, Host- und Client-Update über den Frame-Owner', () => {
    const { runtime, hostUpdate, clientUpdate } = createArenaRuntime();

    runtime.update(16);
    runtime.runHostFrame(16);
    runtime.runClientFrame(16);

    expect(hostUpdate.runHostUpdate).toHaveBeenCalledWith(16);
    expect(clientUpdate.runClientUpdate).toHaveBeenCalledWith(16);
  });
});
