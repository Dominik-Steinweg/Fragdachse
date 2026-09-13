import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { TRACK_GRAVEL_CONFIG, TRACK_GRAVEL_TEXTURE_KEYS, preloadTrackGravelAssets } from '../../src/arena/TrackGravelConfig';

describe('railway gravel production assets', () => {
  it('loads distinct high-resolution RGBA material stamps with visible gravel and transparent gaps', async () => {
    const queued: Array<{ key: string; path: string }> = [];
    preloadTrackGravelAssets({ image: (key: string, path: string) => queued.push({ key, path }) } as never);
    expect(queued.map(entry => entry.key)).toEqual([...TRACK_GRAVEL_TEXTURE_KEYS]);
    const buffers: Buffer[] = [];
    for (const entry of queued) {
      const { data, info } = await sharp(`public/${entry.path.replace('./', '')}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(1024);
      expect(info.height).toBe(1024);
      const alphas = data.filter((_, index) => index % 4 === 3);
      expect(alphas.some(alpha => alpha === 0)).toBe(true);
      expect(alphas.some(alpha => alpha > 240)).toBe(true);
      expect(data[(512 * info.width + 512) * 4 + 3]).toBeGreaterThan(0);
      for (const previous of buffers) expect(data.equals(previous)).toBe(false);
      buffers.push(data);
    }
  });

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
});
