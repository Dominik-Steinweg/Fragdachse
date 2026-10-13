import { describe, expect, it } from 'vitest';
import {
  selectFireControlCopySources,
  type FireControlCopyCandidate,
} from '../src/systems/fireControl/FireControlSourceSelection';

function candidate(id: number, constructionId: string, x: number, y = 0): FireControlCopyCandidate {
  return Object.freeze({ id, constructionId, x, y });
}

describe('fire control copy source selection', () => {
  it('chooses different types before additional originals, ordered by build slot in each round', () => {
    const candidates = [
      candidate(1, 'rocket_turret', 1), candidate(2, 'rocket_turret', 2), candidate(3, 'rocket_turret', 3),
      candidate(4, 'flame_turret', 100), candidate(5, 'flame_turret', 200),
      candidate(6, 'spore_turret', 300),
    ];
    const input = { candidates, slotOrder: ['flame_turret', 'rocket_turret', 'spore_turret'], pointX: 0, pointY: 0 };
    expect(selectFireControlCopySources({ ...input, maxCopies: 3 }).map(source => source.id)).toEqual([4, 1, 6]);
    expect(selectFireControlCopySources({ ...input, maxCopies: 20 }).map(source => source.id))
      .toEqual([4, 1, 6, 5, 2, 3]);
  });

  it('ranks each type by distance to the cursor, breaking equal distances by smaller ID', () => {
    const candidates = [
      candidate(1, 'rocket_turret', 0), candidate(5, 'rocket_turret', 7, 6),
      candidate(3, 'rocket_turret', 4, 9), candidate(9, 'rocket_turret', 4, 4),
    ];
    const result = selectFireControlCopySources({ candidates, slotOrder: [], pointX: 4, pointY: 4, maxCopies: 4 });
    expect(result.map(source => source.id)).toEqual([9, 5, 3, 1]);
    const tied = selectFireControlCopySources({
      candidates: [candidate(8, 'flame_turret', 7, 8), candidate(2, 'flame_turret', 4, 9)],
      slotOrder: [], pointX: 4, pointY: 4, maxCopies: 1,
    });
    expect(tied.map(source => source.id)).toEqual([2]);
  });

  it('puts unequipped types alphabetically after slot types and ignores duplicate or empty slots', () => {
    const candidates = [
      candidate(1, 'spore_turret', 0), candidate(2, 'flame_turret', 0),
      candidate(3, 'rocket_turret', 0), candidate(4, 'rocket_turret', 1),
      candidate(5, 'gravity_turret', 0),
    ];
    expect(selectFireControlCopySources({
      candidates, slotOrder: ['missing_type', 'rocket_turret', 'rocket_turret'],
      pointX: 0, pointY: 0, maxCopies: 5,
    }).map(source => source.id)).toEqual([3, 2, 5, 1, 4]);
  });

  it('counts a repeated ID once, using the first facts supplied for that original', () => {
    const first = candidate(1, 'rocket_turret', 2);
    const result = selectFireControlCopySources({
      candidates: [first, first, candidate(1, 'flame_turret', 0), candidate(2, 'rocket_turret', 3)],
      slotOrder: ['flame_turret', 'rocket_turret'], pointX: 0, pointY: 0, maxCopies: 3,
    });
    expect(result).toEqual([first, candidate(2, 'rocket_turret', 3)]);
  });

  it('returns nothing for nonpositive capacity or no candidates', () => {
    const input = { candidates: [candidate(1, 'rocket_turret', 0)], slotOrder: [], pointX: 0, pointY: 0 };
    for (const maxCopies of [0, -1]) expect(selectFireControlCopySources({ ...input, maxCopies })).toEqual([]);
    expect(selectFireControlCopySources({ ...input, candidates: [], maxCopies: 3 })).toEqual([]);
  });

  it('is reproducible independently of candidate enumeration and never mutates inputs', () => {
    const candidates = Object.freeze([
      candidate(8, 'spore_turret', 1), candidate(3, 'rocket_turret', 5),
      candidate(2, 'rocket_turret', -5), candidate(9, 'flame_turret', 10),
    ]);
    const input = Object.freeze({ candidates, slotOrder: Object.freeze(['rocket_turret']), pointX: 0, pointY: 0, maxCopies: 4 });
    const result = selectFireControlCopySources(input);
    expect(selectFireControlCopySources(input)).toEqual(result);
    expect(selectFireControlCopySources({ ...input, candidates: [...candidates].reverse() })).toEqual(result);
    expect(result.map(source => source.id)).toEqual([2, 9, 8, 3]);
    expect(candidates.map(source => source.id)).toEqual([8, 3, 2, 9]);
    expect(input.slotOrder).toEqual(['rocket_turret']);
  });
});
