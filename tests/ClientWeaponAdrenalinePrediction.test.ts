import { beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  isHost: false,
  worldRevision: 1,
  adrenalineRevision: 1,
  predictionAck: 0,
  adrenaline: 100,
}));

const bridgeMock = vi.hoisted(() => ({
  isHost: vi.fn(() => testState.isHost),
  getLocalPlayerId: vi.fn(() => 'local-player'),
  getLatestGameState: vi.fn(() => ({
    worldRevision: testState.worldRevision,
    players: {
      'local-player': {
        adrenaline: testState.adrenaline,
        adrenalineRevision: testState.adrenalineRevision,
        weapon2PredictionAck: testState.predictionAck,
      },
    },
  })),
  getCurrentWorldRevision: vi.fn(() => testState.worldRevision),
  sendLoadoutUse: vi.fn(),
}));

vi.mock('../src/network/bridge', () => ({ bridge: bridgeMock }));

import { ClientUpdateCoordinator } from '../src/scenes/arena/ClientUpdateCoordinator';

type TestCoordinator = ClientUpdateCoordinator & {
  ctx: { resourceSystem: { getAdrenaline(id: string): number } | null };
  authoritativeAdrenaline: {
    worldRevision: number;
    value: number;
    revision: number;
    weapon2PredictionAck: number;
  } | null;
  pendingAdrenalineSpends: Map<number, { worldRevision: number; predictionId: number; amount: number; status: string }>;
};

function makeCoordinator(authoritativeAdrenaline?: () => number): TestCoordinator {
  const coordinator = Object.create(ClientUpdateCoordinator.prototype) as TestCoordinator;
  coordinator.ctx = {
    resourceSystem: authoritativeAdrenaline
      ? { getAdrenaline: () => authoritativeAdrenaline() }
      : null,
  };
  (coordinator as unknown as { authoritativeAdrenaline: null }).authoritativeAdrenaline = null;
  (coordinator as unknown as { pendingAdrenalineSpends: Map<unknown, unknown> }).pendingAdrenalineSpends = new Map();
  (coordinator as unknown as { localFirePredictions: unknown }).localFirePredictions = {
    weapon1: [],
    weapon2: [],
  };
  (coordinator as unknown as { weaponLastFired: { weapon1: number; weapon2: number } }).weaponLastFired = {
    weapon1: 0,
    weapon2: 0,
  };
  (coordinator as unknown as { nextPredictionId: number }).nextPredictionId = 1;
  return coordinator;
}

