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
    sendLocalInput: vi.fn(),
    sendLocalPlacementPreview: vi.fn(),
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
    (classId) => {
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
        radialGetSelectedTool: () => ({ kind: 'utility', id: 'STINK_CLOUD' }),
        inspectorModeProvider: () => classId === 'inspector_gadachs',
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
    system.setupRadialActionProviders(
      () => [{ kind: 'utility', id: 'STINK_CLOUD' }],
      () => null,
      () => undefined,
      () => false,
      () => false,
      undefined,
      undefined,
      () => 0,
      () => ({ canUseUtility: true, canPlace: true, canManage: true }),
    );
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
