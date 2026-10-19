import { describe, expect, it } from 'vitest';
import { VoidHazeResidue } from '../src/arena/VoidHazeResidue';
import { RESIDUE_HAZE, VoidDangerField } from '../src/arena/VoidDangerField';

describe('residual haze of a deactivated place (user 2026-10-19)', () => {
  const taken = () => 1;

  it('keeps small dense patches over the void plants and clears the air between them', () => {
    const residue = new VoidHazeResidue([500, 500, 1, 900, 500, 1], () => 0, 7);
    expect(residue.at(500, 500)).toBeGreaterThan(.95);
    expect(residue.at(900, 500)).toBeGreaterThan(.95);
    expect(residue.at(700, 500)).toBe(0);
    expect(residue.at(500, 620)).toBe(0);
  });

  it('leaves only a small share of soaked ground hazy, and nothing on untouched ground', () => {
    const residue = new VoidHazeResidue([], taken, 11);
    let kept = 0, samples = 0;
    for (let y = 0; y < 3000; y += 23) for (let x = 0; x < 3000; x += 23) { samples++; if (residue.at(x, y) > .5) kept++; }
    expect(kept / samples).toBeGreaterThan(.02);
    expect(kept / samples).toBeLessThan(.2);
    expect(new VoidHazeResidue([], () => 0, 11).at(1234, 987)).toBe(0);
  });

  it('is what a place without presence keeps of its haze, at least RESIDUE_HAZE thick', () => {
    const field = new VoidDangerField([{ id: 'zone:nest', shapes: [{ kind: 'rect', x: 0, y: 0, width: 1000, height: 1000 }], rim: 96, plants: .85, haze: .45 }], 3);
    const residue = new VoidHazeResidue([500, 500, 1], () => 0, 3);
    const gone = () => 0, at = (x: number, y: number) => residue.at(x, y);
    expect(field.hazeAt(500, 500, gone)).toBe(0);
    expect(field.hazeAt(500, 500, gone, at)).toBeGreaterThan(RESIDUE_HAZE * .95);
    expect(field.hazeAt(200, 200, gone, at)).toBe(0);
    expect(field.extentOf('zone:nest')).toMatchObject({ x: expect.any(Number), radius: expect.any(Number) });
  });
});
