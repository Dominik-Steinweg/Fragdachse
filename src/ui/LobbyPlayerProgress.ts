import * as Phaser from 'phaser';
import { DawnMerchantOverlay } from './DawnMerchantOverlay';
import { FOREST } from './UiSkin';
import { COLORS, DEPTH } from '../config';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID } from '../config/coopDefenseItems';
import { getLocale, t } from '../i18n';
import { getMapName } from '../i18n/contentPresentation';
import type { CoopDefenseProgressSnapshot } from '../utils/coopDefenseProgression';
import {
  createGradientTexture,
  ensureLivingBarTextures,
  LivingBarEffect,
  type LivingBarPalette,
} from './LivingBarEffect';
import { UiButton } from './UiButton';
import { UiTooltip, type UiTooltipLine as TooltipLine } from './UiTooltip';
import { DAWN_UNLOCK_AFTER_MAP_ID } from '../dawn/rules/DawnUnlock';
import { PERSISTENT_BASE_UNLOCK_AFTER_MAP_ID } from '../config/persistentBase';
import { ensureRoundedTexture } from './uiTextures';
import { textStyle } from './uiTheme';

import { LOBBY_CARD, LOBBY_PLAYER_CENTER, LOBBY_PLAYER_FOOTER } from './LobbyLayout';

const CONTENT_L = LOBBY_PLAYER_FOOTER.left;
const CONTENT_W = LOBBY_PLAYER_FOOTER.width;
const PANEL_CX = LOBBY_PLAYER_CENTER;
const COOP_BAND_BG_TOP = 798;
const COOP_LABEL_Y = 820;
const COOP_BAR_Y = 876;
const COOP_BAR_H = 12;
const COOP_BTN_Y = 926;
const COOP_BTN_W = (CONTENT_W - 36) / 4;
const COOP_BTN_H = 48;
const COOP_UPGRADE_BTN_X = CONTENT_L + COOP_BTN_W / 2;
const COOP_ITEMS_BTN_X = CONTENT_L + CONTENT_W - COOP_BTN_W / 2;
const COOP_BAR_TEX_KEY = '_lobby_player_coop_xpbar';

