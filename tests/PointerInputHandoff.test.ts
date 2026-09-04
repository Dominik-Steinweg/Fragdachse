import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: { Angle: { Between: () => 0 } },
  Input: { Keyboard: { JustDown: () => false, JustUp: () => false } },
  Scenes: { Events: { SHUTDOWN: 'shutdown' } },
}));
vi.mock('../src/graphics/cameraBaseScroll', () => ({
  getUnshakenPointerWorldPoint: () => ({ x: 0, y: 0 }),
}));
vi.mock('../src/ui/RadialActionMenu', () => ({
  RadialActionMenu: class {},
}));

import { InputSystem, resolvePointerButtonHandoff } from '../src/systems/InputSystem';

interface TestPointerState {
  buttons: number;
  left: boolean;
  right: boolean;
}

function createInputForHandoff() {
  const pointerState: TestPointerState = { buttons: 0, left: false, right: false };
  const pointer = {
    buttons: 0,
    leftButtonDown: () => pointerState.left,
    rightButtonDown: () => pointerState.right,
  };
  const bridge = {
    getWorldDescriptor: () => null,
    getSynchronizedNow: () => Date.now(),
    getLocalPlayerId: () => 'player-1',
    sendLocalInput: vi.fn(),
  };
  const scene = { input: { activePointer: pointer } };
  const system = new InputSystem(scene as never, bridge as never, () => ({ x: 0, y: 0 } as never));
  const key = () => ({ isDown: false, justDown: false, justUp: false });
  Object.assign(system as never as Record<string, unknown>, {
    keyW: key(), keyA: key(), keyS: key(), keyD: key(), keySpace: key(), keyShift: key(),
    keyE: key(), keyQ: key(), keyR: key(), keyB: key(), keyN: key(),
    localBurrowPhase: 'idle',
  });
  const uses: string[] = [];
  system.setupLoadoutListener((slot) => uses.push(slot));

  return { pointer, pointerState, system, uses };
}

describe('UI -> World Pointer-Handoff', () => {
  it('verbraucht den gehaltenen Join-Gesture bis zum Release', () => {
    // LMB hat den UI-Button aktiviert und ist beim Freischalten der World noch gedrueckt.
    let consumed = 1;
    let handoff = resolvePointerButtonHandoff(1, consumed);
    expect(handoff.gameplayButtons).toBe(0);
    consumed = handoff.consumedButtons;

    // Auch weitere Frames desselben Press bleiben UI-owned.
    handoff = resolvePointerButtonHandoff(1, consumed);
    expect(handoff).toEqual({ gameplayButtons: 0, consumedButtons: 1 });

    // Erst das Release armt LMB neu; der darauffolgende Press ist Gameplay.
    consumed = resolvePointerButtonHandoff(0, consumed).consumedButtons;
    expect(consumed).toBe(0);
    expect(resolvePointerButtonHandoff(1, consumed).gameplayButtons).toBe(1);
  });

  it('behandelt alle beim UI-Wechsel gehaltenen Pointerbuttons gleich', () => {
    // LMB + RMB werden gemeinsam konsumiert; ein neu gedrueckter Middle-Button bleibt frei.
    expect(resolvePointerButtonHandoff(1 | 2 | 4, 1 | 2)).toEqual({
      gameplayButtons: 4,
      consumedButtons: 3,
    });
    expect(resolvePointerButtonHandoff(2, 3)).toEqual({
      gameplayButtons: 0,
      consumedButtons: 2,
    });
  });

  it('verbraucht den UI-Press auch im echten InputSystem bis zum Release', () => {
    const { pointer, pointerState, system, uses } = createInputForHandoff();

    system.setInputEnabled(false);
    pointerState.left = true;
    pointerState.buttons = 1;
    pointer.buttons = pointerState.buttons;
    system.setInputEnabled(true);
    system.update();
    system.update();
    expect(uses).toEqual([]);

    pointerState.left = false;
    pointerState.buttons = 0;
    pointer.buttons = pointerState.buttons;
    system.update();

    pointerState.left = true;
    pointerState.buttons = 1;
    pointer.buttons = pointerState.buttons;
    system.update();
    expect(uses).toEqual(['weapon1']);
  });
});
