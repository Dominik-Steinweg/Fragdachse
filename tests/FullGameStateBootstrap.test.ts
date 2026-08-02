import { describe, expect, it } from 'vitest';
import {
  FULL_GAME_STATE_SLICE_KEYS,
  isCompleteGameStatePayload,
} from '../src/network/FullGameStateBootstrap';

describe('latejoin game-state bootstrap', () => {
  it('requires the current support-weapon slices for latejoiners', () => {
    expect(FULL_GAME_STATE_SLICE_KEYS).toEqual(expect.arrayContaining(['ei', 'fi', 'vu']));
    expect(FULL_GAME_STATE_SLICE_KEYS).not.toContain('tc');
  });

  it('accepts only a full payload with every arena slice present', () => {
    const full = Object.fromEntries(
      FULL_GAME_STATE_SLICE_KEYS.map((key) => [key, null]),
    );
    full.p = [];
    full._full = true;

    expect(isCompleteGameStatePayload(full)).toBe(true);

    const delta = { ...full };
    delete delta.u;
    expect(isCompleteGameStatePayload(delta)).toBe(false);
  });
});