/** Personal progression presentation; no room or round authority. */
export class LobbyPlayerProgress {
  private merchant: DawnMerchantOverlay | null = null;
  private merchantBtn: UiButton | null = null;
  private merchantLayoutReady = false;
  private coopBand: Phaser.GameObjects.Container | null = null;
  private coopProgressLevelText: Phaser.GameObjects.Text | null = null;
  private coopProgressBarFill: Phaser.GameObjects.Image | null = null;
  private coopBarEffect: LivingBarEffect | null = null;
  private coopUpgradesBtn: UiButton | null = null;
  private coopBaseBtn: UiButton | null = null;
  private coopBaseUnlocked = false;
  private baseSignature = '';
  private coopItemsBtn: UiButton | null = null;
  private upgradeBtnEffect: LivingBarEffect | null = null;
  private itemsBtnEffect: LivingBarEffect | null = null;
  private lockTooltip: UiTooltip | null = null;
  private dawnUnlocked = false;
  private coopItemsUnlocked = false;
  private coopItemsSignature: string | null = null;
  private coopProgressAvailable = false;
  private coopUpgradesNeedAttention = false;
  private coopItemsNeedAttention = false;
  private coopProgressSignature: string | null = null;
  private visible = false;
  private isReady = false;
  private connectionEnded = false;
  constructor(private readonly scene: Phaser.Scene,
    private readonly onOpenCoopDefenseUpgrades: () => void,
    private readonly onOpenCoopDefenseItems: () => void,
    private readonly onOpenBase: () => void = () => {},
    private readonly onOpenMerchant: () => void = () => {}) {}
  openMerchant(): void { this.merchant?.show(); }
  isMerchantOpen(): boolean { return this.merchant?.isOpen() ?? false; }
  setVisible(visible: boolean): void { this.visible = visible; this.syncCoopEffectActivity(); }
  hideTooltip(): void { this.lockTooltip?.hide(); }
  setReady(ready: boolean, ended = false): void {
    this.hideTooltip();
    this.isReady = ready; this.connectionEnded = ended; this.updateCoopDefenseMenuButtons();
  }
  destroy(): void {
    this.merchant?.destroy(); this.merchantBtn?.destroy();
    this.upgradeBtnEffect?.destroy(); this.itemsBtnEffect?.destroy(); this.coopBarEffect?.destroy();
    this.lockTooltip?.destroy(); this.coopUpgradesBtn?.destroy(); this.coopItemsBtn?.destroy();
    this.coopBaseBtn?.destroy();
    this.coopBand?.destroy(true);
  }
  build(objects: Phaser.GameObjects.GameObject[]): void {
    this.merchant = new DawnMerchantOverlay(this.scene,
      () => this.coopProgressAvailable && !this.isReady && !this.connectionEnded);
    // Haendler, Basis und Items teilen sich das Sperrmuster: `disabled` plus Schloss und Hinweis.
    this.merchantBtn = new UiButton(this.scene, { skin: 'forest',
      x: COOP_ITEMS_BTN_X, y: COOP_BTN_Y, w: COOP_BTN_W, h: COOP_BTN_H,
      label: t('ui.dawn.merchant'), icon: 'lock', iconSize: 16, intent: 'neutral',
      onClick: () => { if (this.dawnUnlocked) this.onOpenMerchant(); },
    }).setVisible(false);
    this.merchantBtn.setEnabled(false);
    this.attachLockTooltip(this.merchantBtn, () => this.dawnUnlocked ? null : {
      title: t('ui.dawn.merchant').toUpperCase(),
      lines: this.victoryUnlockLines(DAWN_UNLOCK_AFTER_MAP_ID),
    });
    // Das Band gibt es nur bei voller Panelhoehe, deshalb die feste Obergrenze.
    const bandBottom = 966;
    const bandH = bandBottom - COOP_BAND_BG_TOP;
    const bandBg = this.scene.add.image(
      PANEL_CX, COOP_BAND_BG_TOP + bandH / 2,
      ensureRoundedTexture(this.scene, {
        key: `_lobby_forest_coop_panel_${LOBBY_CARD.contentWidth}x${Math.round(bandH)}`,
        w: LOBBY_CARD.contentWidth,
        h: bandH,
        radius: 16,
        topColor: FOREST.glass,
        bottomColor: FOREST.sunken,
        fillAlpha: 0.42,
        strokeColor: FOREST.border,
        strokeAlpha: 0.18,
        strokeWidth: 1,
        highlightAlpha: 0.025,
      }),
    ).setScrollFactor(0);

    const bandLabel = this.scene.add.text(CONTENT_L, COOP_LABEL_Y, t('ui.lobby.progress'),
      textStyle('section', { color: FOREST.muted })).setOrigin(0, 0.5).setScrollFactor(0);

    this.coopProgressLevelText = this.scene.add.text(CONTENT_L, COOP_LABEL_Y + 28, `${t('ui.lobby.level')} 1`,
      textStyle('numL', { color: FOREST.text })).setOrigin(0, 0.5).setScrollFactor(0);

    const barW = CONTENT_W;
    const barX = CONTENT_L;
    const barBg = this.scene.add.rectangle(PANEL_CX, COOP_BAR_Y, barW, COOP_BAR_H, FOREST.sunken, 0.95)
      .setStrokeStyle(1, COLORS.GREY_6)
      .setScrollFactor(0);

    ensureLivingBarTextures(this.scene);
    const coopBarPalette: LivingBarPalette = { dark: COLORS.GREEN_4, mid: COLORS.GREEN_2, light: COLORS.GREEN_1 };
    createGradientTexture(this.scene, COOP_BAR_TEX_KEY, coopBarPalette, barW, COOP_BAR_H);
    this.coopProgressBarFill = this.scene.add.image(barX, COOP_BAR_Y, COOP_BAR_TEX_KEY)
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    this.coopProgressBarFill.setCrop(0, 0, barW, COOP_BAR_H);

    this.coopUpgradesBtn = new UiButton(this.scene, { skin: 'forest',
      x: COOP_UPGRADE_BTN_X, y: COOP_BTN_Y, w: COOP_BTN_W, h: COOP_BTN_H,
      label: t('ui.lobby.upgrades'),
      intent: 'neutral',
      onClick: () => this.onOpenCoopDefenseUpgrades(),
    });

    // Items bleiben bis zum Sieg auf Map 10 gesperrt: `disabled` statt einer eigenen Farbe.
    this.coopItemsBtn = new UiButton(this.scene, { skin: 'forest',
      x: COOP_ITEMS_BTN_X, y: COOP_BTN_Y, w: COOP_BTN_W, h: COOP_BTN_H,
      label: t('ui.lobby.items'),
      intent: 'neutral',
      icon: 'lock',
      iconSize: 16,
      onClick: () => {
        if (!this.coopItemsUnlocked) return;
        this.onOpenCoopDefenseItems();
      },
    });
    this.coopItemsBtn.setEnabled(false);
    this.attachLockTooltip(this.coopItemsBtn, () => this.coopItemsUnlocked ? null : {
      title: 'ITEMS',
      lines: [
        ...this.victoryUnlockLines(COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID),
        { text: '', color: COLORS.GREY_5 },
        { text: t('ui.items.victoryDrops'), color: FOREST.muted },
      ],
    });

    this.coopBaseBtn = new UiButton(this.scene, { skin: 'forest',
      x: PANEL_CX, y: COOP_BTN_Y, w: COOP_BTN_W, h: COOP_BTN_H,
      label: t('ui.base.title'), icon: 'lock', iconSize: 16, intent: 'neutral',
      onClick: () => { if (this.coopBaseUnlocked) this.onOpenBase(); },
    });
    this.coopBaseBtn.setEnabled(false);
    this.attachLockTooltip(this.coopBaseBtn, () => this.baseLockContent());
    this.coopBand = this.scene.add.container(0, 0, [
      bandBg,
      bandLabel,
      this.coopProgressLevelText,
      barBg,
      this.coopProgressBarFill,
      this.coopUpgradesBtn.getRoot(),
      this.coopBaseBtn.getRoot(),
      this.coopItemsBtn.getRoot(),
      this.merchantBtn.getRoot(),
    ]).setScrollFactor(0).setVisible(false);
    objects.push(this.coopBand);

    // Living-Bar-Effekt auf dem Upgrade-Button: macht auf freie Punkte aufmerksam.
    this.upgradeBtnEffect = new LivingBarEffect(
      this.scene,
      this.coopUpgradesBtn.getEffectLayer(),
      -COOP_BTN_W / 2,
      -COOP_BTN_H / 2,
      COOP_BTN_W,
      COOP_BTN_H,
      { dark: COLORS.GOLD_3, mid: COLORS.GOLD_1, light: COLORS.GOLD_1 },
      {
        glowTarget: this.coopUpgradesBtn.getBackground(), scrollFactor: 0, intensity: 0.41,
        clipShape: { kind: 'roundedRect', ...this.coopUpgradesBtn.getEffectBounds() },
        startActive: false, variantKey: 'lobby-upgrades',
      },
    );

    this.itemsBtnEffect = new LivingBarEffect(
      this.scene,
      this.coopItemsBtn.getEffectLayer(),
      -COOP_BTN_W / 2,
      -COOP_BTN_H / 2,
      COOP_BTN_W,
      COOP_BTN_H,
      { dark: COLORS.GOLD_3, mid: COLORS.GOLD_1, light: COLORS.GOLD_1 },
      {
        glowTarget: this.coopItemsBtn.getBackground(), scrollFactor: 0, intensity: 0.41,
        clipShape: { kind: 'roundedRect', ...this.coopItemsBtn.getEffectBounds() },
        startActive: false, variantKey: 'lobby-items',
      },
    );

    this.coopBarEffect = new LivingBarEffect(
      this.scene,
      this.coopBand,
      barX,
      COOP_BAR_Y - COOP_BAR_H / 2,
      barW,
      COOP_BAR_H,
      coopBarPalette,
      { glowTarget: this.coopProgressBarFill, scrollFactor: 0, intensity: 1.2, startActive: false },
    );

    // Eine eigene Overlay-Ebene liegt auch ueber Systemleiste und aeusserem Kartenrahmen.
    // Die Lebensdauer bleibt beim Fortschrittsbereich; Sichtwechsel blenden den Hinweis aus.
    this.lockTooltip = new UiTooltip(this.scene, 360, undefined, undefined, 'forest');
    const tooltipRoot = this.lockTooltip.build().setDepth(DEPTH.OVERLAY + 2).setScrollFactor(0);
    promoteToClarityCamera(this.scene, tooltipRoot);
  }

