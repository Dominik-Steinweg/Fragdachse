import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addStoredCoopDefenseItem,
  claimStoredPendingCoopDefenseItemReward,
  clearStoredPendingCoopDefenseItemReward,
  equipStoredCoopDefenseItem,
  getStoredCoopDefenseEquippedItemIds,
  getStoredCoopDefenseItems,
  getStoredCoopDefenseItemsUnlocked,
  getStoredCoopDefenseProgress,
  getStoredEquippedCoopDefenseItems,
  getStoredPendingCoopDefenseItemReward,
  markStoredCoopDefenseItemsSeen,
  resetStoredCoopDefenseCharacter,
  salvageStoredCoopDefenseItem,
  setStoredCoopDefenseItemsUnlocked,
  setStoredCoopDefenseTotalXp,
  setStoredPendingCoopDefenseItemReward,
  unequipStoredCoopDefenseItem,
  unlockStoredCoopDefenseItemsAfterVictory,
} from '../src/utils/localPreferences';
import {
  COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID,
  COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT,
} from '../src/config/coopDefenseItems';
import { getCoopDefenseItemSalvageXp } from '../src/utils/coopDefenseItems';
import type { CoopDefenseItem } from '../src/types';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number { return this.values.size; }
  clear(): void { this.values.clear(); }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const STORAGE_KEY = 'fragdachse_local_preferences';

function item(overrides: Partial<CoopDefenseItem> = {}): CoopDefenseItem {
  return {
    uid: 'it_a',
    slot: 'armor',
    rarity: 'white',
    itemLevel: 1,
    baseValue: 25,
    affixes: [],
    ...overrides,
  };
}

function writeRawProgress(coopDefense: Record<string, unknown>): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
    version: 17,
    progression: { coopDefense },
  }));
}