describe('client weapon adrenaline prediction', () => {
  beforeEach(() => {
    testState.isHost = false;
    testState.worldRevision = 1;
    testState.adrenalineRevision = 1;
    testState.predictionAck = 0;
    testState.adrenaline = 100;
    vi.clearAllMocks();
  });

  it('uses an authoritative baseline plus explicit pending reservations, never snapshot deltas', () => {
    const coordinator = makeCoordinator();

    expect(coordinator.getLocalAdrenaline()).toBe(100);
    coordinator.pendingAdrenalineSpends.set(17, {
      worldRevision: 1,
      predictionId: 17,
      amount: 30,
      status: 'uncertain',
    });
    expect(coordinator.getLocalAdrenaline()).toBe(70);

    // 100 -> 80 may include a gain and a spend; it is not an implicit ACK.
    testState.adrenaline = 80;
    testState.adrenalineRevision = 2;
    expect(coordinator.getLocalAdrenaline()).toBe(50);

    // A same-valued refund/gain is also resolved only by its explicit ACK.
    testState.adrenaline = 100;
    testState.adrenalineRevision = 3;
    expect(coordinator.getLocalAdrenaline()).toBe(70);

    testState.predictionAck = 17;
    expect(coordinator.getLocalAdrenaline()).toBe(100);
    expect(coordinator.pendingAdrenalineSpends.size).toBe(0);
  });

  it('resets a reused predictionId at a new World instead of accepting the old baseline', () => {
    const coordinator = makeCoordinator();
    expect(coordinator.getLocalAdrenaline()).toBe(100);
    coordinator.pendingAdrenalineSpends.set(5, {
      worldRevision: 1,
      predictionId: 5,
      amount: 30,
      status: 'pending',
    });

    testState.worldRevision = 2;
    testState.adrenaline = 40;
    testState.adrenalineRevision = 3;
    testState.predictionAck = 0;

    expect(coordinator.getLocalAdrenaline()).toBe(40);
    expect(coordinator.pendingAdrenalineSpends.size).toBe(0);
  });

  it('distinguishes a predicted projectile fire from a local cooldown abort', () => {
    const coordinator = makeCoordinator();
    const firePrediction = coordinator as unknown as {
      ctx: {
        resourceSystem: null;
        aimSystem: { notifyShot: ReturnType<typeof vi.fn> };
        effectSystem: { playLocalShotAudio: ReturnType<typeof vi.fn> };
        leftPanel: { flashSlot: ReturnType<typeof vi.fn> };
      };
      getLocalWeaponConfig: () => unknown;
      getLocalWeaponAdrenalineCost: () => number;
      playPredictedLocalHitscanTracer: () => undefined;
    };
    firePrediction.ctx = {
      resourceSystem: null,
      aimSystem: { notifyShot: vi.fn() },
      effectSystem: { playLocalShotAudio: vi.fn() },
      leftPanel: { flashSlot: vi.fn() },
    };
    firePrediction.getLocalWeaponConfig = () => ({
      cooldown: 950,
      fire: { type: 'projectile' },
      adrenalinCost: 30,
    });
    firePrediction.getLocalWeaponAdrenalineCost = () => 30;
    firePrediction.playPredictedLocalHitscanTracer = () => undefined;

    const fired = coordinator.notifyLoadoutFired('weapon2', 0, 1, 2);
    const aborted = coordinator.notifyLoadoutFired('weapon2', 0, 1, 2);

    expect(fired).toMatchObject({ fired: true, predictionId: 1 });
    expect(aborted).toEqual({ fired: false });
    expect((coordinator as unknown as { localFirePredictions: { weapon2: unknown[] } })
      .localFirePredictions.weapon2).toHaveLength(1);
  });

  it('uses the host resource system instead of a stale replicated value', () => {
    testState.isHost = true;
    const coordinator = makeCoordinator(() => 12);

    expect(coordinator.getLocalAdrenaline()).toBe(12);
    expect(bridgeMock.getLatestGameState).not.toHaveBeenCalled();
  });

  it('retries a timed-out request with the same prediction identity and one reservation', async () => {
    const coordinator = makeCoordinator();
    bridgeMock.sendLoadoutUse
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({
        ok: true,
        worldRevision: 1,
        authoritativeAdrenaline: 70,
        adrenalineRevision: 2,
        weapon2PredictionAck: 1,
      });
    vi.useFakeTimers();
    try {
      coordinator.beginPredictedWeapon2Use(
        1,
        { angle: 0.5, targetX: 4, targetY: 8, clientNow: 123 },
        30,
        vi.fn(),
      );
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(250);
      await vi.runAllTimersAsync();
      expect(bridgeMock.sendLoadoutUse).toHaveBeenCalledTimes(2);
      expect(bridgeMock.sendLoadoutUse.mock.calls[0].at(-1)).toBe(1);
      expect(bridgeMock.sendLoadoutUse.mock.calls[1].at(-1)).toBe(1);
      expect(bridgeMock.sendLoadoutUse.mock.calls[1]).toEqual(bridgeMock.sendLoadoutUse.mock.calls[0]);
      expect(coordinator.pendingAdrenalineSpends.size).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves a timed-out reservation from a later ACK without retrying it again', async () => {
    const coordinator = makeCoordinator();
    bridgeMock.sendLoadoutUse.mockRejectedValueOnce(new Error('timeout'));
    vi.useFakeTimers();
    try {
      coordinator.beginPredictedWeapon2Use(
        17,
        { angle: 0.5, targetX: 4, targetY: 8, clientNow: 123 },
        30,
        vi.fn(),
      );
      await Promise.resolve();
      await Promise.resolve();
      expect(coordinator.getLocalAdrenaline()).toBe(70);

      testState.predictionAck = 17;
      coordinator.retryUnresolvedWeapon2Predictions();

      expect(coordinator.pendingAdrenalineSpends.size).toBe(0);
      expect(bridgeMock.sendLoadoutUse).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
