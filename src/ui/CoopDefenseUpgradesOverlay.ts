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
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { addExternalGlow, removeExternalFx, type GlowHandle } from '../utils/phaserFx';
import {
  getCoopDefenseUpgradeTextureKey,
  hasCoopDefenseDedicatedUpgradeIcon,
  isCoopDefenseToolCategory,
  type CoopDefenseUpgradeCategoryId,
} from '../utils/coopDefenseUpgrades';
import { attachHoverEffect } from './uiHover';
import { UiTooltip, type UiTooltipLine } from './UiTooltip';
import { UiContextMenu, type UiContextMenuEntry } from './UiContextMenu';
import { BORDER, INTENT, SURFACE, TEXT, textStyle, FONT_MONO } from './uiTheme';
import {
  COOP_DEFENSE_CLASS_DEFINITIONS,
  COOP_DEFENSE_CLASS_IDS,
} from '../config/coopDefenseClasses';
import type { CoopDefenseClassId, LoadoutSlot, LoadoutToolRef } from '../types';
import {
  describeLoadoutItem,
  describeLoadoutTool,
  loadoutToolKey,
  type LoadoutItemPresentation,
} from '../loadout/LoadoutCatalog';
import {
  LoadoutSlotPicker,
  type LoadoutPickerEntry,
  type LoadoutPickerGroup,
} from './LoadoutSlotPicker';
import { createLoadoutSlotControl } from './LoadoutSlotControl';
import { getClassDescription, getClassName, getClassRole, getClassTooltipLines } from '../i18n/contentPresentation';
import { getLocale, t } from '../i18n';
import { getUpgradeCategoryName, getUpgradeDescriptionSegments } from '../i18n/upgradePresentation';

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
const TREE_BACKGROUND_TEX_KEY = '_ccd_tree_background';

const PANEL_W = GAME_WIDTH - 120;
const PANEL_H = GAME_HEIGHT - 88;
const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;
const TITLE_Y = CY - PANEL_H / 2 + 38;
const SUBTITLE_Y = TITLE_Y + 32;
const BAR_W = PANEL_W - 140;
const BAR_H = 18;
const BAR_X = CX - BAR_W / 2;
const BAR_Y = SUBTITLE_Y + 36;
const HEADER_DIVIDER_Y = BAR_Y + 26;
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
// Die feste Steuerungshinweiszeile bleibt unter jedem Upgrade-Tooltip lesbar.
const TOOLTIP_BOTTOM = FOOTER_Y - 16;

const CLASS_ROW_Y = POINTS_Y + 62;
const CLASS_BUTTON_W = 250;
const CLASS_BUTTON_H = 52;
const CLASS_BUTTON_GAP = 20;
// Loadout-Block: Jede Kategorie bekommt eine Spaltenkarte, die Slot und Tab zusammenfasst.
// Deshalb liegt die Kartenoberkante ueber der Slot-Zeile und die Unterkante unter den Tabs.
const LOADOUT_LABEL_Y = CLASS_ROW_Y + 42;
const LOADOUT_CARD_TOP = CLASS_ROW_Y + 56;
const LOADOUT_SLOT_SIZE = 56;
const LOADOUT_SLOT_GAP = 8;
const LOADOUT_ROW_Y = LOADOUT_CARD_TOP + 12 + LOADOUT_SLOT_SIZE / 2;
const LOADOUT_CARD_RADIUS = 12;
const TAB_TOP = LOADOUT_ROW_Y + LOADOUT_SLOT_SIZE / 2 + 14;
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

const TOOLTIP_MAX_W = 320;

const BASE_UNLOCK_NODE_FILL = COLORS.GREY_5;
const BASE_UNLOCK_NODE_STROKE = COLORS.GREY_2;
const BASE_UNLOCK_NODE_ACTIVE = COLORS.GREY_1;

const DIM_COLOR = COLORS.GREY_10;
const DIM_ALPHA = 0.78;
const PANEL_BG = SURFACE.modal;
const PANEL_ALPHA = 0.96;
const PANEL_BORDER = BORDER.default;

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

type RespecAction = 'category' | 'class' | 'full';

type PlacedNode = {
  node: CoopDefenseUpgradeNodeSnapshot;
  x: number;
  y: number;
};

/**
 * Eigene Farbe je Klasse: Rot fuer den Schadensausteiler, Blau fuer den Panzer, Gold fuer den
 * Ingenieur – letzteres passt zu seinen goldenen Utility-Slots.
 */
const CLASS_ACCENT_COLORS: Record<CoopDefenseClassId, number> = {
  dachs_nukem: COLORS.RED_2,
  dachs_of_steel: COLORS.BLUE_2,
  inspector_gadachs: COLORS.GOLD_2,
};

type LoadoutSlotParams = {
  centerX: number;
  accentColor: number;
  presentation: LoadoutItemPresentation | null;
  tooltipTitle: string;
  tooltipBody: () => string;
  onOpenPicker: (anchorX: number) => void;
};

/** Eine Kategorie-Spalte des Loadout-Blocks: Karte plus die darin liegenden Slots. */
type LoadoutColumn = {
  centerX: number;
  width: number;
  accentColor: number;
  active: boolean;
  slots: LoadoutSlotParams[];
};

