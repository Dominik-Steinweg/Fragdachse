import { describe, expect, it } from 'vitest';
import {
  FULL_GAME_STATE_SLICE_KEYS,
  isCompleteGameStatePayload,
} from '../src/network/FullGameStateBootstrap';

describe('latejoin game-state bootstrap', () => {
  it('requires the current support-weapon slices for latejoiners', () => {
    expect(FULL_GAME_STATE_SLICE_KEYS).toEqual(expect.arrayContaining(['ei', 'fi', 'vu', 'cc', 'mo', 'kr', 'fc', 'bq']));
    expect(FULL_GAME_STATE_SLICE_KEYS).not.toContain('tc');
  });

  it('accepts only a full payload with every arena slice present', () => {
    const full = Object.fromEntries(
      FULL_GAME_STATE_SLICE_KEYS.map((key) => [key, null]),
    );
    full.p = [];
    full._full = true;

    expect(isCompleteGameStatePayload(full)).toBe(true);

    const withoutMortar = { ...full };
    delete withoutMortar.mo;
    expect(isCompleteGameStatePayload(withoutMortar)).toBe(false);
    const withoutKraken = { ...full };
    delete withoutKraken.kr;
    expect(isCompleteGameStatePayload(withoutKraken)).toBe(false);
    const withoutBombers = { ...full };
    delete withoutBombers.bq;
    expect(isCompleteGameStatePayload(withoutBombers)).toBe(false);

    const withoutEssence = { ...full };
    delete withoutEssence.ae;
    expect(isCompleteGameStatePayload(withoutEssence)).toBe(false);

    const delta = { ...full };
    delete delta.u;
    expect(isCompleteGameStatePayload(delta)).toBe(false);
  });
});
