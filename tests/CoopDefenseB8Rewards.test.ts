import { afterEach, describe, expect, it } from 'vitest';
import {
  getCoopDefenseItemAffixDefinition,
  getCoopDefenseItemAffixesForRoll,
} from '../src/config/coopDefenseItems';
import type { ResolvedCoopDefenseMapSecondaryObjectiveConfig } from '../src/config/coopDefenseMaps';
import { NetworkBridge, type RoundResult } from '../src/network/NetworkBridge';
import { clearActiveSession, setActiveSession } from '../src/network/peer/session';
import { CoopDefenseSecondaryObjectiveSystem } from '../src/systems/CoopDefenseSecondaryObjectiveSystem';
import type { CoopDefenseItem } from '../src/types';
import {
  applyCoopDefenseEpicGuarantee,
  getCoopDefenseItemAffixIdsForSlot,
  sanitizeCoopDefensePendingItemReward,
} from '../src/utils/coopDefenseItems';
import {
  createMatchItemRewardPresentation,
  resolveCoopDefenseEpicGuaranteeCount,
} from '../src/ui/MatchResultsModel';

function item(
  uid: string,
  rarity: CoopDefenseItem['rarity'] = 'white',
  slot: CoopDefenseItem['slot'] = 'armor',
  affixes: CoopDefenseItem['affixes'] = [],
): CoopDefenseItem {
  return { uid, slot, rarity, itemLevel: 4, baseValue: 42, affixes };
}

function carryObjective(targetGoal = 4): ResolvedCoopDefenseMapSecondaryObjectiveConfig {
  return {
    id: 'carry-beer',
    type: 'carry',
    start: { type: 'time', atMs: 0 },
    targets: [],
    targetGoal,
    rewards: { itemMetaRewardOnComplete: true },
    carry: {
      spawnZone: { gridX: 1, gridY: 1, widthCells: 1, heightCells: 1 },
      deliveryZone: { gridX: 10, gridY: 1, widthCells: 1, heightCells: 1 },
      itemCount: targetGoal,
    },
  };
}

describe('Coop Defense B8 reward ledger', () => {
  afterEach(() => clearActiveSession());

  it('books carry deliveries exactly once by itemId and caps the guarantee at three', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([carryObjective()]);
    system.hostUpdate(0, false);

    expect(system.getRewardLedger()).toEqual({ epicGuaranteeCount: 0 });
    expect(system.reportCarryDelivered('carry-beer', 'carry-beer:1')).toBe(true);
    expect(system.reportCarryDelivered('carry-beer', 'carry-beer:1')).toBe(false);
    expect(system.reportCarryDelivered('carry-beer', 'carry-beer:2')).toBe(true);
    expect(system.reportCarryDelivered('carry-beer', 'carry-beer:3')).toBe(true);
    expect(system.reportCarryDelivered('carry-beer', 'carry-beer:4')).toBe(true);
    expect(system.getEpicGuaranteeCount()).toBe(3);

    system.reset();
    expect(system.getEpicGuaranteeCount()).toBe(0);
  });

  it('does not couple future Carry objectives to the item meta reward', () => {
    const system = new CoopDefenseSecondaryObjectiveSystem([{
      ...carryObjective(1),
      rewards: undefined,
    }]);
    system.hostUpdate(0, false);

    expect(system.reportCarryDelivered('carry-beer', 'carry-beer:1')).toBe(true);
    expect(system.getEpicGuaranteeCount()).toBe(0);
  });
});

