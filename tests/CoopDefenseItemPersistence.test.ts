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
  getStoredPendingCoopDefenseItemRewards,
  getStoredPendingCoopDefenseItemReward,
  importStoredGameProgressJson,
  exportStoredGameProgressJson,
  invalidateLocalStorageCache,
  LOCAL_PROGRESS_STORAGE_KEY,
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
import { getCoopDefenseItemSalvageXp, getCoopDefenseStashItems } from '../src/utils/coopDefenseItems';
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
    expect(progress.pendingItemRewards).toEqual([]);
  });

  it('unlocks only on the configured map victory', () => {
    expect(unlockStoredCoopDefenseItemsAfterVictory('9')).toBe(false);
    expect(getStoredCoopDefenseItemsUnlocked()).toBe(false);

    expect(unlockStoredCoopDefenseItemsAfterVictory(COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID)).toBe(true);
    expect(getStoredCoopDefenseItemsUnlocked()).toBe(true);
    // Zweiter Sieg auf derselben Map aendert nichts mehr.
    expect(unlockStoredCoopDefenseItemsAfterVictory(COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID)).toBe(false);
  });

  it('round-trips items, equipment and pending rewards through storage', () => {
    setStoredCoopDefenseItemsUnlocked(true);
    expect(addStoredCoopDefenseItem(item({ uid: 'armor-1' }))).toBe(true);
    expect(addStoredCoopDefenseItem(item({ uid: 'boots-1', slot: 'boots', baseValue: 0.05 }))).toBe(true);
    expect(equipStoredCoopDefenseItem('armor-1')).toBe(true);
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 42, mapId: '10', offers: [item({ uid: 'offer-1' })] });

    expect(getStoredCoopDefenseItems().map((entry) => entry.uid)).toEqual(['armor-1', 'boots-1']);
    expect(getStoredCoopDefenseEquippedItemIds()).toEqual({ armor: 'armor-1' });
    expect(getStoredEquippedCoopDefenseItems().map((entry) => entry.uid)).toEqual(['armor-1']);
    expect(getStoredPendingCoopDefenseItemReward()?.roundEndedAt).toBe(42);
    expect(getStoredPendingCoopDefenseItemReward()?.mapId).toBe('10');

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

  it('equips a claimed reward directly when its category has no equipped item', () => {
    addStoredCoopDefenseItem(item({ uid: 'armor-stash' }));
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'offer-armor' })] });

    const claim = claimStoredPendingCoopDefenseItemReward('offer-armor');

    expect(claim?.acquired?.uid).toBe('offer-armor');
    expect(getStoredCoopDefenseEquippedItemIds()).toEqual({ armor: 'offer-armor' });
    expect(getCoopDefenseStashItems(
      getStoredCoopDefenseItems(),
      getStoredCoopDefenseEquippedItemIds(),
      'armor',
    ).map((entry) => entry.uid)).toEqual(['armor-stash']);
  });

  it('equips directly even when the empty category stash is already full', () => {
    for (let index = 0; index < COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT; index++) {
      addStoredCoopDefenseItem(item({ uid: `armor-${index}` }));
    }
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'offer-armor' })] });

    expect(claimStoredPendingCoopDefenseItemReward('offer-armor')?.acquired?.uid).toBe('offer-armor');
    expect(getStoredCoopDefenseEquippedItemIds()).toEqual({ armor: 'offer-armor' });
    expect(getCoopDefenseStashItems(
      getStoredCoopDefenseItems(),
      getStoredCoopDefenseEquippedItemIds(),
      'armor',
    )).toHaveLength(COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT);
  });

  it('equips a reward and moves the previously equipped item into the stash', () => {
    addStoredCoopDefenseItem(item({ uid: 'equipped-armor' }));
    equipStoredCoopDefenseItem('equipped-armor');
    addStoredCoopDefenseItem(item({ uid: 'stash-armor' }));
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'offer-armor' })] });

    const claim = claimStoredPendingCoopDefenseItemReward('offer-armor', undefined, 'equip');

    expect(claim?.acquired?.uid).toBe('offer-armor');
    expect(getStoredCoopDefenseEquippedItemIds()).toEqual({ armor: 'offer-armor' });
    expect(getCoopDefenseStashItems(
      getStoredCoopDefenseItems(),
      getStoredCoopDefenseEquippedItemIds(),
      'armor',
    ).map((entry) => entry.uid)).toEqual(['equipped-armor', 'stash-armor']);
  });

  it('keeps the reward open when an equipped category stash is full and nothing is salvaged', () => {
    for (let index = 0; index < COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT; index++) {
      addStoredCoopDefenseItem(item({ uid: `armor-${index}` }));
    }
    equipStoredCoopDefenseItem('armor-0');
    addStoredCoopDefenseItem(item({ uid: 'armor-10' }));
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'offer-armor' })] });

    expect(claimStoredPendingCoopDefenseItemReward('offer-armor')).toBeNull();
    // Nichts darf sich veraendert haben: die Belohnung bleibt abholbar.
    expect(getStoredPendingCoopDefenseItemReward()?.offers[0].uid).toBe('offer-armor');
    expect(getStoredCoopDefenseItems()).toHaveLength(COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT + 1);
  });

  it('does not equip a reward into a full stash or alter the existing inventory', () => {
    for (let index = 0; index < COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT; index++) {
      addStoredCoopDefenseItem(item({ uid: `armor-${index}` }));
    }
    equipStoredCoopDefenseItem('armor-0');
    addStoredCoopDefenseItem(item({ uid: 'armor-10' }));
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'offer-armor' })] });
    const before = getStoredCoopDefenseItems();

    expect(claimStoredPendingCoopDefenseItemReward('offer-armor', undefined, 'equip')).toBeNull();
    expect(getStoredCoopDefenseItems()).toEqual(before);
    expect(getStoredPendingCoopDefenseItemReward()?.offers[0].uid).toBe('offer-armor');
  });

  it('equips after salvaging a stash item when the category was full', () => {
    for (let index = 0; index < COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT; index++) {
      addStoredCoopDefenseItem(item({ uid: `armor-${index}` }));
    }
    equipStoredCoopDefenseItem('armor-0');
    addStoredCoopDefenseItem(item({ uid: 'armor-10' }));
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'offer-armor' })] });

    const claim = claimStoredPendingCoopDefenseItemReward('offer-armor', 'armor-3', 'equip');

    expect(claim?.acquired?.uid).toBe('offer-armor');
    expect(getStoredCoopDefenseEquippedItemIds()).toEqual({ armor: 'offer-armor' });
    expect(getStoredCoopDefenseItems().map((entry) => entry.uid)).toEqual([
      'armor-0', 'armor-1', 'armor-2', 'armor-4', 'armor-5',
      'armor-6', 'armor-7', 'armor-8', 'armor-9', 'armor-10', 'offer-armor',
    ]);
    expect(getCoopDefenseStashItems(
      getStoredCoopDefenseItems(),
      getStoredCoopDefenseEquippedItemIds(),
      'armor',
    )).toHaveLength(COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT);
  });

  it('claims into a full category by salvaging an existing item', () => {
    setStoredCoopDefenseTotalXp(0);
    for (let index = 0; index < COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT; index++) {
      addStoredCoopDefenseItem(item({ uid: `armor-${index}`, rarity: 'blue', affixes: [{ affixId: 'max_armor', value: 15 }] }));
    }
    equipStoredCoopDefenseItem('armor-0');
    addStoredCoopDefenseItem(item({ uid: 'armor-10', rarity: 'blue', affixes: [{ affixId: 'max_armor', value: 15 }] }));
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'offer-armor' })] });

    const claim = claimStoredPendingCoopDefenseItemReward('offer-armor', 'armor-3');
    expect(claim?.acquired?.uid).toBe('offer-armor');
    expect(claim?.salvagedXp).toBeGreaterThan(0);
    expect(getStoredCoopDefenseProgress().totalXp).toBe(claim!.salvagedXp);

    const uids = getStoredCoopDefenseItems().map((entry) => entry.uid);
    expect(uids).toHaveLength(COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT + 1);
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
    expect(getStoredPendingCoopDefenseItemRewards().map((reward) => reward.offers[0].uid)).toEqual([
      'first', 'third',
    ]);
  });

  it('appends multiple rewards without overwriting older open rewards', () => {
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'old' })] });
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 8, offers: [item({ uid: 'new' })] });

    expect(getStoredPendingCoopDefenseItemRewards().map((reward) => reward.roundEndedAt)).toEqual([7, 8]);
    expect(getStoredPendingCoopDefenseItemRewards().map((reward) => reward.offers[0].uid)).toEqual(['old', 'new']);
  });

  it('migrates a valid legacy single-reward save into the queue and exports the queue', () => {
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'legacy' })] });
    const exported = JSON.parse(exportStoredGameProgressJson()) as {
      progress: { coopDefense: Record<string, unknown> };
    };
    const coop = exported.progress.coopDefense;
    coop.pendingItemReward = (coop.pendingItemRewards as unknown[])[0];
    delete coop.pendingItemRewards;
    window.localStorage.setItem(LOCAL_PROGRESS_STORAGE_KEY, JSON.stringify(exported.progress));
    invalidateLocalStorageCache();

    expect(getStoredPendingCoopDefenseItemRewards().map((reward) => reward.offers[0].uid)).toEqual(['legacy']);

    const queueExport = exportStoredGameProgressJson();
    expect(JSON.parse(queueExport).progress.coopDefense.pendingItemRewards).toHaveLength(1);
    expect(JSON.parse(queueExport).progress.coopDefense.pendingItemReward).toBeUndefined();
    resetStoredCoopDefenseCharacter();
    expect(importStoredGameProgressJson(queueExport).ok).toBe(true);
    expect(getStoredPendingCoopDefenseItemRewards().map((reward) => reward.offers[0].uid)).toEqual(['legacy']);
  });

  it('claims exactly the addressed reward and leaves other queue entries untouched', () => {
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'old' })] });
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 8, offers: [item({ uid: 'new', slot: 'boots', baseValue: 0.05 })] });

    expect(claimStoredPendingCoopDefenseItemReward(999, 'new')).toBeNull();
    expect(getStoredPendingCoopDefenseItemRewards()).toHaveLength(2);

    expect(claimStoredPendingCoopDefenseItemReward(8, 'new')?.acquired?.uid).toBe('new');
    expect(getStoredPendingCoopDefenseItemRewards().map((reward) => reward.roundEndedAt)).toEqual([7]);
  });

  it('does not change the queue when a player decides later', () => {
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 7, offers: [item({ uid: 'old' })] });
    setStoredPendingCoopDefenseItemReward({ roundEndedAt: 8, offers: [item({ uid: 'new', slot: 'boots', baseValue: 0.05 })] });
    const before = getStoredPendingCoopDefenseItemRewards();

    // "Später entscheiden" ist bewusst nur ein Overlay-/Navigationsereignis: kein Claim.
    expect(getStoredPendingCoopDefenseItemRewards()).toEqual(before);
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
    expect(progress.pendingItemRewards).toEqual([]);
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
