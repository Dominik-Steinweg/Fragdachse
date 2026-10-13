import * as Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH, toCssColor } from '../config';
import { DAWN_UI_TEXTURES } from '../assets/DawnUiAssets';
import { DAWN_MERCHANT_CATEGORIES, type DawnMerchantCategory } from '../config/dawn/merchant';
import { getLocale, t } from '../i18n';
import { purchaseDawnExpansion } from '../dawn/economy/DawnEconomy';
import { purchaseDawnInfrastructure } from '../dawn/economy/DawnMerchantInfrastructure';
import { purchaseDawnBossPoint, purchaseDawnBranch } from '../dawn/economy/DawnMerchantUpgrades';
import { ensureDawnShopOffer, getDawnShopOffer, purchaseDawnRecalibrationCore, purchaseDawnShopItem, recalibrateDawnItem,
  type DawnEquipmentProgressDraft } from '../dawn/economy/DawnMerchantEquipment';
import type { DawnProgress } from '../dawn/economy/DawnProgress';
import { isDawnUnlocked } from '../dawn/rules/DawnUnlock';
import { getStoredCoopDefenseProgress, updateStoredDawnProgress, updateStoredDawnEquipmentProgress } from '../utils/localPreferences';
import type { CoopDefenseItem } from '../types';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { ensureModalPanelTexture, ensureTintedSectionTexture, mountForestModal, textStyle } from './ForestModal';
import { resolveCoopDefenseItemIconTexture } from './coopDefenseItemIcons';
import { UiButton } from './UiButton';
import { buildDawnMerchantModel, buildDawnInfrastructureModel, buildDawnUpgradesModel,
  buildDawnEquipmentModel, buildDawnMerchantItemModel } from './DawnMerchantModel';

const CATEGORY_ICONS = {
  expansion: DAWN_UI_TEXTURES.dealerExpansion, infrastructure: DAWN_UI_TEXTURES.dealerInfrastructure,
  upgrades: DAWN_UI_TEXTURES.dealerUpgrades, equipment: DAWN_UI_TEXTURES.dealerEquipment,
};
const WIDTH = 1420, HEIGHT = 960, LEFT = (GAME_WIDTH - WIDTH) / 2 + 70;
const CONTENT_WIDTH = WIDTH - 140;

/** Personal lobby menu. The existing World re-instance observes the saved expansion. */
export class DawnMerchantOverlay {
  private root: Phaser.GameObjects.Container | null = null;
  private content: Phaser.GameObjects.Container | null = null;
  private balance: Phaser.GameObjects.Text | null = null;
  private notice: Phaser.GameObjects.Text | null = null;
  private buttons: UiButton[] = [];
  private contentButtons: UiButton[] = [];
  private tabs = new Map<DawnMerchantCategory, UiButton>();
  private category: DawnMerchantCategory = 'expansion';
  private selecting = false;
  private selectedUid: string | null = null;
  private confirming = false;
  private message = '';
  private readonly onEscape = () => this.hide();

  constructor(private readonly scene: Phaser.Scene, private readonly canInteract: () => boolean) {}

  show(): void {
    if (!this.canInteract()) return;
    const unlocked = isDawnUnlocked(getStoredCoopDefenseProgress());
    // Persist the first roll and each round refresh before presenting any offer.
    updateStoredDawnEquipmentProgress(draft => ensureDawnShopOffer(draft.dawn, unlocked));
    this.message = unlocked && !getDawnShopOffer(getStoredCoopDefenseProgress().dawn) ? t('ui.dawn.saveFailed') : '';
    this.selecting = false;
    this.confirming = false;
    if (!this.root) this.build();
    this.refresh();
    this.root!.setVisible(true);
    this.scene.input.keyboard?.off('keydown-ESC', this.onEscape);
    this.scene.input.keyboard?.on('keydown-ESC', this.onEscape);
  }

  hide(): void {
    this.root?.setVisible(false);
    this.confirming = false;
    this.scene.input.keyboard?.off('keydown-ESC', this.onEscape);
  }

  destroy(): void {
    this.hide();
    this.clearContent();
    for (const button of this.buttons) button.destroy();
    this.buttons = [];
    this.tabs.clear();
    this.root?.destroy(true);
    this.root = null;
    this.content = null;
  }