describe('Coop Defense B8 in-place item guarantee', () => {
  it.each([0, 1, 2, 3])('guarantees %i epic options without lowering offers', (count) => {
    const offers = [item('one'), item('two'), item('three')];
    const result = applyCoopDefenseEpicGuarantee(offers, count, null, () => 0);

    expect(result.filter((entry) => entry.rarity === 'yellow')).toHaveLength(count);
    expect(result.map((entry) => entry.uid)).toEqual(['one', 'two', 'three']);
    expect(result.map((entry) => entry.itemLevel)).toEqual([4, 4, 4]);
    expect(result.map((entry) => entry.baseValue)).toEqual([42, 42, 42]);
    expect(result.every((entry) => entry.affixes.length <= 2)).toBe(true);
  });

  it('counts natural Epic rolls and leaves them untouched', () => {
    const blue = item('blue', 'blue', 'armor', [{ affixId: 'max_hp', value: 31 }]);
    const yellow = item('yellow', 'yellow', 'armor', [
      { affixId: 'max_hp', value: 31 },
      { affixId: 'max_armor', value: 32 },
    ]);
    const result = applyCoopDefenseEpicGuarantee([blue, yellow, item('white')], 1, null, () => 0);

    expect(result.filter((entry) => entry.rarity === 'yellow')).toHaveLength(1);
    expect(result[0]).toBe(blue);
    expect(result[1]).toBe(yellow);
    expect(result[0].rarity).toBe('blue');
    expect(result[0].affixes).toEqual([{ affixId: 'max_hp', value: 31 }]);
    expect(result[1].affixes).toEqual([
      { affixId: 'max_hp', value: 31 },
      { affixId: 'max_armor', value: 32 },
    ]);
  });

  it('raises White to Epic in place and appends only the missing valid affix', () => {
    const source = item('white-to-epic', 'white', 'gloves');
    const result = applyCoopDefenseEpicGuarantee([source], 1, 'inspector_gadachs', () => 0)[0];
    const rollPool = getCoopDefenseItemAffixesForRoll('gloves', 'inspector_gadachs');

    expect(result).toMatchObject({ uid: 'white-to-epic', slot: 'gloves', itemLevel: 4, baseValue: 42, rarity: 'yellow' });
    expect(result.affixes).toHaveLength(2);
    expect(result.affixes.every((affix) => rollPool.some((definition) => definition.id === affix.affixId))).toBe(true);
  });

  it('raises Rare to Epic before a later White candidate', () => {
    const blue = item('blue-to-epic', 'blue', 'armor', [{ affixId: 'max_hp', value: 31 }]);
    const white = item('white-candidate');
    const result = applyCoopDefenseEpicGuarantee([blue, white, item('already-yellow', 'yellow')], 3, null, () => 0);

    expect(result[0].rarity).toBe('yellow');
    expect(result[1].rarity).toBe('yellow');
    expect(result[0].affixes[0]).toEqual({ affixId: 'max_hp', value: 31 });
    expect(result[2].rarity).toBe('yellow');
  });

  it('adds only valid weighted slot/class affixes to an upgraded option', () => {
    const source = item('upgrade-me', 'white', 'gloves');
    const result = applyCoopDefenseEpicGuarantee([source], 1, 'inspector_gadachs', () => 0)[0];
    const rollPool = getCoopDefenseItemAffixesForRoll('gloves', 'inspector_gadachs');

    expect(result).toMatchObject({ uid: 'upgrade-me', slot: 'gloves', itemLevel: 4, baseValue: 42, rarity: 'yellow' });
    expect(result.affixes).toHaveLength(2);
    for (const addedAffix of result.affixes) {
      const definition = getCoopDefenseItemAffixDefinition(addedAffix.affixId);
      expect(rollPool.map((entry) => entry.id)).toContain(addedAffix.affixId);
      expect(getCoopDefenseItemAffixIdsForSlot('gloves')).toContain(addedAffix.affixId);
      expect(definition?.slots).toContain('gloves');
      expect(!definition?.classIds || definition.classIds.includes('inspector_gadachs')).toBe(true);
    }
  });

  it('keeps the applied guarantee marker with the existing pending reward', () => {
    const pending = sanitizeCoopDefensePendingItemReward({
      roundEndedAt: 100,
      epicGuaranteeCount: 2,
      offers: [item('blue', 'blue', 'armor', [{ affixId: 'max_hp', value: 31 }])],
    });
    const presentation = createMatchItemRewardPresentation(pending, [], {});

    expect(pending?.epicGuaranteeCount).toBe(2);
    expect(presentation?.epicGuaranteeCount).toBe(2);
  });
});

describe('Coop Defense B8 round result path', () => {
  function result(epicGuaranteeCount?: number): RoundResult {
    return {
      id: 'p1',
      name: 'p1',
      colorHex: 0xffffff,
      frags: 0,
      teamId: null,
      roundEndedAt: 100,
      gameMode: 'coop_defense',
      mapName: 'Map 0',
      sharedXp: 20,
      epicGuaranteeCount,
    };
  }

  it('transports epicGuaranteeCount through the existing reliable round results snapshot', () => {
    const state = new Map<string, unknown>();
    const room = {
      isHost: () => true,
      setGlobal: (key: string, value: unknown) => state.set(key, value),
      getGlobal: (key: string) => state.get(key),
      destroy: () => undefined,
    };
    setActiveSession({ room: room as never, transport: {} as never, roomCode: 'b8' });

    const bridge = new NetworkBridge();
    bridge.publishRoundResults([result(2)]);
    expect(bridge.getRoundResults()?.[0]).toMatchObject({ sharedXp: 20, epicGuaranteeCount: 2 });
  });

  it('couples the guarantee to victory and clamps malformed values', () => {
    expect(resolveCoopDefenseEpicGuaranteeCount([result(9)], { status: 'victory' })).toBe(3);
    expect(resolveCoopDefenseEpicGuaranteeCount([result(3)], { status: 'defeat' })).toBe(0);
    expect(resolveCoopDefenseEpicGuaranteeCount([result(3)], { status: 'aborted' })).toBe(0);
    expect(resolveCoopDefenseEpicGuaranteeCount([result()], { status: 'victory' })).toBe(0);
  });
});
