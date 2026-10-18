import { describe, expect, it } from 'vitest';
import { buildVoidWaterStain, VOID_STAIN_TEXEL_PX } from '../src/arena/VoidWaterStain';
import type { EcologyPlacement } from '../src/arena/WoodlandEcologyField';

const FRAME = { offsetX: 100, offsetY: 50, width: 1024, height: 768 };
const lily = (x: number, y: number, voidAmount: number | undefined, extra: Partial<EcologyPlacement> = {}): EcologyPlacement => ({
  kind: 'pond', frame: 'lily-pad-01', x, y, size: 64, rotation: 0, alpha: 1, rank: 0, floating: true,
  void: voidAmount !== undefined, voidAmount, ...extra,
});
const at = (stain: NonNullable<ReturnType<typeof buildVoidWaterStain>>, x: number, y: number): number =>
  stain.data[Math.floor((y - stain.offsetY) / VOID_STAIN_TEXEL_PX) * stain.width + Math.floor((x - stain.offsetX) / VOID_STAIN_TEXEL_PX)] / 255;

describe('void water stain', () => {
  it('exists only around infested pond plants', () => {
    expect(buildVoidWaterStain([lily(400, 300, undefined)], FRAME)).toBeNull();
    expect(buildVoidWaterStain([lily(400, 300, .9, { kind: 'shore', floating: false })], FRAME)).toBeNull();
    const stain = buildVoidWaterStain([lily(400, 300, .9), lily(800, 600, undefined)], FRAME)!;
    expect(stain.width * VOID_STAIN_TEXEL_PX).toBeGreaterThanOrEqual(FRAME.width);
    expect(at(stain, 400, 300)).toBeGreaterThan(.6);
    // Natural water stays natural beyond the halo and around healthy plants.
    expect(at(stain, 400 + 64 * 1.6, 300)).toBe(0);
    expect(at(stain, 800, 600)).toBe(0);
  });

  it('seeps out softly and follows the plant\'s infestation', () => {
    const strong = buildVoidWaterStain([lily(400, 300, 1)], FRAME)!, weak = buildVoidWaterStain([lily(400, 300, .35)], FRAME)!;
    let previous = Infinity;
    for (let d = 0; d <= 64 * 1.4; d += VOID_STAIN_TEXEL_PX) {
      const value = at(strong, 400 + d, 300);
      expect(value).toBeLessThanOrEqual(previous + 1e-9);
      expect(at(weak, 400 + d, 300)).toBeLessThanOrEqual(value);
      previous = value;
    }
    expect(at(strong, 400 + 64, 300)).toBeGreaterThan(0);
  });

  it('merges neighbouring plants into one patch without exceeding full ink', () => {
    const pair = buildVoidWaterStain([lily(400, 300, .8), lily(470, 300, .8)], FRAME)!;
    const single = buildVoidWaterStain([lily(400, 300, .8)], FRAME)!;
    expect(at(pair, 435, 300)).toBeGreaterThan(at(single, 435, 300));
    for (const value of pair.data) expect(value).toBeLessThanOrEqual(255);
  });
});
