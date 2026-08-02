import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  isHost: false,
  version: 1,
  adrenaline: 5,
}));

const bridgeMock = vi.hoisted(() => ({
  isHost: vi.fn(() => testState.isHost),
  getLocalPlayerId: vi.fn(() => 'local-player'),
  getGameStateVersion: vi.fn(() => testState.version),
  getLatestGameState: vi.fn(() => ({
    players: {
      'local-player': { adrenaline: testState.adrenaline },
    },
  })),
}));

vi.mock('../src/network/bridge', () => ({ bridge: bridgeMock }));

import { ClientUpdateCoordinator } from '../src/scenes/arena/ClientUpdateCoordinator';

function makeCoordinator(authoritativeAdrenaline?: () => number): ClientUpdateCoordinator {
  const coordinator = Object.create(ClientUpdateCoordinator.prototype) as ClientUpdateCoordinator & {
    ctx: { resourceSystem: { getAdrenaline(id: string): number } | null };
    predictedLocalAdrenaline: number | null;
    predictedLocalAdrenalineSnapshot: number | null;
    predictedLocalAdrenalineSnapshotVersion: number;
    getLocalMaxAdrenaline(): number;
  };
  coordinator.ctx = {
    resourceSystem: authoritativeAdrenaline
      ? { getAdrenaline: () => authoritativeAdrenaline() }
      : null,
  };
  coordinator.predictedLocalAdrenaline = null;
  coordinator.predictedLocalAdrenalineSnapshot = null;
  coordinator.predictedLocalAdrenalineSnapshotVersion = -1;
  coordinator.getLocalMaxAdrenaline = () => 100;
  return coordinator;
}

describe('client weapon adrenaline prediction', () => {
  beforeEach(() => {
    testState.isHost = false;
    testState.version = 1;
    testState.adrenaline = 5;
    vi.clearAllMocks();
  });

  it('keeps a predicted spend reserved across stale snapshots', () => {
    const coordinator = makeCoordinator();

    expect(coordinator.getLocalAdrenaline()).toBe(5);
    coordinator.recordPredictedAdrenalineSpend(5);
    expect(coordinator.getLocalAdrenaline()).toBe(0);

    testState.version = 2;
    testState.adrenaline = 5;
    expect(coordinator.getLocalAdrenaline()).toBe(0);

    testState.version = 3;
    testState.adrenaline = 0;
    expect(coordinator.getLocalAdrenaline()).toBe(0);

    testState.version = 4;
    testState.adrenaline = 1;
    expect(coordinator.getLocalAdrenaline()).toBe(1);
  });

  it('uses the host resource system instead of a stale replicated value', () => {
    testState.isHost = true;
    testState.adrenaline = 5;
    const coordinator = makeCoordinator(() => 0);

    expect(coordinator.getLocalAdrenaline()).toBe(0);
    expect(bridgeMock.getLatestGameState).not.toHaveBeenCalled();
  });
});
