import { describe, expect, it } from 'vitest';
import {
  COOP_DEFENSE_ITEM_REWARD_BACK_LABEL,
  COOP_DEFENSE_ITEM_REWARD_LATER_LABEL,
} from '../src/ui/coopDefenseRewardLabels';

describe('German visible Coop-Defense labels', () => {
  it('uses direct UTF-8 spelling for reward navigation', () => {
    expect(COOP_DEFENSE_ITEM_REWARD_BACK_LABEL).toBe('ZURÜCK');
    expect(COOP_DEFENSE_ITEM_REWARD_LATER_LABEL).toBe('SPÄTER ENTSCHEIDEN');
  });
});
