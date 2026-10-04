import { describe, expect, it } from 'vitest';
// The browser runner uses this exact comparison implementation.
import { comparePixels, compareImages } from '../../scripts/visual/compare.mjs';
import sharp from 'sharp';

describe('visual regression comparison', () => {
  const image = () => Buffer.from([40, 60, 80, 255, 40, 60, 80, 255]);
  const options = { width: 2, height: 1, delta: 12, maxRatio: .1 };
  it('accepts the channel tolerance boundary and rejects a larger local change', () => {
    const actual = image(); actual[0] += 12;
    expect(comparePixels(image(), actual, options).passed).toBe(true);
    actual[0]++;
    expect(comparePixels(image(), actual, options)).toMatchObject({ passed: false, changed: 1, ratio: .5 });
    expect(comparePixels(image(), actual, { ...options, maxRatio: .5 }).passed).toBe(true);
  });
  it('excludes overlapping masks from the denominator and marks differences', () => {
    const actual = image(); actual[0] = actual[4] = 255;
    const mask = { x: 0, y: 0, width: 1, height: 1 };
    const result = comparePixels(image(), actual, { ...options, masks: [mask, mask] });
    expect(result).toMatchObject({ compared: 1, changed: 1, ratio: 1, passed: false });
    expect([...result.diff.slice(4)]).toEqual([255, 0, 100, 255]);
    expect(() => comparePixels(image(), actual, { ...options, masks: [{ ...mask, width: 2 }] })).toThrow(/All pixels/);
  });
  it('rejects invalid sizes, masks and tolerances instead of passing silently', () => {
    expect(() => comparePixels(image(), Buffer.alloc(4), options)).toThrow(/dimensions/);
    expect(() => comparePixels(image(), image(), { ...options, delta: NaN })).toThrow(/tolerance/);
    expect(() => comparePixels(image(), image(), { ...options, masks: [{ x: 2, y: 0, width: 1, height: 1 }] })).toThrow(/Mask/);
  });
  it('compares lossless WebP and PNG pixels and rejects swapped dimensions', async () => {
    const encode = (width: number, height: number) => sharp(image(), { raw: { width, height, channels: 4 } });
    const png = await encode(2, 1).png().toBuffer(), webp = await encode(2, 1).webp({ lossless: true }).toBuffer();
    expect(await compareImages(webp, png, options)).toMatchObject({ passed: true, changed: 0 });
    await expect(compareImages(webp, await encode(1, 2).png().toBuffer(), options)).rejects.toThrow(/dimensions/);
  });
});