describe('coop-defense item persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { localStorage: new MemoryStorage() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('starts locked, empty and without a pending reward', () => {
    const progress = getStoredCoopDefenseProgress();
    expect(progress.itemsUnlocked).toBe(false);
    expect(progress.items).toEqual([]);
    expect(progress.equippedItemIds).toEqual({});
    expect(progress.pendingItemReward).toBeNull();
  });

  it('unlocks only on the configured map victory', () => {
    expect(unlockStoredCoopDefenseItemsAfterVictory('9')).toBe(false);
    expect(getStoredCoopDefenseItemsUnlocked()).toBe(false);

    expect(unlockStoredCoopDefenseItemsAfterVictory(COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID)).toBe(true);
    expect(getStoredCoopDefenseItemsUnlocked()).toBe(true);
    // Zweiter Sieg auf derselben Map aendert nichts mehr.
    expect(unlockStoredCoopDefenseItemsAfterVictory(COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID)).toBe(false);
  });

  it('migrates old completed-map-10 progress to unlocked items', () => {
    writeRawProgress({ highestUnlockedMapId: '11', itemsUnlocked: false });
    expect(getStoredCoopDefenseProgress().itemsUnlocked).toBe(true);
  });

  it('keeps items locked when map 10 was reached but not won', () => {
    writeRawProgress({ highestUnlockedMapId: '10', itemsUnlocked: false });
    expect(getStoredCoopDefenseProgress().itemsUnlocked).toBe(false);
  });

  it('migrates removed map 16 progress without losing item state', () => {
    const storedItem = item({ uid: 'legacy-item' });
    const pending = { roundEndedAt: 42, offers: [item({ uid: 'legacy-offer' })] };
    writeRawProgress({
      highestUnlockedMapId: '16',
      itemsUnlocked: false,
      items: [storedItem],
      pendingItemReward: pending,
    });

    const progress = getStoredCoopDefenseProgress();
    expect(progress.highestUnlockedMapId).toBe('15');
    expect(progress.itemsUnlocked).toBe(true);
    expect(progress.items.map((entry) => entry.uid)).toEqual(['legacy-item']);
    expect(progress.pendingItemReward?.offers.map((entry) => entry.uid)).toEqual(['legacy-offer']);
  });

  it('round-trips items, equipment and pending rewards through storage', () => {
    setStoredCoopDefenseItemsUnlocked(true);
    expect(addStoredCoopDefenseItem(item({ uid: 'armor-1' }))).toBe(true);
    expect(addStoredCoopDefenseItem(item({ uid: 'boots-1', slot: 'boots', baseValue: 0.05 }))).toBe(true);
    expect(equipStoredCoopDefenseItem('armor-1')).toBe(true);
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 42, offers: [item({ uid: 'offer-1' })] });

    expect(getStoredCoopDefenseItems().map((entry) => entry.uid)).toEqual(['armor-1', 'boots-1']);
    expect(getStoredCoopDefenseEquippedItemIds()).toEqual({ armor: 'armor-1' });
    expect(getStoredEquippedCoopDefenseItems().map((entry) => entry.uid)).toEqual(['armor-1']);
    expect(getStoredPendingCoopDefenseItemReward()?.roundEndedAt).toBe(42);

    expect(unequipStoredCoopDefenseItem('armor')).toBe(true);
    expect(getStoredCoopDefenseEquippedItemIds()).toEqual({});
    clearStoredPendingCoopDefenseItemReward();
    expect(getStoredPendingCoopDefenseItemReward()).toBeNull();
  });

  it('refuses to store an item once the category is full, ignoring the equipped one', () => {
    for (let index = 0; index < COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT; index++) {
      expect(addStoredCoopDefenseItem(item({ uid: `armor-${index}` }))).toBe(true);
    }
    expect(addStoredCoopDefenseItem(item({ uid: 'armor-overflow' }))).toBe(false);

    // Wird eines ausgeruestet, zaehlt es nicht mehr aufs Limit und es passt wieder eines rein.
    expect(equipStoredCoopDefenseItem('armor-0')).toBe(true);
    expect(addStoredCoopDefenseItem(item({ uid: 'armor-overflow' }))).toBe(true);
  });

  it('grants salvage xp exactly once and refuses to salvage an equipped item', () => {
    setStoredCoopDefenseTotalXp(100);
    // Ein gelbes Item traegt zwei Eigenschaften; ohne sie stuft die Sanitisierung es zu Recht ab.
    const yellowArmor = item({
      uid: 'armor-1',
      rarity: 'yellow',
      itemLevel: 3,
      affixes: [{ affixId: 'max_armor', value: 20 }, { affixId: 'hp_regen', value: 2 }],
    });
    addStoredCoopDefenseItem(yellowArmor);
    const expectedXp = getCoopDefenseItemSalvageXp(yellowArmor);

    expect(salvageStoredCoopDefenseItem('armor-1')).toBe(expectedXp);
    expect(getStoredCoopDefenseProgress().totalXp).toBe(100 + expectedXp);
    // Zweiter Aufruf findet nichts mehr und darf keine XP nachschieben.
    expect(salvageStoredCoopDefenseItem('armor-1')).toBe(0);
    expect(getStoredCoopDefenseProgress().totalXp).toBe(100 + expectedXp);

    addStoredCoopDefenseItem(item({ uid: 'armor-2' }));
    equipStoredCoopDefenseItem('armor-2');
    expect(salvageStoredCoopDefenseItem('armor-2')).toBe(0);
  });

  it('claims a pending reward into a free category', () => {
    setStoredPendingCoopDefenseItemReward({
      roundEndedAt: 7,
      offers: [item({ uid: 'offer-armor' }), item({ uid: 'offer-boots', slot: 'boots', baseValue: 0.05 })],
    });

    const claim = claimStoredPendingCoopDefenseItemReward('offer-boots');
    expect(claim?.acquired?.uid).toBe('offer-boots');
    expect(claim?.salvagedXp).toBe(0);
    expect(getStoredCoopDefenseItems().map((entry) => entry.uid)).toEqual(['offer-boots']);
    expect(getStoredPendingCoopDefenseItemReward()).toBeNull();
  });

  it('keeps the reward open when the category is full and nothing is salvaged', () => {
    for (let index = 0; index < COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT; index++) {
      addStoredCoopDefenseItem(item({ uid: `armor-${index}` }));
    }
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'offer-armor' })] });

    expect(claimStoredPendingCoopDefenseItemReward('offer-armor')).toBeNull();
    // Nichts darf sich veraendert haben: die Belohnung bleibt abholbar.
    expect(getStoredPendingCoopDefenseItemReward()?.offers[0].uid).toBe('offer-armor');
    expect(getStoredCoopDefenseItems()).toHaveLength(COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT);
  });

  it('claims into a full category by salvaging an existing item', () => {
    setStoredCoopDefenseTotalXp(0);
    for (let index = 0; index < COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT; index++) {
      addStoredCoopDefenseItem(item({ uid: `armor-${index}`, rarity: 'blue', affixes: [{ affixId: 'max_armor', value: 15 }] }));
    }
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'offer-armor' })] });

    const claim = claimStoredPendingCoopDefenseItemReward('offer-armor', 'armor-3');
    expect(claim?.acquired?.uid).toBe('offer-armor');
    expect(claim?.salvagedXp).toBeGreaterThan(0);
    expect(getStoredCoopDefenseProgress().totalXp).toBe(claim!.salvagedXp);

    const uids = getStoredCoopDefenseItems().map((entry) => entry.uid);
    expect(uids).toHaveLength(COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT);
    expect(uids).not.toContain('armor-3');
    expect(uids).toContain('offer-armor');
  });

  it('salvages the offer itself when it is the salvage target', () => {
    setStoredCoopDefenseTotalXp(0);
    setStoredPendingCoopDefenseItemReward({
      roundEndedAt: 7,
      offers: [item({ uid: 'offer-armor', rarity: 'blue', affixes: [{ affixId: 'max_armor', value: 15 }] })],
    });

    const claim = claimStoredPendingCoopDefenseItemReward('offer-armor', 'offer-armor');
    expect(claim?.acquired).toBeNull();
    expect(claim?.salvagedXp).toBeGreaterThan(0);
    expect(getStoredCoopDefenseItems()).toEqual([]);
    expect(getStoredPendingCoopDefenseItemReward()).toBeNull();
  });

  it('marks a claimed item as unseen until the item screen was opened', () => {
    expect(getStoredCoopDefenseProgress().unseenItems).toBe(false);
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'offer-armor' })] });
    expect(getStoredCoopDefenseProgress().unseenItems).toBe(false);

    claimStoredPendingCoopDefenseItemReward('offer-armor');
    expect(getStoredCoopDefenseProgress().unseenItems).toBe(true);

    expect(markStoredCoopDefenseItemsSeen()).toBe(true);
    expect(getStoredCoopDefenseProgress().unseenItems).toBe(false);
    // Zweiter Aufruf aendert nichts mehr und meldet das auch so.
    expect(markStoredCoopDefenseItemsSeen()).toBe(false);
  });

  it('does not mark anything unseen when the offer is discarded for xp', () => {
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'offer-armor' })] });
    claimStoredPendingCoopDefenseItemReward('offer-armor', 'offer-armor');

    expect(getStoredCoopDefenseItems()).toEqual([]);
    expect(getStoredCoopDefenseProgress().unseenItems).toBe(false);
  });

  it('never reports unseen items without any item in the inventory', () => {
    writeRawProgress({ itemsUnlocked: true, unseenItems: true, items: [] });
    expect(getStoredCoopDefenseProgress().unseenItems).toBe(false);
  });

  it('rejects an unknown offer and a salvage target from another category', () => {
    addStoredCoopDefenseItem(item({ uid: 'boots-1', slot: 'boots', baseValue: 0.05 }));
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'offer-armor' })] });

    expect(claimStoredPendingCoopDefenseItemReward('does-not-exist')).toBeNull();
    expect(claimStoredPendingCoopDefenseItemReward('offer-armor', 'boots-1')).toBeNull();
    expect(getStoredPendingCoopDefenseItemReward()).not.toBeNull();
  });

  it('keeps an already open reward of the same round untouched', () => {
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'first' })] });
    expect(setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'second' })] })).toBe(false);
    expect(getStoredPendingCoopDefenseItemReward()?.offers[0].uid).toBe('first');

    expect(setStoredPendingCoopDefenseItemReward({ roundEndedAt: 8, offers: [item({ uid: 'third' })] })).toBe(true);
    expect(getStoredPendingCoopDefenseItemReward()?.offers[0].uid).toBe('third');
  });

  it('sanitises broken stored item data instead of failing', () => {
    writeRawProgress({
      itemsUnlocked: 'yes',
      items: [
        item({ uid: 'ok' }),
        { uid: 'bad-slot', slot: 'cape', rarity: 'white', itemLevel: 1, baseValue: 5, affixes: [] },
        null,
        item({ uid: 'ok' }),
      ],
      equippedItemIds: { armor: 'ok', boots: 'ok', helmet: 'gone' },
      pendingItemReward: { roundEndedAt: 5, offers: [{ uid: '' }] },
    });

    const progress = getStoredCoopDefenseProgress();
    expect(progress.itemsUnlocked).toBe(false);
    expect(progress.items.map((entry) => entry.uid)).toEqual(['ok']);
    // boots verweist auf ein Ruestungsteil, helmet auf nichts: beide Zuweisungen fallen weg.
    expect(progress.equippedItemIds).toEqual({ armor: 'ok' });
    expect(progress.pendingItemReward).toBeNull();
  });

  it('keeps the equipped item when the stored category list is over the limit', () => {
    writeRawProgress({
      items: [
        item({ uid: 'equipped' }),
        ...Array.from({ length: 20 }, (_, index) => item({ uid: `s${index}` })),
      ],
      equippedItemIds: { armor: 'equipped' },
    });

    const progress = getStoredCoopDefenseProgress();
    expect(progress.items).toHaveLength(COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT + 1);
    expect(progress.equippedItemIds).toEqual({ armor: 'equipped' });
  });

  it('wipes items when the character is reset', () => {
    setStoredCoopDefenseItemsUnlocked(true);
    addStoredCoopDefenseItem(item({ uid: 'armor-1' }));
    equipStoredCoopDefenseItem('armor-1');
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'offer' })] });

    resetStoredCoopDefenseCharacter();

    const progress = getStoredCoopDefenseProgress();
    expect(progress.itemsUnlocked).toBe(false);
    expect(progress.items).toEqual([]);
    expect(progress.equippedItemIds).toEqual({});
    expect(progress.pendingItemReward).toBeNull();
    expect(progress.unseenItems).toBe(false);
  });

  it('does not hand out the internal arrays to callers', () => {
    addStoredCoopDefenseItem(item({ uid: 'armor-1' }));
    const progress = getStoredCoopDefenseProgress();
    progress.items.push(item({ uid: 'injected' }));
    progress.equippedItemIds.armor = 'injected';

    expect(getStoredCoopDefenseItems().map((entry) => entry.uid)).toEqual(['armor-1']);
    expect(getStoredCoopDefenseEquippedItemIds()).toEqual({});
  });
});
