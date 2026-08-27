import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  Math: { Angle: { Between: () => 0 } },
  Input: { Keyboard: { JustDown: () => false, JustUp: () => false } },
  Scenes: { Events: { SHUTDOWN: 'shutdown' } },
}));
vi.mock('../src/graphics/cameraBaseScroll', () => ({
  getUnshakenPointerWorldPoint: () => ({ x: 0, y: 0 }),
}));
vi.mock('../src/ui/InspectorToolRadialMenu', () => ({
  InspectorToolRadialMenu: class {},
}));

import { resolvePointerButtonHandoff } from '../src/systems/InputSystem';

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

  it('armt beim semantischen Input-Uebergang statt ueber einen Timer', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/systems/InputSystem.ts'), 'utf8');
    const start = source.indexOf('  setInputEnabled(enabled: boolean');
    const end = source.indexOf('\n  /**', start + 5);
    const body = source.slice(start, end);
    expect(body).toContain('if (enabled && !wasEnabled)');
    expect(body).toContain('this.scene.input.activePointer?.buttons ?? 0');
    expect(body).not.toContain('setTimeout');
  });
});