  private build(): void {
    const x = GAME_WIDTH / 2, y = GAME_HEIGHT / 2;
    const dim = this.scene.add.rectangle(x, y, GAME_WIDTH, GAME_HEIGHT, 0x080c0a, 0.65)
      .setScrollFactor(0).setInteractive();
    const panel = this.scene.add.image(x, y, ensureModalPanelTexture(this.scene, '_dawn_merchant', WIDTH, HEIGHT));
    this.root = this.scene.add.container(0, 0, [dim, panel]).setScrollFactor(0).setDepth(DEPTH.OVERLAY + 3);
    this.icon(this.root, LEFT + 128, 160, DAWN_UI_TEXTURES.dealerPortrait, 128);
    this.label(this.root, LEFT + 218, 126, t('ui.dawn.merchant'), 660, 34);
    this.icon(this.root, LEFT + 234, 203, DAWN_UI_TEXTURES.scrap, 32);
    this.balance = this.label(this.root, LEFT + 264, 190, '', 660, 23);
    this.notice = this.label(this.root, LEFT + 54, 917, '', CONTENT_WIDTH - 394, 17);
    this.content = this.scene.add.container(0, 0);
    this.root.add(this.content);
    for (const [index, category] of DAWN_MERCHANT_CATEGORIES.entries()) {
      const cx = LEFT + CONTENT_WIDTH * (index + 0.5) / 4;
      this.icon(this.root, cx, 266, CATEGORY_ICONS[category], 64);
      const button = this.button(this.root, cx, 323, 296, t(`ui.dawn.tab.${category}`), true, () => {
        this.category = category; this.selecting = false; this.confirming = false; this.message = ''; this.refresh();
      }, false);
      this.tabs.set(category, button);
    }
    this.button(this.root, LEFT + CONTENT_WIDTH - 180, 943, 220, t('ui.common.close'), true, () => this.hide(), false);
    mountForestModal(this.scene, this.root, WIDTH, HEIGHT);
    promoteToClarityCamera(this.scene, this.root);
  }

  private refresh(): void {
    this.clearContent();
    const stored = getStoredCoopDefenseProgress(), unlocked = isDawnUnlocked(stored);
    this.balance?.setText(t('ui.dawn.scrapCount', { scrap: stored.dawn.scrap }));
    this.notice?.setText(unlocked ? this.message : t('ui.dawn.locked'));
    for (const [category, button] of this.tabs) button.setIntent(category === this.category ? 'attention' : 'neutral');
    switch (this.category) {
      case 'expansion': {
        const model = buildDawnMerchantModel(stored.dawn, stored.persistentBaseAreaStage, unlocked);
        this.section(LEFT, 380, CONTENT_WIDTH, 402);
        this.label(this.content!, LEFT + 40, 413, t('ui.dawn.expansionStats', { expansionLevel: model.expansionLevel, radius: model.radius }), 920, 27);
        this.icon(this.content!, LEFT + 58, 563, DAWN_UI_TEXTURES.threat, 32);
        this.label(this.content!, LEFT + 86, 550, t(model.nextThreat === null ? 'ui.dawn.threat' : 'ui.dawn.threatConsequence',
          { threat: model.threat, nextThreat: model.nextThreat ?? model.threat }), 980, 23);
        this.label(this.content!, LEFT + 40, 625, this.price(model.cost), 900, 23);
        this.button(this.content!, LEFT + 220, 729, 360, t(model.cost === null ? 'ui.dawn.maximal' : 'ui.dawn.buyExpansion'),
          model.canBuy, () => this.purchaseDawn(purchaseDawnExpansion));
        break;
      }
      case 'infrastructure':
        buildDawnInfrastructureModel(stored.dawn, unlocked).forEach((entry, index) => {
          this.purchaseRow(index, t(`ui.dawn.infrastructure.${entry.id}.name`),
            `${t('ui.dawn.level', { level: entry.level, max: entry.maxLevel })}\n${t(entry.effectKey)}`,
            entry.cost, entry.canBuy, entry.cost === null ? t('ui.dawn.maximal') : t('ui.dawn.buy'),
            () => this.purchaseDawn((draft, allowed) => purchaseDawnInfrastructure(draft, entry.id, allowed)));
        });
        break;
      case 'upgrades': {
        const model = buildDawnUpgradesModel(stored.dawn, unlocked);
        model.branches.forEach((entry, index) => this.purchaseRow(index,
          t(`ui.dawn.branch.${entry.branchId}.name`), t(`ui.dawn.branch.${entry.branchId}.effect`), entry.price,
          entry.canBuy, t(entry.researched ? 'ui.dawn.researched' : 'ui.dawn.research'),
          () => this.purchaseDawn((draft, allowed) => purchaseDawnBranch(draft, entry.branchId, allowed))));
        const points = model.bossPoints;
        this.purchaseRow(model.branches.length, t('ui.dawn.bossPoints'),
          t('ui.dawn.bossPointCount', { count: points.purchased, max: points.limit }), points.cost, points.canBuy,
          t(points.cost === null ? 'ui.dawn.maximal' : 'ui.dawn.buy'), () => this.purchaseDawn(purchaseDawnBossPoint));
        break;
      }
      case 'equipment': this.equipment(stored, unlocked); break;
    }
  }

