import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { TRACK_GRAVEL_CONFIG, TRACK_RAIL_TEXTURE } from '../../src/arena/TrackGravelConfig';

describe('railway production assets', () => {
  it('draws only the two rails, on the configured centre lines, at the declared resolution', async () => {
    const path = `public/${TRACK_RAIL_TEXTURE.path.replace(/^\.\//, '')}`;
    const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    expect([info.width, info.height]).toEqual([TRACK_RAIL_TEXTURE.width, TRACK_RAIL_TEXTURE.height]);
    expect(info.width).toBe(64 * TRACK_RAIL_TEXTURE.scale);
    const columnAlpha = Array.from({ length: info.width }, (_, x) => {
      let max = 0;
      for (let y = 0; y < info.height; y++) max = Math.max(max, data[(y * info.width + x) * 4 + 3]);
      return max;
    });
    for (const [x, alpha] of columnAlpha.entries()) {
      const world = (x + 0.5) / TRACK_RAIL_TEXTURE.scale;
      const nearest = Math.min(...TRACK_GRAVEL_CONFIG.railCentersPx.map(center => Math.abs(world - center)));
      // Opaque rail heads on the centre lines; nothing but their soft shade further out.
      if (nearest < 1) expect(alpha).toBe(255);
      if (nearest > 6) expect(alpha).toBe(0);
    }
    // Repeats along the line without a seam.
    for (let x = 0; x < info.width; x++) {
      const first = data[x * 4 + 3], last = data[((info.height - 1) * info.width + x) * 4 + 3];
      expect(Math.abs(first - last)).toBeLessThanOrEqual(8);
    }
  });

  it('draws the bed from the shipped seamless gravel, soil and sleeper wood materials', async () => {
    for (const name of ['gravel_material', 'dirt_material', 'sleeper_wood_material']) {
      const { info } = await sharp(`public/assets/sprites/${name}.png`).raw().toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(info.height);
      expect(info.width).toBeGreaterThanOrEqual(256);
    }
  });
});
