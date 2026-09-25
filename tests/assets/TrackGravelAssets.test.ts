import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { TRACK_GRAVEL_CONFIG } from '../../src/arena/TrackGravelConfig';

describe('railway ballast production assets', () => {
  it('anchors the ballast envelope to the actual extracted sleeper footprint', async () => {
    const { data, info } = await sharp('public/assets/sprites/BahnstreckeSchienen.png')
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let left = info.width, right = 0;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        if (data[(y * info.width + x) * 4 + 3] > 0) {
          left = Math.min(left, x);
          right = Math.max(right, x + 1);
        }
      }
    }
    expect(left).toBe(TRACK_GRAVEL_CONFIG.sleeperLeftPx);
    expect(right).toBe(TRACK_GRAVEL_CONFIG.sleeperRightPx);
  });

  it('draws the ballast from the shipped seamless gravel and soil materials', async () => {
    for (const name of ['gravel_material', 'dirt_material']) {
      const { info } = await sharp(`public/assets/sprites/${name}.png`).raw().toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(info.height);
      expect(info.width).toBeGreaterThanOrEqual(256);
    }
  });
});
