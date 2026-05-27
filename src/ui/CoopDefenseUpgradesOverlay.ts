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
const FOOTER_Y = CY + PANEL_H / 2 - 28;
const UPGRADE_AREA_W = PANEL_W - 60;
const UPGRADE_AREA_TOP = POINTS_Y + 34;
const UPGRADE_AREA_BOTTOM = FOOTER_Y - 44;
const UPGRADE_AREA_H = UPGRADE_AREA_BOTTOM - UPGRADE_AREA_TOP;
const UPGRADE_AREA_Y = UPGRADE_AREA_TOP + UPGRADE_AREA_H / 2;
const UPGRADE_AREA_X = CX - UPGRADE_AREA_W / 2;
const UPGRADE_LANE_COUNT = 5;
const LANE_W = UPGRADE_AREA_W / UPGRADE_LANE_COUNT;
const LANE_INNER_PADDING_X = 10;
const LANE_INNER_TOP = 56;
const LANE_INNER_BOTTOM = 14;
const LANE_BODY_H = UPGRADE_AREA_H - LANE_INNER_TOP - LANE_INNER_BOTTOM;
const NODE_H = 68;
const NODE_GAP_Y = 12;
const NODE_GAP_X = 8;
const NODE_INNER_PADDING = 3;
const NODE_LABEL_FONT_SIZE = 13;
const NODE_META_FONT_SIZE = 11;
const TOOLTIP_OFFSET_X = 18;
const TOOLTIP_OFFSET_Y = 18;
const TOOLTIP_MAX_W = 320;

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

type LaneLayoutNode = {
  node: CoopDefenseUpgradeNodeSnapshot;
  x: number;
  y: number;
};

