import { describe, expect, it } from 'vitest';
import { DAWN_MERCHANT } from '../src/config/dawn/merchant';
import { COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT } from '../src/config/coopDefenseItems';
import { createDefaultDawnProgress, DAWN_MAX_SCRAP } from '../src/dawn/economy/DawnProgress';
import { ensureDawnShopOffer, purchaseDawnShopItem, recalibrateDawnItem, type DawnEquipmentProgressDraft } from '../src/dawn/economy/DawnMerchantEquipment';
import { purchaseDawnInfrastructure } from '../src/dawn/economy/DawnMerchantInfrastructure';
import { purchaseDawnBossPoint, purchaseDawnBranch } from '../src/dawn/economy/DawnMerchantUpgrades';
import { buildDawnEquipmentModel, buildDawnInfrastructureModel, buildDawnMerchantItemModel, buildDawnUpgradesModel } from '../src/ui/DawnMerchantModel';
import { describeCoopDefenseItem, rollCoopDefenseItem } from '../src/utils/coopDefenseItems';
import { translate } from '../src/i18n/catalog';
import { DAWN_UI_TEXTURES } from '../src/assets/DawnUiAssets';

function equipment(): DawnEquipmentProgressDraft {
  const dawn = { ...createDefaultDawnProgress(), scrap: DAWN_MAX_SCRAP };
  ensureDawnShopOffer(dawn, true, () => .8);
  return { dawn, items: [], equippedItemIds: {}, unseenItems: false };
}

describe('merchant tab projections', () => {
  it('distinguishes infrastructure with its own drone and magnet artwork', () => {
    expect(buildDawnInfrastructureModel(equipment().dawn, true)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'repair-drones', icon: DAWN_UI_TEXTURES.dealerInfrastructure }),
      expect.objectContaining({ id: 'scrap-magnet', icon: DAWN_UI_TEXTURES.scrapMagnet }),
    ]));
  });
  it('projects each infrastructure purchase through its maximum, without mutating the save', () => {
    const progress = equipment().dawn;
    for (const entry of DAWN_MERCHANT.infrastructure) {
      for (let level = 0; level <= entry.levelPrices.length; level++) {
        const before = structuredClone(progress);
        const row = buildDawnInfrastructureModel(progress, true).find(row => row.id === entry.id)!;
        expect(progress).toEqual(before);
        expect(row).toMatchObject({ level, maxLevel: entry.levelPrices.length,
          cost: entry.levelPrices[level] ?? null, canBuy: level < entry.levelPrices.length });
        expect(buildDawnInfrastructureModel(progress, false).every(row => !row.canBuy)).toBe(true);
        for (const locale of ['de', 'en'] as const) expect(translate(locale, row.effectKey)).not.toContain('⟦');
        purchaseDawnInfrastructure(progress, entry.id, true);
      }
    }
    progress.infrastructure = {};
    progress.scrap = 0;
    expect(buildDawnInfrastructureModel(progress, true).every(row => !row.canBuy)).toBe(true);
  });

  it('reflects researched branches and the authored boss point limit', () => {
    const progress = equipment().dawn;
    const locked = buildDawnUpgradesModel(progress, false);
    expect(locked.branches.every(row => !row.canBuy)).toBe(true);
    expect(locked.bossPoints.canBuy).toBe(false);
    for (const branch of DAWN_MERCHANT.upgrades.branches) purchaseDawnBranch(progress, branch.branchId, true);
    expect(buildDawnUpgradesModel(progress, true).branches.every(row => row.researched && !row.canBuy)).toBe(true);
    for (let count = 0; count < DAWN_MERCHANT.upgrades.bossPointPrices.length; count++) {
      expect(buildDawnUpgradesModel(progress, true).bossPoints).toMatchObject({ purchased: count,
        cost: DAWN_MERCHANT.upgrades.bossPointPrices[count], canBuy: true });
      purchaseDawnBossPoint(progress, true);
    }
    expect(buildDawnUpgradesModel(progress, true).bossPoints).toMatchObject({ cost: null, canBuy: false,
      purchased: DAWN_MERCHANT.upgrades.bossPointPrices.length });
  });

  it('retains sold offers, rejects stale offers and reports slot-specific stash limits', () => {
    const progress = equipment();
    const first = progress.dawn.shopOffer!.items[0];
    progress.items = Array.from({ length: COOP_DEFENSE_ITEM_STASH_LIMIT_PER_SLOT }, (_, index) => ({ ...first.item, uid: `owned-${index}` }));
    expect(buildDawnEquipmentModel(progress, true).offers[0]).toMatchObject({ stashFull: true, canBuy: false });
    progress.equippedItemIds[first.item.slot] = progress.items[0].uid;
    expect(buildDawnEquipmentModel(progress, true).offers[0]).toMatchObject({ stashFull: false, canBuy: true });
    expect(purchaseDawnShopItem(progress, 0, true)).toBe(true);
    expect(buildDawnEquipmentModel(progress, true).offers[0]).toMatchObject({ sold: true, canBuy: false });
    progress.dawn.stats.roundsPlayed++;
    expect(buildDawnEquipmentModel(progress, true).offers).toEqual([]);
  });

  it('gates equipment by unlock, funds and cores and includes both equipped and stored targets', () => {
    const progress = equipment();
    progress.items = [{ ...rollCoopDefenseItem('armor', 3, null, () => .2), rarity: 'yellow' }, rollCoopDefenseItem('armor', 3, null, () => .7)];
    progress.equippedItemIds.armor = progress.items[0].uid;
    progress.dawn.crafting.recalibrationCores = 1;
    const before = structuredClone(progress);
    const model = buildDawnEquipmentModel(progress, true);
    expect(progress).toEqual(before);
    expect(model.owned.map(entry => entry.equipped)).toEqual([true, false]);
    expect(model.owned.every(entry => entry.canRecalibrate)).toBe(true);
    expect(model.canUseCore).toBe(true);
    const locked = buildDawnEquipmentModel(progress, false);
    expect(locked.offers.every(row => !row.canBuy)).toBe(true);
    expect(locked.canBuyCore || locked.canUseCore || locked.owned.some(row => row.canRecalibrate)).toBe(false);
    progress.dawn.scrap = 0;
    expect(buildDawnEquipmentModel(progress, true).canBuyCore).toBe(false);
    expect(buildDawnEquipmentModel(progress, true).offers.every(row => !row.canBuy)).toBe(true);
    recalibrateDawnItem(progress, progress.items[0].uid, true, () => .9);
    const updated = buildDawnEquipmentModel(progress, true);
    expect(updated.canUseCore).toBe(false);
    expect(updated.owned[0].equipped).toBe(true);
    expect(updated.owned[0].item.affixes).not.toEqual(before.items[0].affixes);
    expect(buildDawnMerchantItemModel(updated.owned[0].item, 'de').lines)
      .not.toEqual(buildDawnMerchantItemModel(before.items[0], 'de').lines);
  });

  it.each(['de', 'en'] as const)('reuses every stat and special-affix description in %s', locale => {
    const item = rollCoopDefenseItem('armor', 5, null, () => .8);
    const description = describeCoopDefenseItem(item, locale);
    const model = buildDawnMerchantItemModel(item, locale);
    expect(model.rarityColor).toBe(description.rarityColor);
    expect(model.lines).toHaveLength(description.lines.length + description.affixLines.length);
    for (const line of description.affixLines) expect(model.lines.join('\n')).toContain(line.text);
    for (const line of description.lines) expect(model.lines.join('\n')).toContain(line.label);
    expect(model.lines.join('\n')).not.toContain('⟦');
  });
});
