import * as Phaser from 'phaser';
import { DEPTH, GAME_HEIGHT, GAME_WIDTH } from '../config';
import { DAWN_UI_TEXTURES } from '../assets/DawnUiAssets';
import { addDawnMerchantSlice, DAWN_MERCHANT_UI, dawnMerchantArtTexture, type DawnMerchantUiPart } from '../assets/DawnMerchantUiAssets';
import { DAWN_MERCHANT, getDawnMerchantCategories, type DawnMerchantCategory } from '../config/dawn/merchant';
import { DAWN_MAX_EXPANSION_LEVEL, type DawnProgress } from '../dawn/economy/DawnProgress';
import { getLocale, t } from '../i18n';
import { purchaseDawnExpansion } from '../dawn/economy/DawnEconomy';
import { purchaseDawnInfrastructure } from '../dawn/economy/DawnMerchantInfrastructure';
import { purchaseDawnBossPoint, purchaseDawnBranch } from '../dawn/economy/DawnMerchantUpgrades';
import { ensureDawnShopOffer, getDawnShopOffer, purchaseDawnRecalibrationCore, purchaseDawnShopItem, recalibrateDawnItem,
  type DawnEquipmentProgressDraft } from '../dawn/economy/DawnMerchantEquipment';
import { isDawnUnlocked } from '../dawn/rules/DawnUnlock';
import { getStoredCoopDefenseProgress, updateStoredDawnProgress, updateStoredDawnEquipmentProgress } from '../utils/localPreferences';
import type { CoopDefenseItem } from '../types';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { textStyle } from './ForestModal';
import { resolveCoopDefenseItemIconTexture } from './coopDefenseItemIcons';
import { DawnMerchantScrollPane } from './DawnMerchantScrollPane';
import { getOverlayRoot } from './fullscreen';
import { FONT_DISPLAY } from './uiTheme';
import { buildDawnMerchantModel, buildDawnInfrastructureModel, buildDawnUpgradesModel,
  buildDawnEquipmentModel, buildDawnMerchantItemModel, filterDawnMerchantOffers, summarizeDawnMerchantCategory,
  getDawnMerchantOfferStatus, buildDawnMerchantLevelSegments, DAWN_MERCHANT_FILTERS, type DawnMerchantFilter } from './DawnMerchantModel';

const W = 1690, H = 928, X = 115, Y = 76;
const NAV = { x: 150, y: 264, w: 324, h: 678 };
const GRID = { x: 495, y: 334, w: 710, h: 608 };
const DETAIL = { x: 1230, y: 445, w: 526, h: 345 };
const CARD_W = 216, CARD_H = 272, CARD_STEP = 230, ROW_STEP = 286;
const PAPER = '#d9cfb6', MUTED = '#b7aa8c', RED = '#f09b85';
type Requirement = { met: boolean; text: string; locked?: boolean };
type Offer = {
  id: string; categoryId: string; name: string; icon: string; description: string; effects: string[];
  level: number; max: number | null; cost: number | null; canBuy: boolean; owned: boolean;
  requirements: Requirement[]; buy: () => void; expansion?: boolean; item?: CoopDefenseItem;
  recalibration?: boolean; fresh?: boolean;
};

/** Personal presentation only. All transactions retain the economy and durable-write boundary. */
export class DawnMerchantOverlay {
  private root: Phaser.GameObjects.Container | null = null;
  private detailHeader: Phaser.GameObjects.Container | null = null;
  private footer: Phaser.GameObjects.Container | null = null;
  private confirmation: Phaser.GameObjects.Container | null = null;
  private nav!: DawnMerchantScrollPane;
  private grid!: DawnMerchantScrollPane;
  private details!: DawnMerchantScrollPane;
  private balance: Phaser.GameObjects.Text | null = null;
  private notice: Phaser.GameObjects.Text | null = null;
  private catalogTitle: Phaser.GameObjects.Text | null = null;
  private filterLabel: Phaser.GameObjects.Text | null = null;
  private searchInput: HTMLInputElement | null = null;
  private query = '';
  private filter: DawnMerchantFilter = 'all';
  private searchFocused = false;
  private offers: Offer[] = [];
  private rows: DawnMerchantCategory[] = [];
  private category = DAWN_MERCHANT.categories.find(entry => entry.parentId === null)!.id;
  private expanded = new Set<string>([this.category]);
  private selected = '';
  private hovered = '';
  private hoveredCategory = '';
  private focus: 'categories' | 'cards' = 'categories';
  private lastClick = { id: '', time: 0 };
  private seen = new Set<string>();
  private message = '';
  private failed = false;
  private stampId = '';
  private stampScale = { value: 1 };
  private displayedBalance = { value: 0 };
  private confirming: { id: string; cost: number | null; balance: number } | null = null;

  constructor(private readonly scene: Phaser.Scene, private readonly canInteract: () => boolean) {}

  isOpen(): boolean { return this.root?.visible ?? false; }

