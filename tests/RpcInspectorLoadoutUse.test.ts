import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeMock = vi.hoisted(() => ({
  isHost: vi.fn(() => true),
  isArenaCountdownActive: vi.fn(() => false),
  getGamePhase: vi.fn(() => 'ARENA'),
  getGameMode: vi.fn(() => 'coop_defense'),
  getActiveGameMode: vi.fn(() => 'coop_defense'),
  getPlayerCommittedLoadout: vi.fn(),
  getPlayerCurrentLoadoutSnapshot: vi.fn(),
  registerLoadoutUseHandler: vi.fn(),
  registerHeldActionHandler: vi.fn(),
}));

vi.mock('../src/network/bridge', () => ({ bridge: bridgeMock }));

import { getUtilityConfigForMode, UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { RpcCoordinator } from '../src/scenes/arena/RpcCoordinator';
import { HostHeldActionSystem } from '../src/systems/HostHeldActionSystem';
import type {
  HostHeldActionKind,
  LoadoutToolRef,
  LoadoutUseParams,
  LoadoutUseResult,
} from '../src/types';

type LoadoutHandler = (
  slot: 'utility',
  angle: number,
  targetX: number,
  targetY: number,
  senderId: string,
  shotId?: number,
  params?: LoadoutUseParams,
  clientX?: number,
  clientY?: number,
  clientNow?: number,
) => LoadoutUseResult;

type HeldActionHandler = (
  playerId: string,
  operation: 'start' | 'cancel',
  actionId: string,
  kind?: HostHeldActionKind,
  durationMs?: number,
  toolRef?: LoadoutToolRef,
  temporaryUtilityInstanceId?: string,
) => boolean;

const INSPECTOR_COMMITTED = {
  weapon1: 'GLOCK',
  weapon2: 'P90',
  utility: 'HE_GRENADE',
  ultimate: 'HONEY_BADGER_RAGE',
  coopDefenseClassId: 'inspector_gadachs',
  coopDefenseProfile: null,
  tools: [
    { kind: 'construction', id: 'rocket_turret' },
    { kind: 'utility', id: 'HE_GRENADE' },
    { kind: 'utility', id: 'BFG' },
  ],
};

function createFixture() {
  const consume = vi.fn();
  const start = vi.fn(() => true);
  const clearPlayer = vi.fn();
  const getEquippedUtilityConfig = vi.fn(() => UTILITY_CONFIGS.HE_GRENADE);
  const getTemporaryUtilityConfig = vi.fn((_playerId: string, instanceId: string) => (
    instanceId === 'temporary-utility-7' || instanceId === 'temporary-utility-8'
      ? UTILITY_CONFIGS.BFG
      : null
  ));
  const use = vi.fn((): LoadoutUseResult => ({ ok: true }));
  const ctx = {
    loadoutManager: { getEquippedUtilityConfig, getTemporaryUtilityConfig, use },
    hostHeldActionSystem: { consume, start, clearPlayer },
    translocatorSystem: { getActivePuckId: vi.fn(() => undefined) },
    combatSystem: { isAlive: vi.fn(() => true) },
    burrowSystem: { isBurrowed: vi.fn(() => false), isStunned: vi.fn(() => false) },
  };
  const lifecycle = {
    getActiveConstructionToolsForPlayer: vi.fn(() => [
      { kind: 'construction', id: 'rocket_turret' },
    ]),
    getPlayerCapabilities: vi.fn(() => ({
      canMove: true,
      canUseCombat: true,
      canPlace: true,
      canDismantle: true,
      canInteract: true,
      canUseMissionActions: true,
      canControlCamera: true,
    })),
    placeInspectorConstruction: vi.fn((): LoadoutUseResult => ({ ok: true })),
    useInspectorUtility: vi.fn((): LoadoutUseResult => ({ ok: true })),
    dismantleInspectorConstruction: vi.fn((): LoadoutUseResult => ({ ok: true })),
    dismantleAllInspectorConstructions: vi.fn((): LoadoutUseResult => ({ ok: true })),
  };
  const coordinator = new RpcCoordinator(
    undefined as never,
    ctx as never,
    {} as never,
    {} as never,
    {} as never,
  );
  coordinator.setLifecycle(lifecycle as never);

  return { coordinator, ctx, lifecycle, consume, start, getEquippedUtilityConfig, getTemporaryUtilityConfig, use };
}

function registerLoadoutHandler(coordinator: RpcCoordinator): LoadoutHandler {
  (coordinator as unknown as { registerLoadoutUseHandler: () => void }).registerLoadoutUseHandler();
  const call = [...bridgeMock.registerLoadoutUseHandler.mock.calls].pop();
  return call?.[0] as LoadoutHandler;
}

function registerHeldActionHandler(coordinator: RpcCoordinator): HeldActionHandler {
  (coordinator as unknown as { registerHeldActionHandler: () => void }).registerHeldActionHandler();
  const call = [...bridgeMock.registerHeldActionHandler.mock.calls].pop();
  return call?.[0] as HeldActionHandler;
}

beforeEach(() => {
  vi.clearAllMocks();
  bridgeMock.isHost.mockReturnValue(true);
  bridgeMock.isArenaCountdownActive.mockReturnValue(false);
  bridgeMock.getGamePhase.mockReturnValue('ARENA');
  bridgeMock.getGameMode.mockReturnValue('coop_defense');
  bridgeMock.getPlayerCommittedLoadout.mockReturnValue(INSPECTOR_COMMITTED);
  bridgeMock.getPlayerCurrentLoadoutSnapshot.mockImplementation(() => bridgeMock.getPlayerCommittedLoadout());
});

describe('Inspector loadout-use RPC classification', () => {
  it('places rocket_turret without consulting or consuming the regular charged utility', () => {
    const fixture = createFixture();
    const handler = registerLoadoutHandler(fixture.coordinator);

    const result = handler('utility', 0, 220, 180, 'p1', undefined, {
      constructionId: 'rocket_turret',
      toolRef: { kind: 'construction', id: 'rocket_turret' },
    });

    expect(result).toEqual({ ok: true });
    expect(fixture.lifecycle.placeInspectorConstruction).toHaveBeenCalledWith('p1', 'rocket_turret', 220, 180);
    expect(fixture.getEquippedUtilityConfig).not.toHaveBeenCalled();
    expect(fixture.consume).not.toHaveBeenCalled();
    expect(fixture.use).not.toHaveBeenCalled();
  });

  it('still rejects a normal HE grenade without its host-held action', () => {
    bridgeMock.getPlayerCommittedLoadout.mockReturnValue({
      ...INSPECTOR_COMMITTED,
      coopDefenseClassId: null,
      tools: undefined,
    });
    const fixture = createFixture();
    fixture.consume.mockReturnValue(null);
    const handler = registerLoadoutHandler(fixture.coordinator);

    const result = handler('utility', 0, 220, 180, 'p1', undefined, {});

    expect(result).toEqual({ ok: false, reason: 'blocked' });
    expect(fixture.getEquippedUtilityConfig).toHaveBeenCalledWith('p1');
    expect(fixture.consume).toHaveBeenCalledWith(
      'p1',
      undefined,
      'charged_throw',
      UTILITY_CONFIGS.HE_GRENADE.activation.fullChargeDuration,
      expect.any(Number),
    );
    expect(fixture.use).not.toHaveBeenCalled();
  });

  it('validates an Inspector charged utility with the toolRef config', () => {
    // Die mutable Lobby-Auswahl darf die laufende Coop-Activity nicht umkonfigurieren.
    bridgeMock.getGameMode.mockReturnValue('deathmatch');
    const fixture = createFixture();
    fixture.consume.mockReturnValue({ elapsedMs: 900, chargeFraction: 1 });
    const handler = registerLoadoutHandler(fixture.coordinator);

    const result = handler('utility', 0, 220, 180, 'p1', undefined, {
      toolRef: { kind: 'utility', id: 'BFG' },
      heldActionId: 'bfg-action',
    });

    expect(result).toEqual({ ok: true });
    expect(fixture.getEquippedUtilityConfig).not.toHaveBeenCalled();
    expect(fixture.consume).toHaveBeenCalledWith(
      'p1',
      'bfg-action',
      'charged_gate',
      getUtilityConfigForMode('BFG', 'coop_defense')?.activation.fullChargeDuration,
      expect.any(Number),
      { toolRef: { kind: 'utility', id: 'BFG' } },
    );
    expect(fixture.lifecycle.useInspectorUtility).toHaveBeenCalledWith(
      'p1',
      { kind: 'utility', id: 'BFG' },
      0,
      220,
      180,
      expect.any(Number),
      expect.objectContaining({ heldActionId: 'bfg-action', utilityChargeFraction: 1 }),
    );
  });

  it('keeps dismantle routes outside regular utility charge validation', () => {
    const fixture = createFixture();
    const handler = registerLoadoutHandler(fixture.coordinator);

    expect(handler('utility', 0, 220, 180, 'p1', undefined, { dismantle: true }))
      .toEqual({ ok: true });
    expect(fixture.lifecycle.dismantleInspectorConstruction).toHaveBeenCalledWith('p1', 220, 180);
    expect(fixture.getEquippedUtilityConfig).not.toHaveBeenCalled();
    expect(fixture.consume).not.toHaveBeenCalled();

    fixture.consume.mockReturnValue({ elapsedMs: 1_000, chargeFraction: 1 });
    expect(handler('utility', 0, 220, 180, 'p1', undefined, {
      globalDismantle: true,
      heldActionId: 'global-action',
    })).toEqual({ ok: true });
    expect(fixture.lifecycle.dismantleAllInspectorConstructions).toHaveBeenCalledWith('p1');
    expect(fixture.consume).toHaveBeenCalledWith(
      'p1',
      'global-action',
      'global_dismantle',
      1_000,
      expect.any(Number),
    );
  });

  it('starts an Inspector charge with the same typed tool config', () => {
    const fixture = createFixture();
    const handler = registerHeldActionHandler(fixture.coordinator);

    expect(handler('p1', 'start', 'bfg-action', 'charged_gate', 900, { kind: 'utility', id: 'BFG' }))
      .toBe(true);
    expect(fixture.getEquippedUtilityConfig).not.toHaveBeenCalled();
    expect(fixture.start).toHaveBeenCalledWith(
      'p1',
      'bfg-action',
      'charged_gate',
      getUtilityConfigForMode('BFG', 'coop_defense')?.activation.fullChargeDuration,
      expect.any(Number),
      { toolRef: { kind: 'utility', id: 'BFG' } },
    );
  });

  it('validates and routes a temporary utility by instance identity', () => {
    const fixture = createFixture();
    fixture.consume.mockReturnValue({ elapsedMs: 900, chargeFraction: 1 });
    const handler = registerLoadoutHandler(fixture.coordinator);

    const result = handler('utility', 0, 220, 180, 'p1', undefined, {
      temporaryUtilityInstanceId: 'temporary-utility-7',
      heldActionId: 'temporary-bfg-action',
    });

    expect(result).toEqual({ ok: true });
    expect(fixture.getTemporaryUtilityConfig).toHaveBeenCalledWith('p1', 'temporary-utility-7');
    expect(fixture.consume).toHaveBeenCalledWith(
      'p1',
      'temporary-bfg-action',
      'charged_gate',
      UTILITY_CONFIGS.BFG.activation.fullChargeDuration,
      expect.any(Number),
      { temporaryUtilityInstanceId: 'temporary-utility-7' },
    );
    expect(fixture.use).toHaveBeenCalledWith(
      'utility',
      'p1',
      0,
      220,
      180,
      expect.any(Number),
      undefined,
      expect.objectContaining({ temporaryUtilityInstanceId: 'temporary-utility-7' }),
      undefined,
      undefined,
    );
  });

  it('rejects a held charge when the release names another equal temporary instance', () => {
    const fixture = createFixture();
    fixture.ctx.hostHeldActionSystem = new HostHeldActionSystem();
    const start = registerHeldActionHandler(fixture.coordinator);
    const use = registerLoadoutHandler(fixture.coordinator);

    expect(start(
      'p1',
      'start',
      'temporary-bfg-a',
      'charged_gate',
      900,
      undefined,
      'temporary-utility-7',
    )).toBe(true);

    expect(use('utility', 0, 220, 180, 'p1', undefined, {
      temporaryUtilityInstanceId: 'temporary-utility-8',
      heldActionId: 'temporary-bfg-a',
    })).toEqual({ ok: false, reason: 'blocked' });
    expect(fixture.use).not.toHaveBeenCalled();
  });
});