/** Was ein Node im Baum ins Loadout uebernehmen kann. */
type NodeEquipTarget =
  | { kind: 'tool'; tool: LoadoutToolRef }
  | { kind: 'slot'; slot: LoadoutSlot; itemId: string };

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
  // Konstruktion teilt sich die Slots mit Utility und bleibt deshalb in derselben
  // Goldfamilie, nur eine Stufe dunkler abgesetzt.
  construction: {
    laneFill: COLORS.BROWN_5,
    laneAlpha: 0.5,
    divider: COLORS.GOLD_3,
    nodeBase: COLORS.BROWN_4,
    nodeStroke: COLORS.GOLD_3,
    nodeActive: COLORS.GOLD_2,
    title: COLORS.GOLD_1,
    connector: COLORS.GOLD_3,
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
  private pointsText: Phaser.GameObjects.Text | null = null;
  private pointsChip: Phaser.GameObjects.Image | null = null;
  private respecButton: Phaser.GameObjects.Image | null = null;
  private respecLabel: Phaser.GameObjects.Text | null = null;
  private respecEnabled = false;
  private respecMenu: UiContextMenu | null = null;
  private pendingRespecAction: RespecAction | null = null;
  private categoryRespecEnabled = false;
  private classRespecEnabled = false;
  private fullRespecEnabled = false;
  private progressFill: Phaser.GameObjects.Image | null = null;
  private xpBarEffect: LivingBarEffect | null = null;
  private contentBg: Phaser.GameObjects.Image | null = null;
  private tabsContainer: Phaser.GameObjects.Container | null = null;
  private classContainer: Phaser.GameObjects.Container | null = null;
  private loadoutContainer: Phaser.GameObjects.Container | null = null;
  private loadoutHintText: Phaser.GameObjects.Text | null = null;
  private loadoutHintTimer: Phaser.Time.TimerEvent | null = null;
  private picker: LoadoutSlotPicker | null = null;
  private treeBackgroundContainer: Phaser.GameObjects.Container | null = null;
  private treeBackground: Phaser.GameObjects.Image | null = null;
  private treeBackgroundSignature: string | null = null;
  private upgradesContainer: Phaser.GameObjects.Container | null = null;
  private tooltip: UiTooltip | null = null;
  private visible = false;
  private activeCategoryIndex = 0;
  private dismissDelay: Phaser.Time.TimerEvent | null = null;
  private keyHandler: ((event: KeyboardEvent) => void) | null = null;

  // Per-render decoration tracking (must be torn down before each re-render).
  private nodeEffects: LivingBarEffect[] = [];
  private refreshPending = false;
  private nodeGlows: Array<{ target: Phaser.GameObjects.GameObject; glow: GlowHandle }> = [];
  private decorationTweens: Phaser.Tweens.Tween[] = [];
  private tabGlows: Array<{ target: Phaser.GameObjects.GameObject; glow: GlowHandle }> = [];
  private tabTweens: Phaser.Tweens.Tween[] = [];
  private classGlows: Array<{ target: Phaser.GameObjects.GameObject; glow: GlowHandle }> = [];
  private classTweens: Phaser.Tweens.Tween[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getProgress: () => CoopDefenseProgressSnapshot,
    private readonly onLevelUpUpgrade: (upgradeId: string) => boolean,
    private readonly onLevelDownUpgrade: (upgradeId: string) => boolean,
    private readonly onCategoryRespec: (categoryId: CoopDefenseUpgradeCategoryId) => boolean,
    private readonly onClassRespec: () => boolean,
    private readonly canFullRespec: () => boolean,
    private readonly onFullRespec: () => boolean,
    private readonly onSelectClass: (classId: CoopDefenseClassId) => void,
    private readonly onToggleLoadoutTool: (tool: LoadoutToolRef) => boolean,
    private readonly onSetLoadoutTools: (tools: readonly LoadoutToolRef[]) => boolean,
    private readonly getLoadoutSelection: () => Record<LoadoutSlot, string | null>,
    private readonly onSelectLoadoutItem: (slot: LoadoutSlot, itemId: string) => boolean,
    private readonly onCancel: () => void,
    private readonly onApply: () => void,
  ) {}

  build(): void {
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
    this.levelText = null;
    this.pointsText = null;
    this.pointsChip = null;
    this.respecButton = null;
    this.respecLabel = null;
    this.respecMenu = null;
    this.pendingRespecAction = null;
    this.progressFill = null;
    this.contentBg = null;
    this.tabsContainer = null;
    this.classContainer = null;
    this.loadoutContainer = null;
    this.loadoutHintText = null;
    this.treeBackgroundContainer = null;
    this.treeBackground = null;
    this.treeBackgroundSignature = null;
    this.upgradesContainer = null;
    this.tooltip = null;

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
    const cancelLabel = this.scene.add.text(cancelX, ACTION_BTN_Y, t('ui.upgrades.cancel'), textStyle('label', {
      color: INTENT.neutral.label,
    })).setOrigin(0.5).setScrollFactor(0);
    cancelBtn.on('pointerdown', () => this.closeWithCancel());
    attachHoverEffect(this.scene, cancelBtn, cancelLabel);
    objects.push(cancelBtn);
    objects.push(cancelLabel);

    const applyBtn = this.scene.add.image(applyX, ACTION_BTN_Y, this.ensureActionButtonTexture('apply'))
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    const applyLabel = this.scene.add.text(applyX, ACTION_BTN_Y, t('ui.upgrades.apply'), textStyle('label', {
      color: INTENT.primary.label,
    })).setOrigin(0.5).setScrollFactor(0);
    applyBtn.on('pointerdown', () => this.closeWithApply());
    attachHoverEffect(this.scene, applyBtn, applyLabel);
    objects.push(applyBtn);
    objects.push(applyLabel);

    objects.push(
      this.scene.add.text(CX, TITLE_Y, t('ui.upgrades.title'), textStyle('display'))
        .setOrigin(0.5).setScrollFactor(0),
    );

    // Level und XP-Balken tragen ihre Zahlen im Mouse-over, damit der Kopfbereich schmal bleibt.
    this.levelText = this.scene.add.text(CX, SUBTITLE_Y, t('ui.upgrades.levelTitle', { level: 1 }), {
      fontSize: '22px', fontFamily: FONT_MONO, fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
    }).setOrigin(0.5).setScrollFactor(0);
    this.attachInfoTooltip(
      this.levelText,
      () => `Level ${this.getProgress().level}`,
      () => t('ui.upgrades.xpTotal', { xp: this.getProgress().totalXp }),
    );
    objects.push(this.levelText);

    const barBackground = this.scene.add.rectangle(CX, BAR_Y, BAR_W, BAR_H, COLORS.GREY_9, 0.95)
      .setStrokeStyle(1, COLORS.GREY_4)
      .setScrollFactor(0);
    this.attachInfoTooltip(
      barBackground,
      () => t('ui.upgrades.levelProgress'),
      () => {
        const progress = this.getProgress();
        const remaining = Math.max(0, progress.nextLevelXp - progress.totalXp);
        return t('ui.upgrades.xpToNext', { xp: remaining, level: progress.level + 1 });
      },
    );
    objects.push(barBackground);

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

    this.pointsText = this.scene.add.text(pointsChipX, POINTS_Y, t('ui.upgrades.points', { points: 0 }), {
      fontSize: '17px', fontFamily: FONT_MONO, fontStyle: 'bold', color: toCssColor(COLORS.BLUE_1),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.pointsText);

    // Ein einzelner Respec-Button oeffnet das Auswahlmenue fuer Kategorie/Klasse/Full.
    const respecX = BAR_X + BAR_W - RESPEC_W / 2;
    this.respecButton = this.scene.add.image(respecX, POINTS_Y, this.ensureRespecButtonTexture())
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: true });
    this.respecButton.on('pointerdown', (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
      this.openRespecMenu(respecX - 230, POINTS_Y + RESPEC_H / 2 + 8);
    });
    objects.push(this.respecButton);
    this.respecLabel = this.scene.add.text(respecX, POINTS_Y, t('ui.upgrades.respec'), {
      fontSize: '15px', fontFamily: FONT_MONO, fontStyle: 'bold', color: toCssColor(COLORS.RED_5),
    })
      .setOrigin(0.5).setScrollFactor(0);
    objects.push(this.respecLabel);
    attachHoverEffect(this.scene, this.respecButton, this.respecLabel, {
      isEnabled: () => this.respecEnabled,
    });

    this.classContainer = this.scene.add.container(0, 0).setScrollFactor(0);
    objects.push(this.classContainer);

    this.loadoutContainer = this.scene.add.container(0, 0).setScrollFactor(0);
    objects.push(this.loadoutContainer);

    this.tabsContainer = this.scene.add.container(0, 0).setScrollFactor(0);
    objects.push(this.tabsContainer);

    this.contentBg = this.scene.add.image(CX, CONTENT_Y, this.ensureContentBgTexture(COLORS.GREY_5))
      .setScrollFactor(0);
    objects.push(this.contentBg);

    // Statische Lanes und Connectoren liegen getrennt von den dynamischen Nodes. Der
    // Hintergrund kann dadurch als ein einziges gebackenes Bild bestehen bleiben, wenn
    // nur Punkte, Texte oder Effekte aktualisiert werden.
    this.treeBackgroundContainer = this.scene.add.container(0, 0).setScrollFactor(0);
    objects.push(this.treeBackgroundContainer);

    this.upgradesContainer = this.scene.add.container(0, 0).setScrollFactor(0);
    objects.push(this.upgradesContainer);

    this.tooltip = new UiTooltip(this.scene, TOOLTIP_MAX_W, TEXT.primary, TOOLTIP_BOTTOM);
    objects.push(
      this.tooltip.build()
        // Ueber dem Auswahl-Popup (OVERLAY + 2), damit Slot-Erklaerungen sichtbar bleiben.
        .setDepth(DEPTH.OVERLAY + 3),
    );

    objects.push(
      this.scene.add.text(CX, FOOTER_Y, t('ui.upgrades.controlsHint'), textStyle('caption'))
        .setOrigin(0.5).setScrollFactor(0),
    );

    this.container = this.scene.add.container(0, 0, objects)
      .setDepth(DEPTH.OVERLAY + 1);
    this.container.setVisible(false);
    promoteToClarityCamera(this.scene, this.container);
    this.picker = new LoadoutSlotPicker(this.scene, this.container, DEPTH.OVERLAY + 2);
    this.respecMenu = new UiContextMenu(this.scene, this.container);

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
      || !this.pointsText
      || !this.progressFill
      || !this.upgradesContainer
      || !this.tabsContainer
      || !this.classContainer
      || !this.loadoutContainer
    ) {
      return;
    }

    this.hideTooltip();
    this.picker?.close();
    this.closeRespecMenu();

    const progress = this.getProgress();

    this.levelText.setText(t('ui.upgrades.levelTitle', { level: progress.level }));

    const hasPoints = progress.availableUpgradePoints > 0 || progress.availableBossPoints > 0;
    this.pointsText.setText(
      t('ui.upgrades.pointsSummary', {
        upgradePoints: progress.availableUpgradePoints,
        bossPoints: progress.availableBossPoints,
        earnedBossPoints: progress.earnedBossPoints,
      }),
    );
    this.pointsText.setColor(toCssColor(hasPoints ? COLORS.BLUE_1 : COLORS.GREY_4));
    this.pointsChip?.setTexture(this.ensurePointsChipTexture(hasPoints));

    const fillW = Math.max(0.001, BAR_W * progress.levelProgressFraction);
    this.progressFill.setCrop(0, 0, fillW, BAR_H);
    this.xpBarEffect?.setFilledWidth(fillW);

    const categoryCount = progress.upgradeCategories.length;
    if (categoryCount > 0) {
      this.activeCategoryIndex = Phaser.Math.Clamp(this.activeCategoryIndex, 0, categoryCount - 1);
    }
    this.updateRespecButtons(progress);

    this.renderClasses(progress.classId, progress.unlockedClassIds);
    this.renderLoadoutRow(progress);
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
    this.picker?.close();
    this.closeRespecMenu();
    this.dimRect?.disableInteractive().removeAllListeners();

    this.clearNodeDecorations();
    this.clearTabDecorations();
    this.clearClassDecorations();
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
    this.loadoutHintTimer?.destroy();
    this.loadoutHintTimer = null;
    this.picker?.close();
    this.picker = null;
    this.closeRespecMenu();
    this.respecMenu = null;
    if (this.keyHandler) {
      this.scene.input.keyboard?.off('keydown', this.keyHandler);
      this.keyHandler = null;
    }
    this.clearNodeDecorations();
    this.clearTabDecorations();
    this.clearClassDecorations();
    this.xpBarEffect?.destroy();
    this.xpBarEffect = null;
    this.tooltip?.destroy();
    this.tooltip = null;
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
    this.progressFill = null;
    this.treeBackgroundContainer = null;
    this.treeBackground = null;
    this.treeBackgroundSignature = null;
  }

  /**
   * Haengt ein reines Erklaer-Mouse-over an ein sonst nicht anklickbares Element. Titel und
   * Text werden erst beim Ueberfahren erzeugt, damit sie immer den aktuellen Stand zeigen.
   */
  private attachInfoTooltip(
    target: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text,
    title: () => string,
    body: () => string,
  ): void {
    target.setInteractive()
      .on('pointerover', (pointer: Phaser.Input.Pointer) => this.showTooltip(title(), body(), pointer))
      .on('pointermove', (pointer: Phaser.Input.Pointer) => this.updateTooltipPosition(pointer))
      .on('pointerout', () => this.hideTooltip());
  }

  private updateRespecButtons(progress: CoopDefenseProgressSnapshot): void {
    const activeCategory = progress.upgradeCategories[this.activeCategoryIndex];
    this.categoryRespecEnabled = activeCategory?.upgrades.some((upgrade) => (
      upgrade.level > upgrade.startingLevel
    )) ?? false;
    this.classRespecEnabled = progress.classesUnlocked && progress.upgradeCategories.some((category) => (
      category.upgrades.some((upgrade) => upgrade.level > upgrade.startingLevel)
    ));
    this.fullRespecEnabled = this.canFullRespec();
    this.respecEnabled = this.categoryRespecEnabled || this.classRespecEnabled || this.fullRespecEnabled;
    this.respecButton?.setAlpha(this.respecEnabled ? 1 : 0.4);
    this.respecLabel?.setColor(toCssColor(this.respecEnabled ? COLORS.RED_1 : COLORS.RED_3));
  }

  private openRespecMenu(x: number, y: number): void {
    if (!this.respecMenu) return;

    const progress = this.getProgress();
    const activeCategory = progress.upgradeCategories[this.activeCategoryIndex];
    const actions: Array<{
      action: RespecAction;
      label: string;
      color: number;
      enabled: boolean;
    }> = [
      {
        action: 'category',
        label: t('ui.upgrades.categoryRespec').toUpperCase(),
        color: COLORS.RED_2,
        enabled: this.categoryRespecEnabled,
      },
    ];
    if (progress.classesUnlocked) {
      actions.push({
        action: 'class',
        label: t('ui.upgrades.classRespec').toUpperCase(),
        color: COLORS.RED_2,
        enabled: this.classRespecEnabled,
      });
    }
    actions.push({
      action: 'full',
      label: t('ui.upgrades.fullRespec').toUpperCase(),
      color: COLORS.RED_1,
      enabled: this.fullRespecEnabled,
    });

    const entries: UiContextMenuEntry[] = actions.map((entry) => {
      const confirming = this.pendingRespecAction === entry.action;
      return {
        label: confirming ? t('ui.upgrades.confirm', { action: entry.label }) : entry.label,
        color: confirming ? COLORS.RED_1 : entry.color,
        enabled: entry.enabled,
        keepOpen: entry.enabled && !confirming,
        onPick: () => {
          if (!entry.enabled) return;
          if (!confirming) {
            // Erster Klick fragt nach; erst der zweite fuehrt den Respec aus.
            this.pendingRespecAction = entry.action;
            this.openRespecMenu(x, y);
            return;
          }
          this.pendingRespecAction = null;
          this.executeRespec(entry.action);
        },
      };
    });

    this.respecMenu.open({
      x,
      y,
      title: activeCategory
        ? t('ui.upgrades.respecTitle', { category: activeCategory.label })
        : t('ui.upgrades.respec'),
      titleColor: TEXT.primary,
      entries,
      onClose: () => {
        this.pendingRespecAction = null;
      },
    });
  }

  private executeRespec(action: RespecAction): void {
    if (action === 'category') {
      const category = this.getProgress().upgradeCategories[this.activeCategoryIndex];
      if (category) this.onCategoryRespec(category.id);
    } else if (action === 'class') {
      this.onClassRespec();
    } else {
      this.onFullRespec();
    }
    // ArenaScene owns the mutation and schedules the single coalesced refresh.
    // Do not enqueue another refresh from the overlay callback.
  }

  private closeRespecMenu(): void {
    this.respecMenu?.close();
    this.pendingRespecAction = null;
  }

  private setActiveCategory(index: number): void {
    if (index === this.activeCategoryIndex) return;
    this.activeCategoryIndex = index;
    this.hideTooltip();
    this.picker?.close();
    this.closeRespecMenu();
    const progress = this.getProgress();
    this.updateRespecButtons(progress);
    // Die Spaltenkarte der offenen Kategorie tritt hervor und muss deshalb mitziehen.
    this.renderLoadoutRow(progress);
    this.renderTabs(progress);
    this.renderActiveCategory(progress);
  }

  private clearClassDecorations(): void {
    for (const tween of this.classTweens) tween.destroy();
    this.classTweens = [];
    for (const { target, glow } of this.classGlows) {
      if (target.active) removeExternalFx(target, glow);
    }
    this.classGlows = [];
  }

  /**
   * Die Klassenwahl ist die folgenreichste Entscheidung im Overlay und wird deshalb wie ein
   * Kartensatz gezeichnet: eigene Klassenfarbe, Rolle als zweite Zeile und ein atmender Glow
   * auf der gewaehlten Karte – dieselbe Formsprache wie Kategorie-Tabs und Loadout-Karten.
   */
  private renderClasses(activeClassId: CoopDefenseClassId, unlockedClassIds: readonly CoopDefenseClassId[]): void {
    if (!this.classContainer) return;
    this.clearClassDecorations();
    this.classContainer.removeAll(true);

    const totalWidth = COOP_DEFENSE_CLASS_IDS.length * CLASS_BUTTON_W
      + (COOP_DEFENSE_CLASS_IDS.length - 1) * CLASS_BUTTON_GAP;
    const startX = CX - totalWidth / 2;

    COOP_DEFENSE_CLASS_IDS.forEach((classId, index) => {
      const definition = COOP_DEFENSE_CLASS_DEFINITIONS[classId];
      const locale = getLocale();
      const className = getClassName(classId, locale);
      const classRole = getClassRole(classId, locale);
      const classDescription = getClassDescription(classId, locale);
      const classTooltipLines = getClassTooltipLines(classId, locale);
      const classUnlocked = unlockedClassIds.includes(classId);
      const classesUnlocked = classUnlocked;
      const accentColor = classUnlocked ? CLASS_ACCENT_COLORS[classId] : COLORS.GREY_5;
      const active = classUnlocked && classId === activeClassId;
      const centerX = startX + CLASS_BUTTON_W / 2 + index * (CLASS_BUTTON_W + CLASS_BUTTON_GAP);

      const background = this.scene.add.image(centerX, CLASS_ROW_Y, this.ensureClassButtonTexture(accentColor, active))
        .setScrollFactor(0)
        .setAlpha(classUnlocked ? (active ? 1 : 0.82) : 0.48)
        .setInteractive({ useHandCursor: classUnlocked });

      // Aktiv: dunkler Text auf lebendiger Klassenfarbe; passiv: heller Text auf gedimmtem Grund.
      const name = this.scene.add.text(0, -10, className, {
        fontSize: '17px',
        fontFamily: FONT_MONO,
        fontStyle: 'bold',
        color: toCssColor(active ? COLORS.GREY_10 : (classUnlocked ? COLORS.GREY_1 : COLORS.GREY_4)),
      }).setOrigin(0.5).setScrollFactor(0);
      const role = this.scene.add.text(0, 12, classesUnlocked ? classRole.toUpperCase() : `🔒 ${t('ui.common.locked')}`, {
        fontSize: '11px',
        fontFamily: FONT_MONO,
        fontStyle: 'bold',
        color: toCssColor(active
          ? COLORS.GREY_9
          : (classesUnlocked ? lerpColor(COLORS.GREY_3, accentColor, 0.5) : COLORS.GREY_5)),
      }).setOrigin(0.5).setScrollFactor(0);
      const labels = this.scene.add.container(centerX, CLASS_ROW_Y, [name, role]).setScrollFactor(0);

      if (active) {
        const glow = addExternalGlow(background, accentColor, 1, 0, false, 0.1, 8);
        if (glow) {
          this.classGlows.push({ target: background, glow });
          this.classTweens.push(this.scene.tweens.add({
            targets: glow,
            outerStrength: 2.2,
            duration: 2000,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          }));
        }
      }

      if (classUnlocked) attachHoverEffect(this.scene, background, labels);
      background.on('pointerdown', () => {
        if (!classUnlocked) return;
        if (classId === this.getProgress().classId) return;
        this.activeCategoryIndex = 0;
        // ArenaScene.refreshStoredCoopDefenseProgress() refreshes the visible overlay
        // synchronously after changing the class. Do not enqueue a second full tree rebuild.
        this.onSelectClass(classId);
      });
      background.on('pointerover', (pointer: Phaser.Input.Pointer) => {
        this.showTooltip(
          className,
          classUnlocked
            ? [classRole, '', classDescription, ...classTooltipLines].join('\n')
            : t('ui.upgrades.unlockAfterMap', { map: definition.unlockAfterMapId }),
          pointer,
        );
      });
      background.on('pointermove', (pointer: Phaser.Input.Pointer) => this.updateTooltipPosition(pointer));
      background.on('pointerout', () => this.hideTooltip());

      this.classContainer!.add([background, labels]);
    });
  }

  private ensureClassButtonTexture(accentColor: number, isActive: boolean): string {
    if (isActive) {
      return this.ensureRoundedTexture({
        key: `_ccdclass_${accentColor.toString(16)}_on`,
        w: CLASS_BUTTON_W,
        h: CLASS_BUTTON_H,
        radius: 12,
        topColor: lerpColor(accentColor, 0xffffff, 0.22),
        bottomColor: lerpColor(accentColor, 0x000000, 0.34),
        fillAlpha: 0.97,
        strokeColor: lerpColor(accentColor, 0xffffff, 0.3),
        strokeAlpha: 0.95,
        strokeWidth: 2,
        highlightAlpha: 0.3,
      });
    }
    return this.ensureRoundedTexture({
      key: `_ccdclass_${accentColor.toString(16)}_off`,
      w: CLASS_BUTTON_W,
      h: CLASS_BUTTON_H,
      radius: 12,
      topColor: lerpColor(COLORS.GREY_8, accentColor, 0.4),
      bottomColor: lerpColor(COLORS.GREY_9, accentColor, 0.26),
      fillAlpha: 0.9,
      strokeColor: lerpColor(COLORS.GREY_5, accentColor, 0.55),
      strokeAlpha: 0.75,
      strokeWidth: 1.5,
      highlightAlpha: 0.08,
    });
  }

  /**
   * Zeichnet das komplette Loadout als Slot-Zeile. Jeder Slot steht ueber der Kategorie-Spalte,
   * aus der seine Items stammen; die Utility-Slots des Inspectors teilen sich die Spannweite
   * der beiden gleichwertigen Utility-Kategorien.
   */
  private renderLoadoutRow(progress: CoopDefenseProgressSnapshot): void {
    if (!this.loadoutContainer) return;
    this.loadoutContainer.removeAll(true);

    const categories = progress.upgradeCategories;
    if (categories.length === 0) return;

    // Nur sichtbar, wenn eine Aktion abgelehnt wurde; sonst bleibt der Platz frei.
    this.loadoutHintText = this.scene.add.text(CX, LOADOUT_LABEL_Y, '', {
      fontSize: '12px', fontFamily: FONT_MONO, fontStyle: 'bold', color: toCssColor(COLORS.RED_2),
    }).setOrigin(0.5).setScrollFactor(0);
    this.loadoutContainer.add(this.loadoutHintText);

    const columns = this.buildLoadoutColumns(progress);
    // Erst alle Karten, dann alle Slots: so liegt keine Karte ueber einem fremden Slot.
    for (const column of columns) this.renderCategoryCard(column);
    for (const column of columns) {
      for (const slot of column.slots) this.renderLoadoutSlot(slot);
    }
  }

  /**
   * Ordnet jeder Kategorie mit Loadout-Bezug eine Spalte zu. Beim Inspector werden die beiden
   * gleichwertigen Utility-Kategorien zu einer Spalte mit geteilten Slots zusammengefasst;
   * "Allgemein" hat kein Loadout und bekommt deshalb gar keine Spalte.
   */
  private buildLoadoutColumns(progress: CoopDefenseProgressSnapshot): LoadoutColumn[] {
    const categories = progress.upgradeCategories;
    const layout = this.getTabLayout(categories.length);
    const selection = this.getLoadoutSelection();
    const columns: LoadoutColumn[] = [];
    const utilityIndices: number[] = [];

    categories.forEach((category, index) => {
      if (isCoopDefenseToolCategory(category.id, progress.classId)) {
        utilityIndices.push(index);
        return;
      }
      if (category.id === 'general') return;

      const slot = category.id as LoadoutSlot;
      const itemId = selection[slot];
      const accentColor = this.getCategoryVisuals(category.id, progress.classId).connector;
      const centerX = this.getTabCenterX(layout, index);
      columns.push({
        centerX,
        width: layout.tabW,
        accentColor,
        active: index === this.activeCategoryIndex,
        slots: [{
          centerX,
          accentColor,
          presentation: itemId ? describeLoadoutItem(slot, itemId) : null,
          tooltipTitle: getUpgradeCategoryName(category.id, getLocale()),
          tooltipBody: () => this.buildSlotTooltipBody(getUpgradeCategoryName(category.id, getLocale()), itemId ? describeLoadoutItem(slot, itemId) : null),
          onOpenPicker: (anchorX) => this.openSlotPicker(progress, getUpgradeCategoryName(category.id, getLocale()), slot, anchorX),
        }],
      });
    });

    if (utilityIndices.length > 0) {
      columns.push(this.buildUtilityColumn(progress, layout, utilityIndices));
    }
    return columns;
  }

  /** Geteilte Utility-Slots des Inspectors, verteilt ueber beide gleichwertigen Utility-Spalten. */
  private buildUtilityColumn(
    progress: CoopDefenseProgressSnapshot,
    layout: { tabW: number; startX: number },
    categoryIndices: readonly number[],
  ): LoadoutColumn {
    const capacity = Math.max(1, progress.toolSlotCapacity);
    const tools = progress.toolLoadout;
    const spanLeft = this.getTabCenterX(layout, categoryIndices[0]) - layout.tabW / 2;
    const spanRight = this.getTabCenterX(layout, categoryIndices[categoryIndices.length - 1]) + layout.tabW / 2;
    const spanCenter = (spanLeft + spanRight) / 2;
    const accentColor = CATEGORY_VISUALS.utility.connector;
    const totalW = capacity * LOADOUT_SLOT_SIZE + (capacity - 1) * LOADOUT_SLOT_GAP;
    const startX = spanCenter - totalW / 2 + LOADOUT_SLOT_SIZE / 2;

    const slots: LoadoutSlotParams[] = [];
    for (let index = 0; index < capacity; index += 1) {
      const tool = tools[index] ?? null;
      slots.push({
        centerX: startX + index * (LOADOUT_SLOT_SIZE + LOADOUT_SLOT_GAP),
        accentColor,
        presentation: tool ? describeLoadoutTool(tool) : null,
        tooltipTitle: t('ui.lobby.utilitySlot', { slot: index + 1 }),
        tooltipBody: () => this.buildUtilitySlotTooltipBody(progress, tool),
        onOpenPicker: (anchorX) => this.openUtilitySlotPicker(progress, index, anchorX),
      });
    }

    return {
      centerX: spanCenter,
      width: spanRight - spanLeft,
      accentColor,
      active: categoryIndices.includes(this.activeCategoryIndex),
      slots,
    };
  }

  /**
   * Spaltenkarte hinter Slots und Tab. Sie reicht von der Loadout-Zeile bis unter die Tabs,
   * damit beide als eine Einheit in Kategoriefarbe gelesen werden; die Spalte der offenen
   * Kategorie tritt zusaetzlich hervor.
   */
  private renderCategoryCard(column: LoadoutColumn): void {
    if (!this.loadoutContainer) return;
    const height = TAB_TOP + TAB_H - LOADOUT_CARD_TOP;
    const key = this.ensureLoadoutCardTexture(column.width, height, column.accentColor, column.active);
    this.loadoutContainer.add(this.scene.add.image(column.centerX, LOADOUT_CARD_TOP + height / 2, key)
      .setScrollFactor(0));
  }

  private renderLoadoutSlot(params: LoadoutSlotParams): void {
    if (!this.loadoutContainer) return;

    const { centerX, presentation } = params;
    const group = createLoadoutSlotControl(this.scene, {
      x: centerX,
      y: LOADOUT_ROW_Y,
      width: LOADOUT_SLOT_SIZE,
      height: LOADOUT_SLOT_SIZE,
      accentColor: params.accentColor,
      presentation,
      compact: true,
      onPointerOver: (pointer) => {
        this.showTooltip(params.tooltipTitle, params.tooltipBody(), pointer);
      },
      onPointerMove: (pointer) => this.updateTooltipPosition(pointer),
      onPointerOut: () => this.hideTooltip(),
      onClick: (anchorX) => {
        this.hideTooltip();
        params.onOpenPicker(anchorX);
      },
    });

    this.loadoutContainer.add(group);
  }

  private buildSlotTooltipBody(categoryLabel: string, presentation: LoadoutItemPresentation | null): string {
    return [
      presentation ? t('ui.upgrades.equippedItem', { name: presentation.displayName }) : t('ui.upgrades.empty'),
      t('ui.upgrades.categoryItems', { category: categoryLabel }),
      '',
      t('ui.upgrades.openSelection'),
    ].join('\n');
  }

  private buildUtilitySlotTooltipBody(
    progress: CoopDefenseProgressSnapshot,
    tool: LoadoutToolRef | null,
  ): string {
    return [
      tool ? t('ui.upgrades.equippedItem', { name: describeLoadoutTool(tool).displayName }) : t('ui.upgrades.empty'),
      t('ui.upgrades.utilitySlotsFilled', {
        current: progress.toolLoadout.length,
        capacity: Math.max(1, progress.toolSlotCapacity),
      }),
      t('ui.upgrades.utilityCategories'),
      '',
      t('ui.upgrades.openUtilitySelection'),
    ].join('\n');
  }

  private openSlotPicker(
    progress: CoopDefenseProgressSnapshot,
    categoryLabel: string,
    slot: LoadoutSlot,
    anchorX: number,
  ): void {
    const currentId = this.getLoadoutSelection()[slot];
    const entries: LoadoutPickerEntry[] = progress.unlockedItemsBySlot[slot].map((item) => {
      const presentation = describeLoadoutItem(slot, item.id);
      return {
        key: item.id,
        displayName: item.displayName,
        textureKey: presentation.textureKey,
        accentColor: presentation.accentColor,
        selected: item.id === currentId,
        disabled: false,
        onPick: () => {
          this.onSelectLoadoutItem(slot, item.id);
        },
      };
    });

    this.picker?.open({
      anchorX,
      anchorY: LOADOUT_ROW_Y + LOADOUT_SLOT_SIZE / 2 + 8,
      title: categoryLabel,
      groups: [{ label: null, entries }],
    });
  }

  private openUtilitySlotPicker(progress: CoopDefenseProgressSnapshot, slotIndex: number, anchorX: number): void {
    const equipped = progress.toolLoadout;
    const currentTool = equipped[slotIndex] ?? null;
    const currentKey = loadoutToolKey(currentTool);
    const equippedKeys = new Set(equipped.map((tool) => loadoutToolKey(tool)));

    const buildEntry = (tool: LoadoutToolRef): LoadoutPickerEntry => {
      const presentation = describeLoadoutTool(tool);
      const key = loadoutToolKey(tool);
      return {
        key,
        displayName: presentation.displayName,
        textureKey: presentation.textureKey,
        accentColor: presentation.accentColor,
        selected: key === currentKey,
        // In einem anderen Slot liegende Utilities sind hier nicht noch einmal waehlbar.
        disabled: key !== currentKey && equippedKeys.has(key),
        onPick: () => this.assignToolToSlot(progress, slotIndex, tool),
      };
    };

    const groups: LoadoutPickerGroup[] = [];
    for (const category of progress.upgradeCategories) {
      if (!isCoopDefenseToolCategory(category.id, progress.classId)) continue;
      const entries = category.upgrades
        .filter((node) => node.toolRef !== null && node.level > 0)
        .map((node) => buildEntry(node.toolRef!));
      groups.push({ label: category.label, entries });
    }

    this.picker?.open({
      anchorX,
      anchorY: LOADOUT_ROW_Y + LOADOUT_SLOT_SIZE / 2 + 8,
      title: t('ui.lobby.utilitySlot', { slot: slotIndex + 1 }),
      groups,
      clearLabel: currentTool ? t('ui.lobby.clearSlot') : undefined,
      onClear: currentTool
        ? () => this.applyToolSlots(progress.toolLoadout.filter((_, index) => index !== slotIndex))
        : undefined,
    });
  }

  /**
   * Belegt genau den angeklickten Slot. Die Utility-Liste ist luecklos gespeichert, deshalb
   * landet eine Auswahl jenseits des letzten belegten Slots am Ende.
   */
  private assignToolToSlot(
    progress: CoopDefenseProgressSnapshot,
    slotIndex: number,
    tool: LoadoutToolRef,
  ): void {
    const next = [...progress.toolLoadout];
    if (slotIndex < next.length) next[slotIndex] = tool;
    else next.push(tool);
    this.applyToolSlots(next);
  }

  private applyToolSlots(tools: readonly LoadoutToolRef[]): void {
    if (this.onSetLoadoutTools(tools)) {
      return;
    }
    this.showLoadoutHint(t('ui.upgrades.utilityEquipFailed'));
  }

  private toggleTool(tool: LoadoutToolRef): void {
    if (this.onToggleLoadoutTool(tool)) {
      return;
    }
    this.showLoadoutHint(t('ui.upgrades.noUtilitySlots'));
  }

  /** Ein abgelehntes Ausruesten blieb bisher unkommentiert; der Hinweis steht ueber dem Block. */
  private showLoadoutHint(message: string): void {
    const hint = this.loadoutHintText;
    if (!hint || !hint.active) return;
    hint.setText(message);
    this.loadoutHintTimer?.destroy();
    this.loadoutHintTimer = this.scene.time.delayedCall(2200, () => {
      this.loadoutHintTimer = null;
      if (hint.active) hint.setText('');
    });
  }

  /** Glasige Spaltenkarte im Stil von Panel und Tabs, damit der Block nicht flach wirkt. */
  private ensureLoadoutCardTexture(
    width: number,
    height: number,
    accentColor: number,
    isActive: boolean,
  ): string {
    const w = Math.round(width);
    return this.ensureRoundedTexture({
      key: `_ccdcard_${w}_${Math.round(height)}_${accentColor.toString(16)}_${isActive ? 'on' : 'off'}`,
      w,
      h: height,
      radius: LOADOUT_CARD_RADIUS,
      topColor: lerpColor(COLORS.GREY_8, accentColor, isActive ? 0.34 : 0.2),
      bottomColor: lerpColor(COLORS.GREY_9, accentColor, isActive ? 0.2 : 0.1),
      fillAlpha: isActive ? 0.8 : 0.6,
      strokeColor: accentColor,
      strokeAlpha: isActive ? 0.85 : 0.4,
      strokeWidth: isActive ? 2 : 1.5,
      highlightAlpha: isActive ? 0.1 : 0.05,
    });
  }

  private clearTabDecorations(): void {
    for (const tween of this.tabTweens) tween.destroy();
    this.tabTweens = [];
    for (const { target, glow } of this.tabGlows) {
      if (target.active) removeExternalFx(target, glow);
    }
    this.tabGlows = [];
  }

  /** Spaltenraster der Kategorie-Tabs; die Loadout-Slots richten sich daran aus. */
  private getTabLayout(categoryCount: number): { tabW: number; startX: number } {
    const tabW = Math.min(TAB_MAX_W, (CONTENT_W - TAB_GAP * (categoryCount - 1)) / categoryCount);
    const totalW = tabW * categoryCount + TAB_GAP * (categoryCount - 1);
    return { tabW, startX: CX - totalW / 2 };
  }

  private getTabCenterX(layout: { tabW: number; startX: number }, index: number): number {
    return layout.startX + layout.tabW / 2 + index * (layout.tabW + TAB_GAP);
  }

  /**
   * Beim Inspector sind `construction` und `utility` gleichwertige Werkzeug-Kategorien und
   * teilen sich deshalb dieselbe Gold-Farbgebung.
   */
  private getCategoryVisuals(
    categoryId: CoopDefenseUpgradeCategorySnapshot['id'],
    classId: CoopDefenseClassId,
  ): CategoryVisuals {
    return isCoopDefenseToolCategory(categoryId, classId)
      ? CATEGORY_VISUALS.utility
      : CATEGORY_VISUALS[categoryId];
  }

  private renderTabs(progress: CoopDefenseProgressSnapshot): void {
    if (!this.tabsContainer) return;
    this.clearTabDecorations();
    this.tabsContainer.removeAll(true);

    const categories = progress.upgradeCategories;
    if (categories.length === 0) return;

    const layout = this.getTabLayout(categories.length);
    const tabW = layout.tabW;

    categories.forEach((category, index) => {
      const visuals = this.getCategoryVisuals(category.id, progress.classId);
      const isActive = index === this.activeCategoryIndex;
      const centerX = this.getTabCenterX(layout, index);

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
        fontFamily: FONT_MONO,
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
    if (!category) {
      this.treeBackgroundContainer?.removeAll(true);
      this.treeBackground = null;
      this.treeBackgroundSignature = null;
      return;
    }

    const visuals = this.getCategoryVisuals(category.id, progress.classId);
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
    const treeBackgroundSignature = this.getTreeBackgroundSignature(
      category.id,
      progress.classId,
      itemLanes,
      placed,
      placedById,
      visuals,
    );
    this.renderTreeBackground(
      treeBackgroundSignature,
      itemLanes,
      placed,
      placedById,
      visuals,
    );
    this.renderFlowingDots(placed, placedById, visuals);
    for (const placedNode of placed) {
      this.renderNode(placedNode, visuals);
    }
  }

  private renderTreeBackground(
    signature: string,
    lanes: readonly PlacedItemLane[],
    placed: readonly PlacedNode[],
    placedById: ReadonlyMap<string, PlacedNode>,
    visuals: CategoryVisuals,
  ): void {
    if (!this.treeBackgroundContainer) return;
    if (this.treeBackground && this.treeBackgroundSignature === signature) {
      this.treeBackground.setVisible(true);
      return;
    }

    this.treeBackgroundContainer.removeAll(true);
    this.treeBackground = null;

    // Graphics is used only as a one-shot authoring surface. The resulting texture is
    // the only object that remains in the display list, so GraphicsWebGLRenderer does
    // not replay the lane/connector command buffer while the menu is idle.
    const graphics = this.scene.add.graphics();
    this.drawItemLanes(graphics, lanes, visuals);
    this.drawConnections(graphics, placed, placedById, visuals);
    const existingTreeBackground = this.scene.textures.get(TREE_BACKGROUND_TEX_KEY);
    if (existingTreeBackground instanceof Phaser.Textures.CanvasTexture) {
      existingTreeBackground.clear();
    }
    graphics.generateTexture(TREE_BACKGROUND_TEX_KEY, GAME_WIDTH, GAME_HEIGHT);
    graphics.destroy();

    this.treeBackground = this.scene.add.image(CX, CY, TREE_BACKGROUND_TEX_KEY)
      .setScrollFactor(0);
    this.treeBackgroundContainer.add(this.treeBackground);
    this.treeBackgroundSignature = signature;
  }

  private drawItemLanes(
    graphics: Phaser.GameObjects.Graphics,
    lanes: readonly PlacedItemLane[],
    visuals: CategoryVisuals,
  ): void {
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

  private drawConnections(
    graphics: Phaser.GameObjects.Graphics,
    placed: readonly PlacedNode[],
    placedById: ReadonlyMap<string, PlacedNode>,
    visuals: CategoryVisuals,
  ): void {
    for (const child of placed) {
      for (const requirement of child.node.requires) {
        const parent = placedById.get(requirement.upgradeId);
        if (!parent) continue;

        const points = this.getConnectionPoints(parent, child);

        if (requirement.satisfied) {
          const connectorColor = this.getConnectorColor(child, visuals);
          graphics.lineStyle(4, connectorColor, 0.18);
          this.strokePolyline(graphics, points);
          graphics.lineStyle(2, connectorColor, 0.85);
          this.strokePolyline(graphics, points);
        } else {
          graphics.lineStyle(2, COLORS.GREY_5, 0.45);
          this.strokePolyline(graphics, points);
        }
      }
    }
  }

  private renderFlowingDots(
    placed: readonly PlacedNode[],
    placedById: ReadonlyMap<string, PlacedNode>,
    visuals: CategoryVisuals,
  ): void {
    for (const child of placed) {
      for (const requirement of child.node.requires) {
        const parent = placedById.get(requirement.upgradeId);
        if (!parent || !requirement.satisfied || parent.node.level <= 0 || child.node.level <= 0) continue;
        this.addFlowingDot(this.getConnectionPoints(parent, child), this.getConnectorColor(child, visuals));
      }
    }
  }

  private getConnectionPoints(
    parent: PlacedNode,
    child: PlacedNode,
  ): Array<{ x: number; y: number }> {
    const startX = parent.x;
    const startY = parent.y + NODE_H / 2;
    const endX = child.x;
    const endY = child.y - NODE_H / 2;
    const midY = startY + Math.max(8, (endY - startY) * 0.5);
    return [
      { x: startX, y: startY },
      { x: startX, y: midY },
      { x: endX, y: midY },
      { x: endX, y: endY },
    ];
  }

  private getConnectorColor(child: PlacedNode, visuals: CategoryVisuals): number {
    return child.node.bossPointCostPerLevel > 0
      ? (child.node.bossPointRequirementMet || child.node.level > 0 ? COLORS.GOLD_1 : COLORS.RED_2)
      : visuals.connector;
  }

  private getTreeBackgroundSignature(
    categoryId: string,
    classId: CoopDefenseClassId,
    lanes: readonly PlacedItemLane[],
    placed: readonly PlacedNode[],
    placedById: ReadonlyMap<string, PlacedNode>,
    visuals: CategoryVisuals,
  ): string {
    const laneSignature = lanes
      .map((lane) => `${lane.x},${lane.y},${lane.width},${lane.height}`)
      .join(';');
    const connectionSignature = placed.flatMap((child) => child.node.requires.map((requirement) => {
      const parent = placedById.get(requirement.upgradeId);
      return parent
        ? `${requirement.upgradeId}>${child.node.id}:${requirement.satisfied}:${this.getConnectorColor(child, visuals)}:${parent.x},${parent.y},${child.x},${child.y}`
        : '';
    })).join(';');
    return `${categoryId}|${classId}|${visuals.laneFill}|${visuals.divider}|${visuals.connector}|${laneSignature}|${connectionSignature}`;
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
    // Pending-Upgrades liefern bewusst keinen Texture-Key. In diesem Fall bleibt der
    // Knoten vollstaendig funktionsfaehig, zeigt aber niemals ein fachlich falsches Aliasbild.
    const hasIcon = iconKey !== null && this.scene.textures.exists(iconKey);

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

    if (hasIcon && iconKey !== null) {
      const icon = this.scene.add.image(0, 0, iconKey)
        .setDisplaySize(ICON_SIZE, ICON_SIZE)
        .setScrollFactor(0)
        .setAlpha(isLocked ? 0.4 : 1);
      nodeGroup.add(icon);
    } else {
      const fallback = this.scene.add.text(0, 0, node.label, {
        fontSize: `${NODE_LABEL_FONT_SIZE}px`,
        fontFamily: FONT_MONO,
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
        fontFamily: FONT_MONO,
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
        this.showTooltipLines(node.label, this.buildNodeTooltipLines(node), pointer);
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

    const equipTarget = node.level > 0 ? this.getNodeEquipTarget(node) : null;
    if (equipTarget) {
      const equipped = this.isEquipTargetActive(equipTarget);
      // Einzel-Slots muessen immer belegt bleiben: dort ist das Haekchen nur ein Zustand,
      // Utility-Slots lassen sich dagegen ab- und wieder anwaehlen.
      const interactive = equipTarget.kind === 'tool' || !equipped;
      const toggle = this.scene.add.rectangle(NODE_W / 2 - 4, -NODE_H / 2 + 4, 15, 15,
        equipped ? COLORS.GREEN_2 : COLORS.GREY_5, 0.98)
        .setStrokeStyle(1, equipped ? COLORS.GREEN_1 : COLORS.GREY_2)
        .setScrollFactor(0);
      const toggleLabel = this.scene.add.text(toggle.x, toggle.y, equipped ? '✓' : '+', {
        fontSize: '12px', fontFamily: FONT_MONO, fontStyle: 'bold',
        color: toCssColor(equipped ? COLORS.GREY_10 : COLORS.GREY_1),
      }).setOrigin(0.5).setScrollFactor(0);
      if (interactive) {
        toggle.setInteractive({ useHandCursor: true });
        toggle.on('pointerdown', (pointer: Phaser.Input.Pointer, _lx: number, _ly: number, event: Phaser.Types.Input.EventData) => {
          event.stopPropagation();
          if (!pointer.leftButtonDown()) return;
          if (equipTarget.kind === 'tool') {
            this.toggleTool(equipTarget.tool);
          } else {
            this.onSelectLoadoutItem(equipTarget.slot, equipTarget.itemId);
          }
        });
      }
      nodeGroup.add(toggle);
      nodeGroup.add(toggleLabel);
    }

    this.upgradesContainer.add(nodeGroup);
  }

  /** Liefert das Loadout-Ziel eines Knotens, sofern er ueberhaupt ein Item freischaltet. */
  private getNodeEquipTarget(node: CoopDefenseUpgradeNodeSnapshot): NodeEquipTarget | null {
    if (node.toolRef) return { kind: 'tool', tool: node.toolRef };
    if (node.loadoutUnlock) {
      return { kind: 'slot', slot: node.loadoutUnlock.slot, itemId: node.loadoutUnlock.itemId };
    }
    return null;
  }

  private isEquipTargetActive(target: NodeEquipTarget): boolean {
    if (target.kind === 'tool') {
      const key = loadoutToolKey(target.tool);
      return this.getProgress().toolLoadout.some((entry) => loadoutToolKey(entry) === key);
    }
    return this.getLoadoutSelection()[target.slot] === target.itemId;
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
      strokeColor: PANEL_BORDER,
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
        topColor: lerpColor(INTENT.neutral.fill, 0xffffff, 0.16),
        bottomColor: lerpColor(INTENT.neutral.fill, 0x000000, 0.30),
        fillAlpha: INTENT.neutral.fillAlpha,
        strokeColor: INTENT.neutral.stroke,
        strokeAlpha: INTENT.neutral.strokeAlpha,
        strokeWidth: 2,
        highlightAlpha: INTENT.neutral.gloss,
      });
    }
    return this.ensureRoundedTexture({
      key: '_ccd_apply',
      w: ACTION_BTN_W,
      h: ACTION_BTN_H,
      radius: 12,
      topColor: lerpColor(INTENT.primary.fill, 0xffffff, 0.18),
      bottomColor: lerpColor(INTENT.primary.fill, 0x000000, 0.30),
      fillAlpha: INTENT.primary.fillAlpha,
      strokeColor: INTENT.primary.stroke,
      strokeAlpha: INTENT.primary.strokeAlpha,
      strokeWidth: 2,
      highlightAlpha: INTENT.primary.gloss,
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
      topColor: lerpColor(INTENT.danger.fill, 0xffffff, 0.16),
      bottomColor: lerpColor(INTENT.danger.fill, 0x000000, 0.30),
      fillAlpha: INTENT.danger.fillAlpha,
      strokeColor: INTENT.danger.stroke,
      strokeAlpha: INTENT.danger.strokeAlpha,
      strokeWidth: 2,
      highlightAlpha: INTENT.danger.gloss,
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
  }

  /**
   * Sammelt Refreshes bis zum Frame-Ende.
   *
   * `refresh()` baut den gesamten Kategoriebaum neu auf – inklusive Zerstoeren und Neuanlegen
   * eines {@link LivingBarEffect} (zwei Partikel-Emitter und Aura) **je Knoten**.
   * Beim schnellen Vergeben mehrerer Punkte lief das pro Klick und war deutlich spuerbar; so
   * laeuft es hoechstens einmal pro Frame.
   */
  scheduleRefresh(): void {
    if (this.refreshPending) return;
    this.refreshPending = true;
    this.scene.events.once(Phaser.Scenes.Events.POST_UPDATE, () => {
      this.refreshPending = false;
      if (this.visible) this.refresh();
    });
  }

  private getNodeTextureKey(node: CoopDefenseUpgradeNodeSnapshot): string | null {
    const upgradeTextureKey = getCoopDefenseUpgradeTextureKey(node.id);
    if (upgradeTextureKey === null) return null;
    // Dedicated upgrade artwork takes precedence over the corresponding loadout-item icon.
    if (hasCoopDefenseDedicatedUpgradeIcon(node.id)) return upgradeTextureKey;
    if (node.toolRef) return describeLoadoutTool(node.toolRef).textureKey;
    if (node.loadoutUnlock) {
      // Loadout IDs are semantic IDs; their authored icon key may retain the
      // historical German asset name (e.g. LEAF_BLOWER -> LAUBBLAESER).
      return describeLoadoutItem(node.loadoutUnlock.slot, node.loadoutUnlock.itemId).textureKey;
    }
    if (node.kind === 'upgrade') return upgradeTextureKey;
    return null;
  }

  private showTooltip(title: string, body: string, pointer: Phaser.Input.Pointer): void {
    this.tooltip?.showText(title, body, pointer);
  }

  private showTooltipLines(title: string, lines: readonly UiTooltipLine[], pointer: Phaser.Input.Pointer): void {
    this.tooltip?.show(title, TEXT.primary, lines, pointer);
  }

  private updateTooltipPosition(pointer: Phaser.Input.Pointer): void {
    this.tooltip?.move(pointer);
  }

  private hideTooltip(): void {
    this.tooltip?.hide();
  }

  private buildNodeTooltipLines(node: CoopDefenseUpgradeNodeSnapshot): UiTooltipLine[] {
    const lines: UiTooltipLine[] = [{
      text: t('ui.upgrades.level', { current: node.level, max: node.maxLevel }),
      color: TEXT.primary,
    }];

    if (node.kind === 'unlock' && node.startingLevel > 0 && !node.refundable) {
      lines.push({ text: t('ui.upgrades.baseUnlock'), color: TEXT.primary });
    } else if (!node.refundable) {
      lines.push({ text: t('ui.upgrades.notRefundable'), color: TEXT.primary });
    }

    if (node.bossPointCostPerLevel > 0) {
      lines.push({ text: t('ui.upgrades.special'), color: TEXT.accent, bold: true });
    }
    lines.push({
      text: '',
      color: TEXT.primary,
      segments: getUpgradeDescriptionSegments(node.id, getLocale()).map((segment) => ({
        text: segment.text,
        color: segment.dynamic ? TEXT.accent : TEXT.primary,
        bold: segment.dynamic,
      })),
    });
    if (node.bossPointCostPerLevel > 0) {
      lines.push({ text: t('ui.upgrades.bossCost', {
        points: node.bossPointCostPerLevel,
        plural: node.bossPointCostPerLevel === 1 ? '' : 'e',
      }), color: TEXT.primary });
      if (!node.bossPointRequirementMet && node.level < node.maxLevel) {
        lines.push({ text: t('ui.upgrades.bossPointMissing'), color: TEXT.primary });
      }
    }
    return lines;
  }
}