  private equipment(stored: DawnEquipmentProgressDraft, unlocked: boolean): void {
    const model = buildDawnEquipmentModel(stored, unlocked);
    if (this.selecting) {
      let index = model.owned.findIndex(entry => entry.item.uid === this.selectedUid);
      if (index < 0) index = 0;
      const entry = model.owned[index];
      if (entry) {
        this.selectedUid = entry.item.uid;
        this.itemCard(entry.item, LEFT + 310, 660);
        this.label(this.content!, LEFT + 334, 714, t(entry.equipped ? 'ui.dawn.equipped' : 'ui.dawn.stored'), 250, 18);
        this.button(this.content!, GAME_WIDTH / 2, 760, 360,
          t(this.confirming ? 'ui.dawn.confirmRecalibration' : 'ui.dawn.recalibrate'), entry.canRecalibrate, () => {
            if (!this.confirming) { this.confirming = true; this.message = t('ui.dawn.recalibrationWarning'); this.refresh(); return; }
            this.purchaseEquipment((draft, allowed) => recalibrateDawnItem(draft, entry.item.uid, allowed), 'ui.dawn.recalibrated');
          });
        const change = (offset: number) => {
          this.selectedUid = model.owned[index + offset].item.uid;
          this.confirming = false; this.message = ''; this.refresh();
        };
        this.button(this.content!, LEFT + 145, 552, 240, t('ui.dawn.previousItem'), index > 0, () => change(-1));
        this.button(this.content!, LEFT + CONTENT_WIDTH - 145, 552, 240, t('ui.dawn.nextItem'), index + 1 < model.owned.length, () => change(1));
        this.label(this.content!, LEFT + 50, 610, t('ui.dawn.itemPosition', { index: index + 1, count: model.owned.length }), 220, 18);
      }
      this.button(this.content!, LEFT + 150, 858, 270, t('ui.dawn.backToOffers'), true, () => {
        this.selecting = false; this.confirming = false; this.message = ''; this.refresh();
      });
      this.label(this.content!, LEFT + 330, 840, t('ui.dawn.coreCount', { count: model.cores }), 700, 23);
      return;
    }
    const gap = 20, cardWidth = (CONTENT_WIDTH - 2 * gap) / 3;
    model.offers.forEach(entry => {
      const left = LEFT + entry.index * (cardWidth + gap);
      this.itemCard(entry.item, left, cardWidth);
      this.label(this.content!, left + 20, 710, this.price(entry.price), cardWidth - 40, 17);
      if (entry.stashFull && !entry.sold) this.label(this.content!, left + 20, 791, t('ui.dawn.stashFull'), cardWidth - 40, 14);
      this.button(this.content!, left + cardWidth / 2, 760, cardWidth - 48, t(entry.sold ? 'ui.dawn.sold' : 'ui.dawn.buy'),
        entry.canBuy, () => this.purchaseEquipment((draft, allowed) => purchaseDawnShopItem(draft, entry.index, allowed)));
    });
    if (!model.offers.length) this.label(this.content!, LEFT + 30, 410, t(unlocked ? 'ui.dawn.saveFailed' : 'ui.dawn.locked'), CONTENT_WIDTH - 60, 23);
    this.section(LEFT, 822, CONTENT_WIDTH, 80);
    this.icon(this.content!, LEFT + 50, 862, DAWN_UI_TEXTURES.recalibrationCore, 64);
    this.label(this.content!, LEFT + 96, 830, t('ui.dawn.coreCount', { count: model.cores }), 550, 21);
    this.label(this.content!, LEFT + 96, 865, this.price(model.coreCost), 550, 17);
    this.button(this.content!, LEFT + CONTENT_WIDTH - 398, 862, 240, t('ui.dawn.buy'), model.canBuyCore,
      () => this.purchaseDawn(purchaseDawnRecalibrationCore));
    this.button(this.content!, LEFT + CONTENT_WIDTH - 138, 862, 240, t('ui.dawn.use'), model.canUseCore, () => {
      this.selecting = true; this.confirming = false; this.message = t('ui.dawn.chooseItem'); this.refresh();
    });
  }

