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
import { ensureModalPanelTexture, ensureTintedSectionTexture, mountForestModal, SURFACE, textStyle } from './ForestModal';
import { ensureRoundedTexture } from './uiTextures';
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

  isOpen(): boolean { return this.root?.visible ?? false; }

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
      const button = this.button(this.root, cx, 302, 296, '', true, () => {
        this.category = category; this.selecting = false; this.confirming = false; this.message = ''; this.refresh();
      }, false, 76);
      const tabRoot = button.getRoot();
      this.icon(tabRoot, -108, 0, CATEGORY_ICONS[category], 56);
      this.label(tabRoot, -66, 0, t(`ui.dawn.tab.${category}`), 192, 21).setOrigin(0, 0.5);
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
    for (const [category, button] of this.tabs) {
      const active = category === this.category;
      button.setIntent(active ? 'attention' : 'neutral');
      button.getRoot().setAlpha(active ? 1 : 0.65);
    }
    switch (this.category) {
      case 'expansion': {
        const model = buildDawnMerchantModel(stored.dawn, stored.persistentBaseAreaStage, unlocked);
        this.section(LEFT, 380, CONTENT_WIDTH, 402);
        this.label(this.content!, LEFT + 40, 413, t('ui.dawn.expansionStats', { expansionLevel: model.expansionLevel, radius: model.radius }), 920, 27);
        if (model.coreHpBonus > 0) {
          this.label(this.content!, LEFT + 40, 486, t('ui.dawn.expansionCoreBonus', { hp: model.coreHpBonus, turrets: model.plasmaTurrets }), 920, 21);
        }
        if (model.nextReward) {
          this.label(this.content!, LEFT + 40, 514, model.nextReward.kind === 'radius'
            ? t('ui.dawn.nextExpansionRadius', { radius: model.nextReward.radiusCells })
            : t('ui.dawn.nextExpansionCore', { hp: model.nextReward.coreHpBonus }), 920, 21);
        }
        this.icon(this.content!, LEFT + 58, 563, DAWN_UI_TEXTURES.threat, 32);
        this.label(this.content!, LEFT + 86, 550, t(model.nextThreat === null ? 'ui.dawn.threat' : 'ui.dawn.threatConsequence',
          { threat: model.threat, nextThreat: model.nextThreat ?? model.threat }), 980, 23);
        this.price(LEFT + 40, 625, model.cost, 900, 23);
        this.button(this.content!, LEFT + 220, 729, 360, t(model.cost === null ? 'ui.dawn.maximal' : 'ui.dawn.buyExpansion'),
          model.canBuy, () => this.purchaseDawn(purchaseDawnExpansion));
        break;
      }
      case 'infrastructure':
        buildDawnInfrastructureModel(stored.dawn, unlocked).forEach((entry, index) => {
          this.purchaseRow(index, t(`ui.dawn.infrastructure.${entry.id}.name`),
            `${t('ui.dawn.level', { level: entry.level, max: entry.maxLevel })}\n${t(entry.effectIsNextLevel ? 'ui.dawn.nextLevelEffect' : 'ui.dawn.activeLevelEffect', { effect: t(entry.effectKey) })}`,
            entry.cost, entry.canBuy, entry.cost === null ? t('ui.dawn.maximal') : t('ui.dawn.buy'),
            () => this.purchaseDawn((draft, allowed) => purchaseDawnInfrastructure(draft, entry.id, allowed)), entry.icon);
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
        const footer = this.itemCard(entry.item, LEFT + 310, 660);
        this.label(this.content!, LEFT + 334, footer, t(entry.equipped ? 'ui.dawn.equipped' : 'ui.dawn.stored'), 610, 18);
        this.button(this.content!, GAME_WIDTH / 2, footer + 52, 360,
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
    let cardsBottom = 480;
    model.offers.forEach(entry => {
      const left = LEFT + entry.index * (cardWidth + gap);
      const stashFull = entry.stashFull && !entry.sold;
      const footer = this.itemCard(entry.item, left, cardWidth, stashFull);
      cardsBottom = Math.max(cardsBottom, footer + (stashFull ? 132 : 96));
      this.price(left + 20, footer, entry.price, cardWidth - 40, 19);
      if (stashFull) this.label(this.content!, left + 20, footer + 82, t('ui.dawn.stashFull'), cardWidth - 40, 16);
      this.button(this.content!, left + cardWidth / 2, footer + 52, cardWidth - 48, t(entry.sold ? 'ui.dawn.sold' : 'ui.dawn.buy'),
        entry.canBuy, () => this.purchaseEquipment((draft, allowed) => purchaseDawnShopItem(draft, entry.index, allowed)));
    });
    if (!model.offers.length) this.label(this.content!, LEFT + 30, 410, t(unlocked ? 'ui.dawn.saveFailed' : 'ui.dawn.locked'), CONTENT_WIDTH - 60, 23);
    const coreTop = cardsBottom + 28;
    this.section(LEFT, coreTop, CONTENT_WIDTH, 92);
    this.icon(this.content!, LEFT + 50, coreTop + 46, DAWN_UI_TEXTURES.recalibrationCore, 64);
    this.label(this.content!, LEFT + 96, coreTop + 12, t('ui.dawn.coreCount', { count: model.cores }), 550, 21);
    this.price(LEFT + 96, coreTop + 49, model.coreCost, 550, 19);
    this.button(this.content!, LEFT + CONTENT_WIDTH - 398, coreTop + 46, 240, t('ui.dawn.buy'), model.canBuyCore,
      () => this.purchaseDawn(purchaseDawnRecalibrationCore));
    this.button(this.content!, LEFT + CONTENT_WIDTH - 138, coreTop + 46, 240, t('ui.dawn.use'), model.canUseCore, () => {
      this.selecting = true; this.confirming = false; this.message = t('ui.dawn.chooseItem'); this.refresh();
    });
  }

  private itemCard(item: CoopDefenseItem, left: number, width: number, stashFull = false): number {
    const model = buildDawnMerchantItemModel(item, getLocale());
    const title = this.label(this.content!, left + 128, 390, `${model.slotLabel} · ${t('ui.items.level')} ${item.itemLevel}`, width - 148, 22)
      .setColor(toCssColor(model.rarityColor));
    const rarity = this.label(this.content!, left + 128, title.y + title.height + 6, model.rarityLabel, width - 148, 18)
      .setColor(toCssColor(model.rarityColor));
    this.icon(this.content!, left + 66, 433, resolveCoopDefenseItemIconTexture(this.scene, item.slot, item.itemLevel, 128), 96);
    const descriptionTop = Math.max(495, rarity.y + rarity.height + 16);
    const description = this.label(this.content!, left + 20, descriptionTop, model.lines.join('\n'), width - 40, 19);
    // Page at the measured line height, preserving all wrapped affix text at a readable size.
    const lines = description.getWrappedText();
    const lineHeight = description.height / Math.max(1, lines.length);
    // Reserve the footer and core row before paging; even a full stash must fit the modal.
    const descriptionBudget = Math.min(144, 895 - descriptionTop - 64 - (stashFull ? 132 : 96) - 120);
    const perPage = Math.max(1, Math.floor(descriptionBudget / lineHeight));
    const pages = Math.ceil(lines.length / perPage);
    const descriptionHeight = pages > 1 ? perPage * lineHeight : description.height;
    const paginationY = descriptionTop + descriptionHeight + 28;
    const footer = descriptionTop + descriptionHeight + (pages > 1 ? 64 : 20);
    const height = footer + (stashFull ? 132 : 96) - 375;
    const background = this.scene.add.image(left + width / 2, 375 + height / 2,
      ensureRoundedTexture(this.scene, { key: `_merchant_item_${width}x${height}_${model.rarityColor}`,
        w: width, h: height, radius: 16, topColor: SURFACE.raised, bottomColor: SURFACE.sunken,
        fillAlpha: 0.94, strokeColor: model.rarityColor, strokeAlpha: 0.95, strokeWidth: 3, highlightAlpha: 0.02 }));
    this.content!.add(background);
    this.content!.sendToBack(background);
    if (pages <= 1) return footer;
    let page = 0;
    const status = this.label(this.content!, left + width / 2 - 40, paginationY - 10, '', 80, 16);
    const previous = this.button(this.content!, left + 52, paginationY, 64, '‹', false, () => { page--; update(); });
    const next = this.button(this.content!, left + width - 52, paginationY, 64, '›', true, () => { page++; update(); });
    const update = () => {
      description.setText(lines.slice(page * perPage, (page + 1) * perPage).join('\n'));
      status.setText(`${page + 1} / ${pages}`); previous.setEnabled(page > 0); next.setEnabled(page + 1 < pages);
    };
    update();
    return footer;
  }

  private purchaseRow(index: number, title: string, effect: string, cost: number | null, enabled: boolean, action: string, buy: () => void, icon?: string): void {
    const top = 380 + index * 216;
    this.section(LEFT, top, CONTENT_WIDTH, 194);
    const inset = icon ? 116 : 28;
    if (icon) this.icon(this.content!, LEFT + 62, top + 78, icon, 64);
    this.label(this.content!, LEFT + inset, top + 22, title, 900 - inset, 27);
    this.label(this.content!, LEFT + inset, top + 68, effect, 900 - inset, 22);
    this.price(LEFT + 960, top + 32, cost, 290, 21);
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

  private price(x: number, y: number, cost: number | null, width: number, size: number): void {
    if (cost === null) { this.label(this.content!, x, y, t('ui.dawn.maximal'), width, size); return; }
    this.icon(this.content!, x + 16, y + size / 2 + 2, DAWN_UI_TEXTURES.scrap, 32);
    this.label(this.content!, x + 42, y, t('ui.dawn.scrapCount', { scrap: cost }), width - 42, size);
  }

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
    enabled: boolean, onClick: () => void, transient = true, height = 44): UiButton {
    const button = new UiButton(this.scene, { skin: 'forest', x, y, w, h: height, label,
      isEnabled: this.canInteract, onClick }).setEnabled(enabled);
    parent.add(button.getRoot());
    (transient ? this.contentButtons : this.buttons).push(button);
    return button;
  }
}
