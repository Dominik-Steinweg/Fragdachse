import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({
  BlendModes: { ADD: 1 },
  Math: { Clamp: (value: number, min: number, max: number) => Math.max(min, Math.min(max, value)) },
}));
vi.mock('../src/effects/EffectUtils', () => ({
  makeAdditive: vi.fn(),
  registerGraphicsObject: (_scene: unknown, _lane: unknown, object: unknown) => object,
  registerParticleEmitter: (_scene: unknown, _lane: unknown, object: unknown) => object,
}));

import { NukeRenderer } from '../src/powerups/NukeRenderer';
import type { SyncedNukeStrike } from '../src/types';

afterEach(() => vi.restoreAllMocks());

describe('NukeRenderer icon sizing', () => {
  it.each([16, 256])('pulses the display size independently of a %spx source texture', (sourceSize) => {
    vi.spyOn(Date, 'now').mockReturnValue(10_000);
    const object = () => {
      const result: Record<string, unknown> = {};
      for (const method of ['setPosition', 'setRadius', 'setAlpha', 'setDepth', 'setBlendMode', 'setStrokeStyle', 'setTint', 'destroy']) {
        result[method] = vi.fn(() => result);
      }
      return result;
    };
    const icon = {
      ...object(),
      displayWidth: sourceSize,
      displayHeight: sourceSize,
      setDisplaySize: vi.fn(function (this: { displayWidth: number; displayHeight: number }, width: number, height: number) {
        this.displayWidth = width;
        this.displayHeight = height;
        return this;
      }),
      setScale: vi.fn(function (this: { displayWidth: number; displayHeight: number }, scale: number) {
        this.displayWidth = sourceSize * scale;
        this.displayHeight = sourceSize * scale;
        return this;
      }),
    };
    const scene = {
      add: { circle: object, ellipse: object, image: () => icon, particles: object },
      tweens: { add: vi.fn(), killTweensOf: vi.fn() },
    };
    const renderer = new NukeRenderer(scene as never);
    const strike = { id: 1, x: 100, y: 100, radius: 200, armedAt: 9_000, explodeAt: 11_000, variant: 'normal' } as SyncedNukeStrike;
    renderer.sync([strike]);
    const baseSize = icon.setDisplaySize.mock.calls[0][0];
    const pulse = 1 + 0.09 * Math.sin(10_000 / 95 + strike.id) + 0.5 * 0.12;
    expect(icon.displayWidth).toBeCloseTo(baseSize * pulse);
    expect(icon.displayHeight).toBeCloseTo(baseSize * pulse);
    renderer.sync([strike]);
    expect(icon.displayWidth).toBeCloseTo(baseSize * pulse);
    renderer.clear();
  });
});
