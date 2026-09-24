import { describe, expect, it } from 'vitest';
import {
  ARENA_BACKGROUND_TEXTURE_KEY,
  resolveArenaBackgroundSpec,
} from '../src/arena/ArenaBackground';
import { CAPTURE_THE_BEER_ARENA_WIDTH, FULL_ARENA_WIDTH } from '../src/config';
import { CAPTURE_THE_BEER_MODE, COOP_DEFENSE_MODE } from '../src/gameModes';

const SHARED_SPEC = {
  textureKey: ARENA_BACKGROUND_TEXTURE_KEY,
};

describe('Arena background selection', () => {
  it('uses one shared material for the default arena', () => {
    expect(resolveArenaBackgroundSpec(COOP_DEFENSE_MODE, FULL_ARENA_WIDTH)).toEqual(SHARED_SPEC);
  });

  it('keeps the same material for intermediate widths', () => {
    expect(resolveArenaBackgroundSpec(COOP_DEFENSE_MODE, 2_880)).toEqual(SHARED_SPEC);
  });

  it('keeps the same material for the expanded arena', () => {
    expect(resolveArenaBackgroundSpec(
      CAPTURE_THE_BEER_MODE,
      CAPTURE_THE_BEER_ARENA_WIDTH,
    )).toEqual(SHARED_SPEC);
  });

});
