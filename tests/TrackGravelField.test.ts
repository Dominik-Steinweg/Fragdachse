import { describe, expect, it } from 'vitest';
import { getTrackBallastProfile, writeTrackBallast } from '../src/arena/TrackGravelField';
import { TRACK_BALLAST_REACH_PX, TRACK_GRAVEL_CONFIG as CONFIG } from '../src/arena/TrackGravelConfig';

const FRAME = { offsetX: 37, offsetY: 19, width: 512, height: 512 };
const COLUMNS = [
  { x: FRAME.offsetX + 96, y: FRAME.offsetY, width: 64, height: 512 },
  { x: FRAME.offsetX + 320, y: FRAME.offsetY, width: 64, height: 512 },
];

/** Small deterministic stand-in material with stone-like value variation. */
function material(salt: number) {
  const size = 64, rgba = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = (Math.imul(i + salt * 7919, 2654435761) >>> 24);
    rgba.set([60 + (v >> 1), 58 + (v >> 1), 52 + (v >> 1), 255], i * 4);
  }
  return { width: size, height: size, rgba };
}
const MATERIALS = { gravel: material(1), soil: material(2) };

function bed(x: number, y: number, size: number, columns = COLUMNS, frame = FRAME, seed = 17) {
  const pixels = new Uint8ClampedArray(size * size * 4);
  writeTrackBallast(pixels, size, seed, columns, frame, { worldX: x, worldY: y, size }, MATERIALS);
  return pixels;
}

describe('railway ballast bed', () => {
  it('is stable across input order and rebuilds, but varies by world seed', () => {
    const first = bed(FRAME.offsetX, FRAME.offsetY, 256);
    expect(bed(FRAME.offsetX, FRAME.offsetY, 256, [...COLUMNS].reverse())).toEqual(first);
    expect(bed(FRAME.offsetX, FRAME.offsetY, 256)).toEqual(first);
    expect(bed(FRAME.offsetX, FRAME.offsetY, 256, COLUMNS, FRAME, 18)).not.toEqual(first);
    expect(bed(FRAME.offsetX, FRAME.offsetY, 256, []).every(value => value === 0)).toBe(true);
  });

  it('moves with the world frame without rerolling the material', () => {
    const delta = { x: 1024, y: -64 };
    const movedFrame = { ...FRAME, offsetX: FRAME.offsetX + delta.x, offsetY: FRAME.offsetY + delta.y };
    const movedColumns = COLUMNS.map(c => ({ ...c, x: c.x + delta.x, y: c.y + delta.y }));
    expect(bed(FRAME.offsetX + delta.x, FRAME.offsetY + delta.y, 256, movedColumns, movedFrame))
      .toEqual(bed(FRAME.offsetX, FRAME.offsetY, 256));
  });

  it('keeps independent continuous edges within the configured core and shoulder reach', () => {
    let asymmetric = false;
    for (const seed of [0, 1, 17, 999]) {
      for (let y = -16; y < 512; y += 0.5) {
        const profile = getTrackBallastProfile(seed, 3, y);
        const cores = [CONFIG.sleeperLeftPx - profile.coreLeft, profile.coreRight - CONFIG.sleeperRightPx];
        const shoulders = [profile.coreLeft - profile.shoulderLeft, profile.shoulderRight - profile.coreRight];
        for (const reach of cores) {
          expect(reach).toBeGreaterThanOrEqual(CONFIG.minCoreOverhangPx);
          expect(reach).toBeLessThanOrEqual(CONFIG.maxCoreOverhangPx);
        }
        for (const reach of shoulders) {
          expect(reach).toBeGreaterThanOrEqual(CONFIG.minShoulderPx);
          expect(reach).toBeLessThanOrEqual(CONFIG.maxShoulderPx);
        }
        asymmetric ||= Math.abs(shoulders[0] - shoulders[1]) > 0.5;
        const adjacent = getTrackBallastProfile(seed, 3, y + 0.00001);
        expect(Math.abs(profile.shoulderLeft - adjacent.shoulderLeft)).toBeLessThan(0.001);
      }
    }
    expect(asymmetric).toBe(true);
  });

  it('gives overlapping chunk gutters the exact same pixels as a larger bake', () => {
    const full = bed(FRAME.offsetX, FRAME.offsetY, 256);
    const regions = [{ x: 0, y: 0, size: 132 }, { x: 124, y: 124, size: 132 }];
    for (const region of regions) {
      const part = bed(FRAME.offsetX + region.x, FRAME.offsetY + region.y, region.size);
      for (let y = 0; y < region.size; y += 1) {
        const start = ((region.y + y) * 256 + region.x) * 4;
        expect(part.slice(y * region.size * 4, (y + 1) * region.size * 4))
          .toEqual(full.slice(start, start + region.size * 4));
      }
    }
  });

  it('covers the sleeper footprint, fades within its reach, ends with the column and unions beds', () => {
    const region = { worldX: FRAME.offsetX, worldY: FRAME.offsetY - 16, size: 256 };
    const shorter = [{ ...COLUMNS[0], height: 32 }];
    const pixels = new Uint8ClampedArray(256 * 256 * 4);
    const alpha = (x: number, y: number) => pixels[(y * 256 + x) * 4 + 3];
    writeTrackBallast(pixels, 256, 17, shorter, FRAME, region, MATERIALS);
    // Column x = 96; the sleepers span x 102..154 in this region.
    for (let x = 102; x < 154; x += 1) expect(alpha(x, 24)).toBeGreaterThan(0);
    expect(alpha(96 - TRACK_BALLAST_REACH_PX - 1, 24)).toBe(0);
    expect(alpha(96 + 64 + TRACK_BALLAST_REACH_PX + 1, 24)).toBe(0);
    expect(alpha(128, 0)).toBe(0);
    expect(alpha(128, 64)).toBe(0);
    const alone = alpha(150, 24);
    writeTrackBallast(pixels, 256, 17, [...shorter, { ...shorter[0], x: shorter[0].x + 32 }], FRAME, region, MATERIALS);
    expect(alpha(150, 24)).toBeGreaterThanOrEqual(alone);
    expect(alpha(180, 24)).toBeGreaterThan(0);
  });
});
