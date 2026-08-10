import { describe, expect, it } from 'vitest';
import { ARENA_BACKGROUND_TEXTURE_KEY, resolveArenaBackgroundSpec } from '../src/arena/ArenaBackground';
import { CAPTURE_THE_BEER_ARENA_WIDTH, FULL_ARENA_WIDTH } from '../src/config';
import { CAPTURE_THE_BEER_MODE, COOP_DEFENSE_MODE } from '../src/gameModes';

describe('Arena background selection', () => {
  it('uses one shared tile for the default arena', () => {
    expect(resolveArenaBackgroundSpec(COOP_DEFENSE_MODE, FULL_ARENA_WIDTH)).toEqual({
      textureKey: ARENA_BACKGROUND_TEXTURE_KEY,
    });
  });

  it('keeps the same tile for intermediate widths', () => {
    expect(resolveArenaBackgroundSpec(COOP_DEFENSE_MODE, 2_880)).toEqual({
      textureKey: ARENA_BACKGROUND_TEXTURE_KEY,
    });
  });

  it('keeps the same tile for the expanded arena', () => {
    expect(resolveArenaBackgroundSpec(
      CAPTURE_THE_BEER_MODE,
      CAPTURE_THE_BEER_ARENA_WIDTH,
    )).toEqual({
      textureKey: ARENA_BACKGROUND_TEXTURE_KEY,
    });
  });
});
