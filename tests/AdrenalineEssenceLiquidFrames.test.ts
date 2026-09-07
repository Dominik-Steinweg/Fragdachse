import { describe, expect, it } from 'vitest';
import {
  ESSENCE_LIQUID_FRAMES, ESSENCE_LIQUID_FRAME_SIZE as SIZE,
  ESSENCE_LIQUID_PHASES, ESSENCE_LIQUID_VARIANTS,
  writeEssenceLiquidPixels, writeEssenceLiquidTailPixels,
} from '../src/adrenalineEssence/AdrenalineEssenceLiquidFrames';

function pixels(variant: number, phase: number): Uint8ClampedArray {
  const result = new Uint8ClampedArray(SIZE * SIZE * 4);
  writeEssenceLiquidPixels(result, variant, phase);
  return result;
}

function alphaAt(pixels: Uint8ClampedArray, x: number, y: number): number {
  return pixels[(y * SIZE + x) * 4 + 3];
}

/** The material contract can be checked without opening any generated image. */
describe('procedural essence liquid material', () => {
  it('keeps every frame a connected, softly edged cyan bead on a transparent background', () => {
    for (const frame of ESSENCE_LIQUID_FRAMES) {
      const image = pixels(frame.variant, frame.phase);
      const opaque = new Set<number>();
      let softEdge = 0;
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
        const alpha = alphaAt(image, x, y);
        if (x === 0 || y === 0 || x === SIZE - 1 || y === SIZE - 1) expect(alpha).toBe(0);
        if (alpha > 0 && alpha < 255) softEdge++;
        if (alpha < 16) continue;
        opaque.add(y * SIZE + x);
        const index = (y * SIZE + x) * 4;
        expect(image[index + 1]).toBeGreaterThan(image[index]);
        expect(image[index + 2]).toBeGreaterThan(image[index]);
        expect(image[index]).toBeLessThan(190); // No overexposed white facets.
      }
      expect(softEdge).toBeGreaterThan(20);
      const start = SIZE / 2 * SIZE + SIZE / 2;
      expect(opaque.has(start)).toBe(true);
      const visited = new Set<number>([start]);
      const queue = [start];
      for (let i = 0; i < queue.length; i++) {
        const index = queue[i];
        for (const next of [index - 1, index + 1, index - SIZE, index + SIZE]) {
          if (opaque.has(next) && !visited.has(next)) { visited.add(next); queue.push(next); }
        }
      }
      expect(visited.size).toBe(opaque.size);
    }
  });

  it('has distinct variants and a seamless, gentle phase loop with stable area', () => {
    expect(new Set(Array.from({ length: ESSENCE_LIQUID_VARIANTS }, (_, variant) =>
      pixels(variant, 0).join(','))).size).toBe(ESSENCE_LIQUID_VARIANTS);
    for (let variant = 0; variant < ESSENCE_LIQUID_VARIANTS; variant++) {
      const frames = Array.from({ length: ESSENCE_LIQUID_PHASES }, (_, phase) => pixels(variant, phase));
      for (let phase = 0; phase < frames.length; phase++) {
        const current = frames[phase];
        const next = frames[(phase + 1) % frames.length];
        let difference = 0;
        let area = 0;
        for (let index = 3; index < current.length; index += 4) {
          difference += Math.abs(current[index] - next[index]);
          area += current[index];
        }
        expect(difference).toBeGreaterThan(0);
        expect(difference / area).toBeLessThan(0.1);
      }
    }
  });

  it('creates a soft tail with a rounded wider head and transparent frame borders', () => {
    const image = new Uint8ClampedArray(SIZE * SIZE * 4);
    writeEssenceLiquidTailPixels(image);
    let rear = 0;
    let front = 0;
    for (let y = 0; y < SIZE; y++) {
      rear += alphaAt(image, 7, y);
      front += alphaAt(image, 23, y);
      expect(alphaAt(image, 0, y)).toBe(0);
      expect(alphaAt(image, SIZE - 1, y)).toBe(0);
    }
    expect(front).toBeGreaterThan(rear);
    expect(rear).toBeGreaterThan(0);
  });
});
