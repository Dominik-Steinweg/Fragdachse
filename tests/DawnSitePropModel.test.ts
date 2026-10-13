import { describe, expect, it } from 'vitest';
import { resolveDawnSitePropVisual } from '../src/arena/DawnSitePropModel';
import type { CoopDefenseSecondaryObjectiveState } from '../src/types';

const states: readonly (CoopDefenseSecondaryObjectiveState | undefined)[] = [undefined, 'dormant', 'active', 'completed', 'failed'];

describe('Dawn site prop projection', () => {
  it.each([1, 2, 3])('shows wreck tier %i until salvaged or destroyed', tier => {
    for (const state of states) {
      expect(resolveDawnSitePropVisual('wreck', tier, state, false)).toEqual(state === 'completed'
        ? null : { textureKey: `construction_dawn_wreck_t${tier}`, animationKey: null });
      expect(resolveDawnSitePropVisual('wreck', tier, state, true)).toBeNull();
    }
  });

  it.each([1, 2, 3])('projects extractor tier %i from rest to active to idle', tier => {
    for (const state of states) {
      const animated = state === 'active' || state === 'completed';
      expect(resolveDawnSitePropVisual('extractor', tier, state, false)).toEqual({
        textureKey: animated ? 'construction_dawn_extractor_sheet' : 'construction_dawn_extractor',
        animationKey: state === 'active' ? 'construction_dawn_extractor_sheet_active'
          : state === 'completed' ? 'construction_dawn_extractor_sheet_idle' : null,
      });
      expect(resolveDawnSitePropVisual('extractor', tier, state, true)).toBeNull();
    }
  });

  it('does not invent a visual for unknown art', () => {
    expect(resolveDawnSitePropVisual('unknown', 1, undefined, false)).toBeNull();
    expect(resolveDawnSitePropVisual('wreck', 4, undefined, false)).toBeNull();
  });
});