type LaneLayout = {
  category: CoopDefenseUpgradeCategorySnapshot;
  visuals: CategoryVisuals;
  nodeWidth: number;
  laneLeft: number;
  bodyTop: number;
  nodes: LaneLayoutNode[];
  nodesById: Map<string, LaneLayoutNode>;
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
  private upgradesContainer: Phaser.GameObjects.Container | null = null;
  private tooltipContainer: Phaser.GameObjects.Container | null = null;
  private tooltipBackground: Phaser.GameObjects.Rectangle | null = null;
  private tooltipText: Phaser.GameObjects.Text | null = null;
  private visible = false;
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
    this.upgradesContainer = null;
    this.tooltipContainer = null;
    this.tooltipBackground = null;
    this.tooltipText = null;

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

    this.pointsText = this.scene.add.text(CX, POINTS_Y, '0 Upgrade-Punkte verfuegbar', {
      fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(COLORS.BLUE_1),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.pointsText);

    objects.push(
      this.scene.add.rectangle(CX, UPGRADE_AREA_Y, UPGRADE_AREA_W, UPGRADE_AREA_H, COLORS.GREY_8, 0.52)
        .setStrokeStyle(1, COLORS.GREY_5)
        .setScrollFactor(0),
    );

    this.upgradesContainer = this.scene.add.container(0, 0).setScrollFactor(0);
    objects.push(this.upgradesContainer);

    this.tooltipBackground = this.scene.add.rectangle(0, 0, 10, 10, COLORS.GREY_9, 0.96)
      .setOrigin(0, 0)
      .setStrokeStyle(1, COLORS.GREY_4)
      .setVisible(false)
      .setScrollFactor(0);
    this.tooltipText = this.scene.add.text(0, 0, '', {
      fontSize: '14px', fontFamily: 'monospace', color: toCssColor(COLORS.GREY_1), wordWrap: { width: TOOLTIP_MAX_W },
    }).setOrigin(0, 0).setVisible(false).setScrollFactor(0);
    this.tooltipContainer = this.scene.add.container(0, 0, [this.tooltipBackground, this.tooltipText])
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

    this.renderUpgradeLanes(progress);
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

  private renderUpgradeLanes(progress: CoopDefenseProgressSnapshot): void {
    if (!this.upgradesContainer) return;

    this.upgradesContainer.removeAll(true);

    const layouts = this.buildLaneLayouts(progress.upgradeCategories);

    for (let laneIndex = 0; laneIndex < progress.upgradeCategories.length; laneIndex += 1) {
      const layout = layouts[laneIndex];
      const laneX = UPGRADE_AREA_X + laneIndex * LANE_W;
      const laneCenterX = laneX + LANE_W / 2;

      this.upgradesContainer.add(
        this.scene.add.rectangle(laneCenterX, UPGRADE_AREA_Y, LANE_W, UPGRADE_AREA_H, layout.visuals.laneFill, layout.visuals.laneAlpha)
          .setScrollFactor(0),
      );

      this.upgradesContainer.add(
        this.scene.add.text(laneCenterX, UPGRADE_AREA_TOP + 16, layout.category.label, {
          fontSize: '18px', fontFamily: 'monospace', fontStyle: 'bold', color: toCssColor(layout.visuals.title),
        }).setOrigin(0.5, 0).setScrollFactor(0),
      );

      if (laneIndex > 0) {
        this.upgradesContainer.add(
          this.scene.add.rectangle(laneX, UPGRADE_AREA_Y, 2, UPGRADE_AREA_H - 18, COLORS.GREY_5, 0.95)
            .setScrollFactor(0),
        );
      }

      this.upgradesContainer.add(
        this.scene.add.rectangle(laneCenterX, UPGRADE_AREA_TOP + LANE_INNER_TOP - 10, LANE_W - 14, 2, layout.visuals.divider, 0.9)
          .setScrollFactor(0),
      );

      this.renderLaneConnections(layout);
      this.renderLaneNodes(layout);
    }
  }

  private buildLaneLayouts(categories: readonly CoopDefenseUpgradeCategorySnapshot[]): LaneLayout[] {
    const maxRows = Math.max(1, Math.floor((LANE_BODY_H + NODE_GAP_Y) / (NODE_H + NODE_GAP_Y)));
    const categoriesWithBuckets = categories.map((category) => {
      const depths = this.computeNodeDepths(category.upgrades);
      const buckets = new Map<number, CoopDefenseUpgradeNodeSnapshot[]>();

      for (const node of category.upgrades) {
        const bucket = depths.get(node.id) ?? 0;
        const list = buckets.get(bucket) ?? [];
        list.push(node);
        buckets.set(bucket, list);
      }

      const orderedBuckets = [...buckets.entries()]
        .sort((left, right) => left[0] - right[0])
        .map(([, nodes]) => nodes);
      const totalColumns = orderedBuckets.reduce((sum, nodes) => sum + Math.max(1, Math.ceil(nodes.length / maxRows)), 0);

      return {
        category,
        orderedBuckets,
        totalColumns,
      };
    });

    const maxColumns = Math.max(1, ...categoriesWithBuckets.map((entry) => entry.totalColumns));
    const laneInnerW = LANE_W - LANE_INNER_PADDING_X * 2;
    const computedNodeWidth = Math.max(
      84,
      Math.floor((laneInnerW - NODE_GAP_X * Math.max(0, maxColumns - 1)) / maxColumns),
    );

    return categoriesWithBuckets.map(({ category, orderedBuckets }, laneIndex) => {
      const laneLeft = UPGRADE_AREA_X + laneIndex * LANE_W;
      const bodyTop = UPGRADE_AREA_TOP + LANE_INNER_TOP;
      const nodesById = new Map<string, LaneLayoutNode>();
      const nodes: LaneLayoutNode[] = [];
      let columnIndex = 0;

      for (const bucketNodes of orderedBuckets) {
        const requiredColumns = Math.max(1, Math.ceil(bucketNodes.length / maxRows));
        for (let localColumn = 0; localColumn < requiredColumns; localColumn += 1) {
          const sliceStart = localColumn * maxRows;
          const slice = bucketNodes.slice(sliceStart, sliceStart + maxRows);
          const columnCount = slice.length;
          const usedHeight = columnCount * NODE_H + Math.max(0, columnCount - 1) * NODE_GAP_Y;
          const startY = bodyTop + Math.max(0, (LANE_BODY_H - usedHeight) / 2) + NODE_H / 2;
          const x = laneLeft + LANE_INNER_PADDING_X + computedNodeWidth / 2 + columnIndex * (computedNodeWidth + NODE_GAP_X);

          slice.forEach((node, index) => {
            const layoutNode = {
              node,
              x,
              y: startY + index * (NODE_H + NODE_GAP_Y),
            };
            nodes.push(layoutNode);
            nodesById.set(node.id, layoutNode);
          });
          columnIndex += 1;
        }
      }

      return {
        category,
        visuals: CATEGORY_VISUALS[category.id],
        nodeWidth: computedNodeWidth,
        laneLeft,
        bodyTop,
        nodes,
        nodesById,
      };
    });
  }

  private computeNodeDepths(upgrades: readonly CoopDefenseUpgradeNodeSnapshot[]): Map<string, number> {
    const nodesById = new Map(upgrades.map((node) => [node.id, node]));
    const cache = new Map<string, number>();

    const visit = (nodeId: string): number => {
      const cached = cache.get(nodeId);
      if (cached != null) return cached;

      const node = nodesById.get(nodeId);
      if (!node || node.requires.length === 0) {
        cache.set(nodeId, 0);
        return 0;
      }

      const depth = 1 + Math.max(...node.requires.map((requirement) => visit(requirement.upgradeId)));
      cache.set(nodeId, depth);
      return depth;
    };

    for (const node of upgrades) visit(node.id);
    return cache;
  }

  private renderLaneConnections(layout: LaneLayout): void {
    if (!this.upgradesContainer) return;

    const graphics = this.scene.add.graphics().setScrollFactor(0);
    graphics.lineStyle(1, layout.visuals.connector, 0.72);

    for (const layoutNode of layout.nodes) {
      for (const requirement of layoutNode.node.requires) {
        const dependency = layout.nodesById.get(requirement.upgradeId);
        if (!dependency) continue;

        const startX = dependency.x + layout.nodeWidth / 2;
        const startY = dependency.y;
        const endX = layoutNode.x - layout.nodeWidth / 2;
        const endY = layoutNode.y;
        const midX = startX + Math.max(10, (endX - startX) * 0.5);

        graphics.lineStyle(1, requirement.satisfied ? layout.visuals.connector : COLORS.GREY_5, requirement.satisfied ? 0.82 : 0.55);
        graphics.beginPath();
        graphics.moveTo(startX, startY);
        graphics.lineTo(midX, startY);
        graphics.lineTo(midX, endY);
        graphics.lineTo(endX, endY);
        graphics.strokePath();
      }
    }

    this.upgradesContainer.add(graphics);
  }

  private renderLaneNodes(layout: LaneLayout): void {
    if (!this.upgradesContainer) return;

    for (const layoutNode of layout.nodes) {
      const nodeGroup = this.scene.add.container(0, 0).setScrollFactor(0);
      const interactionEnabled = layoutNode.node.canLevelUp || layoutNode.node.canLevelDown;
      const isLocked = !layoutNode.node.unlocked && layoutNode.node.level <= 0;
      const progressFraction = layoutNode.node.maxLevel > 0
        ? Phaser.Math.Clamp(layoutNode.node.level / layoutNode.node.maxLevel, 0, 1)
        : 0;
      const baseAlpha = isLocked ? 0.34 : layoutNode.node.level > 0 ? 0.92 : 0.68;

      const baseRect = this.scene.add.rectangle(layoutNode.x, layoutNode.y, layout.nodeWidth, NODE_H, layout.visuals.nodeBase, baseAlpha)
        .setStrokeStyle(2, interactionEnabled ? layout.visuals.nodeStroke : COLORS.GREY_5)
        .setScrollFactor(0);
      nodeGroup.add(baseRect);

      const fillWidth = Math.max(0, (layout.nodeWidth - NODE_INNER_PADDING * 2) * progressFraction);
      const activeFill = this.scene.add.rectangle(
        layoutNode.x - layout.nodeWidth / 2 + NODE_INNER_PADDING,
        layoutNode.y,
        Math.max(0.001, fillWidth),
        NODE_H - NODE_INNER_PADDING * 2,
        layout.visuals.nodeActive,
        layoutNode.node.level > 0 ? 0.94 : 0,
      )
        .setOrigin(0, 0.5)
        .setScrollFactor(0);
      nodeGroup.add(activeFill);

      const label = this.scene.add.text(layoutNode.x, layoutNode.y - 9, layoutNode.node.label, {
        fontSize: `${NODE_LABEL_FONT_SIZE}px`,
        fontFamily: 'monospace',
        fontStyle: 'bold',
        color: toCssColor(isLocked ? COLORS.GREY_4 : COLORS.GREY_1),
        align: 'center',
        wordWrap: { width: layout.nodeWidth - 14, useAdvancedWrap: true },
      }).setOrigin(0.5).setScrollFactor(0);
      nodeGroup.add(label);

      const levelColor = layoutNode.node.level > 0 ? COLORS.GREY_9 : isLocked ? COLORS.GREY_5 : COLORS.GREY_2;
      const metaText = this.scene.add.text(layoutNode.x, layoutNode.y + NODE_H / 2 - 11, `${layoutNode.node.level}/${layoutNode.node.maxLevel}`, {
        fontSize: `${NODE_META_FONT_SIZE}px`,
        fontFamily: 'monospace',
        color: toCssColor(levelColor),
      }).setOrigin(0.5, 1).setScrollFactor(0);
      nodeGroup.add(metaText);

      const hitArea = this.scene.add.rectangle(layoutNode.x, layoutNode.y, layout.nodeWidth, NODE_H, 0x000000, 0.001)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: interactionEnabled })
        .on('pointerover', (pointer: Phaser.Input.Pointer) => {
          baseRect.setAlpha(Math.min(1, baseAlpha + 0.12));
          this.showTooltip(layoutNode.node.description, pointer);
        })
        .on('pointermove', (pointer: Phaser.Input.Pointer) => this.updateTooltipPosition(pointer))
        .on('pointerout', () => {
          baseRect.setAlpha(baseAlpha);
          this.hideTooltip();
        })
        .on('pointerdown', (pointer: Phaser.Input.Pointer) => this.handleUpgradePointerDown(layoutNode.node, pointer));
      nodeGroup.add(hitArea);

      this.upgradesContainer.add(nodeGroup);
    }
  }

  private handleUpgradePointerDown(node: CoopDefenseUpgradeNodeSnapshot, pointer: Phaser.Input.Pointer): void {
    if (pointer.rightButtonDown()) this.onLevelDownUpgrade(node.id);
    else this.onLevelUpUpgrade(node.id);
    this.refresh();
  }

  private showTooltip(description: string, pointer: Phaser.Input.Pointer): void {
    if (!this.tooltipContainer || !this.tooltipBackground || !this.tooltipText) return;

    this.tooltipText.setText(description);
    const width = this.tooltipText.width + 18;
    const height = this.tooltipText.height + 16;

    this.tooltipBackground.setSize(width, height);
    this.tooltipText.setPosition(9, 8);
    this.tooltipContainer.setVisible(true);
    this.tooltipBackground.setVisible(true);
    this.tooltipText.setVisible(true);
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
    this.tooltipText?.setVisible(false);
  }
}