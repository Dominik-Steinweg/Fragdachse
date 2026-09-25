import { describe, expect, it } from 'vitest';
import { DirtSurfaceField, DIRT_SURFACE_REACH_PX, WATER_BANK_REACH_PX } from '../src/arena/DirtSurfaceField';
import { deriveGrassHeight } from '../src/arena/GroundMaterialSamples';
import type { GroundMaterialSamples } from '../src/arena/GroundMaterialSamples';
import { CELL_SIZE } from '../src/config';

const frame = { offsetX: 37, offsetY: 19, width: 512, height: 512 };
const dirt = Array.from({ length: 9 * 9 }, (_, i) => ({ gridX: 3 + i % 9, gridY: 3 + Math.floor(i / 9) }))
  .filter(c => !(c.gridX >= 6 && c.gridX <= 8 && c.gridY >= 6 && c.gridY <= 8));

/** Small deterministic stand-in materials with blade-like variation. */
function materials(): GroundMaterialSamples {
  const size = 64, rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = (Math.imul(i, 2654435761) >>> 24);
    rgba.set([60 + (v & 63), 80 + (v >> 2), 40, 255], i * 4);
  }
  const grass = { width: size, height: size, rgba };
  const dry = { width: size, height: size, rgba: rgba.map((value, i) => i % 4 === 3 ? 255 : 255 - value) };
  // The drier second soil must follow the same frame-anchored sampling as everything else.
  return { dirt: grass, dirtAlt: dry, bank: dry, bankWet: grass, grassHeight: deriveGrassHeight(grass) };
}
const samples = materials();
const sample = (field: DirtSurfaceField, x: number, y: number, size: number) => {
  const pixels = new Uint8ClampedArray(size * size * 4);
  field.writeSurface(pixels, size, x, y, size, samples);
  return pixels;
};

describe('World soil surface', () => {
  it('is independent of cell order, rebuilding, and sampling partition', () => {
    const field = new DirtSurfaceField(17, dirt, frame);
    const rebuilt = new DirtSurfaceField(17, [...dirt].reverse(), frame);
    const whole = sample(field, frame.offsetX, frame.offsetY, 256);
    expect(sample(rebuilt, frame.offsetX, frame.offsetY, 256)).toEqual(whole);
    for (const dx of [0, 128]) for (const dy of [0, 128]) {
      const part = sample(field, frame.offsetX + dx - 2, frame.offsetY + dy - 2, 132);
      for (let y = 0; y < 128; y++) {
        expect(part.slice(((y + 2) * 132 + 2) * 4, ((y + 2) * 132 + 130) * 4))
          .toEqual(whole.slice(((y + dy) * 256 + dx) * 4, ((y + dy) * 256 + dx + 128) * 4));
      }
    }
  });

  it('moves with the World frame and varies at edges between seeds', () => {
    const origin = { ...frame, offsetX: 0, offsetY: 0 };
    const pixels = sample(new DirtSurfaceField(17, dirt, frame), 37, 19, 256);
    expect(sample(new DirtSurfaceField(17, dirt, origin), 0, 0, 256)).toEqual(pixels);
    expect(sample(new DirtSurfaceField(18, dirt, frame), 37, 19, 256)).not.toEqual(pixels);
  });

  it('preserves solid interiors, holes, isolated cells and all-grass Worlds', () => {
    const field = new DirtSurfaceField(17, dirt, frame);
    expect(field.coverageAt(37 + 4.5 * CELL_SIZE, 19 + 4.5 * CELL_SIZE)).toBe(1);
    expect(field.coverageAt(37 + 7.5 * CELL_SIZE, 19 + 7.5 * CELL_SIZE)).toBe(0);
    // The organic warp may shift a single cell, but never erase it.
    const island = new DirtSurfaceField(17, [{ gridX: 3, gridY: 3 }], frame);
    let islandPeak = 0;
    for (let y = -CELL_SIZE; y <= CELL_SIZE; y += 4) for (let x = -CELL_SIZE; x <= CELL_SIZE; x += 4) {
      islandPeak = Math.max(islandPeak, island.coverageAt(37 + 3.5 * CELL_SIZE + x, 19 + 3.5 * CELL_SIZE + y));
    }
    expect(islandPeak).toBeGreaterThan(.9);
    const empty = new DirtSurfaceField(17, [], frame);
    expect(empty.coverageAt(37, 19)).toBe(0);
    const solid = new DirtSurfaceField(17, Array.from({ length: 256 }, (_, i) => ({ gridX: i % 16, gridY: Math.floor(i / 16) })), frame);
    expect(solid.coverageAt(36, 18)).toBe(1); // World boundary is not a new material edge.
    const pixels = sample(field, 37 + 3 * CELL_SIZE - DIRT_SURFACE_REACH_PX - 4, 19, 3);
    for (let i = 3; i < pixels.length; i += 4) expect(pixels[i]).toBe(0);
  });
  it('lays a riverbank under and around water, independent of order and partition', () => {
    const water = [{ gridX: 1, gridY: 1 }, { gridX: 2, gridY: 1 }, { gridX: 1, gridY: 2 }, { gridX: 2, gridY: 2 }];
    const field = new DirtSurfaceField(17, dirt, frame, water);
    const whole = sample(field, frame.offsetX, frame.offsetY, 256);
    expect(sample(new DirtSurfaceField(17, dirt, frame, [...water].reverse()), frame.offsetX, frame.offsetY, 256))
      .toEqual(whole);
    for (const dx of [0, 128]) for (const dy of [0, 128]) {
      const part = sample(field, frame.offsetX + dx - 2, frame.offsetY + dy - 2, 132);
      for (let y = 0; y < 128; y++) {
        expect(part.slice(((y + 2) * 132 + 2) * 4, ((y + 2) * 132 + 130) * 4))
          .toEqual(whole.slice(((y + dy) * 256 + dx) * 4, ((y + dy) * 256 + dx + 128) * 4));
      }
    }
    // The bed below the translucent water rim is fully covered.
    expect(whole[(2 * CELL_SIZE * 256 + 2 * CELL_SIZE) * 4 + 3]).toBe(255);
    // Beyond its reach the bank leaves the grass untouched.
    const far = sample(field, frame.offsetX + 3 * CELL_SIZE + WATER_BANK_REACH_PX, frame.offsetY + 14 * CELL_SIZE, 8);
    for (let i = 3; i < far.length; i += 4) expect(far[i]).toBe(0);
    // Without bank materials, water leaves the soil exactly as before.
    const plain = { dirt: samples.dirt, dirtAlt: samples.dirtAlt, grassHeight: samples.grassHeight };
    const bare = new Uint8ClampedArray(256 * 256 * 4), reference = new Uint8ClampedArray(256 * 256 * 4);
    field.writeSurface(bare, 256, frame.offsetX, frame.offsetY, 256, plain);
    new DirtSurfaceField(17, dirt, frame).writeSurface(reference, 256, frame.offsetX, frame.offsetY, 256, plain);
    expect(bare).toEqual(reference);
  });
});