  show(): void {
    if (!this.canInteract()) return;
    const unlocked = isDawnUnlocked(getStoredCoopDefenseProgress());
    updateStoredDawnEquipmentProgress(draft => ensureDawnShopOffer(draft.dawn, unlocked));
    this.failed = unlocked && !getDawnShopOffer(getStoredCoopDefenseProgress().dawn);
    this.message = this.failed ? t('ui.dawn.saveFailed') : '';
    this.confirming = null;
    if (!this.root) this.build();
    this.root!.setVisible(true);
    this.refresh();
    // Capture before Phaser queues events or dispatches key-specific lobby handlers.
    window.addEventListener('keydown', this.keydown, true);
    window.addEventListener('keyup', this.searchKeyup, true);
    window.addEventListener('pointerdown', this.outsideSearch, true);
  }

  hide(): void {
    this.root?.setVisible(false);
    this.blurSearch();
    this.confirming = null;
    this.confirmation?.destroy(true); this.confirmation = null;
    this.nav?.cancelDrag(); this.grid?.cancelDrag(); this.details?.cancelDrag();
    window.removeEventListener('keydown', this.keydown, true);
    window.removeEventListener('keyup', this.searchKeyup, true);
    window.removeEventListener('pointerdown', this.outsideSearch, true);
    this.scene.tweens.killTweensOf([this.displayedBalance, this.stampScale]);
    this.stampId = '';
  }

  destroy(): void {
    this.hide();
    this.nav?.destroy(); this.grid?.destroy(); this.details?.destroy();
    this.searchInput?.remove(); this.searchInput = null;
    this.root?.destroy(true); this.root = null;
  }

  private active = (): boolean => !!this.root?.visible && !this.confirming && this.canInteract();

