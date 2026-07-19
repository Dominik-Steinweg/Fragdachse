import { describe, expect, it } from 'vitest';
import { getCoopDefenseUpgradeLoadoutSelection } from '../src/utils/coopDefenseUpgrades';

describe('coop-defense upgrade loadout selection', () => {
  it('resolves a follow-up upgrade to the unlocked item', () => {
    expect(getCoopDefenseUpgradeLoadoutSelection('glock_adrenaline_gain')).toEqual({
      slot: 'weapon1',
      itemId: 'GLOCK',
    });
  });

  it('does not select an item for general upgrades', () => {
    expect(getCoopDefenseUpgradeLoadoutSelection('dash_range')).toBeNull();
  });
});
