import { describe, expect, it } from 'vitest';
import { resolveArenaBackgroundSpec } from '../src/arena/ArenaBackground';
import {
  ARENA_HEIGHT,
  CAPTURE_THE_BEER_ARENA_WIDTH,
  FULL_ARENA_WIDTH,
} from '../src/config';
import { CAPTURE_THE_BEER_MODE, COOP_DEFENSE_MODE } from '../src/gameModes';

describe('Arena background selection', () => {
  it('keeps the current Coop background at native size', () => {
    expect(resolveArenaBackgroundSpec(COOP_DEFENSE_MODE, FULL_ARENA_WIDTH)).toEqual({
      textureKey: 'gras_bg_dm',
      sourceX: 0,
      sourceY: 0,
      sourceWidth: FULL_ARENA_WIDTH,
      sourceHeight: ARENA_HEIGHT,
    });
  });

  it('uses a centered native crop for intermediate Coop widths', () => {
    expect(resolveArenaBackgroundSpec(COOP_DEFENSE_MODE, 2_880)).toEqual({
      textureKey: 'gras_bg_ctb',
      sourceX: 720,
      sourceY: 0,
      sourceWidth: 2_880,
      sourceHeight: ARENA_HEIGHT,
    });
  });

  it('uses the complete expanded background at the shared maximum', () => {
    expect(resolveArenaBackgroundSpec(
      CAPTURE_THE_BEER_MODE,
      CAPTURE_THE_BEER_ARENA_WIDTH,
    )).toEqual({
      textureKey: 'gras_bg_ctb',
      sourceX: 0,
      sourceY: 0,
      sourceWidth: CAPTURE_THE_BEER_ARENA_WIDTH,
      sourceHeight: ARENA_HEIGHT,
    });
  });
});
