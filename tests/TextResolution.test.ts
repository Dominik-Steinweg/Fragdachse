import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => {
  class Text {}
  class Container {}
  class Layer {}

  return {
    GameObjects: { Text, Container, Layer },
    Math: { Clamp: (value: number, min: number, max: number) => Math.min(Math.max(value, min), max) },
    Scale: { Events: { RESIZE: 'resize' } },
  };
});

import * as Phaser from 'phaser';
import { installTextResolution, reRasterAllText } from '../src/graphics/TextResolution';

function fakeText(properties: Record<string, unknown>): Phaser.GameObjects.Text {
  return Object.assign(Object.create(Phaser.GameObjects.Text.prototype), properties) as Phaser.GameObjects.Text;
}

describe('TextResolution', () => {
  it('ignores text objects whose Phaser texture is already destroyed', () => {
    const staleText = fakeText({
      isDestroyed: true,
      scene: undefined,
      style: null,
      frame: { source: null },
      updateText: vi.fn(),
      setResolution: vi.fn(),
    });
    const orphanedText = fakeText({
      isDestroyed: false,
      scene: {},
      style: { resolution: 1 },
      frame: { source: null },
      updateText: vi.fn(),
      setResolution: vi.fn(),
    });
    const liveText = fakeText({
      isDestroyed: false,
      scene: {},
      style: { resolution: 1 },
      frame: { source: {} },
      updateText: vi.fn(),
      setResolution: vi.fn(),
    });
    const resizeListeners: Array<() => void> = [];
    const scene = {
      sys: { isActive: () => true, isSleeping: () => false },
      children: { list: [staleText, orphanedText, liveText] },
      scale: {
        width: 1920,
        on: (_event: string, listener: () => void) => { resizeListeners.push(listener); },
        off: vi.fn(),
      },
      add: { text: vi.fn() },
    } as unknown as Phaser.Scene;

    reRasterAllText(scene);
    expect(staleText.updateText).not.toHaveBeenCalled();
    expect(orphanedText.updateText).not.toHaveBeenCalled();
    expect(liveText.updateText).toHaveBeenCalledOnce();

    installTextResolution(scene);
    expect(() => resizeListeners[0]()).not.toThrow();
    expect(staleText.setResolution).not.toHaveBeenCalled();
    expect(orphanedText.setResolution).not.toHaveBeenCalled();
  });
});