  private focusSearch(): void {
    if (!this.active()) return;
    if (!this.searchInput) {
      const input = document.createElement('input');
      input.type = 'text'; input.maxLength = 80; input.autocomplete = 'off'; input.spellcheck = false;
      input.setAttribute('aria-label', t('ui.dawn.searchLabel'));
      Object.assign(input.style, { position: 'fixed', zIndex: '1000', boxSizing: 'border-box',
        width: '410px', height: '34px', padding: '2px 0', border: '0', borderBottom: '1px solid #d9822b',
        outline: 'none', borderRadius: '0', background: '#1b1a17', color: PAPER, caretColor: PAPER,
        fontFamily: FONT_DISPLAY, fontWeight: '700', fontSize: '19px', transformOrigin: 'top left' });
      input.addEventListener('input', () => { this.query = input.value; this.applyBrowse(); });
      input.addEventListener('blur', () => this.blurSearch());
      // Native input interaction never becomes a Phaser pointer event.
      for (const type of ['pointerdown', 'pointerup', 'pointermove', 'mousedown', 'mouseup', 'wheel']) {
        input.addEventListener(type, event => event.stopPropagation());
      }
      getOverlayRoot().appendChild(input);
      this.searchInput = input;
    }
    this.searchFocused = true;
    this.searchInput.value = this.query;
    this.searchInput.placeholder = t('ui.dawn.searchPlaceholder');
    this.searchInput.style.display = 'block';
    this.positionSearch();
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.positionSearch);
    this.scene.scale.on(Phaser.Scale.Events.RESIZE, this.positionSearch);
    this.searchInput.focus({ preventScroll: true });
    this.renderBrowse();
  }

  private readonly positionSearch = (): void => {
    if (!this.searchInput || !this.searchFocused) return;
    const bounds = this.scene.game.canvas.getBoundingClientRect();
    const sx = bounds.width / GAME_WIDTH, sy = bounds.height / GAME_HEIGHT;
    this.searchInput.style.left = `${bounds.left + (GRID.x + 44) * sx}px`;
    this.searchInput.style.top = `${bounds.top + 273 * sy}px`;
    this.searchInput.style.transform = `scale(${sx}, ${sy})`;
  };

  private blurSearch(): void {
    this.searchFocused = false;
    this.scene.scale.off(Phaser.Scale.Events.RESIZE, this.positionSearch);
    if (this.searchInput) {
      this.searchInput.style.display = 'none';
      if (document.activeElement === this.searchInput) this.searchInput.blur();
    }
    this.renderBrowse();
  }

  private readonly outsideSearch = (event: PointerEvent): void => {
    if (this.searchFocused && event.target !== this.searchInput) this.blurSearch();
  };
  private readonly searchKeyup = (event: KeyboardEvent): void => {
    if (this.isOpen() && this.searchFocused) event.stopImmediatePropagation();
  };

  private renderBrowse(): void {
    this.catalogTitle?.setText(this.query || t('ui.dawn.searchPlaceholder')).setColor(this.query ? PAPER : MUTED)
      .setVisible(!this.searchFocused);
    if (this.filterLabel) {
      this.filterLabel.setText(t(`ui.dawn.filter.${this.filter}`));
      this.filterLabel.setY(266 + (48 - this.filterLabel.height) / 2);
    }
  }

  private applyBrowse(): void {
    this.grid.reset(); this.details.reset();
    this.hovered = ''; this.lastClick = { id: '', time: 0 };
    const visible = this.visibleOffers();
    if (!visible.some(entry => entry.id === this.selected)) this.selected = visible[0]?.id ?? '';
    this.renderNav(); this.renderGrid(); this.renderDetails();
  }

  private build(): void {
    this.root = this.scene.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH.OVERLAY + 3).setName('dawn-merchant');
    this.root.add(this.scene.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x080907, 0.78).setInteractive());
    this.fill(this.root, X + 18, Y + 18, W - 36, H - 36);
    this.root.add(this.scene.add.tileSprite(650, 102, 1035, 126, DAWN_MERCHANT_UI['header-panorama'].key).setOrigin(0).setAlpha(0.72));
    this.icon(this.root, 208, 167, DAWN_UI_TEXTURES.dealerPortrait, 120);
    this.label(this.root, 285, 120, t('ui.dawn.dealerName'), 350, 34);
    this.icon(this.root, 301, 194, DAWN_UI_TEXTURES.scrap, 32);
    this.balance = this.label(this.root, 328, 178, '', 315, 29);
    const close = this.icon(this.root, 1738, 151, DAWN_MERCHANT_UI['button-close'].key, 48).setInteractive({ useHandCursor: true });
    let closing = false;
    close.on('pointerdown', () => { closing = true; });
    close.on('pointerout', () => { closing = false; });
    close.on('pointerup', () => { if (closing) this.hide(); closing = false; });
    this.rule(this.root, 150, 240, 1620, 1);
    this.rule(this.root, 1213, 266, 1, 676);
    this.label(this.root, NAV.x + 4, 244, t('ui.dawn.catalog'), 310, 15).setColor(MUTED);
    this.catalogTitle = this.label(this.root, GRID.x + 44, 279, '', 410, 19).setFixedSize(410, 28).setCrop(0, 0, 410, 28);
    const search = addDawnMerchantSlice(this.scene, this.root, 'field-search', GRID.x, 266, 464, 48).setInteractive({ useHandCursor: true });
    search.on('pointerdown', () => this.focusSearch());
    this.root.bringToTop(this.catalogTitle);
    this.icon(this.root, GRID.x + 24, 290, DAWN_MERCHANT_UI['icon-search'].key, 26);
    const filter = addDawnMerchantSlice(this.scene, this.root, 'field-search', 973, 266, 208, 48).setInteractive({ useHandCursor: true });
    filter.on('pointerdown', () => {
      if (!this.active()) return;
      this.blurSearch();
      this.filter = DAWN_MERCHANT_FILTERS[(DAWN_MERCHANT_FILTERS.indexOf(this.filter) + 1) % DAWN_MERCHANT_FILTERS.length];
      this.applyBrowse();
    });
    this.icon(this.root, 996, 290, DAWN_MERCHANT_UI['icon-filter'].key, 24);
    this.filterLabel = this.label(this.root, 1018, 272, '', 150, 17).setLineSpacing(0);
    this.nav = new DawnMerchantScrollPane(this.scene, this.root, NAV.x, NAV.y + 22, NAV.w, NAV.h - 22, this.active,
      (x, y) => this.chooseCategory(Math.floor(y / 64), x), (x, y) => {
        const id = x >= 0 && x < NAV.w - 22 && y >= this.nav.scrollOffset && y < this.nav.scrollOffset + NAV.h - 22
          ? this.rows[Math.floor(y / 64)]?.id ?? '' : '';
        if (id !== this.hoveredCategory) { this.hoveredCategory = id; this.renderNav(); }
      });
    this.grid = new DawnMerchantScrollPane(this.scene, this.root, GRID.x, GRID.y, GRID.w, GRID.h, this.active,
      (x, y) => this.chooseCard(x, y), (x, y) => {
        const id = this.cardAt(x, y)?.id ?? '';
        if (id !== this.hovered) { this.hovered = id; this.renderGrid(); }
      });
    this.detailHeader = this.scene.add.container(0, 0); this.root.add(this.detailHeader);
    this.details = new DawnMerchantScrollPane(this.scene, this.root, DETAIL.x, DETAIL.y, DETAIL.w, DETAIL.h, this.active, () => {});
    this.footer = this.scene.add.container(0, 0); this.root.add(this.footer);
    this.notice = this.label(this.root, 151, 952, '', 1530, 18);
    addDawnMerchantSlice(this.scene, this.root, 'window-frame', X, Y, W, H);
    promoteToClarityCamera(this.scene, this.root);
  }

  private makeOffers(): Offer[] {
    const stored = getStoredCoopDefenseProgress(), progress = stored.dawn, unlocked = isDawnUnlocked(stored);
    const result: Offer[] = [];
    const add = (entry: Omit<Offer, 'requirements'> & { requirements?: Requirement[] }) => {
      const requirements: Requirement[] = [{ met: unlocked, locked: !unlocked,
        text: t(unlocked ? 'ui.dawn.campaignDone' : 'ui.dawn.locked') }, ...(entry.requirements ?? [])];
      if (entry.cost !== null) requirements.push({ met: progress.scrap >= entry.cost,
        text: t('ui.dawn.funds', { scrap: progress.scrap, cost: entry.cost }) });
      if (entry.owned) requirements.push({ met: true, text: t('ui.dawn.limitReached') });
      // Domain predicates remain authoritative, including rare capacity limits.
      if (!entry.canBuy && !entry.owned && requirements.every(row => row.met)) {
        requirements.push({ met: false, locked: true, text: t('ui.dawn.capacity') });
      }
      result.push({ ...entry, requirements });
    };
    const expansion = buildDawnMerchantModel(progress, stored.persistentBaseAreaStage, unlocked);
    add({ id: 'expansion', categoryId: DAWN_MERCHANT.expansion.categoryId, name: t('ui.dawn.category.base'),
      icon: DAWN_UI_TEXTURES.dealerExpansion, description: t('ui.dawn.expansionDescription'),
      effects: [t('ui.dawn.expansionStats', { expansionLevel: expansion.expansionLevel, radius: expansion.radius }),
        t('ui.dawn.expansionHpEffect', { hp: expansion.coreHpBonus }),
        t('ui.dawn.expansionTurretEffect', { turrets: expansion.plasmaTurrets }),
        ...(expansion.nextReward ? [expansion.nextReward.kind === 'radius'
          ? t('ui.dawn.nextExpansionRadius', { radius: expansion.nextReward.radiusCells })
          : t('ui.dawn.nextExpansionCore', { hp: expansion.nextReward.coreHpBonus })] : []),
        t(expansion.nextThreat === null ? 'ui.dawn.threat' : 'ui.dawn.threatConsequence', { threat: expansion.threat, nextThreat: expansion.nextThreat ?? expansion.threat })],
      level: expansion.expansionLevel, max: DAWN_MAX_EXPANSION_LEVEL, cost: expansion.cost, canBuy: expansion.canBuy,
      owned: expansion.cost === null, expansion: true, buy: () => this.purchaseDawn(purchaseDawnExpansion) });
    for (const entry of buildDawnInfrastructureModel(progress, unlocked)) {
      add({ id: entry.id, categoryId: DAWN_MERCHANT.infrastructure.find(row => row.id === entry.id)!.categoryId,
        name: t(`ui.dawn.infrastructure.${entry.id}.name`), icon: entry.icon, description: t('ui.dawn.infrastructureDescription'),
        effects: [t(entry.effectIsNextLevel ? 'ui.dawn.nextLevelEffect' : 'ui.dawn.activeLevelEffect', { effect: t(entry.effectKey) })],
        level: entry.level, max: entry.maxLevel, cost: entry.cost, canBuy: entry.canBuy, owned: entry.cost === null,
        buy: () => this.purchaseDawn((draft, allowed) => purchaseDawnInfrastructure(draft, entry.id, allowed)) });
    }
    const upgrades = buildDawnUpgradesModel(progress, unlocked);
    for (const entry of upgrades.branches) add({ id: `branch:${entry.branchId}`, categoryId: entry.categoryId,
      name: t(`ui.dawn.branch.${entry.branchId}.name`), icon: DAWN_UI_TEXTURES.dealerUpgrades,
      description: t('ui.dawn.researchDescription'), effects: [t(`ui.dawn.branch.${entry.branchId}.effect`)],
      level: entry.researched ? 1 : 0, max: 1, cost: entry.researched ? null : entry.price, canBuy: entry.canBuy, owned: entry.researched,
      buy: () => this.purchaseDawn((draft, allowed) => purchaseDawnBranch(draft, entry.branchId, allowed)) });
    const points = upgrades.bossPoints;
    add({ id: 'boss-points', categoryId: DAWN_MERCHANT.upgrades.bossPointCategoryId, name: t('ui.dawn.bossPoints'),
      icon: DAWN_UI_TEXTURES.dealerUpgrades, description: t('ui.dawn.researchDescription'),
      effects: [t('ui.dawn.bossPointCount', { count: points.purchased, max: points.limit })],
      level: points.purchased, max: points.limit, cost: points.cost, canBuy: points.canBuy, owned: points.cost === null,
      buy: () => this.purchaseDawn(purchaseDawnBossPoint) });
    const equipment = buildDawnEquipmentModel(stored, unlocked);
    const itemData = (item: CoopDefenseItem) => {
      const model = buildDawnMerchantItemModel(item, getLocale());
      return { item, name: `${model.slotLabel} · ${t('ui.items.level')} ${item.itemLevel}`,
        icon: resolveCoopDefenseItemIconTexture(this.scene, item.slot, item.itemLevel, 128),
        effects: model.lines, level: item.itemLevel, max: null };
    };
    for (const entry of equipment.offers) add({ ...itemData(entry.item), id: `item:${entry.item.uid}`,
      categoryId: DAWN_MERCHANT.equipment.itemCategoryId, description: t('ui.dawn.itemDescription'),
      cost: entry.price, canBuy: entry.canBuy, owned: entry.sold, fresh: !entry.sold && !this.seen.has(entry.item.uid),
      requirements: [{ met: !entry.stashFull, locked: entry.stashFull, text: t(entry.stashFull ? 'ui.dawn.stashFull' : 'ui.dawn.stashSpace') }],
      buy: () => this.purchaseEquipment((draft, allowed) => purchaseDawnShopItem(draft, entry.index, allowed)) });
    add({ id: 'core', categoryId: DAWN_MERCHANT.equipment.coreCategoryId, name: t('ui.dawn.coreName'),
      icon: DAWN_UI_TEXTURES.recalibrationCore, description: t('ui.dawn.coreDescription'),
      effects: [t('ui.dawn.coreCount', { count: equipment.cores }), t(equipment.owned.length ? 'ui.dawn.chooseItem' : 'ui.dawn.noItems')],
      level: equipment.cores, max: null, cost: equipment.coreCost, canBuy: equipment.canBuyCore, owned: false,
      buy: () => this.purchaseDawn(purchaseDawnRecalibrationCore) });
    for (const entry of equipment.owned) add({ ...itemData(entry.item), id: `recalibrate:${entry.item.uid}`,
      categoryId: DAWN_MERCHANT.equipment.recalibrationCategoryId,
      description: `${t(entry.equipped ? 'ui.dawn.equipped' : 'ui.dawn.stored')}\n\n${t('ui.dawn.recalibrationWarning')}`,
      cost: null, canBuy: entry.canRecalibrate, owned: false, recalibration: true,
      requirements: [{ met: equipment.cores > 0, locked: equipment.cores === 0, text: t('ui.dawn.coreRequired') }],
      buy: () => this.purchaseEquipment((draft, allowed) => recalibrateDawnItem(draft, entry.item.uid, allowed), 'ui.dawn.recalibrated') });
    return result;
  }

  private refresh(animateFrom?: number): void {
    this.offers = this.makeOffers();
    const visible = this.visibleOffers();
    if (!visible.some(entry => entry.id === this.selected)) { this.selected = visible[0]?.id ?? ''; this.details.reset(); }
    this.renderNav(); this.renderGrid(); this.renderDetails();
    this.notice?.setText(this.message || t('ui.dawn.controls')).setColor(this.failed ? RED : this.message ? PAPER : MUTED);
    this.scene.tweens.killTweensOf(this.displayedBalance);
    const balance = getStoredCoopDefenseProgress().dawn.scrap;
    this.displayedBalance.value = animateFrom ?? balance;
    const update = () => this.balance?.setText(t('ui.dawn.scrapCount', { scrap: Math.round(this.displayedBalance.value) }));
    update();
    if (animateFrom !== undefined) this.scene.tweens.add({ targets: this.displayedBalance, value: balance, duration: 480, onUpdate: update });
  }

  private visibleOffers(): Offer[] { return filterDawnMerchantOffers(this.offers, this.category, this.query, this.filter, getLocale()); }
  private current(): Offer | undefined { return this.offers.find(entry => entry.id === this.selected); }
  private status(entry: Offer): 'owned' | 'blocked' | 'expensive' | 'available' {
    return getDawnMerchantOfferStatus(entry);
  }

  private renderNav(): void {
    this.nav.clear();
    const categories = getDawnMerchantCategories(this.offers.map(entry => entry.categoryId));
    this.rows = categories.filter(entry => entry.parentId === null).flatMap(root => [root,
      ...(this.expanded.has(root.id) ? categories.filter(child => child.parentId === root.id) : [])]);
    this.rows.forEach((entry, index) => {
      const y = index * 64, selected = entry.id === this.category;
      addDawnMerchantSlice(this.scene, this.nav.content, `${entry.parentId ? 'subcategory' : 'category'}-row-${selected ? 'active' : entry.id === this.hoveredCategory ? 'hover' : 'normal'}`, 0, y, NAV.w - 22, 56);
      this.icon(this.nav.content, entry.parentId ? 49 : 31, y + 28, entry.iconKey, entry.parentId ? 29 : 36);
      this.label(this.nav.content, entry.parentId ? 73 : 59, y + 8, t(entry.nameKey), entry.parentId ? 164 : 178, 18).setLineSpacing(0);
      const summary = summarizeDawnMerchantCategory(this.offers, entry.id);
      this.label(this.nav.content, 250, y + 18, String(summary.count), 32, 17).setColor(MUTED);
      if (summary.attention) this.nav.content.add(this.scene.add.circle(240, y + 27, 3, 0xd9822b));
      if (!entry.parentId) this.label(this.nav.content, 282, y + 18, this.expanded.has(entry.id) ? '−' : '+', 20, 18);
      if (selected && this.focus === 'categories') this.rule(this.nav.content, 3, y + 9, 3, 38);
    });
    this.nav.setContentHeight(this.rows.length * 64);
  }

  private chooseCategory(index: number, x = 0): void {
    const entry = this.rows[index]; if (!entry) return;
    this.focus = 'categories';
    if (entry.parentId === null) {
      if (entry.id === this.category || x >= 278) {
        if (this.expanded.has(entry.id)) this.expanded.delete(entry.id); else this.expanded.add(entry.id);
      } else this.expanded.add(entry.id);
    }
    this.category = entry.id; this.selected = ''; this.message = ''; this.stampId = '';
    this.grid.reset(); this.details.reset(); this.refresh();
    const row = this.rows.findIndex(candidate => candidate.id === entry.id);
    this.nav.reveal(row * 64, row * 64 + 56);
  }

  private cardAt(x: number, y: number): Offer | undefined {
    if (x < 0 || x >= GRID.w - 22 || y < this.grid.scrollOffset || y >= this.grid.scrollOffset + GRID.h) return undefined;
    const col = Math.floor(x / CARD_STEP), row = Math.floor(y / ROW_STEP);
    if (col > 2 || x % CARD_STEP > CARD_W || y % ROW_STEP > CARD_H) return undefined;
    return this.visibleOffers()[row * 3 + col];
  }
  private chooseCard(x: number, y: number): void {
    const entry = this.cardAt(x, y); if (!entry) return;
    this.focus = 'cards';
    const double = this.lastClick.id === entry.id && this.scene.time.now - this.lastClick.time < 360;
    this.lastClick = { id: entry.id, time: this.scene.time.now };
    this.select(entry.id);
    if (double) this.requestPurchase();
  }
  private select(id: string): void {
    this.selected = id; this.details.reset(); this.message = ''; this.notice?.setText(t('ui.dawn.controls')).setColor(MUTED);
    const entry = this.current();
    if (entry?.item) { this.seen.add(entry.item.uid); entry.fresh = false; }
    this.renderNav(); this.renderGrid(); this.renderDetails();
  }

  private renderGrid(): void {
    this.grid.clear();
    const offers = this.visibleOffers();
    this.renderBrowse();
    offers.forEach((entry, index) => {
      const x = index % 3 * CARD_STEP, y = Math.floor(index / 3) * ROW_STEP, state = this.status(entry);
      this.fill(this.grid.content, x + 4, y + 4, CARD_W - 8, CARD_H - 8);
      const frame = state === 'owned' ? 'owned' : state === 'blocked' ? 'locked' : entry.id === this.selected ? 'selected' : entry.id === this.hovered || entry.canBuy ? 'hover' : 'normal';
      if (entry.item) addDawnMerchantSlice(this.scene, this.grid.content, `card-rarity-${entry.item.rarity}`, x, y, CARD_W, CARD_H);
      addDawnMerchantSlice(this.scene, this.grid.content, `card-frame-${frame}`, x, y, CARD_W, CARD_H);
      const alpha = state === 'blocked' ? 0.5 : 1;
      this.icon(this.grid.content, x + CARD_W / 2, y + 85, entry.icon, 134).setAlpha(alpha);
      const title = this.label(this.grid.content, x + 15, y + 158, entry.name, CARD_W - 30, 19).setLineSpacing(0).setAlpha(alpha);
      const lines = title.getWrappedText();
      if (lines.length > 2) title.setText(`${lines[0]}\n${lines[1].slice(0, -1)}…`);
      if (entry.fresh) {
        this.icon(this.grid.content, x + 28, y + 27, DAWN_MERCHANT_UI['badge-new'].key, 38);
        this.label(this.grid.content, x + 52, y + 17, t('ui.dawn.new'), 88, 15);
      }
      if (entry.id === this.selected && (state === 'owned' || state === 'blocked')) this.rule(this.grid.content, x + 8, y + 8, 5, 40, 0x9f3b30);
      const segments = buildDawnMerchantLevelSegments(entry.level, entry.max ?? 0);
      if (segments.length > 5) {
        const step = 142 / segments.length;
        segments.forEach((filled, index) => this.rule(this.grid.content, x + 15 + index * step, y + 221,
          step - 2, 7, filled ? 0xd9cfb6 : 0x5a5140));
        this.label(this.grid.content, x + 162, y + 214, `${entry.level}/${entry.max}`, 48, 16);
      } else segments.forEach((filled, index) => this.icon(this.grid.content, x + 22 + index * 19, y + 224,
        DAWN_MERCHANT_UI[filled ? 'pip-filled' : 'pip-empty'].key, 14));
      if (entry.recalibration) this.label(this.grid.content, x + 15, y + 214, t('ui.dawn.recalibrate'), CARD_W - 30, 16).setColor(MUTED);
      const price = entry.owned ? t('ui.dawn.owned') : entry.recalibration ? t('ui.dawn.oneCore') : t('ui.dawn.scrapCount', { scrap: entry.cost ?? 0 });
      this.label(this.grid.content, x + 15, y + 243, price, CARD_W - 30, 16).setColor(state === 'expensive' ? RED : PAPER);
      if (entry.id === this.stampId) {
        const stamp = this.scene.add.container(x + CARD_W / 2, y + 116).setScale(this.stampScale.value).setAngle(-9);
        this.grid.content.add(stamp);
        this.icon(stamp, 0, 0, DAWN_MERCHANT_UI['stamp-purchased-blank'].key, 190, 55);
        this.label(stamp, -88, -16, t('ui.dawn.stamp'), 176, 25).setAlign('center');
      }
    });
    if (!offers.length) this.label(this.grid.content, 16, 24,
      t(this.query.trim() || this.filter !== 'all' ? 'ui.dawn.noMatches' : 'ui.dawn.empty'), 650, 23).setColor(MUTED);
    this.grid.setContentHeight(Math.ceil(offers.length / 3) * ROW_STEP);
  }

  private renderDetails(): void {
    this.detailHeader!.removeAll(true); this.footer!.removeAll(true); this.details.clear();
    const entry = this.current();
    if (!entry) { this.details.setContentHeight(0); return; }
    this.icon(this.detailHeader!, 1303, 340, entry.icon, 140);
    const name = this.label(this.detailHeader!, 1390, 269, entry.name, 365, 27).setLineSpacing(2);
    const category = DAWN_MERCHANT.categories.find(row => row.id === entry.categoryId)!;
    const categoryY = Math.max(336, name.y + name.height + 10);
    this.label(this.detailHeader!, 1390, categoryY, t(category.nameKey), 365, 17).setColor(MUTED);
    this.label(this.detailHeader!, 1390, categoryY + 29, entry.max === null
      ? (entry.item ? buildDawnMerchantItemModel(entry.item, getLocale()).rarityLabel : t('ui.dawn.coreCount', { count: entry.level }))
      : t('ui.dawn.nextLevel', { level: entry.level, next: Math.min(entry.level + 1, entry.max), max: entry.max }), 365, 18);
    this.label(this.detailHeader!, 1230, 414, t(`ui.dawn.${this.status(entry)}`), 500, 17).setColor(entry.canBuy || entry.owned ? PAPER : RED);
    let y = 0;
    const paragraph = (text: string, size = 21, color = PAPER) => {
      const label = this.label(this.details.content, 0, y, text, DETAIL.w - 34, size).setColor(color);
      y += label.height + 19;
    };
    paragraph(entry.description);
    paragraph(t('ui.dawn.effects'), 16, MUTED);
    entry.effects.forEach(effect => paragraph(`• ${effect}`));
    paragraph(t('ui.dawn.requirements'), 16, MUTED);
    for (const requirement of entry.requirements) {
      if (requirement.locked && !requirement.met) this.icon(this.details.content, 12, y + 14, DAWN_MERCHANT_UI['icon-lock'].key, 24);
      else this.label(this.details.content, 0, y, requirement.met ? '✓' : '☐', 28, 23);
      const line = this.label(this.details.content, 34, y, requirement.text, DETAIL.w - 68, 19).setColor(requirement.met ? PAPER : RED);
      y += line.height + 14;
    }
    this.details.setContentHeight(y);
    this.rule(this.footer!, 1230, 810, 526, 1);
    if (entry.recalibration) {
      this.label(this.footer!, 1230, 824, t('ui.dawn.craftAction'), 510, 16).setColor(MUTED);
      this.icon(this.footer!, 1249, 867, DAWN_UI_TEXTURES.recalibrationCore, 36);
      this.label(this.footer!, 1278, 853, t('ui.dawn.oneCore'), 190, 24);
    } else {
      this.icon(this.footer!, 1249, 854, DAWN_UI_TEXTURES.scrap, 36);
      this.label(this.footer!, 1278, 840, entry.owned ? t('ui.dawn.maximal') : t('ui.dawn.scrapCount', { scrap: entry.cost ?? 0 }), 460, 27)
        .setColor(this.status(entry) === 'expensive' ? RED : PAPER);
    }
    this.button(this.footer!, 1230, 888, 526, entry.recalibration ? t('ui.dawn.recalibrate') : t('ui.dawn.buy'), entry.canBuy,
      () => this.requestPurchase());
  }

  private requestPurchase(): void {
    const entry = this.current(); if (!entry?.canBuy || !this.active()) return;
    this.blurSearch();
    const balance = getStoredCoopDefenseProgress().dawn.scrap;
    if (entry.expansion || entry.recalibration || (entry.cost ?? 0) >= balance * 0.5) {
      this.confirming = { id: entry.id, cost: entry.cost, balance };
      this.showConfirmation(entry, balance);
    } else entry.buy();
  }
  private showConfirmation(entry: Offer, balance: number): void {
    this.confirmation?.destroy(true);
    const parent = this.scene.add.container(0, 0); this.confirmation = parent; this.root!.add(parent);
    parent.add(this.scene.add.rectangle(960, 540, GAME_WIDTH, GAME_HEIGHT, 0x080907, 0.84).setInteractive());
    this.fill(parent, 600, 304, 720, 472);
    addDawnMerchantSlice(this.scene, parent, 'window-frame', 580, 284, 760, 512);
    this.label(parent, 638, 334, t('ui.dawn.confirmTitle'), 640, 30);
    this.label(parent, 638, 396, entry.recalibration ? `${entry.name}\n\n${t('ui.dawn.recalibrationWarning')}`
      : t('ui.dawn.confirmBody', { name: entry.name, cost: entry.cost ?? 0, remaining: balance - (entry.cost ?? 0) }), 644, 24);
    if (entry.expansion) this.label(parent, 638, 575, entry.effects[entry.effects.length - 1], 640, 20).setColor(RED);
    this.button(parent, 638, 671, 270, t('ui.dawn.cancel'), true, () => this.cancelConfirmation());
    this.button(parent, 930, 671, 350, t(entry.recalibration ? 'ui.dawn.confirmRecalibration' : 'ui.dawn.confirmBuy'), true, () => this.confirmPurchase());
  }
  private cancelConfirmation(): void { this.confirming = null; this.confirmation?.destroy(true); this.confirmation = null; }
  private confirmPurchase(): void {
    const confirmation = this.confirming;
    if (!confirmation || !this.canInteract()) return;
    // Re-read after confirmation; stale prices/balances require a fresh review.
    const current = this.makeOffers().find(entry => entry.id === confirmation.id);
    this.cancelConfirmation();
    if (!current?.canBuy || current.cost !== confirmation.cost || getStoredCoopDefenseProgress().dawn.scrap !== confirmation.balance) {
      this.failed = true; this.message = t('ui.dawn.purchaseFailed'); this.refresh(); return;
    }
    current.buy();
  }

  private purchaseDawn(purchase: (draft: DawnProgress, unlocked: boolean) => boolean): void {
    if (!this.canInteract()) return;
    const before = getStoredCoopDefenseProgress().dawn.scrap;
    let bought = false;
    const saved = updateStoredDawnProgress(draft => { bought = purchase(draft, isDawnUnlocked(getStoredCoopDefenseProgress())); });
    this.finishPurchase(bought, saved, before);
  }
  private purchaseEquipment(purchase: (draft: DawnEquipmentProgressDraft, unlocked: boolean) => boolean, success = 'ui.dawn.purchased'): void {
    if (!this.canInteract()) return;
    const before = getStoredCoopDefenseProgress().dawn.scrap;
    let bought = false;
    const saved = updateStoredDawnEquipmentProgress(draft => {
      bought = purchase(draft, isDawnUnlocked(getStoredCoopDefenseProgress())); return bought;
    });
    this.finishPurchase(bought, saved, before, success);
  }
  private finishPurchase(bought: boolean, saved: boolean, before: number, success = 'ui.dawn.purchased'): void {
    this.failed = !bought || !saved;
    this.message = t(!bought ? 'ui.dawn.purchaseFailed' : !saved ? 'ui.dawn.saveFailed' : success);
    this.scene.tweens.killTweensOf(this.stampScale);
    this.stampId = bought && saved ? this.selected : '';
    this.stampScale.value = 1.5;
    this.refresh(bought && saved ? before : undefined);
    if (this.stampId) this.scene.tweens.add({ targets: this.stampScale, value: 1, duration: 220, ease: 'Back.easeOut', onUpdate: () => this.renderGrid() });
  }

  private readonly keydown = (event: KeyboardEvent): void => {
    if (!this.isOpen()) return;
    if (this.searchFocused) {
      event.stopImmediatePropagation();
      // Keep native editing, composition and clipboard shortcuts, but never submit/navigate the menu.
      if (event.key === 'Enter') event.preventDefault();
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault();
        if (!event.repeat) { this.query = ''; this.blurSearch(); this.applyBrowse(); }
      }
      return;
    }
    if (event.key === '/' && this.active()) {
      event.preventDefault(); event.stopImmediatePropagation(); this.focusSearch(); return;
    }
    if (!['Escape', 'Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape') {
      if (event.repeat) return;
      if (this.confirming) this.cancelConfirmation();
      else if (this.query) { this.query = ''; this.applyBrowse(); }
      else this.hide();
      return;
    }
    if (event.repeat || !this.canInteract()) return;
    if (this.confirming) { if (event.key === 'Enter') this.confirmPurchase(); return; }
    if (event.key === 'Enter') { this.requestPurchase(); return; }
    if (this.focus === 'categories') {
      if (event.key === 'ArrowRight') { this.focus = 'cards'; this.renderNav(); return; }
      if (event.key === 'ArrowLeft') {
        this.expanded.delete(this.category); this.renderNav(); return;
      }
      const index = this.rows.findIndex(row => row.id === this.category);
      const next = Phaser.Math.Clamp(index + (event.key === 'ArrowDown' ? 1 : -1), 0, this.rows.length - 1);
      if (next !== index) this.chooseCategory(next);
    } else {
      const offers = this.visibleOffers(), index = offers.findIndex(entry => entry.id === this.selected);
      if (event.key === 'ArrowLeft' && index % 3 === 0) { this.focus = 'categories'; this.renderNav(); return; }
      const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowDown' ? 3 : -3;
      const next = Phaser.Math.Clamp(index + delta, 0, offers.length - 1);
      if (offers[next]) { this.select(offers[next].id); this.grid.reveal(Math.floor(next / 3) * ROW_STEP, Math.floor(next / 3) * ROW_STEP + CARD_H); }
    }
  };

  private fill(parent: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number): void {
    parent.add(this.scene.add.tileSprite(x, y, w, h, DAWN_MERCHANT_UI['panel-fill'].key).setOrigin(0));
  }
  private rule(parent: Phaser.GameObjects.Container, x: number, y: number, w: number, h: number, color = 0x8d7d58): void {
    parent.add(this.scene.add.rectangle(x, y, w, h, color, 0.8).setOrigin(0));
  }
  private label(parent: Phaser.GameObjects.Container, x: number, y: number, text: string, width: number, size: number): Phaser.GameObjects.Text {
    const label = this.scene.add.text(x, y, text, { ...textStyle('body'), color: PAPER, fontSize: size, lineSpacing: 5,
      wordWrap: { width, useAdvancedWrap: true } });
    parent.add(label); return label;
  }
  private icon(parent: Phaser.GameObjects.Container, x: number, y: number, key: string, w: number, h = w): Phaser.GameObjects.Image {
    const icon = this.scene.add.image(x, y, dawnMerchantArtTexture(key, Math.max(w, h))).setDisplaySize(w, h); parent.add(icon); return icon;
  }
  private button(parent: Phaser.GameObjects.Container, x: number, y: number, width: number, label: string, enabled: boolean, action: () => void): void {
    const part: DawnMerchantUiPart = enabled ? 'button-buy-normal' : 'button-buy-disabled';
    const face = addDawnMerchantSlice(this.scene, parent, part, x, y, width, 56);
    const text = this.label(parent, x + 14, y + 14, label, width - 28, 23).setAlign('center').setFixedSize(width - 28, 34);
    if (!enabled) { text.setAlpha(0.55); return; }
    let pressed = false;
    face.setInteractive({ useHandCursor: true });
    face.on('pointerdown', () => { pressed = true; });
    face.on('pointerover', () => face.setTexture(DAWN_MERCHANT_UI['button-buy-hover'].key));
    face.on('pointerout', () => { pressed = false; face.setTexture(DAWN_MERCHANT_UI['button-buy-normal'].key); });
    face.on('pointerup', () => {
      const activate = pressed && this.root?.visible && this.canInteract(); pressed = false;
      if (activate) action();
    });
  }
}
