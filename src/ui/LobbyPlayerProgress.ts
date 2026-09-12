import * as Phaser from 'phaser';
import { COLORS } from '../config';
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
import { UiTooltip } from './UiTooltip';
import { ensureRoundedTexture } from './uiTextures';
import { textStyle } from './uiTheme';

import { LOBBY_CARD, LOBBY_PLAYER_CENTER, LOBBY_PLAYER_CONTENT_LEFT } from './LobbyLayout';

const CONTENT_L = LOBBY_PLAYER_CONTENT_LEFT;
const CONTENT_W = LOBBY_CARD.contentWidth;
const PANEL_CX = LOBBY_PLAYER_CENTER;
const COOP_BAND_BG_TOP = 802;
const COOP_LABEL_Y = 820;
const COOP_BAR_Y = 876;
const COOP_BAR_H = 12;
const COOP_BTN_Y = 926;
const COOP_BTN_W = (CONTENT_W - 20) / 2;
const COOP_BTN_H = 48;
const COOP_UPGRADE_BTN_X = CONTENT_L + COOP_BTN_W / 2;
const COOP_ITEMS_BTN_X = CONTENT_L + CONTENT_W - COOP_BTN_W / 2;
const COOP_BAR_TEX_KEY = '_lobby_player_coop_xpbar';

