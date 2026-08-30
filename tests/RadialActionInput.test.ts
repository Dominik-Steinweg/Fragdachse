import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Angle: { Between: () => 0 },
  },
  Input: {
    Keyboard: {
      JustDown: (key: { justDown?: boolean }) => key.justDown === true,
      JustUp: (key: { justUp?: boolean }) => key.justUp === true,
    },
  },
  Scenes: { Events: { SHUTDOWN: 'shutdown' } },
}));

vi.mock('../src/graphics/cameraBaseScroll', () => ({
  getUnshakenPointerWorldPoint: () => ({ x: 100, y: 0 }),
}));

import { UTILITY_CONFIGS } from '../src/loadout/LoadoutConfig';
import { InputSystem } from '../src/systems/InputSystem';

interface TestKey {
  isDown: boolean;
  justDown: boolean;
  justUp: boolean;
}

function key(): TestKey {
  return { isDown: false, justDown: false, justUp: false };
}

function createSystem() {
  const pointerState = { left: false, right: false };
  const pointer = {
    x: 80,
    y: 40,
    leftButtonDown: () => pointerState.left,
    rightButtonDown: () => pointerState.right,
  };
  const bridge = {
    getWorldDescriptor: () => null,
    getActiveGameMode: () => 'coop_defense',
    getSynchronizedNow: () => Date.now(),
    sendLocalInput: vi.fn(),
    sendLocalPlacementPreview: vi.fn(),
    sendLoadoutUse: vi.fn(),
    sendHeldActionStart: vi.fn(),
    sendHeldActionCancel: vi.fn(),
    sendDecoyStealthBreakRequest: vi.fn(),
    getLocalPlayerId: () => 'p1',
  };
  const scene = { input: { activePointer: pointer } };
  const system = new InputSystem(scene as never, bridge as never, () => ({ x: 0, y: 0 } as never));
  const keys = {
    keyW: key(), keyA: key(), keyS: key(), keyD: key(), keySpace: key(), keyShift: key(),
    keyE: key(), keyQ: key(), keyR: key(), keyB: key(), keyN: key(),
  };
  Object.assign(system as never as Record<string, unknown>, keys, {
    localBurrowPhase: 'idle',
    radialEnabled: true,
  });
  return { system, keys, bridge, pointerState };
}

