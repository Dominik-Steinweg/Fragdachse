import { describe, expect, it } from 'vitest';
import { DEFAULT_COOP_PROGRAM, isSameCoopProgram, parseCoopProgram } from '../src/dawn/contracts/CoopProgram';
import { DAWN_UNLOCK_AFTER_MAP_ID, isDawnUnlocked } from '../src/dawn/rules/DawnUnlock';
import { COOP_DEFENSE_CAMPAIGN_MAP_COUNT } from '../src/config/coopDefenseMaps';

describe('Coop program contract', () => {
  it('defaults to campaign and compares parsed programs by value', () => {
    expect(DEFAULT_COOP_PROGRAM).toEqual({ kind: 'campaign' });
    for (const kind of ['campaign', 'dawn'] as const) {
      const parsed = parseCoopProgram(JSON.parse(JSON.stringify({ kind })));
      expect(parsed).toEqual({ kind });
      expect(isSameCoopProgram(parsed!, { kind })).toBe(true);
    }
    expect(isSameCoopProgram({ kind: 'campaign' }, { kind: 'dawn' })).toBe(false);
  });

  it.each([undefined, null, 'dawn', [], {}, { kind: 'endless' }, { kind: 1 }])('rejects malformed input %j', raw => {
    expect(parseCoopProgram(raw)).toBeNull();
  });
});

describe('Dawn unlock', () => {
  it('requires completion of the final campaign map, regardless of unlocked successors', () => {
    expect(DAWN_UNLOCK_AFTER_MAP_ID).toBe(String(COOP_DEFENSE_CAMPAIGN_MAP_COUNT));
    const progress = {
      highestUnlockedMapId: String(COOP_DEFENSE_CAMPAIGN_MAP_COUNT + 1),
      completedMapIds: Array.from({ length: COOP_DEFENSE_CAMPAIGN_MAP_COUNT - 1 }, (_, i) => String(i + 1)),
    };
    expect(isDawnUnlocked({ completedMapIds: [] })).toBe(false);
    expect(isDawnUnlocked(progress)).toBe(false);
    expect(isDawnUnlocked({ completedMapIds: [DAWN_UNLOCK_AFTER_MAP_ID] })).toBe(true);
  });
});
