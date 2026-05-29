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
const POINTS_Y = BAR_Y + 38;
const POINTS_TEXT_OFFSET_Y = 8;
const FOOTER_Y = CY + PANEL_H / 2 - 28;

const TAB_TOP = POINTS_Y + 28;
const TAB_H = 36;
const TAB_GAP = 12;
const TAB_MAX_W = 240;

const CONTENT_TOP = TAB_TOP + TAB_H + 26;
const CONTENT_BOTTOM = FOOTER_Y - 22;
const CONTENT_W = PANEL_W - 80;
const CONTENT_X = CX - CONTENT_W / 2;
const CONTENT_H = CONTENT_BOTTOM - CONTENT_TOP;
const CONTENT_Y = CONTENT_TOP + CONTENT_H / 2;

const NODE_W = 48;
const NODE_H = 48;
const ICON_SIZE = 32;
const NODE_GAP_X = 18;
const NODE_GAP_Y = 26;
const ROW_GAP = 26;
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
  private progressFill: Phaser.GameObjects.Rectangle | null = null;
  private progressLabelText: Phaser.GameObjects.Text | null = null;
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

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getProgress: () => CoopDefenseProgressSnapshot,
    private readonly onLevelUpUpgrade: (upgradeId: string) => boolean,
    private readonly onLevelDownUpgrade: (upgradeId: string) => boolean,
  ) {}

  build(): void {
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
    this.levelText = null;
    this.xpText = null;
    this.pointsText = null;
    this.progressFill = null;
    this.progressLabelText = null;
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

    const panel = this.scene.add.rectangle(CX, CY, PANEL_W, PANEL_H, PANEL_BG, PANEL_ALPHA)
      .setStrokeStyle(2, ACCENT)
      .setScrollFactor(0)
      .setInteractive();
    objects.push(panel);

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
    this.progressFill = this.scene.add.rectangle(BAR_X, BAR_Y, BAR_W, BAR_H, COLORS.GREEN_4, 1)
      .setOrigin(0, 0.5)
      .setScrollFactor(0);
    objects.push(this.progressFill);

    this.progressLabelText = this.scene.add.text(CX, BAR_Y + 22, '0 / 25 XP bis zum naechsten Level', {
      fontSize: '13px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4),
    }).setOrigin(0.5, 0).setScrollFactor(0);
    objects.push(this.progressLabelText);

    this.pointsText = this.scene.add.text(CX, POINTS_Y + POINTS_TEXT_OFFSET_Y, '0 Upgrade-Punkte verfuegbar', {
      fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.BLUE_1),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.pointsText);

    this.tabsContainer = this.scene.add.container(0, 0).setScrollFactor(0);
    objects.push(this.tabsContainer);

    objects.push(
      this.scene.add.rectangle(CX, CONTENT_Y, CONTENT_W, CONTENT_H, COLORS.GREY_8, 0.52)
        .setStrokeStyle(1, COLORS.GREY_5)
        .setScrollFactor(0),
    );

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
      this.scene.add.text(CX, FOOTER_Y, '[ ESC / Klick ausserhalb zum Schliessen | Linksklick skillt | Rechtsklick nimmt zurueck ]', {
        fontSize: '13px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_4),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    this.container = this.scene.add.container(0, 0, objects)
      .setDepth(DEPTH.OVERLAY + 1);
    this.container.setVisible(false);

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
    this.pointsText.setText(`${progress.availableUpgradePoints} Upgrade-Punkte verfuegbar`);
    this.progressFill.setDisplaySize(Math.max(0.001, BAR_W * progress.levelProgressFraction), BAR_H);
    this.progressLabelText.setText(`${progress.xpIntoLevel} / ${levelXpSpan} XP bis zum naechsten Level`);

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
    this.refresh();

    this.container.setVisible(true);
    this.container.setAlpha(0);
    this.scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 150,
      ease: 'Sine.easeOut',
    });

    this.dismissDelay = this.scene.time.delayedCall(120, () => {
      this.dismissDelay = null;
      if (!this.visible) return;
      this.dimRect?.setInteractive().once('pointerdown', () => this.hide());
    });

    this.keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') this.hide();
    };
    this.scene.input.keyboard?.on('keydown', this.keyHandler);
  }

  hide(): void {
    if (!this.visible || !this.container) return;
    this.visible = false;
    this.dismissDelay?.destroy();
    this.dismissDelay = null;
    this.dimRect?.disableInteractive().removeAllListeners();
    if (this.keyHandler) {
      this.scene.input.keyboard?.off('keydown', this.keyHandler);
      this.keyHandler = null;
    }

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
    this.container?.destroy(true);
    this.container = null;
    this.dimRect = null;
  }

  private setActiveCategory(index: number): void {
    if (index === this.activeCategoryIndex) return;
    this.activeCategoryIndex = index;
    this.hideTooltip();
    const progress = this.getProgress();
    this.renderTabs(progress);
    this.renderActiveCategory(progress);
  }

  private renderTabs(progress: CoopDefenseProgressSnapshot): void {
    if (!this.tabsContainer) return;
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

      const bg = this.scene.add.rectangle(
        centerX,
        TAB_TOP + TAB_H / 2,
        tabW,
        TAB_H,
        isActive ? visuals.laneFill : COLORS.GREY_8,
        isActive ? 0.92 : 0.5,
      )
        .setStrokeStyle(isActive ? 2 : 1, isActive ? visuals.divider : COLORS.GREY_5)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: !isActive });
      this.tabsContainer!.add(bg);

      const label = this.scene.add.text(centerX, TAB_TOP + TAB_H / 2, category.label, {
        fontSize: '15px',
        fontFamily: 'monospace',
        fontStyle: 'bold',
        color: toCssColor(isActive ? visuals.title : COLORS.GREY_3),
      }).setOrigin(0.5).setScrollFactor(0);
      this.tabsContainer!.add(label);

      if (!isActive) {
        bg.on('pointerover', () => bg.setAlpha(0.72));
        bg.on('pointerout', () => bg.setAlpha(0.5));
        bg.on('pointerdown', () => this.setActiveCategory(index));
      }
    });
  }

  private renderActiveCategory(progress: CoopDefenseProgressSnapshot): void {
    if (!this.upgradesContainer) return;
    this.upgradesContainer.removeAll(true);

    const category = progress.upgradeCategories[this.activeCategoryIndex];
    if (!category) return;

    const visuals = CATEGORY_VISUALS[category.id];
    const tree = this.buildCategoryTree(category.upgrades);
    const columnCache = new Map<string, number>();
    const depthCache = new Map<string, number>();

    const colsPerRow = Math.max(1, Math.floor((CONTENT_W + NODE_GAP_X) / COLUMN_UNIT));

    const rows: { roots: CoopDefenseUpgradeNodeSnapshot[]; totalCols: number; maxDepth: number }[] = [];
    let current = { roots: [] as CoopDefenseUpgradeNodeSnapshot[], totalCols: 0, maxDepth: 1 };

    for (const root of tree.roots) {
      const cols = this.measureColumns(root.id, tree.childrenByParentId, columnCache);
      if (current.roots.length > 0 && current.totalCols + cols > colsPerRow) {
        rows.push(current);
        current = { roots: [], totalCols: 0, maxDepth: 1 };
      }
      current.roots.push(root);
      current.totalCols += cols;
      current.maxDepth = Math.max(current.maxDepth, this.measureDepth(root.id, tree.childrenByParentId, depthCache));
    }
    if (current.roots.length > 0) rows.push(current);

    const placed: PlacedNode[] = [];
    const placedById = new Map<string, PlacedNode>();

    let rowTopY = CONTENT_TOP + 12;
    for (const row of rows) {
      const rowWidthPx = row.totalCols * COLUMN_UNIT - NODE_GAP_X;
      const rowLeftX = CONTENT_X + Math.max(0, (CONTENT_W - rowWidthPx) / 2);

      let colCursor = 0;
      for (const root of row.roots) {
        const cols = this.measureColumns(root.id, tree.childrenByParentId, columnCache);
        this.layoutSubtree({
          node: root,
          leftX: rowLeftX + colCursor * COLUMN_UNIT,
          depthIndex: 0,
          rowTopY,
          tree,
          columnCache,
          placed,
          placedById,
        });
        colCursor += cols;
      }

      rowTopY += row.maxDepth * ROW_UNIT + ROW_GAP;
    }

    this.renderConnections(placed, placedById, visuals);
    for (const placedNode of placed) {
      this.renderNode(placedNode, visuals);
    }
  }

  private layoutSubtree(params: {
    node: CoopDefenseUpgradeNodeSnapshot;
    leftX: number;
    depthIndex: number;
    rowTopY: number;
    tree: CategoryTree;
    columnCache: Map<string, number>;
    placed: PlacedNode[];
    placedById: Map<string, PlacedNode>;
  }): void {
    const { node, leftX, depthIndex, rowTopY, tree, columnCache, placed, placedById } = params;

    const cols = this.measureColumns(node.id, tree.childrenByParentId, columnCache);
    const subtreeWidthPx = cols * COLUMN_UNIT - NODE_GAP_X;
    const x = leftX + subtreeWidthPx / 2;
    const y = rowTopY + depthIndex * ROW_UNIT + NODE_H / 2;

    const placedNode: PlacedNode = { node, x, y };
    placed.push(placedNode);
    placedById.set(node.id, placedNode);

    const children = tree.childrenByParentId.get(node.id) ?? [];
    let childLeft = leftX;
    for (const child of children) {
      this.layoutSubtree({
        node: child,
        leftX: childLeft,
        depthIndex: depthIndex + 1,
        rowTopY,
        tree,
        columnCache,
        placed,
        placedById,
      });
      childLeft += this.measureColumns(child.id, tree.childrenByParentId, columnCache) * COLUMN_UNIT;
    }
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

  private measureColumns(
    nodeId: string,
    childrenByParentId: ReadonlyMap<string, CoopDefenseUpgradeNodeSnapshot[]>,
    cache: Map<string, number>,
  ): number {
    const cached = cache.get(nodeId);
    if (cached != null) return cached;

    const children = childrenByParentId.get(nodeId) ?? [];
    const cols = children.length === 0
      ? 1
      : Math.max(1, children.reduce((sum, child) => sum + this.measureColumns(child.id, childrenByParentId, cache), 0));
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

    for (const child of placed) {
      for (const requirement of child.node.requires) {
        const parent = placedById.get(requirement.upgradeId);
        if (!parent) continue;

        const startX = parent.x;
        const startY = parent.y + NODE_H / 2;
        const endX = child.x;
        const endY = child.y - NODE_H / 2;
        const midY = startY + Math.max(8, (endY - startY) * 0.5);

        graphics.lineStyle(2, requirement.satisfied ? visuals.connector : COLORS.GREY_5, requirement.satisfied ? 0.82 : 0.5);
        graphics.beginPath();
        graphics.moveTo(startX, startY);
        graphics.lineTo(startX, midY);
        graphics.lineTo(endX, midY);
        graphics.lineTo(endX, endY);
        graphics.strokePath();
      }
    }

    this.upgradesContainer.add(graphics);
  }

  private renderNode(placedNode: PlacedNode, visuals: CategoryVisuals): void {
    if (!this.upgradesContainer) return;

    const { node, x, y } = placedNode;
    const nodeGroup = this.scene.add.container(0, 0).setScrollFactor(0);

    const isBaseUnlock = node.kind === 'unlock' && node.startingLevel > 0 && !node.refundable;
    const interactionEnabled = node.canLevelUp || node.canLevelDown;
    const isLocked = !node.unlocked && node.level <= 0;
    const progressFraction = node.maxLevel > 0
      ? Phaser.Math.Clamp(node.level / node.maxLevel, 0, 1)
      : 0;
    const nodeBaseColor = isBaseUnlock ? BASE_UNLOCK_NODE_FILL : visuals.nodeBase;
    const nodeStrokeColor = isBaseUnlock ? BASE_UNLOCK_NODE_STROKE : visuals.nodeStroke;
    const nodeActiveColor = isBaseUnlock ? BASE_UNLOCK_NODE_ACTIVE : visuals.nodeActive;
    const baseAlpha = isLocked ? 0.28 : node.level > 0 ? 0.96 : 0.72;

    const iconKey = this.getNodeTextureKey(node);
    const hasIcon = iconKey != null && this.scene.textures.exists(iconKey);

    const baseRect = this.scene.add.rectangle(x, y, NODE_W, NODE_H, nodeBaseColor, baseAlpha)
      .setStrokeStyle(1, interactionEnabled || isBaseUnlock ? nodeStrokeColor : COLORS.GREY_5)
      .setScrollFactor(0);
    nodeGroup.add(baseRect);

    // Fortschritts-Fuellung steigt von unten hoch und scheint hinter dem transparenten Icon durch.
    const fillHeight = Math.max(0, (NODE_H - NODE_INNER_PADDING * 2) * progressFraction);
    const activeFill = this.scene.add.rectangle(
      x,
      y + NODE_H / 2 - NODE_INNER_PADDING,
      NODE_W - NODE_INNER_PADDING * 2,
      Math.max(0.001, fillHeight),
      nodeActiveColor,
      node.level > 0 ? 0.55 : 0,
    )
      .setOrigin(0.5, 1)
      .setScrollFactor(0);
    nodeGroup.add(activeFill);

    if (hasIcon && iconKey) {
      const icon = this.scene.add.image(x, y, iconKey)
        .setDisplaySize(ICON_SIZE, ICON_SIZE)
        .setScrollFactor(0)
        .setAlpha(isLocked ? 0.4 : 1);
      nodeGroup.add(icon);
    } else {
      const fallback = this.scene.add.text(x, y, node.label, {
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
      const levelText = this.scene.add.text(x + NODE_W / 2 - 2, y + NODE_H / 2 - 1, `${node.level}/${node.maxLevel}`, {
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

    const hitArea = this.scene.add.rectangle(x, y, NODE_W, NODE_H, 0x000000, 0.001)
      .setScrollFactor(0)
      .setInteractive({ useHandCursor: interactionEnabled })
      .on('pointerover', (pointer: Phaser.Input.Pointer) => {
        baseRect.setAlpha(Math.min(1, baseAlpha + 0.12));
        this.showTooltip(node, pointer);
      })
      .on('pointermove', (pointer: Phaser.Input.Pointer) => this.updateTooltipPosition(pointer))
      .on('pointerout', () => {
        baseRect.setAlpha(baseAlpha);
        this.hideTooltip();
      })
      .on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handleUpgradePointerDown(node, pointer));
    nodeGroup.add(hitArea);

    this.upgradesContainer.add(nodeGroup);
  }

  private handleUpgradePointerDown(node: CoopDefenseUpgradeNodeSnapshot, pointer: Phaser.Input.Pointer): void {
    if (pointer.rightButtonDown()) this.onLevelDownUpgrade(node.id);
    else this.onLevelUpUpgrade(node.id);
    this.refresh();
  }

  private getNodeTextureKey(node: CoopDefenseUpgradeNodeSnapshot): string | null {
    if (node.loadoutUnlock?.itemId) return node.loadoutUnlock.itemId;
    if (node.kind === 'upgrade') return `UPGRADE_${node.id.toUpperCase()}`;
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

    lines.push(node.description);
    return lines.join('\n');
  }
}