describe('Radial Menu V2 input', () => {
  it.each(['dachs_nukem', 'dachs_of_steel', 'inspector_gadachs'] as const)(
    'opens the same action model with R for %s',
    (_classId) => {
      const { system, keys } = createSystem();
      const menu = {
        isOpen: false,
        open: vi.fn(function (this: { isOpen: boolean }) { this.isOpen = true; }),
        update: vi.fn(),
        close: vi.fn(() => null),
      };
      Object.assign(system as never as Record<string, unknown>, {
        radialActionMenu: menu,
        radialGetTools: () => [{ kind: 'utility', id: 'STINK_CLOUD' }],
        radialGetCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
      });
      keys.keyR.isDown = true;
      keys.keyR.justDown = true;

      const handled = (system as never as { updateRadialActionMenu(): boolean }).updateRadialActionMenu();

      expect(handled).toBe(true);
      expect(menu.open).toHaveBeenCalledTimes(1);
      expect(menu.open.mock.calls[0]?.[2]).toMatchObject([
        { ref: { kind: 'utility', utilityId: 'STINK_CLOUD' }, category: 'utility' },
      ]);
    },
  );

  it('dispatches the canonically selected normal utility on E', () => {
    const { system, keys } = createSystem();
    system.setupRadialActionProviders({
      getTools: () => [{ kind: 'utility', id: 'STINK_CLOUD' }],
      getCooldownUntil: () => 0,
      getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
    });
    system.setupUtilityConfigProvider(() => UTILITY_CONFIGS.STINK_CLOUD);
    system.setupUtilityCooldownProvider(() => 0);
    const uses = vi.fn();
    system.setupLoadoutListener(uses);
    keys.keyE.justDown = true;
    keys.keyE.isDown = true;

    system.update();

    expect(uses).toHaveBeenCalledTimes(1);
    expect(uses.mock.calls[0]?.[0]).toBe('utility');
  });

  it('delegates tool-loadout utility identity without a parallel selection state', () => {
    const { system, keys } = createSystem();
    system.setupRadialActionProviders({
      getTools: () => [{ kind: 'utility', id: 'STINK_CLOUD' }],
      getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
      utilityUsesToolRef: (utilityId) => utilityId === 'STINK_CLOUD',
    });
    system.setupUtilityConfigProvider(() => UTILITY_CONFIGS.STINK_CLOUD);
    system.setupUtilityCooldownProvider(() => 0);
    const uses = vi.fn();
    system.setupLoadoutListener(uses);
    keys.keyE.justDown = true;
    keys.keyE.isDown = true;

    system.update();

    expect(uses).toHaveBeenCalledTimes(1);
    expect(uses.mock.calls[0]?.[4]).toMatchObject({
      toolRef: { kind: 'utility', id: 'STINK_CLOUD' },
    });
  });

  it('evaluates authoritative cooldowns on the synchronized clock when the client clock is behind', () => {
    vi.useFakeTimers();
    vi.setSystemTime(95_000);
    try {
      const { system, bridge } = createSystem();
      let synchronizedNow = 100_000;
      let authoritativeCooldown = 101_000;
      bridge.getSynchronizedNow = () => synchronizedNow;
      system.setupRadialActionProviders({
        getTools: () => [{ kind: 'utility', id: 'STINK_CLOUD' }],
        getCooldownUntil: () => authoritativeCooldown,
        getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
      });
      system.setupUtilityCooldownProvider(() => authoritativeCooldown);

      const getStates = () => (system as any).getRadialActionStates() as Array<{
        ref: { kind: string; utilityId?: string };
        available: boolean;
        cooldownUntil: number;
      }>;
      expect(getStates().find((entry) => entry.ref.utilityId === 'STINK_CLOUD')).toMatchObject({
        available: false,
        cooldownUntil: 101_000,
      });
      expect(system.getSelectedUtilityCooldownUntil()).toBe(101_000);

      synchronizedNow = 101_000;
      expect(getStates().find((entry) => entry.ref.utilityId === 'STINK_CLOUD')).toMatchObject({
        available: true,
        cooldownUntil: 101_000,
      });
      expect(system.getSelectedUtilityCooldownUntil()).toBe(101_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a client clock ahead of the host expire cooldowns early', () => {
    vi.useFakeTimers();
    vi.setSystemTime(105_000);
    try {
      const { system, bridge } = createSystem();
      let synchronizedNow = 100_000;
      let authoritativeCooldown = 101_000;
      bridge.getSynchronizedNow = () => synchronizedNow;
      system.setupRadialActionProviders({
        getTools: () => [{ kind: 'utility', id: 'STINK_CLOUD' }],
        getCooldownUntil: () => authoritativeCooldown,
        getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
      });
      system.setupUtilityCooldownProvider(() => authoritativeCooldown);

      const getStates = () => (system as any).getRadialActionStates() as Array<{
        ref: { kind: string; utilityId?: string };
        available: boolean;
        cooldownUntil: number;
      }>;
      expect(getStates().find((entry) => entry.ref.utilityId === 'STINK_CLOUD')).toMatchObject({
        available: false,
        cooldownUntil: 101_000,
      });
      expect(system.getSelectedUtilityCooldownUntil()).toBe(101_000);

      synchronizedNow = 101_000;
      expect(getStates().find((entry) => entry.ref.utilityId === 'STINK_CLOUD')).toMatchObject({
        available: true,
        cooldownUntil: 101_000,
      });
      expect(system.getSelectedUtilityCooldownUntil()).toBe(101_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('starts normal utility prediction from synchronized time, not local Date.now()', () => {
    vi.useFakeTimers();
    vi.setSystemTime(95_000);
    try {
      const { system, keys, bridge } = createSystem();
      bridge.getSynchronizedNow = () => 100_000;
      const utilityConfig = { ...UTILITY_CONFIGS.STINK_CLOUD, cooldown: 8_000 };
      const uses = vi.fn();
      system.setupRadialActionProviders({
        getTools: () => [{ kind: 'utility', id: 'STINK_CLOUD' }],
        getCooldownUntil: () => 0,
        getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
      });
      system.setupUtilityConfigProvider(() => utilityConfig);
      system.setupUtilityCooldownProvider(() => 0);
      system.setupLoadoutListener(uses);

      keys.keyE.isDown = true;
      keys.keyE.justDown = true;
      system.update();

      expect(uses).toHaveBeenCalledTimes(1);
      expect(system.getPredictedUtilityCooldownUntil({ kind: 'utility', utilityId: 'STINK_CLOUD' }))
        .toBe(108_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let the prediction block the instant request that creates it', () => {
    const { system, keys, bridge } = createSystem();
    let authoritativeCooldown = 0;
    const dispatches = vi.fn();
    system.setupRadialActionProviders({
      getTools: () => [{ kind: 'utility', id: 'STINK_CLOUD' }],
      getCooldownUntil: () => authoritativeCooldown,
      getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
    });
    system.setupUtilityConfigProvider(() => UTILITY_CONFIGS.STINK_CLOUD);
    system.setupUtilityCooldownProvider(() => authoritativeCooldown);
    // Mirrors ArenaScene's synchronous request gate: only authoritative state decides whether
    // this already-admitted request reaches the transport.
    system.setupLoadoutListener((slot, angle, targetX, targetY, params) => {
      if (authoritativeCooldown > Date.now()) return;
      bridge.sendLoadoutUse(slot, angle, targetX, targetY, params);
      dispatches();
    });

    keys.keyE.isDown = true;
    keys.keyE.justDown = true;
    system.update();

    expect(dispatches).toHaveBeenCalledTimes(1);
    expect(bridge.sendLoadoutUse).toHaveBeenCalledTimes(1);
    expect(system.getPredictedUtilityCooldownUntil({ kind: 'utility', utilityId: 'STINK_CLOUD' }))
      .toBeGreaterThan(Date.now());

    // The prediction now blocks a second InputSystem dispatch even though the host snapshot is
    // still ready. The synchronous gate must not be the only protection against duplicates.
    system.update();
    expect(dispatches).toHaveBeenCalledTimes(1);
    expect(bridge.sendLoadoutUse).toHaveBeenCalledTimes(1);
  });

  it('does not self-block a targeted utility confirmation', () => {
    const { system, keys, pointerState } = createSystem();
    let authoritativeCooldown = 0;
    const dispatches = vi.fn();
    const nukeConfig = { ...UTILITY_CONFIGS.NUKE, cooldown: 2_000 };
    system.setupRadialActionProviders({
      getTools: () => [{ kind: 'utility', id: 'NUKE' }],
      getCooldownUntil: () => authoritativeCooldown,
      getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
    });
    system.setupUtilityConfigProvider(() => nukeConfig);
    system.setupUtilityCooldownProvider(() => authoritativeCooldown);
    system.setupLoadoutListener((slot, angle, targetX, targetY, params) => {
      if (authoritativeCooldown > Date.now()) return;
      dispatches(slot, angle, targetX, targetY, params);
    });

    keys.keyE.isDown = true;
    keys.keyE.justDown = true;
    system.update();
    expect(dispatches).not.toHaveBeenCalled();

    keys.keyE.isDown = false;
    keys.keyE.justDown = false;
    pointerState.left = true;
    system.update();
    expect(dispatches).toHaveBeenCalledTimes(1);
    expect(system.getPredictedUtilityCooldownUntil({ kind: 'utility', utilityId: 'NUKE' }))
      .toBeGreaterThan(Date.now());

    pointerState.left = false;
    system.update();
    keys.keyE.isDown = true;
    keys.keyE.justDown = true;
    system.update();
    expect(dispatches).toHaveBeenCalledTimes(1);
  });

  it('keeps first-use dispatch independent for equal temporary instances', () => {
    vi.useFakeTimers();
    vi.setSystemTime(95_000);
    try {
      const { system, keys, bridge } = createSystem();
      bridge.getSynchronizedNow = () => 100_000;
      const utilityConfig = { ...UTILITY_CONFIGS.STINK_CLOUD, cooldown: 8_000 };
      const temporaryUtilities = [
        {
          kind: 'utility' as const, instanceId: 'temp-a', utilityId: 'STINK_CLOUD', charges: 2,
          cooldownUntil: 0, cooldownDurationMs: 8_000, acquisitionOrder: 0,
        },
        {
          kind: 'utility' as const, instanceId: 'temp-b', utilityId: 'STINK_CLOUD', charges: 1,
          cooldownUntil: 0, cooldownDurationMs: 8_000, acquisitionOrder: 1,
        },
      ];
      const dispatches = vi.fn();
      system.setupRadialActionProviders({
        getTools: () => [{ kind: 'utility', id: 'STINK_CLOUD' }],
        getCooldownUntil: () => 0,
        getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
      });
      system.setupTemporaryUtilityProvider(() => temporaryUtilities);
      system.setupUtilityConfigProvider(() => utilityConfig);
      system.setupUtilityCooldownProvider(() => 0);
      system.setupLoadoutListener((_slot, _angle, _targetX, _targetY, params) => {
        if (params?.temporaryUtilityInstanceId) dispatches(params.temporaryUtilityInstanceId);
      });
      const actionA = { kind: 'temporary-utility' as const, instanceId: 'temp-a', utilityId: 'STINK_CLOUD' };
      const actionB = { kind: 'temporary-utility' as const, instanceId: 'temp-b', utilityId: 'STINK_CLOUD' };
      system.getSelectedRadialActionForHud();
      (system as any).applyRadialSelection(actionA);

      keys.keyE.isDown = true;
      keys.keyE.justDown = true;
      system.update();
      expect(dispatches).toHaveBeenLastCalledWith('temp-a');
      expect(system.getPredictedUtilityCooldownUntil(actionA)).toBe(108_000);

      (system as any).applyRadialSelection(actionB);
      system.update();
      expect(dispatches).toHaveBeenLastCalledWith('temp-b');
      expect(dispatches).toHaveBeenCalledTimes(2);
      expect(system.getPredictedUtilityCooldownUntil(actionB)).toBe(108_000);
    } finally {
      vi.useRealTimers();
    }
  });

  it('dispatches a charged temporary release before its prediction gates later input', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const { system, keys, bridge } = createSystem();
      const bfgConfig = { ...UTILITY_CONFIGS.BFG, cooldown: 2_000 };
      const temporaryUtilities = [{
        kind: 'utility' as const, instanceId: 'temp-bfg', utilityId: 'BFG', charges: 1,
        cooldownUntil: 0, cooldownDurationMs: 2_000, acquisitionOrder: 0,
      }];
      const dispatches = vi.fn();
      system.setupRadialActionProviders({
        getTools: () => [],
        getCooldownUntil: () => 0,
        getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
      });
      system.setupTemporaryUtilityProvider(() => temporaryUtilities);
      system.setupUtilityConfigProvider(() => bfgConfig);
      system.setupUtilityCooldownProvider(() => 0);
      system.setupLoadoutListener((_slot, _angle, _targetX, _targetY, params) => {
        dispatches(params);
      });
      const action = { kind: 'temporary-utility' as const, instanceId: 'temp-bfg', utilityId: 'BFG' };
      (system as any).applyRadialSelection(action);

      keys.keyE.isDown = true;
      keys.keyE.justDown = true;
      system.update();
      expect(bridge.sendHeldActionStart).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(900);
      keys.keyE.isDown = false;
      keys.keyE.justDown = false;
      keys.keyE.justUp = true;
      system.update();

      expect(dispatches).toHaveBeenCalledTimes(1);
      expect(dispatches.mock.calls[0]?.[0]).toMatchObject({
        temporaryUtilityInstanceId: 'temp-bfg',
        heldActionId: expect.any(String),
        utilityChargeFraction: 1,
      });
      expect(system.getPredictedUtilityCooldownUntil(action)).toBe(3_900);
    } finally {
      vi.useRealTimers();
    }
  });

  it('auto-selects new temporary instances and restores nested selection history', () => {
    const { system } = createSystem();
    let temporaryUtilities: Array<{
      kind: 'utility'; instanceId: string; utilityId: string; charges: number;
      cooldownUntil: number; cooldownDurationMs: number; acquisitionOrder: number;
    }> = [];
    system.setupRadialActionProviders({
      getTools: () => [{ kind: 'utility', id: 'STINK_CLOUD' }],
      getCooldownUntil: () => 0,
      getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
    });
    system.setupTemporaryUtilityProvider(() => temporaryUtilities);

    expect(system.getSelectedRadialActionForHud()).toEqual({ kind: 'utility', utilityId: 'STINK_CLOUD' });
    expect(system.getSelectedHeldItemIdForPresentation()).toBe('STINK_CLOUD');
    temporaryUtilities = [{
      kind: 'utility', instanceId: 'temp-1', utilityId: 'BFG', charges: 1,
      cooldownUntil: 0, cooldownDurationMs: 1_000, acquisitionOrder: 0,
    }];
    expect(system.getSelectedRadialActionForHud()).toEqual({
      kind: 'temporary-utility', instanceId: 'temp-1', utilityId: 'BFG',
    });
    expect(system.getSelectedHeldItemIdForPresentation()).toBe('BFG');
    temporaryUtilities = [...temporaryUtilities, {
      kind: 'utility', instanceId: 'temp-2', utilityId: 'BFG', charges: 1,
      cooldownUntil: 0, cooldownDurationMs: 1_000, acquisitionOrder: 1,
    }];
    expect(system.getSelectedRadialActionForHud()).toEqual({
      kind: 'temporary-utility', instanceId: 'temp-2', utilityId: 'BFG',
    });
    expect(system.getSelectedHeldItemIdForPresentation()).toBe('BFG');

    temporaryUtilities = temporaryUtilities.filter((instance) => instance.instanceId !== 'temp-2');
    expect(system.getSelectedRadialActionForHud()).toEqual({
      kind: 'temporary-utility', instanceId: 'temp-1', utilityId: 'BFG',
    });
    expect(system.getSelectedHeldItemIdForPresentation()).toBe('BFG');
    temporaryUtilities = [];
    expect(system.getSelectedRadialActionForHud()).toEqual({ kind: 'utility', utilityId: 'STINK_CLOUD' });
    expect(system.getSelectedHeldItemIdForPresentation()).toBe('STINK_CLOUD');
  });

  it('keeps two Nukes and a BFG as three independent radial actions without a cap', () => {
    const { system } = createSystem();
    const temporaryUtilities = [
      {
        kind: 'utility' as const, instanceId: 'nuke-a', utilityId: 'NUKE', charges: 1,
        cooldownUntil: 0, cooldownDurationMs: 8_000, acquisitionOrder: 0,
      },
      {
        kind: 'utility' as const, instanceId: 'nuke-b', utilityId: 'NUKE', charges: 1,
        cooldownUntil: 0, cooldownDurationMs: 8_000, acquisitionOrder: 1,
      },
      {
        kind: 'utility' as const, instanceId: 'bfg', utilityId: 'BFG', charges: 1,
        cooldownUntil: 0, cooldownDurationMs: 8_000, acquisitionOrder: 2,
      },
    ];
    system.setupRadialActionProviders({
      getTools: () => [],
      getCooldownUntil: () => 0,
      getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
    });
    system.setupTemporaryUtilityProvider(() => temporaryUtilities);

    const actions = (system as any).getRadialActionStates() as Array<{
      ref: { kind: string; instanceId?: string; utilityId?: string };
    }>;
    const temporaryActions = actions.filter((entry) => entry.ref.kind === 'temporary-utility');
    expect(temporaryActions.map((entry) => entry.ref.instanceId)).toEqual(['nuke-a', 'nuke-b', 'bfg']);
    expect(new Set(temporaryActions.map((entry) => entry.ref.instanceId)).size).toBe(3);
    expect(temporaryActions.map((entry) => entry.ref.utilityId)).toEqual(['NUKE', 'NUKE', 'BFG']);
    expect(system.getSelectedRadialActionForHud()).toEqual({
      kind: 'temporary-utility', instanceId: 'bfg', utilityId: 'BFG',
    });
  });

  it('clears temporary return history after explicit selection', () => {
    const { system } = createSystem();
    let temporaryUtilities = [{
      kind: 'utility' as const, instanceId: 'temp-1', utilityId: 'BFG', charges: 1,
      cooldownUntil: 0, cooldownDurationMs: 1_000, acquisitionOrder: 0,
    }];
    system.setupRadialActionProviders({
      getTools: () => [{ kind: 'utility', id: 'STINK_CLOUD' }],
    });
    system.setupTemporaryUtilityProvider(() => temporaryUtilities);
    expect(system.getSelectedRadialActionForHud()?.kind).toBe('temporary-utility');

    (system as any).applyRadialSelection({ kind: 'utility', utilityId: 'STINK_CLOUD' });
    temporaryUtilities = [];

    expect(system.getSelectedRadialActionForHud()).toEqual({ kind: 'utility', utilityId: 'STINK_CLOUD' });
    expect((system as any).radialSelectionHistory).toEqual([]);
  });

  it('revalidates a radial candidate against the current temporary collection on close', () => {
    const { system, keys } = createSystem();
    let temporaryUtilities = [
      {
        kind: 'utility' as const, instanceId: 'temp-a', utilityId: 'BFG', charges: 1,
        cooldownUntil: 0, cooldownDurationMs: 1_000, acquisitionOrder: 0,
      },
      {
        kind: 'utility' as const, instanceId: 'temp-b', utilityId: 'BFG', charges: 1,
        cooldownUntil: 0, cooldownDurationMs: 1_000, acquisitionOrder: 1,
      },
    ];
    const menu = {
      isOpen: false,
      open: vi.fn(function (this: { isOpen: boolean }) { this.isOpen = true; }),
      update: vi.fn(),
      close: vi.fn(function (this: { isOpen: boolean }) {
        this.isOpen = false;
        return { kind: 'temporary-utility' as const, instanceId: 'temp-a', utilityId: 'BFG' };
      }),
    };
    Object.assign(system as never as Record<string, unknown>, {
      radialActionMenu: menu,
      radialGetTools: () => [],
      radialGetCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
    });
    system.setupTemporaryUtilityProvider(() => temporaryUtilities);
    system.getSelectedRadialActionForHud();
    (system as any).applyRadialSelection({
      kind: 'temporary-utility', instanceId: 'temp-a', utilityId: 'BFG',
    });

    keys.keyR.isDown = true;
    keys.keyR.justDown = true;
    expect((system as never as { updateRadialActionMenu(): boolean }).updateRadialActionMenu()).toBe(true);
    expect(system.getSelectedRadialActionForHud()).toEqual({
      kind: 'temporary-utility', instanceId: 'temp-a', utilityId: 'BFG',
    });

    temporaryUtilities = [temporaryUtilities[1]!];
    keys.keyR.isDown = false;
    keys.keyR.justDown = false;
    expect((system as never as { updateRadialActionMenu(): boolean }).updateRadialActionMenu()).toBe(true);
    expect(system.getSelectedRadialActionForHud()).toEqual({
      kind: 'temporary-utility', instanceId: 'temp-b', utilityId: 'BFG',
    });
  });

  it('keeps cooldown prediction per action and converges without an early ready reset', () => {
    vi.useFakeTimers();
    vi.setSystemTime(95_000);
    try {
      const { system, bridge } = createSystem();
      bridge.getSynchronizedNow = () => 100_000;
      let temporaryUtilities = [
        {
          kind: 'utility' as const, instanceId: 'temp-a', utilityId: 'BFG', charges: 2,
          cooldownUntil: 0, cooldownDurationMs: 8_000, acquisitionOrder: 0,
        },
        {
          kind: 'utility' as const, instanceId: 'temp-b', utilityId: 'BFG', charges: 1,
          cooldownUntil: 0, cooldownDurationMs: 8_000, acquisitionOrder: 1,
        },
      ];
      let authoritativeCooldown = 0;
      system.setupTemporaryUtilityProvider(() => temporaryUtilities);
      system.setupUtilityCooldownProvider(() => authoritativeCooldown);
      const actionA = { kind: 'temporary-utility' as const, instanceId: 'temp-a', utilityId: 'BFG' };
      const actionB = { kind: 'temporary-utility' as const, instanceId: 'temp-b', utilityId: 'BFG' };
      system.getSelectedRadialActionForHud();
      (system as any).applyRadialSelection(actionA);
      (system as any).predictUtilityCooldown(actionA, 108_000);

      const actions = (system as any).getRadialActionStates() as Array<{
        ref: typeof actionA; available: boolean; cooldownUntil: number;
      }>;
      expect(actions.find((entry) => entry.ref.instanceId === 'temp-a')).toMatchObject({
        available: false,
        cooldownUntil: 108_000,
      });
      expect(actions.find((entry) => entry.ref.instanceId === 'temp-b')).toMatchObject({ available: true });
      expect((system as any).getEffectiveUtilityCooldownUntil()).toBe(108_000);

      authoritativeCooldown = 108_500;
      temporaryUtilities[0] = { ...temporaryUtilities[0]!, cooldownUntil: 108_500 };
      const convergedActions = (system as any).getRadialActionStates() as Array<{
        ref: typeof actionA; available: boolean; cooldownUntil: number;
      }>;
      expect(convergedActions.find((entry) => entry.ref.instanceId === 'temp-a')).toMatchObject({
        available: false,
        cooldownUntil: 108_500,
      });
      expect((system as any).getEffectiveUtilityCooldownUntil()).toBe(108_500);
      expect(system.getPredictedUtilityCooldownUntil(actionA)).toBe(0);

      temporaryUtilities = [temporaryUtilities[1]!];
      expect(system.getSelectedRadialActionForHud()).toEqual(actionB);
      expect(system.getPredictedUtilityCooldownUntil(actionA)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses an R press only to cancel an active interaction and requires a fresh press to open', () => {
    const { system, keys } = createSystem();
    const menu = {
      isOpen: false,
      open: vi.fn(function (this: { isOpen: boolean }) { this.isOpen = true; }),
      update: vi.fn(),
      close: vi.fn(() => null),
    };
    Object.assign(system as never as Record<string, unknown>, {
      radialActionMenu: menu,
      radialGetTools: () => [{ kind: 'utility', id: 'STINK_CLOUD' }],
      radialGetCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
      utilityPlacementActive: true,
    });

    keys.keyR.isDown = true;
    keys.keyR.justDown = true;
    expect((system as never as { updateRadialActionMenu(): boolean }).updateRadialActionMenu()).toBe(true);
    expect(menu.open).not.toHaveBeenCalled();
    expect((system as never as { utilityPlacementActive: boolean }).utilityPlacementActive).toBe(false);

    keys.keyR.isDown = false;
    keys.keyR.justDown = false;
    expect((system as never as { updateRadialActionMenu(): boolean }).updateRadialActionMenu()).toBe(false);

    keys.keyR.isDown = true;
    keys.keyR.justDown = true;
    expect((system as never as { updateRadialActionMenu(): boolean }).updateRadialActionMenu()).toBe(true);
    expect(menu.open).toHaveBeenCalledTimes(1);
  });

  it('confirms a move in two stages and keeps the reposition action selected afterwards', () => {
    const { system, keys } = createSystem();
    const sourcePreview = {
      angle: 0, targetX: 10, targetY: 10, gridX: 4, gridY: 4,
      isValid: true, frame: 0, range: 320, kind: 'rock' as const,
      mode: 'move-source' as const, sourceRuntimeId: 77,
    };
    const targetPreview = {
      angle: 0, targetX: 20, targetY: 20, gridX: 6, gridY: 5,
      isValid: true, frame: 0, range: 320, kind: 'rock' as const,
      mode: 'move-target' as const, sourceRuntimeId: 77,
    };
    const requestMove = vi.fn(() => Promise.resolve({ ok: true as const }));
    system.setupRadialActionProviders({
      getTools: () => [],
      getCooldownUntil: () => 0,
      getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
      getManagementActions: () => ['reposition'],
    });
    system.setupRepositionActionProvider(
      () => sourcePreview,
      (sourceRuntimeId) => (sourceRuntimeId === 77 ? targetPreview : undefined),
      requestMove,
    );
    system.setupLoadoutListener(vi.fn());
    Object.assign(system as never as Record<string, unknown>, {
      selectedRadialAction: { kind: 'management', action: 'reposition' },
    });

    keys.keyE.justDown = true;
    keys.keyE.isDown = true;
    system.update();
    expect(system.isRepositionActive()).toBe(true);
    expect(system.getConstructionPlacementPreviewState()).toBe(sourcePreview);

    // Erste Bestaetigung waehlt nur die Quelle; das Original bleibt unveraendert in der Welt.
    system.update();
    expect(requestMove).not.toHaveBeenCalled();
    expect(system.getConstructionPlacementPreviewState()).toBe(targetPreview);

    // Zweite Bestaetigung schickt den Move; die Aktion bleibt danach ausgewaehlt.
    system.update();
    expect(requestMove).toHaveBeenCalledTimes(1);
    expect(requestMove.mock.calls[0]).toEqual([77, targetPreview]);
    expect(system.isRepositionActive()).toBe(false);
    expect((system as never as { selectedRadialAction: unknown }).selectedRadialAction)
      .toEqual({ kind: 'management', action: 'reposition' });
  });

  it('sends no move request for an invalid target and leaves the source untouched', () => {
    const { system, keys } = createSystem();
    const sourcePreview = {
      angle: 0, targetX: 10, targetY: 10, gridX: 4, gridY: 4,
      isValid: true, frame: 0, range: 320, kind: 'rock' as const,
      mode: 'move-source' as const, sourceRuntimeId: 77,
    };
    const requestMove = vi.fn(() => Promise.resolve({ ok: true as const }));
    system.setupRadialActionProviders({
      getTools: () => [],
      getCooldownUntil: () => 0,
      getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
      getManagementActions: () => ['reposition'],
    });
    system.setupRepositionActionProvider(
      () => sourcePreview,
      () => ({ ...sourcePreview, mode: 'move-target' as const, isValid: false }),
      requestMove,
    );
    system.setupLoadoutListener(vi.fn());
    Object.assign(system as never as Record<string, unknown>, {
      selectedRadialAction: { kind: 'management', action: 'reposition' },
    });

    keys.keyE.justDown = true;
    keys.keyE.isDown = true;
    system.update();
    system.update();
    system.update();

    expect(requestMove).not.toHaveBeenCalled();
    expect(system.isRepositionActive()).toBe(true);
  });

  it('keeps dismantle targeting active until an explicit cancel', () => {
    const { system, keys } = createSystem();
    const preview = {
      angle: 0, targetX: 20, targetY: 20, gridX: 6, gridY: 5,
      isValid: true, frame: 0, range: 320, kind: 'rock' as const,
      mode: 'dismantle' as const, sourceRuntimeId: 77,
    };
    system.setupRadialActionProviders({
      getTools: () => [],
      getDismantlePreview: () => preview,
      getCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
      getManagementActions: () => ['dismantle'],
    });
    const uses = vi.fn();
    system.setupLoadoutListener(uses);
    Object.assign(system as never as Record<string, unknown>, {
      selectedRadialAction: { kind: 'management', action: 'dismantle' },
    });

    keys.keyE.justDown = true;
    keys.keyE.isDown = true;
    system.update();
    system.update();

    expect(uses).toHaveBeenCalledWith('utility', 0, 20, 20, {
      inputStarted: true,
      dismantle: true,
    });
    expect(system.isDismantlePlacementActive()).toBe(true);

    keys.keyE.justDown = false;
    keys.keyE.isDown = false;
    keys.keyR.justDown = true;
    keys.keyR.isDown = true;
    system.update();

    expect(system.isDismantlePlacementActive()).toBe(false);
  });

  it('ends a running move preview when its source is gone', () => {
    const { system } = createSystem();
    system.setupRepositionActionProvider(() => undefined, () => undefined, vi.fn());
    system.setupLoadoutListener(vi.fn());
    Object.assign(system as never as Record<string, unknown>, {
      selectedRadialAction: { kind: 'management', action: 'reposition' },
      repositionActive: true,
      repositionSourceRuntimeId: 77,
    });

    system.update();

    expect(system.isRepositionActive()).toBe(false);
  });

  it('consumes an RMB cancel gesture until release before weapon 2 can fire', () => {
    const { system, pointerState } = createSystem();
    const uses = vi.fn();
    system.setupLoadoutListener(uses);
    Object.assign(system as never as Record<string, unknown>, { utilityPlacementActive: true });

    pointerState.right = true;
    system.update();
    expect((system as never as { utilityPlacementActive: boolean }).utilityPlacementActive).toBe(false);
    expect(uses).not.toHaveBeenCalled();

    system.update();
    expect(uses).not.toHaveBeenCalled();

    pointerState.right = false;
    system.update();
    pointerState.right = true;
    system.update();
    expect(uses).toHaveBeenCalledTimes(1);
    expect(uses.mock.calls[0]?.[0]).toBe('weapon2');
  });
});
