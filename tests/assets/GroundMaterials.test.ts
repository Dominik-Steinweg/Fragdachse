import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { GROUND_COVER_TIERS } from '../../src/arena/GroundCoverConfig';
import { CELL_SIZE } from '../../src/config';

describe('native forest floor assets', () => {
  for (const name of ['gras_bg_tile', 'dirt_material']) it(`${name} wraps without a colour seam`, async () => {
    const { data, info } = await sharp(`public/assets/sprites/${name}.png`).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    expect(width).toBeGreaterThan(32); expect(height).toBe(width);
    for (let y = 0; y < height; y++) for (let c = 0; c < channels; c++) {
      expect(data[(y * width) * channels + c]).toBe(data[(y * width + width - 1) * channels + c]);
    }
    expect(data.subarray(0, width * channels)).toEqual(data.subarray((height - 1) * width * channels));
  });
  it('ground_macro is a smooth seamless Multiply map', async () => {
    const { data, info } = await sharp('public/assets/sprites/ground_macro.png').removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width, height, channels } = info;
    // Seamless: the step across each wrap edge is no larger than a step inside the tile.
    let wrapStep = 0, innerStep = 0;
    for (let y = 0; y < height; y++) for (let c = 0; c < channels; c++) {
      wrapStep = Math.max(wrapStep, Math.abs(data[(y * width) * channels + c] - data[(y * width + width - 1) * channels + c]));
      innerStep = Math.max(innerStep, Math.abs(data[(y * width) * channels + c] - data[(y * width + 1) * channels + c]));
    }
    expect(wrapStep).toBeLessThanOrEqual(innerStep + 1);
  });
  it('ships compact transparent cover stamps with real empty space', async () => {
    for (const tier of GROUND_COVER_TIERS) for (const variant of tier.variants) {
      const { data, info } = await sharp(`public/assets/sprites/groundcover/${variant.fileName}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      let empty = 0, opaque = 0;
      for (let i = 3; i < data.length; i += 4) { if (data[i] === 0) empty++; if (data[i] > 64) opaque++; }
      expect(empty).toBeGreaterThan(0); expect(opaque).toBeGreaterThan(0);
      // No mipmaps: stamps stay close to their largest display size (margins and oversampling
      // included), whatever that size is.
      const anchorMax = Math.max(...[tier.seam, tier.dirt, tier.grass, tier.rockFoot, tier.bank]
        .filter((anchor) => anchor !== undefined).map((anchor) => anchor!.maxSizeCells));
      const maxDisplayPx = (variant.sizeCells?.[1] ?? anchorMax) * CELL_SIZE;
      expect(Math.max(info.width, info.height)).toBeLessThanOrEqual(Math.ceil(maxDisplayPx * 1.6));
    }
  });
});
