import { describe, expect, it } from 'vitest';
import { COLORS } from '../src/config';
import {
  COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT,
  getCoopDefenseItemRarityDefinition,
} from '../src/config/coopDefenseItems';
import {
  buildCoopDefenseInventoryGrid,
  buildCoopDefenseItemTooltip,
  listEquippedCoopDefenseSpecialEffects,
  resolveCoopDefenseItemDrop,
  summariseEquippedCoopDefenseItems,
} from '../src/ui/CoopDefenseItemsModel';
import type { CoopDefenseItem } from '../src/types';
import { compareCoopDefenseItems } from '../src/utils/coopDefenseItems';

function item(overrides: Partial<CoopDefenseItem> = {}): CoopDefenseItem {
  return {
    uid: 'it_test',
    slot: 'armor',
    rarity: 'white',
    itemLevel: 1,
    baseValue: 25,
    affixes: [],
    ...overrides,
  };
}

function tooltipTexts(content: { lines: readonly { text: string }[] }): string[] {
  return content.lines.map((line) => line.text);
}

describe('coop-defense inventory grid', () => {
  it('gives every category a full 2x5 grid and leaves free places empty', () => {
    const columns = buildCoopDefenseInventoryGrid([item({ uid: 'a' })], {}, 'rarity');

    expect(columns.map((column) => column.slot)).toEqual(['helmet', 'gloves', 'armor', 'boots']);
    for (const column of columns) {
      expect(column.cells).toHaveLength(COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT);
      expect(column.capacity).toBe(COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT);
    }
    const armor = columns.find((column) => column.slot === 'armor')!;
    expect(armor.used).toBe(1);
    expect(armor.cells[0]?.uid).toBe('a');
    expect(armor.cells[1]).toBeNull();
  });

  it('keeps the equipped part out of the grid and reports it separately', () => {
    const columns = buildCoopDefenseInventoryGrid(
      [item({ uid: 'worn' }), item({ uid: 'spare' })],
      { armor: 'worn' },
      'rarity',
    );

    const armor = columns.find((column) => column.slot === 'armor')!;
    expect(armor.equipped?.uid).toBe('worn');
    expect(armor.used).toBe(1);
    expect(armor.cells.filter((cell) => cell !== null).map((cell) => cell!.uid)).toEqual(['spare']);
  });

  it('orders the cells by the requested sort mode', () => {
    const items = [
      item({ uid: 'low_rare', rarity: 'yellow', itemLevel: 1 }),
      item({ uid: 'high_common', rarity: 'white', itemLevel: 5 }),
    ];

    const byRarity = buildCoopDefenseInventoryGrid(items, {}, 'rarity')
      .find((column) => column.slot === 'armor')!;
    expect(byRarity.cells[0]?.uid).toBe('low_rare');

    const byLevel = buildCoopDefenseInventoryGrid(items, {}, 'itemLevel')
      .find((column) => column.slot === 'armor')!;
    expect(byLevel.cells[0]?.uid).toBe('high_common');
  });
});

