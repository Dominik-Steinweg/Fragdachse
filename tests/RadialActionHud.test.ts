import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: {
    Angle: {
      Between: (x1: number, y1: number, x2: number, y2: number) => Math.atan2(y2 - y1, x2 - x1),
    },
    Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)),
  },
  Input: {
    Keyboard: {
      JustDown: (key: { justDown?: boolean }) => key.justDown === true,
      JustUp: (key: { justUp?: boolean }) => key.justUp === true,
    },
  },
}));

vi.mock('../src/graphics/cameraBaseScroll', () => ({
  getUnshakenPointerWorldPoint: () => ({ x: 100, y: 0 }),
}));

vi.mock('../src/ui/RadialActionMenu', () => ({
  RadialActionMenu: class {},
}));

import { getUtilityHudDisplayName } from '../src/ui/ArenaHUD';
import { t } from '../src/i18n';
import { InputSystem } from '../src/systems/InputSystem';

afterEach(() => {
  vi.useRealTimers();
});

function createInputSystem(): InputSystem {
  const scene = {
    input: {
      activePointer: { x: 100, y: 0 },
    },
  };
  const bridge = {
    getActiveGameMode: () => 'coop_defense',
    getSynchronizedNow: () => Date.now(),
  };
  return new InputSystem(scene as never, bridge as never, () => ({ x: 0, y: 0 } as never));
}

describe('radial action HUD state', () => {
  it('uses the actual radial action label instead of a stale construction label', () => {
    expect(getUtilityHudDisplayName(undefined, 'dismantle')).toBe(t('ui.radial.dismantle'));
    expect(getUtilityHudDisplayName(undefined, 'dismantle-own-all')).toBe(t('ui.radial.dismantleAll'));
  });

  it('exposes global dismantle as a one-second utility charge while held', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_500);
    const system = createInputSystem();
    Object.assign(system as never as Record<string, unknown>, {
      selectedRadialAction: { kind: 'management', action: 'dismantle-own-all' },
      radialGetManagementActions: () => ['dismantle-own-all'],
      radialGetCapabilities: () => ({ canUseUtility: true, canPlace: true, canManage: true }),
      globalDismantleHoldStartedAt: 1_000,
    });

    expect(system.getSelectedRadialActionForHud()).toEqual({
      kind: 'management',
      action: 'dismantle-own-all',
    });
    expect(system.isUtilityHudDisplayActive()).toBe(true);
    expect(system.isUtilityChargePreviewActive()).toBe(true);
    expect(system.getUtilityChargePreviewState()).toMatchObject({
      chargeFraction: 0.5,
      isBlocked: false,
      isGateCharge: true,
    });
  });
});
