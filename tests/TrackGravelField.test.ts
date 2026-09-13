import { describe, expect, it } from 'vitest';
import { generateTrackGravelPlacements, getTrackGravelEdges, writeTrackGravelCutout } from '../src/arena/TrackGravelField';
import { TRACK_GRAVEL_CONFIG as CONFIG, TRACK_GRAVEL_TEXTURE_KEYS } from '../src/arena/TrackGravelConfig';

const FRAME = { offsetX: 37, offsetY: 19, width: 512, height: 512 };
const COLUMNS = [
  { x: FRAME.offsetX + 96, y: FRAME.offsetY, width: 64, height: 512 },
  { x: FRAME.offsetX + 320, y: FRAME.offsetY, width: 64, height: 512 },
];

function mask(x: number, y: number, size: number, columns = COLUMNS, frame = FRAME) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  writeTrackGravelCutout(pixels, size, 17, columns, frame, { worldX: x, worldY: y, size });
  return pixels;
}

describe('railway gravel field', () => {
  it('is stable across input order and rebuilds, but varies by world seed', () => {
    const first = generateTrackGravelPlacements(17, COLUMNS, FRAME);
    expect(generateTrackGravelPlacements(17, [...COLUMNS].reverse(), FRAME)).toEqual(first);
    expect(generateTrackGravelPlacements(17, COLUMNS, FRAME)).toEqual(first);
    expect(generateTrackGravelPlacements(18, COLUMNS, FRAME)).not.toEqual(first);
    expect(generateTrackGravelPlacements(17, [], FRAME)).toEqual([]);
    expect(new Set(first.map(p => p.textureKey)).size).toBeGreaterThan(1);
    for (const placement of first) {
      expect(TRACK_GRAVEL_TEXTURE_KEYS).toContain(placement.textureKey);
      expect(placement.sizePx).toBeGreaterThanOrEqual(CONFIG.minStampSizePx);
      expect(placement.sizePx).toBeLessThanOrEqual(CONFIG.maxStampSizePx);
    }
  });

  it('moves geometry with the world frame without rerolling the material', () => {
    const delta = { x: 1024, y: -64 };
    const movedFrame = { ...FRAME, offsetX: FRAME.offsetX + delta.x, offsetY: FRAME.offsetY + delta.y };
    const movedColumns = COLUMNS.map(c => ({ ...c, x: c.x + delta.x, y: c.y + delta.y }));
    const moved = generateTrackGravelPlacements(17, movedColumns, movedFrame);
    const original = generateTrackGravelPlacements(17, COLUMNS, FRAME);
    for (let i = 0; i < original.length; i += 1) {
      const { worldX, worldY, ...material } = original[i];
      const { worldX: movedX, worldY: movedY, ...movedMaterial } = moved[i];
      expect(movedMaterial).toEqual(material);
      expect(movedX - delta.x).toBeCloseTo(worldX, 10);
      expect(movedY - delta.y).toBeCloseTo(worldY, 10);
    }
    expect(mask(FRAME.offsetX + delta.x, FRAME.offsetY + delta.y, 256, movedColumns, movedFrame))
      .toEqual(mask(FRAME.offsetX, FRAME.offsetY, 256));
  });

  it('keeps independent continuous edges within the configured sleeper overhang', () => {
    let asymmetric = false;
    for (const seed of [0, 1, 17, 999]) {
      for (let y = -16; y < 512; y += 0.5) {
        const [left, right] = getTrackGravelEdges(seed, 3, y);
        const leftReach = CONFIG.sleeperLeftPx - left;
        const rightReach = right - CONFIG.sleeperRightPx;
        for (const reach of [leftReach, rightReach]) {
          expect(reach).toBeGreaterThanOrEqual(CONFIG.minOverhangPx);
          expect(reach).toBeLessThanOrEqual(CONFIG.maxOverhangPx);
        }
        asymmetric ||= Math.abs(leftReach - rightReach) > 0.5;
        const adjacent = getTrackGravelEdges(seed, 3, y + 0.00001);
        expect(Math.abs(left - adjacent[0])).toBeLessThan(0.001);
      }
    }
    expect(asymmetric).toBe(true);
  });

  it('gives overlapping chunk gutters the exact same mask pixels as a larger bake', () => {
    const full = mask(FRAME.offsetX, FRAME.offsetY, 256);
    const regions = [{ x: 0, y: 0, size: 132 }, { x: 124, y: 124, size: 132 }];
    for (const region of regions) {
      const part = mask(FRAME.offsetX + region.x, FRAME.offsetY + region.y, region.size);
      for (let y = 0; y < region.size; y += 1) {
        const start = ((region.y + y) * 256 + region.x) * 4;
        expect(part.slice(y * region.size * 4, (y + 1) * region.size * 4))
          .toEqual(full.slice(start, start + region.size * 4));
      }
    }
  });

  it('masks the outside and endpoints and unions overlapping beds', () => {
    const region = { worldX: FRAME.offsetX, worldY: FRAME.offsetY - 16, size: 256 };
    const pixels = new Uint8ClampedArray(256 * 256 * 4);
    const shorter = [{ ...COLUMNS[0], height: 32 }];
    writeTrackGravelCutout(pixels, 256, 17, shorter, FRAME, region);
    const alpha = (x: number, y: number) => pixels[(y * 256 + x) * 4 + 3];
    expect(alpha(128, 0)).toBe(255);
    expect(alpha(128, 24)).toBe(0);
    expect(alpha(128, 64)).toBe(255);
    expect(alpha(80, 24)).toBe(255);
    expect(alpha(176, 24)).toBe(255);
    const overlapping = [...shorter, { ...shorter[0], x: shorter[0].x + 32 }];
    writeTrackGravelCutout(pixels, 256, 17, overlapping, FRAME, region);
    expect(alpha(128, 24)).toBe(0);
    expect(alpha(160, 24)).toBe(0);
    writeTrackGravelCutout(pixels, 256, 17, [], FRAME, region);
    expect(pixels.every(value => value === 255)).toBe(true);
  });
});
