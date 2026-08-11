import { describe, expect, it } from 'vitest';
import {
  ARENA_BACKGROUND_DETAIL_ALPHA,
  ARENA_BACKGROUND_DETAIL_TEXTURE_KEY,
  ARENA_BACKGROUND_TEXTURE_KEY,
  resolveArenaBackgroundSpec,
} from '../src/arena/ArenaBackground';
import { CAPTURE_THE_BEER_ARENA_WIDTH, FULL_ARENA_WIDTH } from '../src/config';
import { CAPTURE_THE_BEER_MODE, COOP_DEFENSE_MODE } from '../src/gameModes';

const SHARED_SPEC = {
  textureKey: ARENA_BACKGROUND_TEXTURE_KEY,
  detailTextureKey: ARENA_BACKGROUND_DETAIL_TEXTURE_KEY,
  detailAlpha: ARENA_BACKGROUND_DETAIL_ALPHA,
};

describe('Arena background selection', () => {
  it('uses one shared tile pair for the default arena', () => {
    expect(resolveArenaBackgroundSpec(COOP_DEFENSE_MODE, FULL_ARENA_WIDTH)).toEqual(SHARED_SPEC);
  });

  it('keeps the same tile pair for intermediate widths', () => {
    expect(resolveArenaBackgroundSpec(COOP_DEFENSE_MODE, 2_880)).toEqual(SHARED_SPEC);
  });

  it('keeps the same tile pair for the expanded arena', () => {
    expect(resolveArenaBackgroundSpec(
      CAPTURE_THE_BEER_MODE,
      CAPTURE_THE_BEER_ARENA_WIDTH,
    )).toEqual(SHARED_SPEC);
  });

  /**
   * Der Periodenbruch der Detailebene ist der Grund für die zweite Kachel: Beide Größen dürfen
   * kein kleines gemeinsames Vielfaches haben, sonst wiederholt sich die Kombination sichtbar.
   */
  it('keeps the two ground tiles on decorrelated periods', () => {
    const base = 627;
    const detail = 512;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    expect((base * detail) / gcd(base, detail)).toBeGreaterThan(CAPTURE_THE_BEER_ARENA_WIDTH * 10);
  });
});
