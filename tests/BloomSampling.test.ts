import { describe, expect, it } from 'vitest';
import { resolveWorldBloomSampling } from '../src/effects/postfx/bloomSampling';

describe('resolveWorldBloomSampling', () => {
  it('verwendet auf Hoch einen feineren Kernel mit kleineren Abständen', () => {
    const high = resolveWorldBloomSampling('high', 1);
    const medium = resolveWorldBloomSampling('medium', 1);

    expect(high.blurQuality).toBe(2);
    expect(high.blurSteps).toBeGreaterThan(medium.blurSteps - 1);
    expect(high.blurOffsetPx).toBeLessThan(medium.blurOffsetPx);
  });

  it('hält die Blur-Größe im Designraum bei dynamischer Renderauflösung konstant', () => {
    const one = resolveWorldBloomSampling('high', 1);
    const two = resolveWorldBloomSampling('high', 2);

    expect(two.blurOffsetPx).toBeCloseTo(one.blurOffsetPx * 2, 8);
    expect(two.blurOffsetPx / 2).toBeCloseTo(one.blurOffsetPx, 8);
  });

  it('behält subpixelgenaue Abstände statt eines festen Pixelrasters', () => {
    const sampling = resolveWorldBloomSampling('high', 1.333);

    expect(sampling.blurOffsetPx % 1).not.toBe(0);
  });

  it('lässt Niedrig ohne permanenten Bloom kostengünstig', () => {
    const low = resolveWorldBloomSampling('low', 2);

    expect(low.blurQuality).toBe(0);
    expect(low.blurOffsetPx).toBe(0);
  });
});