  private baseLockContent(): { title: string; lines: TooltipLine[] } | null {
    const title = t('ui.base.title').toUpperCase();
    return this.coopBaseUnlocked ? null : { title, lines: this.victoryUnlockLines(PERSISTENT_BASE_UNLOCK_AFTER_MAP_ID) };
  }

  private victoryUnlockLines(mapId: string): TooltipLine[] {
    return [
      { text: t('ui.items.locked'), color: FOREST.text },
      { text: '', color: COLORS.GREY_5 },
      { text: t('ui.items.unlockByVictory'), color: FOREST.muted },
      { text: getMapName(mapId, getLocale()), color: COLORS.GOLD_2, bold: true },
    ];
  }

  /**
   * Gesperrte Buttons bleiben als Trefferflaeche erhalten (`UiButton.setEnabled`), deshalb kommen
   * Hover-Ereignisse an. `content` liefert `null`, sobald der Button nutzbar ist.
   */
  private attachLockTooltip(
    button: UiButton,
    content: () => { title: string; lines: TooltipLine[] } | null,
  ): void {
    const bg = button.getBackground();
    bg.on('pointerover', (pointer: Phaser.Input.Pointer) => {
      const shown = content();
      if (shown) this.lockTooltip?.show(shown.title, COLORS.GOLD_1, shown.lines, pointer);
    });
    bg.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (content()) this.lockTooltip?.move(pointer);
    });
    bg.on('pointerout', () => this.lockTooltip?.hide());
  }

  setCoopDefenseProgress(progress: CoopDefenseProgressSnapshot | null): void {
    if (!this.coopBand || !this.coopProgressLevelText) return;
    this.coopProgressAvailable = progress !== null;

    const signature = progress
      ? [
        progress.level,
        progress.levelProgressFraction,
        progress.availableUpgradePoints,
        progress.availableBossPoints,
        progress.earnedBossPoints,
      ].join('|')
      : 'none';
    if (signature === this.coopProgressSignature) {
      this.syncCoopEffectActivity();
      return;
    }
    this.coopProgressSignature = signature;

    if (!progress) {
      this.coopUpgradesNeedAttention = false;
      this.syncCoopEffectActivity();
      return;
    }

    this.coopProgressLevelText.setText(`${t('ui.lobby.level')} ${progress.level}`);

    const barW = CONTENT_W;
    const fillW = Math.max(0.001, barW * progress.levelProgressFraction);
    this.coopProgressBarFill?.setCrop(0, 0, fillW, COOP_BAR_H);
    this.coopBarEffect?.setFilledWidth(fillW);

    const freePoints = progress.availableUpgradePoints;
    const upgradesAvailable = freePoints > 0 || progress.availableBossPoints > 0;
    this.coopUpgradesBtn?.setIntent(upgradesAvailable ? 'attention' : 'neutral');

    this.coopUpgradesNeedAttention = upgradesAvailable;
    this.syncCoopEffectActivity();
  }

  setCoopDefenseItemsState(
    unlocked: boolean,
    pendingRewardCount: number,
    hasUnseenItems: boolean,
  ): void {
    if (!this.coopItemsBtn) return;

    const openCount = Math.max(0, Math.floor(pendingRewardCount));
    const signature = `${unlocked}|${openCount}|${hasUnseenItems}`;
    if (signature === this.coopItemsSignature) {
      this.syncCoopEffectActivity();
      return;
    }
    this.coopItemsSignature = signature;
    this.coopItemsUnlocked = unlocked;
    // Ein offener Sperr-Hinweis waere nach dem Freischalten falsch.
    this.hideTooltip();

    this.updateCoopDefenseMenuButtons();
    // Das Schloss traegt die Sperre; freigeschaltet braucht der Button kein Symbol mehr.
    this.coopItemsBtn.setIcon(unlocked ? null : 'lock');
    const needsAttention = unlocked && (openCount > 0 || hasUnseenItems);
    this.coopItemsBtn.setBadge(unlocked && openCount > 0 ? openCount : null);
    this.coopItemsBtn.setIntent(needsAttention ? 'attention' : 'neutral');
    this.coopItemsNeedAttention = needsAttention;
    this.syncCoopEffectActivity();
  }

  private syncCoopEffectActivity(): void {
    const visible = this.visible && this.coopProgressAvailable;
    this.merchantBtn?.setVisible(visible);
    if (visible && !this.merchantLayoutReady) {
      this.merchantLayoutReady = true;
      const buttons = [this.coopUpgradesBtn, this.coopBaseBtn, this.coopItemsBtn, this.merchantBtn];
      buttons.forEach((button, index) => button?.setPosition(CONTENT_L + CONTENT_W * (index + 0.5) / buttons.length, COOP_BTN_Y));
    }
    if (!this.coopProgressAvailable || this.isReady || this.connectionEnded) this.merchant?.hide();
    if (!visible) this.hideTooltip();
    if (this.coopBand && this.coopBand.visible !== visible) {
      this.coopBand.setVisible(visible);
    }
    if (visible) this.coopBarEffect?.start();
    else this.coopBarEffect?.stop();
    if (visible && this.coopUpgradesNeedAttention) this.upgradeBtnEffect?.start();
    else this.upgradeBtnEffect?.stop();
    if (visible && this.coopItemsNeedAttention) this.itemsBtnEffect?.start();
    else this.itemsBtnEffect?.stop();
  }

  setBaseState(unlocked: boolean, pending: number, isHost: boolean): void {
    const signature = `${unlocked}:${pending}:${isHost}`;
    if (signature === this.baseSignature) return;
    this.baseSignature = signature;
    this.coopBaseUnlocked = unlocked;
    this.hideTooltip();
    this.coopBaseBtn?.setIcon(unlocked ? null : 'lock');
    // Pending rewards are base-owned, so only the host gets the badge.
    this.coopBaseBtn?.setBadge(isHost && unlocked && pending > 0 ? pending : null);
    this.updateCoopDefenseMenuButtons();
  }

  /** The Bauhof is being prepared in the background: the button shows it, but stays usable. */
  setBasePreparing(preparing: boolean): void {
    this.coopBaseBtn?.setBusy(preparing && this.coopBaseUnlocked);
  }

  setDawnUnlocked(unlocked: boolean): void {
    if (unlocked === this.dawnUnlocked) return;
    this.dawnUnlocked = unlocked;
    this.hideTooltip();
    this.merchantBtn?.setIcon(unlocked ? null : 'lock');
    this.updateCoopDefenseMenuButtons();
  }

  private updateCoopDefenseMenuButtons(): void {
    const enabled = !this.isReady && !this.connectionEnded;
    this.merchantBtn?.setEnabled(enabled && this.dawnUnlocked);
    if (!enabled) this.merchant?.hide();
    this.coopBaseBtn?.setEnabled(enabled && this.coopBaseUnlocked);
    this.coopUpgradesBtn?.setEnabled(enabled);
    this.coopItemsBtn?.setEnabled(enabled && this.coopItemsUnlocked);
  }
}