  private itemCard(item: CoopDefenseItem, left: number, width: number): void {
    const model = buildDawnMerchantItemModel(item, getLocale());
    this.section(left, 375, width, 410, model.rarityColor);
    this.icon(this.content!, left + 48, 416, resolveCoopDefenseItemIconTexture(this.scene, item.slot, item.itemLevel, 64), 64);
    this.label(this.content!, left + 93, 390, `${model.slotLabel} · ${t('ui.items.level')} ${item.itemLevel}`, width - 115, 21)
      .setColor(toCssColor(model.rarityColor));
    this.label(this.content!, left + 93, 427, model.rarityLabel, width - 115, 17).setColor(toCssColor(model.rarityColor));
    const description = this.label(this.content!, left + 20, 468, model.lines.join('\n'), width - 40, 17);
    // Page at the measured line height, preserving all wrapped affix text at a readable size.
    const lines = description.getWrappedText();
    const lineHeight = description.height / Math.max(1, lines.length);
    const perPage = Math.max(1, Math.floor(195 / lineHeight));
    const pages = Math.ceil(lines.length / perPage);
    if (pages <= 1) return;
    let page = 0;
    const status = this.label(this.content!, left + width / 2 - 40, 678, '', 80, 16);
    const previous = this.button(this.content!, left + 52, 688, 64, '‹', false, () => { page--; update(); });
    const next = this.button(this.content!, left + width - 52, 688, 64, '›', true, () => { page++; update(); });
    const update = () => {
      description.setText(lines.slice(page * perPage, (page + 1) * perPage).join('\n'));
      status.setText(`${page + 1} / ${pages}`); previous.setEnabled(page > 0); next.setEnabled(page + 1 < pages);
    };
    update();
  }

  private purchaseRow(index: number, title: string, effect: string, cost: number | null, enabled: boolean, action: string, buy: () => void): void {
    const top = 380 + index * 216;
    this.section(LEFT, top, CONTENT_WIDTH, 194);
    this.label(this.content!, LEFT + 28, top + 22, title, 870, 27);
    this.label(this.content!, LEFT + 28, top + 68, effect, 870, 22);
    this.label(this.content!, LEFT + 960, top + 32, this.price(cost), 290, 21);
    this.button(this.content!, LEFT + CONTENT_WIDTH - 165, top + 130, 280, action, enabled, buy);
  }

  private purchaseDawn(purchase: (draft: DawnProgress, unlocked: boolean) => boolean): void {
    if (!this.canInteract()) return;
    let bought = false;
    // Only a durable write counts as a purchase; a failed write keeps the previous progress.
    const saved = updateStoredDawnProgress(draft => { bought = purchase(draft, isDawnUnlocked(getStoredCoopDefenseProgress())); });
    this.message = !bought ? t('ui.dawn.purchaseFailed') : saved ? t('ui.dawn.purchased') : t('ui.dawn.saveFailed');
    this.refresh();
  }

  private purchaseEquipment(purchase: (draft: DawnEquipmentProgressDraft, unlocked: boolean) => boolean, success = 'ui.dawn.purchased'): void {
    if (!this.canInteract()) return;
    const saved = updateStoredDawnEquipmentProgress(draft => purchase(draft, isDawnUnlocked(getStoredCoopDefenseProgress())));
    this.confirming = false;
    this.message = t(saved ? success : 'ui.dawn.saveFailed');
    this.refresh();
  }

  private clearContent(): void {
    for (const button of this.contentButtons) button.destroy();
    this.contentButtons = [];
    this.content?.removeAll(true);
  }

  private price(cost: number | null): string { return t(cost === null ? 'ui.dawn.maximal' : 'ui.dawn.expansionCost', { cost: cost ?? 0 }); }

  private section(x: number, y: number, w: number, h: number, accent = 0x8b9870): void {
    this.content!.add(this.scene.add.image(x + w / 2, y + h / 2,
      ensureTintedSectionTexture(this.scene, '_merchant_section', w, h, accent)).setDisplaySize(w, h));
  }

  private label(parent: Phaser.GameObjects.Container, x: number, y: number, text: string, width: number, size: number): Phaser.GameObjects.Text {
    const label = this.scene.add.text(x, y, text, { ...textStyle('body'), fontSize: size, lineSpacing: 4,
      wordWrap: { width, useAdvancedWrap: true } });
    parent.add(label); return label;
  }

  private icon(parent: Phaser.GameObjects.Container, x: number, y: number, key: string, size: number): void {
    if (this.scene.textures.exists(key)) parent.add(this.scene.add.image(x, y, key).setDisplaySize(size, size));
  }

  private button(parent: Phaser.GameObjects.Container, x: number, y: number, w: number, label: string,
    enabled: boolean, onClick: () => void, transient = true): UiButton {
    const button = new UiButton(this.scene, { skin: 'forest', x, y, w, h: 44, label,
      isEnabled: this.canInteract, onClick }).setEnabled(enabled);
    parent.add(button.getRoot());
    (transient ? this.contentButtons : this.buttons).push(button);
    return button;
  }
}
