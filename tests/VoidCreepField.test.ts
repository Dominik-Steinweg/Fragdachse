import { describe, expect, it } from 'vitest';
import { buildVoidCreepField, buildVoidCreepHaze, buildVoidCreepLand, voidCreepAt, voidCreepHazeAt, voidCreepLandAt, voidCreepTexelRect } from '../src/arena/VoidCreepField';
import { buildVoidWaterStain } from '../src/arena/VoidWaterStain';

const FRAME = { offsetX: 64, offsetY: 32, width: 2048, height: 1280 };
/** A round infested area around (700, 600) with haze over it; everything else untouched. */
const falloff = (x: number, y: number) => Math.max(0, 1 - Math.hypot(x - 700, y - 600) / 500);
const disc = { intensityAt: falloff, hazeAt: falloff };
const none = { intensityAt: () => 0 };

describe('void creep field', () => {
  it('exists only where the void has taken over, so clean worlds keep no textures', () => {
    expect(buildVoidCreepField(none, FRAME)).toBeNull();
    const creep = buildVoidCreepField(disc, FRAME)!;
    expect(voidCreepAt(creep, 700, 600)).toBeGreaterThan(.8);
    expect(voidCreepAt(creep, 1900, 1200)).toBe(0);
  });

  it('soaks the land only where the takeover is established, not at its faint rim', () => {
    const creep = buildVoidCreepField(disc, FRAME)!;
    // Intensity below about a third never creeps, whatever the warp does.
    expect(voidCreepAt(creep, 700 + 500 * .8, 600)).toBe(0);
    expect(voidCreepAt(creep, 700, 600)).toBeGreaterThan(voidCreepAt(creep, 700 + 500 * .45, 600));
  });

  it('keeps the haze apart from the soaked ground: a region rewritten without haze keeps its scar', () => {
    const creep = buildVoidCreepField(disc, FRAME)!;
    expect(voidCreepHazeAt(creep, 700, 600)).toBeGreaterThan(.6);
    expect(voidCreepHazeAt(creep, 1900, 1200)).toBe(0);
    const rect = voidCreepTexelRect(creep, { x: 200, y: 100, width: 1000, height: 1000 })!;
    // The full build and a region build agree texel for texel.
    const again = buildVoidCreepHaze(creep, disc, rect), width = rect.x1 - rect.x0 + 1;
    for (let y = rect.y0; y <= rect.y1; y += 7) for (let x = rect.x0; x <= rect.x1; x += 7)
      expect(again[(y - rect.y0) * width + x - rect.x0]).toBe(creep.haze[y * creep.width + x]);
    const lifted = buildVoidCreepHaze(creep, { intensityAt: falloff }, rect);
    expect(Math.max(...lifted)).toBe(0);
    expect(voidCreepAt(creep, 700, 600)).toBeGreaterThan(.8);
    // Haze alone still keeps a field, so a hazy place without plants is drawn.
    expect(buildVoidCreepField({ intensityAt: () => 0, hazeAt: falloff }, FRAME)).not.toBeNull();
  });

  it('lets infested ponds seep up their banks with their own infestation', () => {
    const plain = buildVoidCreepField(disc, FRAME)!;
    const banks = buildVoidCreepField(disc, FRAME, [1600, 300, 1])!;
    expect(voidCreepAt(plain, 1660, 300)).toBe(0);
    expect(voidCreepAt(banks, 1660, 300)).toBeGreaterThan(.2);
    const weak = buildVoidCreepField(disc, FRAME, [1600, 300, .3])!;
    expect(voidCreepAt(weak, 1660, 300)).toBeLessThan(voidCreepAt(banks, 1660, 300));
  });

  it('records the land share and is identical for every peer', () => {
    const water = (x: number) => x > 760 ? 0 : 1;
    const creep = buildVoidCreepField(disc, FRAME, [], water)!;
    expect(voidCreepLandAt(creep, 600, 600)).toBe(1);
    expect(voidCreepLandAt(creep, 900, 600)).toBe(0);
    expect(buildVoidCreepField(disc, FRAME, [], water)).toEqual(creep);
  });

  it('keeps only the land share for a World whose trails need it, the same for every peer', () => {
    const water = (x: number) => x > 760 ? 0 : 1;
    const land = buildVoidCreepLand(FRAME, water);
    expect(land.landOnly).toBe(true);
    expect(Math.max(...land.data, ...land.haze)).toBe(0);
    expect(voidCreepLandAt(land, 600, 600)).toBe(1);
    expect(voidCreepLandAt(land, 900, 600)).toBe(0);
    expect(land.land).toEqual(buildVoidCreepField(disc, FRAME, [], water)!.land);
    expect(buildVoidCreepLand(FRAME, water)).toEqual(land);
  });

  it('inks larger stretches of water where it reaches a pond', () => {
    const creep = buildVoidCreepField(disc, FRAME)!;
    const stain = buildVoidWaterStain([], FRAME, creep)!;
    const at = (x: number, y: number) => stain.data[Math.floor((y - stain.offsetY) / stain.texelPx) * stain.width
      + Math.floor((x - stain.offsetX) / stain.texelPx)];
    expect(at(700, 600)).toBeGreaterThan(80);
    expect(at(1900, 1200)).toBe(0);
  });
});