describe('coop-defense item tooltip', () => {
  it('lists the exact values plus the comparison with the equipped part', () => {
    const content = buildCoopDefenseItemTooltip(
      item({ uid: 'new', rarity: 'blue', baseValue: 30, affixes: [{ affixId: 'max_armor', value: 20 }] }),
      item({ uid: 'old', baseValue: 22 }),
      false,
    );
    const texts = tooltipTexts(content);

    expect(content.title).toBe('Rüstung · Stufe 1');
    expect(texts).toContain('+30 Maximale HP');
    expect(texts).toContain('+20 Rüstungsmaximum');
    expect(texts).toContain('GEGENÜBER AUSGERÜSTET');
    expect(texts).toContain('+8 Maximale HP');

    const gain = content.lines.find((line) => line.text === '+8 Maximale HP')!;
    expect(gain.color).toBe(COLORS.GREEN_2);
  });

  it('marks a worse value in red', () => {
    const content = buildCoopDefenseItemTooltip(
      item({ uid: 'new', baseValue: 18 }),
      item({ uid: 'old', baseValue: 25 }),
      false,
    );
    const loss = content.lines.find((line) => line.text === '-7 Maximale HP')!;
    expect(loss.color).toBe(COLORS.RED_2);
  });

  it('reads a lower cost as an improvement, not as a loss', () => {
    const helmet = (cost: number, uid: string): CoopDefenseItem => item({
      uid, slot: 'helmet', rarity: 'blue', baseValue: 0.06,
      affixes: [{ affixId: 'adrenaline_cost', value: cost }],
    });

    const cheaper = buildCoopDefenseItemTooltip(helmet(-0.08, 'new'), helmet(-0.03, 'old'), false);
    const gain = cheaper.lines.find((line) => line.text === '-5 % Adrenalinverbrauch')!;
    expect(gain.color).toBe(COLORS.GREEN_2);

    const costlier = buildCoopDefenseItemTooltip(helmet(-0.03, 'new'), helmet(-0.08, 'old'), false);
    const loss = costlier.lines.find((line) => line.text === '+5 % Adrenalinverbrauch')!;
    expect(loss.color).toBe(COLORS.RED_2);
  });

  it('drops the comparison for the part that is already worn', () => {
    const worn = item({ uid: 'worn', baseValue: 25 });
    const texts = tooltipTexts(buildCoopDefenseItemTooltip(worn, worn, true));

    expect(texts).not.toContain('GEGENÜBER AUSGERÜSTET');
    expect(texts).toContain('+25 Maximale HP');
    expect(texts.some((text) => text.includes('Ablegen'))).toBe(true);
  });

  it('reuses reward comparison rows from the new item perspective without inventory hints', () => {
    const equipped = item({ uid: 'old', rarity: 'blue', baseValue: 22 });
    const newItem = item({ uid: 'new', baseValue: 30 });
    const content = buildCoopDefenseItemTooltip(equipped, null, true, {
      comparison: {
        title: 'WECHSEL ZU NEUEM ITEM',
        rows: compareCoopDefenseItems(newItem, equipped),
        identicalText: 'identisch zum neuen Item',
      },
      showInventoryHints: false,
    });
    const texts = tooltipTexts(content);

    expect(texts).toContain('+22 Maximale HP');
    expect(texts).toContain('WECHSEL ZU NEUEM ITEM');
    expect(texts).toContain('+8 Maximale HP');
    expect(texts.some((text) => /Klick|Ziehen|Zerlegen/.test(text))).toBe(false);
    expect(content.lines.find((line) => line.text === '+8 Maximale HP')?.color).toBe(COLORS.GREEN_2);
  });

  it('uses the German rarity label in the item presentation', () => {
    expect(getCoopDefenseItemRarityDefinition('white').label).toBe('Gewöhnlich');
  });

  it('always states the salvage reward', () => {
    const texts = tooltipTexts(buildCoopDefenseItemTooltip(item({ rarity: 'yellow' }), null, false));
    expect(texts.some((text) => /^Zerlegen bringt \+\d+ XP$/.test(text))).toBe(true);
  });

  it('shows a statless surrounded affix in the tooltip and equipment special effects', () => {
    const surrounded = item({
      uid: 'surrounded-rare',
      rarity: 'blue',
      baseValue: 30,
      affixes: [{ affixId: 'surrounded', value: 0.12 }],
    });

    const texts = tooltipTexts(buildCoopDefenseItemTooltip(surrounded, null, false));
    expect(texts).toContain('+30 Maximale HP');
    expect(texts).toContain('Umzingelt');
    expect(texts).toContain('Bei mindestens 5 Gegnern in 160 Reichweite: +12 % Adrenalinregeneration');

    expect(listEquippedCoopDefenseSpecialEffects([surrounded])).toEqual([{
      label: 'Umzingelt',
      text: '+12 % Umzingelt',
    }]);
  });
});

describe('coop-defense equipment summary', () => {
  it('adds up the same stat across several worn parts', () => {
    // Der Ruestungs-Basiswert und das Stiefel-Affix zahlen auf `player.maxHp` ein, tragen aber
    // unterschiedliche Beschriftungen – zusammengefasst gilt die zuerst gesehene.
    const lines = summariseEquippedCoopDefenseItems([
      item({ slot: 'armor', baseValue: 25 }),
      item({ slot: 'boots', baseValue: 0.05, affixes: [{ affixId: 'max_hp', value: 20 }] }),
    ]);

    expect(lines.find((line) => line.label === 'Maximale HP')?.text).toBe('+45');
    expect(lines.find((line) => line.label === 'Bewegungsgeschwindigkeit')?.text).toBe('+5 %');
  });

  it('returns nothing without equipment', () => {
    expect(summariseEquippedCoopDefenseItems([])).toEqual([]);
  });
});

describe('coop-defense item drag targets', () => {
  const stashPart = { item: item({ slot: 'armor' }), equipped: false };
  const wornPart = { item: item({ slot: 'armor' }), equipped: true };

  it('equips onto the matching equipment place', () => {
    expect(resolveCoopDefenseItemDrop(stashPart, { slot: 'armor', kind: 'equipment' })).toBe('equip');
  });

  it('takes a worn part off when dropped on its own inventory column', () => {
    expect(resolveCoopDefenseItemDrop(wornPart, { slot: 'armor', kind: 'stash' })).toBe('unequip');
  });

  it('refuses a foreign category and pointless drops', () => {
    expect(resolveCoopDefenseItemDrop(stashPart, { slot: 'boots', kind: 'equipment' })).toBeNull();
    expect(resolveCoopDefenseItemDrop(wornPart, { slot: 'helmet', kind: 'stash' })).toBeNull();
    expect(resolveCoopDefenseItemDrop(stashPart, { slot: 'armor', kind: 'stash' })).toBeNull();
    expect(resolveCoopDefenseItemDrop(wornPart, { slot: 'armor', kind: 'equipment' })).toBeNull();
  });
});
