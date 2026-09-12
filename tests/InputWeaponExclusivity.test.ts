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
import type { LoadoutUseParams } from '../src/types';

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
    sendBurrowRequest: vi.fn(),
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
  const uses: Array<{ slot: string; params?: LoadoutUseParams }> = [];
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


describe('Rocket magazine mouse ownership', () => {
  function rocketInput() {
    return createInput(() => ({ ...WEAPON_CONFIGS.ROCKET_LAUNCHER,
      rocketLauncher: { ...WEAPON_CONFIGS.ROCKET_LAUNCHER.rocketLauncher!, magazineLevel: 1 } }));
  }
  it('toggles focus with clicks, retains it after LMB release, and starts the next gesture unfocused', () => {
    const f = rocketInput();
    f.pointerState.left = true; f.pointerState.right = true; f.system.update();
    expect(f.uses).toEqual([{ slot: 'weapon2', params: expect.objectContaining({
      rocketMagazine: { id: 1, phase: 'hold', focused: true } }) }]);
    f.system.update(); // Holding LMB must not toggle each frame.
    f.pointerState.left = false; f.system.update();
    expect(f.uses.at(-1)?.params).toMatchObject({ rocketMagazine: { id: 1, phase: 'hold', focused: true } });
    f.system.syncRocketMagazineState({ id: 1, loaded: 1, capacity: 2, intervalMs: 100, nextLoadAt: 1000, focused: false, canLoadNext: true });
    expect(f.system.getRocketMagazinePreview()?.focused).toBe(true);
    f.pointerState.left = true; f.system.update();
    expect(f.uses.at(-1)?.params).toMatchObject({ rocketMagazine: { id: 1, phase: 'hold', focused: false } });
    f.pointerState.left = false; f.system.update();
    f.pointerState.right = false; f.system.update();
    expect(f.uses.at(-1)?.params).toMatchObject({ rocketMagazine: { id: 1, phase: 'release', focused: false } });
    expect(f.uses.every(u => u.slot === 'weapon2')).toBe(true);
    f.pointerState.right = true; f.system.update();
    expect(f.uses.at(-1)?.params).toMatchObject({ rocketMagazine: { id: 2, phase: 'hold', focused: false } });
  });

  it.each(['dash', 'burrow', 'utility'] as const)('releases the magazine before %s and requires a fresh RMB gesture', action => {
    const f = rocketInput();
    f.pointerState.right = true; f.pointerState.left = true; f.system.update();
    f.pointerState.left = false; f.system.update();
    const before = f.uses.length;
    const order: string[] = [];
    f.bridge.sendDash.mockImplementation(() => { order.push('dash'); expect(f.uses.at(-1)?.params?.rocketMagazine?.phase).toBe('release'); });
    f.bridge.sendBurrowRequest.mockImplementation(() => { order.push('burrow'); expect(f.uses.at(-1)?.params?.rocketMagazine?.phase).toBe('release'); });
    const keys = f.system as unknown as { keySpace: { justDown: boolean }; keyShift: { justDown: boolean }; keyE: { justDown: boolean } };
    if (action === 'dash') keys.keySpace.justDown = true;
    if (action === 'burrow') keys.keyShift.justDown = true;
    if (action === 'utility') {
      // An available instantaneous utility follows the same E entry point as targeted/charged utilities.
      vi.spyOn(f.system as any, 'getSelectedRadialActionState').mockReturnValue({ ref: { kind: 'utility', utilityId: 'DECOY' }, available: true });
      vi.spyOn(f.system as any, 'getEffectiveUtilityCooldownUntil').mockReturnValue(0);
      keys.keyE.justDown = true;
    }
    f.system.update();
    const releaseIndex = f.uses.findIndex((use, i) => i >= before && use.params?.rocketMagazine?.phase === 'release');
    expect(releaseIndex).toBeGreaterThanOrEqual(before);
    expect(f.uses[releaseIndex].params?.rocketMagazine).toMatchObject({ id: 1, focused: true });
    if (action === 'utility') expect(f.uses.at(-1)?.slot).toBe('utility');
    else expect(order).toEqual([action]);
    const after = f.uses.length;
    keys.keySpace.justDown = keys.keyShift.justDown = keys.keyE.justDown = false;
    f.system.update();
    expect(f.uses).toHaveLength(after);
    f.pointerState.right = false; f.system.update();
    f.pointerState.right = true; f.system.update();
    expect(f.uses.at(-1)?.params?.rocketMagazine).toMatchObject({ id: 2, phase: 'hold', focused: false });
  });
  it('keeps targeted utility aiming active after firing the magazine with E while RMB stays held', () => {
    const f = rocketInput();
    const utility = { id: 'test-targeted', cooldown: 200, activation: { type: 'targeted_click' } } as const;
    f.system.setupUtilityConfigProvider(() => utility as never);
    vi.spyOn(f.system as any, 'getSelectedRadialActionState').mockReturnValue({ ref: { kind: 'utility', utilityId: utility.id }, available: true });
    vi.spyOn(f.system as any, 'getEffectiveUtilityCooldownUntil').mockReturnValue(0);
    const keys = f.system as unknown as { keyE: { justDown: boolean } };
    f.pointerState.right = true; f.system.update();
    keys.keyE.justDown = true; f.system.update();
    expect(f.uses.at(-1)?.params?.rocketMagazine?.phase).toBe('release');
    keys.keyE.justDown = false; f.system.update();
    expect(f.system.getUtilityTargetingPreviewState()).toBeDefined();
    f.pointerState.left = true; f.system.update();
    expect(f.uses.at(-1)?.slot).toBe('utility');
    expect(f.system.getUtilityTargetingPreviewState()).toBeUndefined();
  });

  it('uses an LMB toggle in the same frame as a forced dash release', () => {
    const f = rocketInput(); f.pointerState.right = true; f.system.update();
    f.pointerState.left = true;
    (f.system as unknown as { keySpace: { justDown: boolean } }).keySpace.justDown = true;
    f.system.update();
    expect(f.uses.find(use => use.params?.rocketMagazine?.phase === 'release')?.params?.rocketMagazine?.focused).toBe(true);
  });

  it('cancels at menu/input loss and cannot revive the same held gesture', () => {
    const f = rocketInput(); f.pointerState.right = true; f.system.update();
    f.system.setInputEnabled(false);
    expect(f.uses.at(-1)?.params).toMatchObject({ rocketMagazine: { id: 1, phase: 'cancel' } });
    f.system.setInputEnabled(true); f.system.update();
    expect(f.uses.at(-1)?.params).toMatchObject({ rocketMagazine: { phase: 'cancel' } });
    f.pointerState.right = false; f.system.update(); f.pointerState.right = true; f.system.update();
    expect(f.uses.at(-1)?.params).toMatchObject({ rocketMagazine: { id: 2, phase: 'hold' } });
  });
});
