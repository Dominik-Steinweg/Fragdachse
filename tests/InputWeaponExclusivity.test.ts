import { afterEach, describe, expect, it, vi } from 'vitest';

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
vi.mock('../src/ui/RadialActionMenu', () => ({
  RadialActionMenu: class {},
}));

import { WEAPON_CONFIGS } from '../src/loadout/LoadoutConfig';
import { InputSystem } from '../src/systems/InputSystem';
import { DASH_T1_S, DASH_T2_S } from '../src/config';

interface TestPointerState {
  left: boolean;
  right: boolean;
}

function createInput(getWeapon2Config: () => typeof WEAPON_CONFIGS.TESLA_DOME | typeof WEAPON_CONFIGS.AWP) {
  const pointerState: TestPointerState = { left: false, right: false };
  const pointer = {
    leftButtonDown: () => pointerState.left,
    rightButtonDown: () => pointerState.right,
  };
  const bridge = {
    getGamePhase: () => 'ARENA',
    canPlayerAct: () => true,
    getWorldDescriptor: () => null,
    getSynchronizedNow: () => Date.now(),
    getLocalPlayerId: () => 'player-1',
    sendLocalInput: vi.fn(),
    sendDash: vi.fn(),
  };
  const scene = { input: { activePointer: pointer } };
  const system = new InputSystem(scene as never, bridge as never, () => ({ x: 0, y: 0 } as never));
  const key = () => ({ isDown: false, justDown: false, justUp: false });
  Object.assign(system as never as Record<string, unknown>, {
    keyW: key(), keyA: key(), keyS: key(), keyD: key(), keySpace: key(), keyShift: key(),
    keyE: key(), keyQ: key(), keyR: key(), keyB: key(), keyN: key(),
    localBurrowPhase: 'idle',
  });
  system.setupWeapon2ConfigProvider(getWeapon2Config);
  const uses: Array<{ slot: string; params?: { inputStarted?: boolean; scopeHolding?: boolean } }> = [];
  system.setupLoadoutListener((slot, _angle, _targetX, _targetY, params) => {
    uses.push({ slot, params });
  });

  return { system, pointerState, uses, bridge };
}

describe('authoritative dash input feedback', () => {
  afterEach(() => vi.useRealTimers());

  it('allows another press immediately after rejection and starts feedback only on confirmation', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000);
    const { system, bridge } = createInput(() => WEAPON_CONFIGS.AWP);
    const keys = system as unknown as { keyD: { isDown: boolean }; keySpace: { justDown: boolean } };
    keys.keyD.isDown = true;
    system.setLocalState(false, true, 'underground', 0);
    keys.keySpace.justDown = true;
    system.update();
    expect(bridge.sendDash).toHaveBeenCalledWith(1, 0);
    expect(system.getDashCooldownFrac()).toBe(0);
    keys.keySpace.justDown = false;
    system.update();
    vi.advanceTimersByTime(20);
    keys.keySpace.justDown = true;
    system.update();
    expect(bridge.sendDash).toHaveBeenCalledTimes(2);

    system.setLocalState(false, false, 'recovery', 1);
    expect(system.getDashCooldownFrac()).toBe(1);
    vi.advanceTimersByTime(50);
    system.setLocalState(false, false, 'recovery', 1);
    expect(system.getDashCooldownFrac()).toBeLessThan(1);
    vi.advanceTimersByTime((DASH_T1_S + DASH_T2_S) * 1000);
    expect(system.getDashCooldownFrac()).toBeGreaterThan(0);
    system.setLocalState(false, false, 'idle', 0);
    expect(system.getDashCooldownFrac()).toBe(0);
  });

  it('does not hold input behind the base duration when recovery upgrades finish early', () => {
    vi.useFakeTimers();
    const { system, bridge } = createInput(() => WEAPON_CONFIGS.AWP);
    const keys = system as unknown as { keyD: { isDown: boolean }; keySpace: { justDown: boolean } };
    keys.keyD.isDown = true;
    system.setLocalState(false, false, 'idle', 1);
    vi.advanceTimersByTime(DASH_T1_S * 1000);
    system.setLocalState(false, false, 'idle', 2);
    system.setLocalState(false, false, 'idle', 0);
    keys.keySpace.justDown = true;
    system.update();
    expect(bridge.sendDash).toHaveBeenCalledOnce();
    expect(system.getDashCooldownFrac()).toBe(0);
  });
});

describe('weapon input exclusivity', () => {
  it('cancels an in-progress RMB scope when LMB is pressed and never fires the stale RMB release', () => {
    const { system, pointerState, uses } = createInput(() => WEAPON_CONFIGS.AWP);

    pointerState.right = true;
    system.update();
    expect(system.isScoping()).toBe(true);

    pointerState.left = true;
    system.update();
    expect(system.isScoping()).toBe(false);
    expect(uses.map((use) => use.slot)).toEqual(['weapon2', 'weapon1']);

    pointerState.left = false;
    pointerState.right = false;
    system.update();
    expect(uses.map((use) => use.slot)).toEqual(['weapon2', 'weapon1']);
  });

  it('preserves a fast RMB press made while LMB had priority until the deliberate switch back', () => {
    const { system, pointerState, uses } = createInput(() => WEAPON_CONFIGS.TESLA_DOME);

    pointerState.left = true;
    system.update();
    pointerState.right = true;
    system.update();
    expect(uses.at(-1)?.slot).toBe('weapon1');

    pointerState.left = false;
    system.update();

    expect(uses.at(-1)).toEqual({ slot: 'weapon2', params: { inputStarted: true } });
  });
});
