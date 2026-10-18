import { describe, expect, it } from 'vitest';
import { buildVoidCreepField, voidCreepAt, voidCreepLandAt, voidCreepSporePoints } from '../src/arena/VoidCreepField';
import { buildVoidWaterStain } from '../src/arena/VoidWaterStain';

const FRAME = { offsetX: 64, offsetY: 32, width: 2048, height: 1280 };
/** A round infested area around (700, 600); everything else untouched. */
const disc = { intensityAt: (x: number, y: number) => Math.max(0, 1 - Math.hypot(x - 700, y - 600) / 500) };
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

  it('lets infested ponds seep up their banks with their own infestation', () => {
    const plain = buildVoidCreepField(disc, FRAME)!;
    const banks = buildVoidCreepField(disc, FRAME, [1600, 300, 1])!;
    expect(voidCreepAt(plain, 1660, 300)).toBe(0);
    expect(voidCreepAt(banks, 1660, 300)).toBeGreaterThan(.2);
    const weak = buildVoidCreepField(disc, FRAME, [1600, 300, .3])!;
    expect(voidCreepAt(weak, 1660, 300)).toBeLessThan(voidCreepAt(banks, 1660, 300));
  });

  it('keeps strands and spores on land and is identical for every peer', () => {
    const water = (x: number) => x > 760 ? 0 : 1;
    const creep = buildVoidCreepField(disc, FRAME, [], water)!;
    expect(voidCreepLandAt(creep, 600, 600)).toBe(1);
    expect(voidCreepLandAt(creep, 900, 600)).toBe(0);
    const spores = voidCreepSporePoints(creep, 7);
    expect(spores.length).toBeGreaterThan(0);
    for (let i = 0; i < spores.length; i += 3) expect(voidCreepLandAt(creep, spores[i], spores[i + 1])).toBeGreaterThanOrEqual(.9);
    expect(voidCreepSporePoints(buildVoidCreepField(disc, FRAME, [], water)!, 7)).toEqual(spores);
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
