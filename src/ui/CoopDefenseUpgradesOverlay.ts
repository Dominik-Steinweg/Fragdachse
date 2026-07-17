import * as Phaser from 'phaser';
import {
  COLORS,
  DEPTH,
  GAME_HEIGHT,
  GAME_WIDTH,
  toCssColor,
} from '../config';
import type {
  CoopDefenseProgressSnapshot,
  CoopDefenseUpgradeCategorySnapshot,
  CoopDefenseUpgradeNodeSnapshot,
} from '../utils/coopDefenseProgression';
import {
  LivingBarEffect,
  createGradientTexture,
  ensureLivingBarTextures,
  paletteFromColor,
  rgbStr,
  type LivingBarPalette,
} from './LivingBarEffect';
import { addExternalGlow, removeExternalFx, type GlowHandle } from '../utils/phaserFx';
import { getCoopDefenseUpgradeTextureKey } from '../utils/coopDefenseUpgrades';
import { attachHoverEffect } from './uiHover';

// ── Canvas helpers for modern node textures ──────────────────────────────────

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 0xff, ag = (a >> 8) & 0xff, ab = a & 0xff;
  const br = (b >> 16) & 0xff, bg = (b >> 8) & 0xff, bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

const NODE_TEX_RADIUS = 12;
const XP_BAR_TEX_KEY = '_ccd_xpbar';

const PANEL_W = GAME_WIDTH - 120;
const PANEL_H = GAME_HEIGHT - 88;
const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;
const TITLE_Y = CY - PANEL_H / 2 + 38;
const SUBTITLE_Y = TITLE_Y + 32;
const BAR_W = PANEL_W - 140;
const BAR_H = 18;
const BAR_X = CX - BAR_W / 2;
const BAR_Y = SUBTITLE_Y + 48;
const PROGRESS_LABEL_Y = BAR_Y + 22;
const HEADER_DIVIDER_Y = PROGRESS_LABEL_Y + 30;
const HEADER_DIVIDER_W = 360;
const POINTS_Y = HEADER_DIVIDER_Y + 32;
const POINTS_CHIP_W = 520;
const POINTS_CHIP_H = 40;
const RESPEC_W = 180;
const RESPEC_H = 38;
// Untere Button-Leiste (Abbruch / Uebernehmen) + Hinweiszeile darunter.
const ACTION_BTN_W = 220;
const ACTION_BTN_H = 50;
const ACTION_BTN_GAP = 40;
const ACTION_BTN_Y = CY + PANEL_H / 2 - 60;
const FOOTER_Y = CY + PANEL_H / 2 - 22;

const TAB_TOP = POINTS_Y + 48;
const TAB_H = 36;
const TAB_GAP = 12;
const TAB_MAX_W = 240;

const CONTENT_TOP = TAB_TOP + TAB_H + 26;
const CONTENT_BOTTOM = ACTION_BTN_Y - ACTION_BTN_H / 2 - 16;
const CONTENT_W = PANEL_W - 80;
const CONTENT_X = CX - CONTENT_W / 2;
const CONTENT_H = CONTENT_BOTTOM - CONTENT_TOP;
const CONTENT_Y = CONTENT_TOP + CONTENT_H / 2;

const NODE_W = 48;
const NODE_H = 48;
const ICON_SIZE = 32;
const BOSS_FRAME_SIZE = 56;
const BOSS_BADGE_SIZE = 20;
const NODE_GAP_X = 18;
const NODE_GAP_Y = 26;
const ROW_GAP = 26;
const ITEM_LANE_GAP_X = 18;
const ITEM_LANE_PADDING_X = 6;
const ITEM_LANE_PADDING_Y = 8;
const NODE_INNER_PADDING = 2;
const NODE_LABEL_FONT_SIZE = 9;

const COLUMN_UNIT = NODE_W + NODE_GAP_X;
const ROW_UNIT = NODE_H + NODE_GAP_Y;

const TOOLTIP_OFFSET_X = 18;
const TOOLTIP_OFFSET_Y = 18;
const TOOLTIP_MAX_W = 320;
const TOOLTIP_PADDING = 12;

const BASE_UNLOCK_NODE_FILL = COLORS.GREY_5;
const BASE_UNLOCK_NODE_STROKE = COLORS.GREY_2;
const BASE_UNLOCK_NODE_ACTIVE = COLORS.GREY_1;

const DIM_COLOR = COLORS.GREY_10;
const DIM_ALPHA = 0.78;
const PANEL_BG = COLORS.GREY_7;
const PANEL_ALPHA = 0.96;
const ACCENT = COLORS.GOLD_1;

type CategoryVisuals = {
  laneFill: number;
  laneAlpha: number;
  divider: number;
  nodeBase: number;
  nodeStroke: number;
  nodeActive: number;
  title: number;
  connector: number;
};

type PlacedNode = {
  node: CoopDefenseUpgradeNodeSnapshot;
  x: number;
  y: number;
};

type PlacedItemLane = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CategoryTree = {
  roots: CoopDefenseUpgradeNodeSnapshot[];
  childrenByParentId: Map<string, CoopDefenseUpgradeNodeSnapshot[]>;
};

const CATEGORY_VISUALS: Record<CoopDefenseUpgradeCategorySnapshot['id'], CategoryVisuals> = {
  general: {
    laneFill: COLORS.GREEN_6,
    laneAlpha: 0.44,
    divider: COLORS.GREEN_3,
    nodeBase: COLORS.GREEN_5,
    nodeStroke: COLORS.GREEN_3,
    nodeActive: COLORS.GREEN_2,
    title: COLORS.GREEN_1,
    connector: COLORS.GREEN_2,
  },
  weapon1: {
    laneFill: COLORS.BLUE_5,
    laneAlpha: 0.48,
    divider: COLORS.BLUE_2,
    nodeBase: COLORS.BLUE_4,
    nodeStroke: COLORS.BLUE_2,
    nodeActive: COLORS.BLUE_1,
    title: COLORS.BLUE_1,
    connector: COLORS.BLUE_2,
  },
  weapon2: {
    laneFill: COLORS.BLUE_6,
    laneAlpha: 0.56,
    divider: COLORS.BLUE_3,
    nodeBase: COLORS.BLUE_5,
    nodeStroke: COLORS.BLUE_3,
    nodeActive: COLORS.BLUE_2,
    title: COLORS.BLUE_1,
    connector: COLORS.BLUE_3,
  },
  utility: {
    laneFill: COLORS.GOLD_6,
    laneAlpha: 0.48,
    divider: COLORS.GOLD_2,
    nodeBase: COLORS.GOLD_5,
    nodeStroke: COLORS.GOLD_2,
    nodeActive: COLORS.GOLD_1,
    title: COLORS.GOLD_1,
    connector: COLORS.GOLD_2,
  },
  ultimate: {
    laneFill: COLORS.RED_6,
    laneAlpha: 0.52,
    divider: COLORS.RED_2,
    nodeBase: COLORS.RED_5,
    nodeStroke: COLORS.RED_2,
    nodeActive: COLORS.RED_1,
    title: COLORS.RED_1,
    connector: COLORS.RED_2,
  },
};

export class CoopDefenseUpgradesOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private dimRect: Phaser.GameObjects.Rectangle | null = null;
  private levelText: Phaser.GameObjects.Text | null = null;
  private xpText: Phaser.GameObjects.Text | null = null;
  private pointsText: Phaser.GameObjects.Text | null = null;
  private pointsChip: Phaser.GameObjects.Image | null = null;
  private respecButton: Phaser.GameObjects.Image | null = null;
  private respecLabel: Phaser.GameObjects.Text | null = null;
  private respecEnabled = false;
  private progressFill: Phaser.GameObjects.Image | null = null;
  private xpBarEffect: LivingBarEffect | null = null;
  private progressLabelText: Phaser.GameObjects.Text | null = null;
  private contentBg: Phaser.GameObjects.Image | null = null;
  private tabsContainer: Phaser.GameObjects.Container | null = null;
  private upgradesContainer: Phaser.GameObjects.Container | null = null;
  private tooltipContainer: Phaser.GameObjects.Container | null = null;
  private tooltipBackground: Phaser.GameObjects.Rectangle | null = null;
  private tooltipTitleText: Phaser.GameObjects.Text | null = null;
  private tooltipDivider: Phaser.GameObjects.Rectangle | null = null;
  private tooltipBodyText: Phaser.GameObjects.Text | null = null;
  private visible = false;
  private activeCategoryIndex = 0;
  private dismissDelay: Phaser.Time.TimerEvent | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;

  // Per-render decoration tracking (must be torn down before each re-render).
  private nodeEffects: LivingBarEffect[] = [];
  private nodeGlows: Array<{ target: Phaser.GameObjects.GameObject; glow: GlowHandle }> = [];
  private decorationTweens: Phaser.Tweens.Tween[] = [];
  private tabGlows: Array<{ target: Phaser.GameObjects.GameObject; glow: GlowHandle }> = [];
  private tabTweens: Phaser.Tweens.Tween[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getProgress: () => CoopDefenseProgressSnapshot,
    private readonly onLevelUpUpgrade: (upgradeId: string) => boolean,
    private readonly onLevelDownUpgrade: (upgradeId: string) => boolean,
    private readonly onFullRespec: () => boolean,
    private readonly onCancel: () => void,
    private readonly onApply: () => void,
  ) {}

  build(): void {
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
    this.levelText = null;
    this.xpText = null;
    this.pointsText = null;
    this.pointsChip = null;
    this.respecButton = null;
    this.respecLabel = null;
    this.progressFill = null;
    this.progressLabelText = null;
    this.contentBg = null;
    this.tabsContainer = null;
    this.upgradesContainer = null;
    this.tooltipContainer = null;
    this.tooltipBackground = null;
    this.tooltipTitleText = null;
    this.tooltipDivider = null;
    this.tooltipBodyText = null;

    const objects: Phaser.GameObjects.GameObject[] = [];

    this.dimRect = this.scene.add.rectangle(CX, CY, GAME_WIDTH, GAME_HEIGHT, DIM_COLOR, DIM_ALPHA)
      .setScrollFactor(0);
    objects.push(this.dimRect);

    const panel = this.scene.add.image(CX, CY, this.ensurePanelTexture())
      .setScrollFactor(0)
      .setInteractive();
    objects.push(panel);

    // Untere Button-Leiste: Abbruch (verwirft) + Uebernehmen (bestaetigt).
    const cancelX = CX - ACTION_BTN_GAP / 2 - ACTION_BTN_W / 2;
    const applyX = CX + ACTION_BTN_GAP / 2 + ACTION_BTN_W / 2;

    const cancelBtn = this.scene.add.image(cancelX, ACTION_BTN_Y, this.ensureActionButtonTexture('cancel'))
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    const cancelLabel = this.scene.add.text(cancelX, ACTION_BTN_Y, 'ABBRUCH', {
      fontSize: '20px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
    }).setOrigin(0.5).setScrollFactor(0);
    cancelBtn.on('pointerdown', () => this.closeWithCancel());
    attachHoverEffect(this.scene, cancelBtn, cancelLabel);
    objects.push(cancelBtn);
    objects.push(cancelLabel);

    const applyBtn = this.scene.add.image(applyX, ACTION_BTN_Y, this.ensureActionButtonTexture('apply'))
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    const applyLabel = this.scene.add.text(applyX, ACTION_BTN_Y, 'ÜBERNEHMEN', {
      fontSize: '20px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_10),
    }).setOrigin(0.5).setScrollFactor(0);
    applyBtn.on('pointerdown', () => this.closeWithApply());
    attachHoverEffect(this.scene, applyBtn, applyLabel);
    objects.push(applyBtn);
    objects.push(applyLabel);

    objects.push(
      this.scene.add.text(CX, TITLE_Y, 'UPGRADES', {
        fontSize: '28px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(ACCENT),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    this.levelText = this.scene.add.text(CX, SUBTITLE_Y, 'Level 1', {
      fontSize: '22px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.levelText);

    this.xpText = this.scene.add.text(CX, SUBTITLE_Y + 28, '0 XP gesamt', {
      fontSize: '15px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_2),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.xpText);

    objects.push(
      this.scene.add.rectangle(CX, BAR_Y, BAR_W, BAR_H, COLORS.GREY_9, 0.95)
        .setStrokeStyle(1, COLORS.GREY_4)
        .setScrollFactor(0),
    );

    // Modern XP bar: gradient image cropped to fill width + living particle/glow effect.
    ensureLivingBarTextures(this.scene);
    // Knalligere, hellere XP-Leiste (kein gedecktes Gruen).
    const xpPalette: LivingBarPalette = {
      dark: COLORS.GREEN_4,
      mid: COLORS.GREEN_2,
      light: COLORS.GREEN_1,
    };
    createGradientTexture(this.scene, XP_BAR_TEX_KEY, xpPalette, BAR_W, BAR_H);
    this.progressFill = this.scene.add.image(BAR_X, BAR_Y, XP_BAR_TEX_KEY)
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    this.progressFill.setCrop(0, 0, BAR_W, BAR_H);
    objects.push(this.progressFill);

    this.progressLabelText = this.scene.add.text(CX, PROGRESS_LABEL_Y, '500 XP bis Level 26', {
      fontSize: '13px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_3),
    }).setOrigin(0.5, 0).setScrollFactor(0);
    objects.push(this.progressLabelText);

    // Schlichte Trennlinie zwischen Level-Fortschritt und Upgrade-Punkten.
    objects.push(
      this.scene.add.rectangle(CX, HEADER_DIVIDER_Y, HEADER_DIVIDER_W, 1, COLORS.GREY_5, 0.6)
        .setScrollFactor(0),
    );

    // Eingefasster, flacher "Status"-Chip fuer verfuegbare Upgrade-Punkte.
    // Bewusst matt/flach gehalten, damit er nicht wie ein drueckbarer Button wirkt.
    const pointsChipX = CX;
    this.pointsChip = this.scene.add.image(pointsChipX, POINTS_Y, this.ensurePointsChipTexture(true))
      .setScrollFactor(0);
    objects.push(this.pointsChip);

    this.pointsText = this.scene.add.text(pointsChipX, POINTS_Y, '0 Upgrade-Punkte verfuegbar', {
      fontSize: '17px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.BLUE_1),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.pointsText);

    // "Full Respec"-Button rechts, ungefaehr auf Hoehe der Punkte-Anzeige.
    const respecX = BAR_X + BAR_W - RESPEC_W / 2;
    this.respecButton = this.scene.add.image(respecX, POINTS_Y, this.ensureRespecButtonTexture())
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.respecButton.on('pointerdown', () => {
      if (!this.respecEnabled) return;
      if (this.onFullRespec()) this.refresh();
    });
    objects.push(this.respecButton);

    this.respecLabel = this.scene.add.text(respecX, POINTS_Y, 'FULL RESPEC', {
      fontSize: '14px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.RED_5),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.respecLabel);
    attachHoverEffect(this.scene, this.respecButton, this.respecLabel, { isEnabled: () => this.respecEnabled });

    this.tabsContainer = this.scene.add.container(0, 0).setScrollFactor(0);
    objects.push(this.tabsContainer);

    this.contentBg = this.scene.add.image(CX, CONTENT_Y, this.ensureContentBgTexture(COLORS.GREY_5))
      .setScrollFactor(0);
    objects.push(this.contentBg);

    this.upgradesContainer = this.scene.add.container(0, 0).setScrollFactor(0);
    objects.push(this.upgradesContainer);

    this.tooltipBackground = this.scene.add.rectangle(0, 0, 10, 10, COLORS.GREY_9, 0.97)
      .setOrigin(0, 0)
      .setStrokeStyle(1, ACCENT)
      .setVisible(false)
      .setScrollFactor(0);
    this.tooltipTitleText = this.scene.add.text(0, 0, '', {
      fontSize: '16px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(ACCENT), wordWrap: { width: TOOLTIP_MAX_W },
    }).setOrigin(0, 0).setVisible(false).setScrollFactor(0);
    this.tooltipDivider = this.scene.add.rectangle(0, 0, 10, 1, COLORS.GREY_4, 0.9)
      .setOrigin(0, 0)
      .setVisible(false)
      .setScrollFactor(0);
    this.tooltipBodyText = this.scene.add.text(0, 0, '', {
      fontSize: '14px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_1), wordWrap: { width: TOOLTIP_MAX_W },
    }).setOrigin(0, 0).setVisible(false).setScrollFactor(0);
    this.tooltipContainer = this.scene.add.container(0, 0, [
      this.tooltipBackground,
      this.tooltipTitleText,
      this.tooltipDivider,
      this.tooltipBodyText,
    ])
      .setDepth(DEPTH.OVERLAY + 2)
      .setVisible(false);
    objects.push(this.tooltipContainer);

    objects.push(
      this.scene.add.text(CX, FOOTER_Y, '[ Linksklick skillt | Rechtsklick nimmt zurueck]', {
        fontSize: '13px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    this.container = this.scene.add.container(0, 0, objects)
      .setDepth(DEPTH.OVERLAY + 1);
    this.container.setVisible(false);

    // Living breathing effect for the XP bar (particles confined to the fill region + glow).
    this.xpBarEffect = new LivingBarEffect(
      this.scene,
      this.container,
      BAR_X,
      BAR_Y - BAR_H / 2,
      BAR_W,
      BAR_H,
      xpPalette,
      { glowTarget: this.progressFill, scrollFactor: 0, intensity: 1.35 },
    );

    this.refresh();
  }

  refresh(): void {
    if (
      !this.levelText
      || !this.xpText
      || !this.pointsText
      || !this.progressFill
      || !this.progressLabelText
      || !this.upgradesContainer
      || !this.tabsContainer
    ) {
      return;
    }

    this.hideTooltip();

    const progress = this.getProgress();
    const levelXpSpan = Math.max(1, progress.nextLevelXp - progress.currentLevelStartXp);

    this.levelText.setText(`Level ${progress.level}`);
    this.xpText.setText(`${progress.totalXp} XP gesamt`);

    const hasPoints = progress.availableUpgradePoints > 0 || progress.availableBossPoints > 0;
    this.pointsText.setText(
      `${progress.availableUpgradePoints} Upgrade-Punkte  |  ★ ${progress.availableBossPoints}/${progress.earnedBossPoints} Boss-Punkte`,
    );
    this.pointsText.setColor(toCssColor(hasPoints ? COLORS.BLUE_1 : COLORS.GREY_4));
    this.pointsChip?.setTexture(this.ensurePointsChipTexture(hasPoints));

    // Respec nur moeglich, wenn irgendein zuruecknehmbares Upgrade ueber Startlevel ist.
    this.respecEnabled = progress.upgradeCategories.some((category) =>
      category.upgrades.some((upgrade) => upgrade.refundable && upgrade.level > upgrade.startingLevel),
    );
    if (this.respecButton) this.respecButton.setAlpha(this.respecEnabled ? 1 : 0.4);
    if (this.respecLabel) {
      this.respecLabel.setColor(toCssColor(this.respecEnabled ? COLORS.RED_1 : COLORS.RED_3));
    }
    const fillW = Math.max(0.001, BAR_W * progress.levelProgressFraction);
    this.progressFill.setCrop(0, 0, fillW, BAR_H);
    this.xpBarEffect?.setFilledWidth(fillW);
    const remainingXp = Math.max(0, levelXpSpan - progress.xpIntoLevel);
    this.progressLabelText.setText(`${remainingXp} XP bis Level ${progress.level + 1}`);

    const categoryCount = progress.upgradeCategories.length;
    if (categoryCount > 0) {
      this.activeCategoryIndex = Phaser.Math.Clamp(this.activeCategoryIndex, 0, categoryCount - 1);
    }

    this.renderTabs(progress);
    this.renderActiveCategory(progress);
  }

  show(): void {
    if (this.visible || !this.container) return;
    this.visible = true;
    this.xpBarEffect?.start();
    this.refresh();

    this.container.setVisible(true);
    this.container.setAlpha(0);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 150,
      ease: 'Sine.easeOut',
    });

    // Klick ausserhalb (auf den abdunkelnden Hintergrund) wird abgefangen, aber
    // schliesst NICHT mehr – Schliessen ausschliesslich ueber Abbruch/Uebernehmen.
    this.dimRect?.setInteractive();
  }

  /** Verwirft alle Aenderungen seit dem Oeffnen und schliesst. */
  private closeWithCancel(): void {
    if (!this.visible) return;
    this.onCancel();
    this.refresh();
    this.hide();
  }

  /** Uebernimmt die Aenderungen und schliesst. */
  private closeWithApply(): void {
    if (!this.visible) return;
    this.onApply();
    this.hide();
  }

  hide(): void {
    if (!this.visible || !this.container) return;
    this.visible = false;
    this.dismissDelay?.destroy();
    this.dismissDelay = null;
    this.dimRect?.disableInteractive().removeAllListeners();

    this.clearNodeDecorations();
    this.clearTabDecorations();
    this.xpBarEffect?.stop();

    this.scene.tweens.add({
      targets: this.container,
      alpha: 0,
      duration: 100,
      ease: 'Sine.easeIn',
      onComplete: () => this.container?.setVisible(false),
    });
  }

  toggle(): void {
    if (this.visible) this.hide();
    else this.show();
  }

  isOpen(): boolean {
    return this.visible;
  }

  destroy(): void {
    this.dismissDelay?.destroy();
    if (this.keyHandler) {
      this.scene.input.keyboard?.off('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.clearNodeDecorations();
    this.clearTabDecorations();
    this.xpBarEffect?.destroy();
    this.xpBarEffect = null;
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
    this.progressFill = null;
  }

  private setActiveCategory(index: number): void {
    if (index === this.activeCategoryIndex) return;
    this.activeCategoryIndex = index;
    this.hideTooltip();
    const progress = this.getProgress();
    this.renderTabs(progress);
    this.renderActiveCategory(progress);
  }

  private clearTabDecorations(): void {
    for (const tween of this.tabTweens) tween.destroy();
    this.tabTweens = [];
    for (const { target, glow } of this.tabGlows) {
      if (target.active) removeExternalFx(target, glow);
    }
    this.tabGlows = [];
  }

  private renderTabs(progress: CoopDefenseProgressSnapshot): void {
    if (!this.tabsContainer) return;
    this.clearTabDecorations();
    this.tabsContainer.removeAll(true);

    const categories = progress.upgradeCategories;
    if (categories.length === 0) return;

    const tabW = Math.min(TAB_MAX_W, (CONTENT_W - TAB_GAP * (categories.length - 1)) / categories.length);
    const totalW = tabW * categories.length + TAB_GAP * (categories.length - 1);
    const startX = CX - totalW / 2;

    categories.forEach((category, index) => {
      const visuals = CATEGORY_VISUALS[category.id];
      const isActive = index === this.activeCategoryIndex;
      const centerX = startX + tabW / 2 + index * (tabW + TAB_GAP);

      const tabTexKey = this.ensureTabTexture(tabW, visuals, isActive);
      const restAlpha = isActive ? 1 : 0.7;
      const bg = this.scene.add.image(centerX, TAB_TOP + TAB_H / 2, tabTexKey)
        .setScrollFactor(0)
        .setAlpha(restAlpha)
        .setInteractive({ useHandCursor: true });
      this.tabsContainer!.add(bg);

      if (isActive) {
        // Leichter, atmender Glow am aktiven Tab in Kategorie-Farbe.
        const glow = addExternalGlow(bg, visuals.connector, 0.7, 0, false, 0.1, 6);
        if (glow) {
          this.tabGlows.push({ target: bg, glow });
          this.tabTweens.push(this.scene.tweens.add({
            targets: glow,
            outerStrength: 1.7,
            duration: 1800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          }));
        }
      }

      const label = this.scene.add.text(centerX, TAB_TOP + TAB_H / 2, category.label, {
        fontSize: '15px',
        fontFamily: 'monospace',
        fontStyle: 'bold',
        // Aktiv: dunkler Text auf lebendiger Farbe (hoher Kontrast); passiv: hell.
        color: toCssColor(isActive ? COLORS.GREY_10 : COLORS.GREY_2),
      }).setOrigin(0.5).setScrollFactor(0);
      this.tabsContainer!.add(label);

      // Einheitlicher Hover-Effekt fuer alle Tabs (auch der aktive).
      attachHoverEffect(this.scene, bg, label);
      bg.on('pointerdown', () => this.setActiveCategory(index));
    });
  }

  private ensureTabTexture(tabW: number, visuals: CategoryVisuals, isActive: boolean): string {
    const w = Math.max(1, Math.round(tabW));
    // Lebendige Kategorie-Farbe (connector ist deutlich gesaettigter als nodeBase).
    const tabColor = visuals.connector;
    if (isActive) {
      return this.ensureRoundedTexture({
        key: `_ccdtab_${w}_${tabColor.toString(16)}_on`,
        w,
        h: TAB_H,
        radius: 10,
        topColor: lerpColor(tabColor, 0xffffff, 0.2),
        bottomColor: lerpColor(tabColor, 0x000000, 0.34),
        fillAlpha: 0.97,
        strokeColor: lerpColor(visuals.title, 0xffffff, 0.12),
        strokeAlpha: 0.95,
        strokeWidth: 2,
        highlightAlpha: 0.3,
      });
    }
    // Passiv: gedimmt, aber mit klar erkennbarer Kategorie-Farbe.
    return this.ensureRoundedTexture({
      key: `_ccdtab_${w}_${tabColor.toString(16)}_off`,
      w,
      h: TAB_H,
      radius: 10,
      topColor: lerpColor(COLORS.GREY_8, tabColor, 0.45),
      bottomColor: lerpColor(COLORS.GREY_9, tabColor, 0.32),
      fillAlpha: 0.9,
      strokeColor: lerpColor(COLORS.GREY_5, tabColor, 0.55),
      strokeAlpha: 0.75,
      strokeWidth: 1.5,
      highlightAlpha: 0.08,
    });
  }

  private clearNodeDecorations(): void {
    for (const tween of this.decorationTweens) tween.destroy();
    this.decorationTweens = [];
    for (const effect of this.nodeEffects) effect.destroy();
    this.nodeEffects = [];
    for (const { target, glow } of this.nodeGlows) {
      if (target.active) removeExternalFx(target, glow);
    }
    this.nodeGlows = [];
  }

  private renderActiveCategory(progress: CoopDefenseProgressSnapshot): void {
    if (!this.upgradesContainer) return;
    this.clearNodeDecorations();
    this.upgradesContainer.removeAll(true);

    const category = progress.upgradeCategories[this.activeCategoryIndex];
    if (!category) return;

    const visuals = CATEGORY_VISUALS[category.id];
    this.contentBg?.setTexture(this.ensureContentBgTexture(visuals.connector));
    const tree = this.buildCategoryTree(category.upgrades);
    const columnCache = new Map<string, number>();
    const depthCache = new Map<string, number>();

    const rows: { roots: CoopDefenseUpgradeNodeSnapshot[]; totalWidthPx: number; maxDepth: number }[] = [];
    let current = { roots: [] as CoopDefenseUpgradeNodeSnapshot[], totalWidthPx: 0, maxDepth: 1 };

    for (const root of tree.roots) {
      const cols = this.measureColumns(root.id, tree.childrenByParentId, columnCache);
      const treeWidthPx = cols * COLUMN_UNIT - NODE_GAP_X;
      const itemLaneWidthPx = treeWidthPx + ITEM_LANE_PADDING_X * 2;
      const nextWidthPx = current.totalWidthPx
        + (current.roots.length > 0 ? ITEM_LANE_GAP_X : 0)
        + itemLaneWidthPx;
      if (current.roots.length > 0 && nextWidthPx > CONTENT_W) {
        rows.push(current);
        current = { roots: [], totalWidthPx: 0, maxDepth: 1 };
      }
      if (current.roots.length > 0) current.totalWidthPx += ITEM_LANE_GAP_X;
      current.roots.push(root);
      current.totalWidthPx += itemLaneWidthPx;
      current.maxDepth = Math.max(current.maxDepth, this.measureDepth(root.id, tree.childrenByParentId, depthCache));
    }
    if (current.roots.length > 0) rows.push(current);

    const placed: PlacedNode[] = [];
    const placedById = new Map<string, PlacedNode>();
    const itemLanes: PlacedItemLane[] = [];

    let rowTopY = CONTENT_TOP + 12;
    for (const row of rows) {
      const rowLeftX = CONTENT_X + Math.max(0, (CONTENT_W - row.totalWidthPx) / 2);
      const itemLaneHeightPx = row.maxDepth * ROW_UNIT - NODE_GAP_Y + ITEM_LANE_PADDING_Y * 2;

      let itemCursorX = rowLeftX;
      for (const root of row.roots) {
        const cols = this.measureColumns(root.id, tree.childrenByParentId, columnCache);
        const treeWidthPx = cols * COLUMN_UNIT - NODE_GAP_X;
        const itemLaneWidthPx = treeWidthPx + ITEM_LANE_PADDING_X * 2;
        this.layoutSubtree({
          node: root,
          leftX: itemCursorX + ITEM_LANE_PADDING_X,
          rowTopY,
          tree,
          placed,
          placedById,
        });
        itemLanes.push({
          x: itemCursorX + itemLaneWidthPx / 2,
          y: rowTopY - ITEM_LANE_PADDING_Y + itemLaneHeightPx / 2,
          width: itemLaneWidthPx,
          height: itemLaneHeightPx,
        });
        itemCursorX += itemLaneWidthPx + ITEM_LANE_GAP_X;
      }

      rowTopY += row.maxDepth * ROW_UNIT + ROW_GAP;
    }

    this.repositionMergeNodes(placed, placedById, tree.childrenByParentId);
    this.renderItemLanes(itemLanes, visuals);
    this.renderConnections(placed, placedById, visuals);
    for (const placedNode of placed) {
      this.renderNode(placedNode, visuals);
    }
  }

  private renderItemLanes(lanes: readonly PlacedItemLane[], visuals: CategoryVisuals): void {
    if (!this.upgradesContainer || lanes.length === 0) return;

    const graphics = this.scene.add.graphics().setScrollFactor(0);
    for (const lane of lanes) {
      const left = lane.x - lane.width / 2;
      const top = lane.y - lane.height / 2;
      const radius = 14;

      // A soft, layered edge keeps each item group legible without turning the
      // upgrade tree into a grid of heavy cards.
      graphics.fillStyle(0x000000, 0.12);
      graphics.fillRoundedRect(left + 1, top + 2, lane.width - 2, lane.height, radius);
      graphics.fillStyle(visuals.divider, 0.06);
      graphics.fillRoundedRect(left, top, lane.width, lane.height, radius);
      graphics.fillStyle(visuals.laneFill, 0.17);
      graphics.fillRoundedRect(left + 1, top + 1, lane.width - 2, lane.height - 2, radius - 1);
      graphics.lineStyle(1, visuals.divider, 0.2);
      graphics.strokeRoundedRect(left + 0.5, top + 0.5, lane.width - 1, lane.height - 1, radius);
      graphics.lineStyle(1, 0xffffff, 0.035);
      graphics.strokeRoundedRect(left + 2, top + 2, lane.width - 4, lane.height - 4, radius - 2);
    }
    this.upgradesContainer.add(graphics);
  }

  private layoutSubtree(params: {
    node: CoopDefenseUpgradeNodeSnapshot;
    leftX: number;
    rowTopY: number;
    tree: CategoryTree;
    placed: PlacedNode[];
    placedById: Map<string, PlacedNode>;
  }): void {
    const { node, leftX, rowTopY, tree, placed, placedById } = params;
    const layers = this.collectSubtreeLayers(node, tree.childrenByParentId);
    const cols = Math.max(1, ...layers.map((layer) => layer.length));
    const subtreeWidthPx = cols * COLUMN_UNIT - NODE_GAP_X;

    for (let depthIndex = 0; depthIndex < layers.length; depthIndex += 1) {
      const layer = layers[depthIndex];
      const layerWidthPx = layer.length * COLUMN_UNIT - NODE_GAP_X;
      const layerLeftX = leftX + (subtreeWidthPx - layerWidthPx) / 2;
      const y = rowTopY + depthIndex * ROW_UNIT + NODE_H / 2;

      for (let index = 0; index < layer.length; index += 1) {
        const currentNode = layer[index];
        const x = layerLeftX + index * COLUMN_UNIT + NODE_W / 2;
        const placedNode: PlacedNode = { node: currentNode, x, y };
        placed.push(placedNode);
        placedById.set(currentNode.id, placedNode);
      }
    }
  }

  private collectSubtreeLayers(
    root: CoopDefenseUpgradeNodeSnapshot,
    childrenByParentId: ReadonlyMap<string, readonly CoopDefenseUpgradeNodeSnapshot[]>,
  ): CoopDefenseUpgradeNodeSnapshot[][] {
    const layers: CoopDefenseUpgradeNodeSnapshot[][] = [];
    let currentLayer: CoopDefenseUpgradeNodeSnapshot[] = [root];

    while (currentLayer.length > 0) {
      layers.push(currentLayer);
      currentLayer = currentLayer.flatMap((node) => childrenByParentId.get(node.id) ?? []);
    }

    return layers;
  }

  private buildCategoryTree(upgrades: readonly CoopDefenseUpgradeNodeSnapshot[]): CategoryTree {
    const childrenByParentId = new Map<string, CoopDefenseUpgradeNodeSnapshot[]>();
    const rootNodes: CoopDefenseUpgradeNodeSnapshot[] = [];

    for (const node of upgrades) {
      const primaryParentId = node.requires[0]?.upgradeId;
      if (!primaryParentId) {
        rootNodes.push(node);
        continue;
      }
      const siblings = childrenByParentId.get(primaryParentId) ?? [];
      siblings.push(node);
      childrenByParentId.set(primaryParentId, siblings);
    }

    const visited = new Set<string>();
    const markVisited = (node: CoopDefenseUpgradeNodeSnapshot): void => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      for (const child of childrenByParentId.get(node.id) ?? []) markVisited(child);
    };
    for (const root of rootNodes) markVisited(root);
    for (const node of upgrades) {
      if (!visited.has(node.id)) rootNodes.push(node);
    }

    return { roots: rootNodes, childrenByParentId };
  }

  private repositionMergeNodes(
    placed: readonly PlacedNode[],
    placedById: ReadonlyMap<string, PlacedNode>,
    childrenByParentId: ReadonlyMap<string, readonly CoopDefenseUpgradeNodeSnapshot[]>,
  ): void {
    for (const merge of placed) {
      if (merge.node.requires.length < 2) continue;

      const parentPositions = merge.node.requires
        .map((requirement) => placedById.get(requirement.upgradeId)?.x)
        .filter((x): x is number => x !== undefined)
        .sort((left, right) => left - right);
      if (parentPositions.length < 2) continue;

      merge.x = Phaser.Math.Average(parentPositions);

      const children = (childrenByParentId.get(merge.node.id) ?? [])
        .filter((child) => child.requires.length === 1)
        .map((child) => placedById.get(child.id))
        .filter((child): child is PlacedNode => child !== undefined);
      if (children.length === 0) continue;

      for (let index = 0; index < children.length; index += 1) {
        const position = children.length === 1
          ? parentPositions.length / 2
          : (index * (parentPositions.length - 1)) / (children.length - 1);
        const leftIndex = Math.floor(position);
        const rightIndex = Math.min(parentPositions.length - 1, Math.ceil(position));
        children[index].x = Phaser.Math.Linear(
          parentPositions[leftIndex],
          parentPositions[rightIndex],
          position - leftIndex,
        );
      }
    }
  }

  private measureColumns(
    nodeId: string,
    childrenByParentId: ReadonlyMap<string, CoopDefenseUpgradeNodeSnapshot[]>,
    cache: Map<string, number>,
  ): number {
    const cached = cache.get(nodeId);
    if (cached != null) return cached;

    let cols = 1;
    let currentLayerIds = [nodeId];
    while (currentLayerIds.length > 0) {
      cols = Math.max(cols, currentLayerIds.length);
      currentLayerIds = currentLayerIds.flatMap((id) => (
        (childrenByParentId.get(id) ?? []).map((child) => child.id)
      ));
    }
    cache.set(nodeId, cols);
    return cols;
  }

  private measureDepth(
    nodeId: string,
    childrenByParentId: ReadonlyMap<string, CoopDefenseUpgradeNodeSnapshot[]>,
    cache: Map<string, number>,
  ): number {
    const cached = cache.get(nodeId);
    if (cached != null) return cached;

    const children = childrenByParentId.get(nodeId) ?? [];
    const depth = children.length === 0
      ? 1
      : 1 + Math.max(...children.map((child) => this.measureDepth(child.id, childrenByParentId, cache)));
    cache.set(nodeId, depth);
    return depth;
  }

  private renderConnections(
    placed: readonly PlacedNode[],
    placedById: ReadonlyMap<string, PlacedNode>,
    visuals: CategoryVisuals,
  ): void {
    if (!this.upgradesContainer) return;

    const graphics = this.scene.add.graphics().setScrollFactor(0);
    this.upgradesContainer.add(graphics);

    for (const child of placed) {
      for (const requirement of child.node.requires) {
        const parent = placedById.get(requirement.upgradeId);
        if (!parent) continue;

        const startX = parent.x;
        const startY = parent.y + NODE_H / 2;
        const endX = child.x;
        const endY = child.y - NODE_H / 2;
        const midY = startY + Math.max(8, (endY - startY) * 0.5);

        const points: Array<{ x: number; y: number }> = [
          { x: startX, y: startY },
          { x: startX, y: midY },
          { x: endX, y: midY },
          { x: endX, y: endY },
        ];

        if (requirement.satisfied) {
          const connectorColor = child.node.bossPointCostPerLevel > 0
            ? (child.node.bossPointRequirementMet || child.node.level > 0 ? COLORS.GOLD_1 : COLORS.RED_2)
            : visuals.connector;
          // The path lights up as soon as its prerequisite is satisfied. The
          // energy dot only appears once both connected upgrades are active.
          graphics.lineStyle(4, connectorColor, 0.18);
          this.strokePolyline(graphics, points);
          graphics.lineStyle(2, connectorColor, 0.85);
          this.strokePolyline(graphics, points);
          if (parent.node.level > 0 && child.node.level > 0) {
            this.addFlowingDot(points, connectorColor);
          }
        } else {
          graphics.lineStyle(2, COLORS.GREY_5, 0.45);
          this.strokePolyline(graphics, points);
        }
      }
    }
  }

  private strokePolyline(
    graphics: Phaser.GameObjects.Graphics,
    points: ReadonlyArray<{ x: number; y: number }>,
  ): void {
    graphics.beginPath();
    graphics.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) graphics.lineTo(points[i].x, points[i].y);
    graphics.strokePath();
  }

  private addFlowingDot(
    points: ReadonlyArray<{ x: number; y: number }>,
    color: number,
  ): void {
    if (!this.upgradesContainer) return;

    const dot = this.scene.add.image(points[0].x, points[0].y, '_living_blob')
      .setScrollFactor(0)
      .setBlendMode(Phaser.BlendModes.ADD)
      .setTint(color)
      .setDisplaySize(14, 14)
      .setAlpha(0.9);
    this.upgradesContainer.add(dot);

    // Segment lengths drive proportional travel timing along the elbow.
    const segLengths: number[] = [];
    let total = 0;
    for (let i = 1; i < points.length; i += 1) {
      const len = Phaser.Math.Distance.Between(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
      segLengths.push(len);
      total += len;
    }
    const speed = 90; // px/sec
    const travelDuration = Math.max(400, (total / speed) * 1000);

    const tweens: Phaser.Types.Tweens.TweenBuilderConfig[] = [];
    for (let i = 1; i < points.length; i += 1) {
      const frac = total > 0 ? segLengths[i - 1] / total : 1 / (points.length - 1);
      tweens.push({
        targets: dot,
        x: points[i].x,
        y: points[i].y,
        duration: Math.max(60, travelDuration * frac),
        ease: 'Linear',
      });
    }

    const chain = this.scene.tweens.chain({
      targets: dot,
      loop: -1,
      loopDelay: 0,
      tweens,
      onLoop: () => dot.setPosition(points[0].x, points[0].y),
    });
    this.decorationTweens.push(chain as unknown as Phaser.Tweens.Tween);
  }

  private renderNode(placedNode: PlacedNode, visuals: CategoryVisuals): void {
    if (!this.upgradesContainer) return;

    const { node, x, y } = placedNode;
    // Knoten als eigenes Container-Element am Zentrum (x,y) -> alle Kinder in
    // lokalen Koordinaten, damit der Hover-Scale-Effekt sauber um die Mitte greift.
    const nodeGroup = this.scene.add.container(x, y).setScrollFactor(0);

    const isBaseUnlock = node.kind === 'unlock' && node.startingLevel > 0 && !node.refundable;
    const interactionEnabled = node.canLevelUp || node.canLevelDown;
    const isLocked = !node.unlocked && node.level <= 0;
    const isActive = node.level > 0;
    const isBossUpgrade = node.bossPointCostPerLevel > 0;
    const bossPointAvailable = node.bossPointRequirementMet || isActive;
    const bossAccentColor = bossPointAvailable ? COLORS.GOLD_1 : COLORS.RED_2;
    const progressFraction = node.maxLevel > 0
      ? Phaser.Math.Clamp(node.level / node.maxLevel, 0, 1)
      : 0;
    const nodeBaseColor = isBaseUnlock ? BASE_UNLOCK_NODE_FILL : visuals.nodeBase;
    const nodeStrokeColor = isBaseUnlock ? BASE_UNLOCK_NODE_STROKE : visuals.nodeStroke;
    const nodeActiveColor = isBaseUnlock ? BASE_UNLOCK_NODE_ACTIVE : visuals.nodeActive;
    const baseAlpha = isLocked ? 0.34 : isActive ? 1 : 0.82;

    const iconKey = this.getNodeTextureKey(node);
    const hasIcon = iconKey != null && this.scene.textures.exists(iconKey);

    // Boss-Punkt-Upgrades bilden den hochwertigen Abschluss eines Zweigs. Ein
    // eigener, etwas groesserer Rahmen hebt ihre Silhouette hervor, waehrend der
    // eigentliche Knoten seine Kategorie-Farbe und damit seine Zugehoerigkeit behaelt.
    let bossFrame: Phaser.GameObjects.Image | null = null;
    if (isBossUpgrade) {
      bossFrame = this.scene.add.image(
        0,
        0,
        this.ensureBossNodeFrameTexture(bossAccentColor, isActive),
      )
        .setScrollFactor(0)
        .setAlpha(isLocked ? 0.64 : isActive ? 1 : 0.88);
      nodeGroup.add(bossFrame);

      // Ein ruhiger Gold-Glow macht gekaufte Capstones eindeutig, ohne mit dem
      // farbigen Aktiv-Glow der Kategorie zu konkurrieren.
      if (isActive) {
        const bossGlow = addExternalGlow(bossFrame, COLORS.GOLD_1, 1.15, 0, false, 0.08, 8);
        if (bossGlow) {
          this.nodeGlows.push({ target: bossFrame, glow: bossGlow });
          this.decorationTweens.push(this.scene.tweens.add({
            targets: bossGlow,
            outerStrength: 2.25,
            duration: 2100,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          }));
        }
      }
    }

    // Modern glassy rounded-rect base (generated texture, glow-capable Image).
    const baseTexKey = this.ensureNodeBaseTexture(nodeBaseColor, nodeStrokeColor);
    const baseRect = this.scene.add.image(0, 0, baseTexKey)
      .setScrollFactor(0)
      .setAlpha(baseAlpha);
    nodeGroup.add(baseRect);

    // Fortschritts-Fuellung steigt von unten hoch und scheint hinter dem transparenten Icon durch.
    const innerW = NODE_W - NODE_INNER_PADDING * 2;
    const innerH = NODE_H - NODE_INNER_PADDING * 2;
    if (isActive) {
      const fillHeight = Math.max(1, innerH * progressFraction);
      const fillTexKey = this.ensureNodeFillTexture(nodeActiveColor);
      const activeFill = this.scene.add.image(0, NODE_H / 2 - NODE_INNER_PADDING, fillTexKey)
        .setOrigin(0.5, 1)
        .setScrollFactor(0)
        .setAlpha(0.62);
      // Crop the full-height fill texture to the filled (bottom) portion.
      activeFill.setCrop(0, innerH - fillHeight, innerW, fillHeight);
      nodeGroup.add(activeFill);

      // Basis-Freischaltungen (z.B. Glock, nicht ruecknehmbar) bleiben ruhig/statisch -
      // kein lebendiger Effekt, kein Leuchten.
      if (!isBaseUnlock) {
        // "Living" breathing effect on the upgrade-level fill (similar to the XP bar).
        const fillTopY = NODE_H / 2 - NODE_INNER_PADDING - fillHeight;
        const fillPalette = paletteFromColor(nodeActiveColor);
        const effect = new LivingBarEffect(
          this.scene,
          nodeGroup,
          -innerW / 2,
          fillTopY,
          innerW,
          fillHeight,
          fillPalette,
          { scrollFactor: 0, intensity: 0.32 },
        );
        effect.setFilledWidth(innerW);
        this.nodeEffects.push(effect);

        // Dezenter, animierter Aussen-Glow in Kategorie-Farbe fuer aktive Upgrades.
        const glow = addExternalGlow(baseRect, visuals.connector, 0.6, 0, false, 0.1, 7);
        if (glow) {
          this.nodeGlows.push({ target: baseRect, glow });
          const glowTween = this.scene.tweens.add({
            targets: glow,
            outerStrength: 1.8,
            duration: 1800,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
          this.decorationTweens.push(glowTween);
        }
      }
    }

    if (hasIcon && iconKey) {
      const icon = this.scene.add.image(0, 0, iconKey)
        .setDisplaySize(ICON_SIZE, ICON_SIZE)
        .setScrollFactor(0)
        .setAlpha(isLocked ? 0.4 : 1);
      nodeGroup.add(icon);
    } else {
      const fallback = this.scene.add.text(0, 0, node.label, {
        fontSize: `${NODE_LABEL_FONT_SIZE}px`,
        fontFamily: 'monospace',
        fontStyle: 'bold',
        color: toCssColor(isLocked ? COLORS.GREY_4 : COLORS.GREY_1),
        align: 'center',
        wordWrap: { width: NODE_W - 6, useAdvancedWrap: true },
      }).setOrigin(0.5).setScrollFactor(0);
      nodeGroup.add(fallback);
    }

    if (node.maxLevel > 1) {
      const levelText = this.scene.add.text(NODE_W / 2 - 2, NODE_H / 2 - 1, `${node.level}/${node.maxLevel}`, {
        fontSize: '11px',
        fontFamily: 'monospace',
        fontStyle: 'bold',
        color: toCssColor(isLocked ? COLORS.GREY_4 : COLORS.GREY_1),
      })
        .setOrigin(1, 1)
        .setScrollFactor(0)
        .setStroke(toCssColor(COLORS.GREY_10), 3);
      nodeGroup.add(levelText);
    }

    if (isBossUpgrade) {
      const badgeX = -NODE_W / 2 + 2;
      const badgeY = -NODE_H / 2 + 2;
      const badgeBase = this.scene.add.image(
        badgeX,
        badgeY,
        this.ensureBossBadgeTexture(bossAccentColor),
      ).setScrollFactor(0).setAlpha(isLocked ? 0.78 : 1);
      const bossBadge = this.scene.add.text(badgeX, badgeY - 0.5, '★', {
        fontSize: '12px',
        fontFamily: 'Arial, sans-serif',
        fontStyle: 'bold',
        color: toCssColor(COLORS.GREY_10),
      }).setOrigin(0.5).setScrollFactor(0);
      nodeGroup.add(badgeBase);
      nodeGroup.add(bossBadge);
    }

    const hitArea = this.scene.add.rectangle(0, 0, NODE_W, NODE_H, 0x000000, 0.001)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: interactionEnabled })
      .on('pointerover', (pointer: Phaser.Input.Pointer) => {
        baseRect.setAlpha(Math.min(1, baseAlpha + 0.12));
        // Einheitlicher Hover-Effekt: ganzer Knoten waechst leicht.
        this.scene.tweens.add({
          targets: nodeGroup, scaleX: 1.06, scaleY: 1.06, duration: 90, ease: 'Sine.easeOut',
        });
        this.showTooltip(node, pointer);
      })
      .on('pointermove', (pointer: Phaser.Input.Pointer) => this.updateTooltipPosition(pointer))
      .on('pointerout', () => {
        baseRect.setAlpha(baseAlpha);
        this.scene.tweens.add({
          targets: nodeGroup, scaleX: 1, scaleY: 1, duration: 120, ease: 'Sine.easeOut',
        });
        this.hideTooltip();
      })
      .on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handleUpgradePointerDown(node, pointer));
    nodeGroup.add(hitArea);

    this.upgradesContainer.add(nodeGroup);
  }

  private ensureNodeBaseTexture(fillColor: number, strokeColor: number): string {
    const key = `_ccdnode_${fillColor.toString(16)}_${strokeColor.toString(16)}`;
    if (this.scene.textures.exists(key)) return key;

    const w = NODE_W;
    const h = NODE_H;
    const ct = this.scene.textures.createCanvas(key, w, h);
    if (!ct) return key;
    const ctx = ct.context;
    ctx.clearRect(0, 0, w, h);

    const inset = 1.5;
    const top = lerpColor(fillColor, 0xffffff, 0.22);
    const bottom = lerpColor(fillColor, 0x000000, 0.42);

    roundRectPath(ctx, inset, inset, w - inset * 2, h - inset * 2, NODE_TEX_RADIUS);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, rgbStr(top));
    grad.addColorStop(1, rgbStr(bottom));
    ctx.fillStyle = grad;
    ctx.fill();

    // Glassy top highlight (clipped to the rounded shape).
    ctx.save();
    roundRectPath(ctx, inset, inset, w - inset * 2, h - inset * 2, NODE_TEX_RADIUS);
    ctx.clip();
    const hi = ctx.createLinearGradient(0, 0, 0, h * 0.55);
    hi.addColorStop(0, 'rgba(255,255,255,0.28)');
    hi.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = hi;
    ctx.fillRect(0, 0, w, h * 0.55);
    ctx.restore();

    roundRectPath(ctx, inset, inset, w - inset * 2, h - inset * 2, NODE_TEX_RADIUS);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgbStr(lerpColor(strokeColor, 0xffffff, 0.15));
    ctx.stroke();

    ct.refresh();
    return key;
  }

  private ensureBossNodeFrameTexture(accentColor: number, active: boolean): string {
    const state = active ? 'active' : 'idle';
    const key = `_ccdnode_boss_${accentColor.toString(16)}_${state}`;
    if (this.scene.textures.exists(key)) return key;

    const w = BOSS_FRAME_SIZE;
    const h = BOSS_FRAME_SIZE;
    const ct = this.scene.textures.createCanvas(key, w, h);
    if (!ct) return key;
    const ctx = ct.context;
    ctx.clearRect(0, 0, w, h);

    const inset = 2.5;
    const radius = NODE_TEX_RADIUS + 3;
    const strokeGradient = ctx.createLinearGradient(0, 0, 0, h);
    strokeGradient.addColorStop(0, rgbStr(lerpColor(accentColor, 0xffffff, 0.42), active ? 1 : 0.9));
    strokeGradient.addColorStop(0.48, rgbStr(accentColor, active ? 0.96 : 0.78));
    strokeGradient.addColorStop(1, rgbStr(lerpColor(accentColor, 0x000000, 0.38), active ? 0.92 : 0.68));

    // Warmer Schimmer im Spalt zwischen Sonderrahmen und Kategorie-Knoten.
    roundRectPath(ctx, inset, inset, w - inset * 2, h - inset * 2, radius);
    ctx.fillStyle = rgbStr(accentColor, active ? 0.2 : 0.11);
    ctx.fill();

    roundRectPath(ctx, inset, inset, w - inset * 2, h - inset * 2, radius);
    ctx.lineWidth = active ? 3 : 2.5;
    ctx.strokeStyle = strokeGradient;
    ctx.stroke();

    roundRectPath(ctx, inset + 3.5, inset + 3.5, w - (inset + 3.5) * 2, h - (inset + 3.5) * 2, radius - 3.5);
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgbStr(lerpColor(accentColor, 0xffffff, 0.35), active ? 0.58 : 0.36);
    ctx.stroke();

    // Kleine Mittelmarken geben dem Rahmen eine praegnante Capstone-Silhouette.
    ctx.fillStyle = rgbStr(lerpColor(accentColor, 0xffffff, 0.34), active ? 0.95 : 0.78);
    for (const [x, y] of [[w / 2, 1.5], [w - 1.5, h / 2], [w / 2, h - 1.5], [1.5, h / 2]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(-2.5, -2.5, 5, 5);
      ctx.restore();
    }

    ct.refresh();
    return key;
  }

  private ensureBossBadgeTexture(accentColor: number): string {
    const key = `_ccdnode_boss_badge_${accentColor.toString(16)}`;
    if (this.scene.textures.exists(key)) return key;

    const size = BOSS_BADGE_SIZE;
    const ct = this.scene.textures.createCanvas(key, size, size);
    if (!ct) return key;
    const ctx = ct.context;
    ctx.clearRect(0, 0, size, size);

    const center = size / 2;
    const radius = center - 1.5;
    const fill = ctx.createRadialGradient(center - 2, center - 3, 1, center, center, radius);
    fill.addColorStop(0, rgbStr(lerpColor(accentColor, 0xffffff, 0.28), 1));
    fill.addColorStop(0.58, rgbStr(accentColor, 1));
    fill.addColorStop(1, rgbStr(lerpColor(accentColor, 0x000000, 0.52), 1));
    ctx.beginPath();
    ctx.arc(center, center, radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgbStr(lerpColor(accentColor, 0xffffff, 0.58));
    ctx.stroke();

    ct.refresh();
    return key;
  }

  private ensureNodeFillTexture(color: number): string {
    const key = `_ccdfill_${color.toString(16)}`;
    if (this.scene.textures.exists(key)) return key;

    const w = NODE_W - NODE_INNER_PADDING * 2;
    const h = NODE_H - NODE_INNER_PADDING * 2;
    const ct = this.scene.textures.createCanvas(key, w, h);
    if (!ct) return key;
    const ctx = ct.context;
    ctx.clearRect(0, 0, w, h);

    const r = Math.max(2, NODE_TEX_RADIUS - NODE_INNER_PADDING);
    roundRectPath(ctx, 0, 0, w, h, r);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, rgbStr(lerpColor(color, 0xffffff, 0.18)));
    grad.addColorStop(1, rgbStr(lerpColor(color, 0x000000, 0.25)));
    ctx.fillStyle = grad;
    ctx.fill();

    ct.refresh();
    return key;
  }

  /** Generic glassy rounded-rect texture (shared by panel, content area and tabs). */
  private ensureRoundedTexture(params: {
    key: string;
    w: number;
    h: number;
    radius: number;
    topColor: number;
    bottomColor: number;
    fillAlpha: number;
    strokeColor: number;
    strokeAlpha: number;
    strokeWidth: number;
    highlightAlpha: number;
  }): string {
    if (this.scene.textures.exists(params.key)) return params.key;

    const w = Math.max(1, Math.round(params.w));
    const h = Math.max(1, Math.round(params.h));
    const ct = this.scene.textures.createCanvas(params.key, w, h);
    if (!ct) return params.key;
    const ctx = ct.context;
    ctx.clearRect(0, 0, w, h);

    const inset = Math.max(1, params.strokeWidth);
    const rectW = w - inset * 2;
    const rectH = h - inset * 2;

    roundRectPath(ctx, inset, inset, rectW, rectH, params.radius);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, rgbStr(params.topColor, params.fillAlpha));
    grad.addColorStop(1, rgbStr(params.bottomColor, params.fillAlpha));
    ctx.fillStyle = grad;
    ctx.fill();

    if (params.highlightAlpha > 0) {
      ctx.save();
      roundRectPath(ctx, inset, inset, rectW, rectH, params.radius);
      ctx.clip();
      const hi = ctx.createLinearGradient(0, 0, 0, h * 0.55);
      hi.addColorStop(0, `rgba(255,255,255,${params.highlightAlpha})`);
      hi.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = hi;
      ctx.fillRect(0, 0, w, h * 0.55);
      ctx.restore();
    }

    if (params.strokeAlpha > 0) {
      roundRectPath(ctx, inset, inset, rectW, rectH, params.radius);
      ctx.lineWidth = params.strokeWidth;
      ctx.strokeStyle = rgbStr(params.strokeColor, params.strokeAlpha);
      ctx.stroke();
    }

    ct.refresh();
    return params.key;
  }

  private ensurePanelTexture(): string {
    return this.ensureRoundedTexture({
      key: '_ccd_panel',
      w: PANEL_W,
      h: PANEL_H,
      radius: 22,
      topColor: lerpColor(PANEL_BG, 0xffffff, 0.07),
      bottomColor: lerpColor(PANEL_BG, 0x000000, 0.3),
      fillAlpha: PANEL_ALPHA,
      strokeColor: ACCENT,
      strokeAlpha: 0.5,
      strokeWidth: 2,
      highlightAlpha: 0.05,
    });
  }

  private ensureActionButtonTexture(kind: 'cancel' | 'apply'): string {
    if (kind === 'cancel') {
      return this.ensureRoundedTexture({
        key: '_ccd_cancel',
        w: ACTION_BTN_W,
        h: ACTION_BTN_H,
        radius: 12,
        topColor: lerpColor(COLORS.RED_3, 0xffffff, 0.16),
        bottomColor: lerpColor(COLORS.RED_4, 0x000000, 0.30),
        fillAlpha: 0.97,
        strokeColor: lerpColor(COLORS.RED_2, 0xffffff, 0.14),
        strokeAlpha: 0.92,
        strokeWidth: 2,
        highlightAlpha: 0.24,
      });
    }
    return this.ensureRoundedTexture({
      key: '_ccd_apply',
      w: ACTION_BTN_W,
      h: ACTION_BTN_H,
      radius: 12,
      topColor: lerpColor(COLORS.GREEN_3, 0xffffff, 0.18),
      bottomColor: lerpColor(COLORS.GREEN_4, 0x000000, 0.30),
      fillAlpha: 0.97,
      strokeColor: lerpColor(COLORS.GREEN_2, 0xffffff, 0.14),
      strokeAlpha: 0.92,
      strokeWidth: 2,
      highlightAlpha: 0.26,
    });
  }

  private ensurePointsChipTexture(active: boolean): string {
    // Flach, ohne Glanz-Highlight -> klar als Status-Anzeige (kein Button) lesbar.
    if (active) {
      return this.ensureRoundedTexture({
        key: '_ccd_points_on',
        w: POINTS_CHIP_W,
        h: POINTS_CHIP_H,
        radius: 10,
        topColor: lerpColor(COLORS.GREY_8, COLORS.BLUE_3, 0.30),
        bottomColor: lerpColor(COLORS.GREY_9, COLORS.BLUE_4, 0.16),
        fillAlpha: 0.55,
        strokeColor: lerpColor(COLORS.BLUE_2, COLORS.GREY_4, 0.25),
        strokeAlpha: 0.6,
        strokeWidth: 1.5,
        highlightAlpha: 0,
      });
    }
    return this.ensureRoundedTexture({
      key: '_ccd_points_off',
      w: POINTS_CHIP_W,
      h: POINTS_CHIP_H,
      radius: 10,
      topColor: COLORS.GREY_8,
      bottomColor: COLORS.GREY_9,
      fillAlpha: 0.45,
      strokeColor: COLORS.GREY_6,
      strokeAlpha: 0.5,
      strokeWidth: 1.5,
      highlightAlpha: 0,
    });
  }

  private ensureRespecButtonTexture(): string {
    return this.ensureRoundedTexture({
      key: '_ccd_respec',
      w: RESPEC_W,
      h: RESPEC_H,
      radius: 11,
      topColor: lerpColor(COLORS.RED_3, 0xffffff, 0.16),
      bottomColor: lerpColor(COLORS.RED_4, 0x000000, 0.30),
      fillAlpha: 0.97,
      strokeColor: lerpColor(COLORS.RED_2, 0xffffff, 0.12),
      strokeAlpha: 0.9,
      strokeWidth: 2,
      highlightAlpha: 0.24,
    });
  }

  private ensureContentBgTexture(color: number): string {
    const key = `_ccd_contentbg_${color.toString(16)}`;
    if (this.scene.textures.exists(key)) return key;

    const w = Math.max(1, Math.round(CONTENT_W));
    const h = Math.max(1, Math.round(CONTENT_H));
    const ct = this.scene.textures.createCanvas(key, w, h);
    if (!ct) return key;
    const ctx = ct.context;
    ctx.clearRect(0, 0, w, h);

    const radius = 16;
    const inset = 1.5;
    const rectW = w - inset * 2;
    const rectH = h - inset * 2;

    // Dunkler Grund, sanft in die Kategoriefarbe getoent.
    roundRectPath(ctx, inset, inset, rectW, rectH, radius);
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, rgbStr(lerpColor(COLORS.GREY_8, color, 0.22), 0.55));
    grad.addColorStop(1, rgbStr(lerpColor(COLORS.GREY_9, color, 0.08), 0.6));
    ctx.fillStyle = grad;
    ctx.fill();

    // Weicher radialer Schimmer oben fuer einen ansprechenderen Look.
    ctx.save();
    roundRectPath(ctx, inset, inset, rectW, rectH, radius);
    ctx.clip();
    const rad = ctx.createRadialGradient(w / 2, h * 0.02, 0, w / 2, h * 0.02, w * 0.62);
    rad.addColorStop(0, rgbStr(color, 0.16));
    rad.addColorStop(1, rgbStr(color, 0));
    ctx.fillStyle = rad;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();

    roundRectPath(ctx, inset, inset, rectW, rectH, radius);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgbStr(color, 0.4);
    ctx.stroke();

    ct.refresh();
    return key;
  }

  private handleUpgradePointerDown(node: CoopDefenseUpgradeNodeSnapshot, pointer: Phaser.Input.Pointer): void {
    if (pointer.rightButtonDown()) this.onLevelDownUpgrade(node.id);
    else this.onLevelUpUpgrade(node.id);
    this.refresh();
  }

  private getNodeTextureKey(node: CoopDefenseUpgradeNodeSnapshot): string | null {
    if (node.loadoutUnlock?.itemId) return node.loadoutUnlock.itemId;
    if (node.kind === 'upgrade') return getCoopDefenseUpgradeTextureKey(node.id);
    return null;
  }

  private showTooltip(node: CoopDefenseUpgradeNodeSnapshot, pointer: Phaser.Input.Pointer): void {
    if (
      !this.tooltipContainer
      || !this.tooltipBackground
      || !this.tooltipTitleText
      || !this.tooltipDivider
      || !this.tooltipBodyText
    ) return;

    this.tooltipTitleText.setText(node.label);
    this.tooltipBodyText.setText(this.buildTooltipBody(node));

    const contentWidth = Math.max(this.tooltipTitleText.width, this.tooltipBodyText.width);
    const width = contentWidth + TOOLTIP_PADDING * 2;

    const titleY = TOOLTIP_PADDING;
    const dividerY = titleY + this.tooltipTitleText.height + 6;
    const bodyY = dividerY + 7;
    const height = bodyY + this.tooltipBodyText.height + TOOLTIP_PADDING;

    this.tooltipBackground.setSize(width, height);
    this.tooltipTitleText.setPosition(TOOLTIP_PADDING, titleY);
    this.tooltipDivider.setPosition(TOOLTIP_PADDING, dividerY).setSize(contentWidth, 1);
    this.tooltipBodyText.setPosition(TOOLTIP_PADDING, bodyY);

    this.tooltipContainer.setVisible(true);
    this.tooltipBackground.setVisible(true);
    this.tooltipTitleText.setVisible(true);
    this.tooltipDivider.setVisible(true);
    this.tooltipBodyText.setVisible(true);
    this.updateTooltipPosition(pointer);
  }

  private updateTooltipPosition(pointer: Phaser.Input.Pointer): void {
    if (!this.tooltipContainer || !this.tooltipBackground) return;

    const width = this.tooltipBackground.width;
    const height = this.tooltipBackground.height;
    const x = Phaser.Math.Clamp(pointer.x + TOOLTIP_OFFSET_X, 12, GAME_WIDTH - width - 12);
    const y = Phaser.Math.Clamp(pointer.y + TOOLTIP_OFFSET_Y, 12, GAME_HEIGHT - height - 12);

    this.tooltipContainer.setPosition(x, y);
  }

  private hideTooltip(): void {
    this.tooltipContainer?.setVisible(false);
    this.tooltipBackground?.setVisible(false);
    this.tooltipTitleText?.setVisible(false);
    this.tooltipDivider?.setVisible(false);
    this.tooltipBodyText?.setVisible(false);
  }

  private buildTooltipBody(node: CoopDefenseUpgradeNodeSnapshot): string {
    const lines = [`Stufe ${node.level}/${node.maxLevel}`];

    if (node.kind === 'unlock' && node.startingLevel > 0 && !node.refundable) {
      lines.push('Basis-Freischaltung');
    } else if (!node.refundable) {
      lines.push('Nicht ruecknehmbar');
    }

    if (node.bossPointCostPerLevel > 0) lines.push('★ Besonderes Upgrade');
    lines.push(node.description);
    if (node.bossPointCostPerLevel > 0) {
      lines.push(`★ Boss-Kosten: ${node.bossPointCostPerLevel} Punkt`);
      if (!node.bossPointRequirementMet && node.level < node.maxLevel) {
        lines.push('Boss-Punkt fehlt: Boss-Level erfolgreich abschliessen.');
      }
    }
    return lines.join('\n');
  }
}