/** Personal progression presentation; no room or round authority. */
export class LobbyPlayerProgress {
  private coopBand: Phaser.GameObjects.Container | null = null;
  private coopProgressLevelText: Phaser.GameObjects.Text | null = null;
  private coopProgressBarFill: Phaser.GameObjects.Image | null = null;
  private coopBarEffect: LivingBarEffect | null = null;
  private coopUpgradesBtn: UiButton | null = null;
  private coopItemsBtn: UiButton | null = null;
  private upgradeBtnEffect: LivingBarEffect | null = null;
  private itemsBtnEffect: LivingBarEffect | null = null;
  private itemsTooltip: UiTooltip | null = null;
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
    private readonly onOpenCoopDefenseItems: () => void) {}
  setVisible(visible: boolean): void { this.visible = visible; this.syncCoopEffectActivity(); }
  setReady(ready: boolean, ended = false): void {
    this.isReady = ready; this.connectionEnded = ended; this.updateCoopDefenseMenuButtons();
  }
  destroy(): void {
    this.upgradeBtnEffect?.destroy(); this.itemsBtnEffect?.destroy(); this.coopBarEffect?.destroy();
    this.itemsTooltip?.destroy(); this.coopUpgradesBtn?.destroy(); this.coopItemsBtn?.destroy();
    this.coopBand?.destroy(true);
  }
  build(objects: Phaser.GameObjects.GameObject[]): void {
    // Das Band gibt es nur bei voller Panelhoehe, deshalb die feste Obergrenze.
    const bandBottom = 956;
    const bandH = bandBottom - COOP_BAND_BG_TOP;
    const bandBg = this.scene.add.image(
      PANEL_CX, COOP_BAND_BG_TOP + bandH / 2,
      ensureRoundedTexture(this.scene, {
        key: `_lobby_coop_panel_polished_${Math.round(CONTENT_W)}x${Math.round(bandH)}`,
        w: CONTENT_W,
        h: bandH,
        radius: 16,
        topColor: COLORS.GREY_7,
        bottomColor: COLORS.GREY_8,
        fillAlpha: 0.42,
        strokeColor: COLORS.GREY_5,
        strokeAlpha: 0.18,
        strokeWidth: 1,
        highlightAlpha: 0.025,
      }),
    ).setScrollFactor(0);

    const bandLabel = this.scene.add.text(CONTENT_L, COOP_LABEL_Y, t('ui.lobby.progress'),
      textStyle('section', { color: COLORS.GREY_3 })).setOrigin(0, 0.5).setScrollFactor(0);

    this.coopProgressLevelText = this.scene.add.text(CONTENT_L, COOP_LABEL_Y + 28, t('ui.lobby.level', { level: 1 }),
      textStyle('numL', { color: COLORS.GREY_1 })).setOrigin(0, 0.5).setScrollFactor(0);

    const barW = CONTENT_W;
    const barX = CONTENT_L;
    const barBg = this.scene.add.rectangle(PANEL_CX, COOP_BAR_Y, barW, COOP_BAR_H, COLORS.GREY_9, 0.95)
      .setStrokeStyle(1, COLORS.GREY_6)
      .setScrollFactor(0);

    ensureLivingBarTextures(this.scene);
    const coopBarPalette: LivingBarPalette = { dark: COLORS.GREEN_4, mid: COLORS.GREEN_2, light: COLORS.GREEN_1 };
    createGradientTexture(this.scene, COOP_BAR_TEX_KEY, coopBarPalette, barW, COOP_BAR_H);
    this.coopProgressBarFill = this.scene.add.image(barX, COOP_BAR_Y, COOP_BAR_TEX_KEY)
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    this.coopProgressBarFill.setCrop(0, 0, barW, COOP_BAR_H);

    this.coopUpgradesBtn = new UiButton(this.scene, {
      x: COOP_UPGRADE_BTN_X, y: COOP_BTN_Y, w: COOP_BTN_W, h: COOP_BTN_H,
      label: t('ui.lobby.upgrades'),
      intent: 'neutral',
      onClick: () => this.onOpenCoopDefenseUpgrades(),
    });

    // Items bleiben bis zum Sieg auf Map 10 gesperrt: `disabled` statt einer eigenen Farbe.
    this.coopItemsBtn = new UiButton(this.scene, {
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
    this.attachItemsLockTooltip();

    this.coopBand = this.scene.add.container(0, 0, [
      bandBg,
      bandLabel,
      this.coopProgressLevelText,
      barBg,
      this.coopProgressBarFill,
      this.coopUpgradesBtn.getRoot(),
      this.coopItemsBtn.getRoot(),
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

    // Zuletzt eingehaengt, damit der Tooltip ueber Buttons und Feld-Images liegt.
    this.itemsTooltip = new UiTooltip(this.scene, 360);
    this.coopBand.add(this.itemsTooltip.build());
  }

  private attachItemsLockTooltip(): void {
    const bg = this.coopItemsBtn?.getBackground();
    if (!bg) return;
    // Der Button ist im gesperrten Zustand nicht interaktiv; die Trefferflaeche muss deshalb
    // eigens gesetzt werden, sonst gaebe es kein pointerover fuer den Hinweis.
    bg.setInteractive({ useHandCursor: false });
    bg.on('pointerover', (pointer: Phaser.Input.Pointer) => {
      if (this.coopItemsUnlocked) return;
      this.itemsTooltip?.show(
        'ITEMS',
        COLORS.GOLD_1,
        [
          { text: t('ui.items.locked'), color: COLORS.GREY_1 },
          { text: '', color: COLORS.GREY_5 },
          { text: t('ui.items.unlockByVictory'), color: COLORS.GREY_3 },
          {
            text: getMapName(COOP_DEFENSE_ITEMS_UNLOCK_AFTER_MAP_ID, getLocale()),
            color: COLORS.GOLD_2,
            bold: true,
          },
          { text: '', color: COLORS.GREY_5 },
          { text: t('ui.items.victoryDrops'), color: COLORS.GREY_3 },
        ],
        pointer,
      );
    });
    bg.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.coopItemsUnlocked) return;
      this.itemsTooltip?.move(pointer);
    });
    bg.on('pointerout', () => this.itemsTooltip?.hide());
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
    this.itemsTooltip?.hide();

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

  private updateCoopDefenseMenuButtons(): void {
    const enabled = !this.isReady && !this.connectionEnded;
    this.coopUpgradesBtn?.setEnabled(enabled);
    this.coopItemsBtn?.setEnabled(enabled && this.coopItemsUnlocked);
  }
}
