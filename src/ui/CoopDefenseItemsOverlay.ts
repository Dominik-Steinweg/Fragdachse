import * as Phaser from 'phaser';
import { COLORS, DEPTH, GAME_HEIGHT, GAME_WIDTH, toCssColor } from '../config';
import {
  COOP_DEFENSE_ITEM_SLOTS,
  getCoopDefenseItemRarityDefinition,
  getCoopDefenseItemSlotDefinition,
} from '../config/coopDefenseItems';
import { toDesignSpace } from '../graphics/RenderResolution';
import type { CoopDefenseItem, CoopDefenseItemSlot } from '../types';
import {
  getCoopDefenseItemSalvageXp,
  getEquippedCoopDefenseItems,
  type CoopDefenseEquippedItemIds,
  type CoopDefenseItemSortMode,
} from '../utils/coopDefenseItems';
import {
  buildCoopDefenseInventoryGrid,
  buildCoopDefenseItemTooltip,
  getCoopDefenseItemCellColor,
  listEquippedCoopDefenseSpecialEffects,
  resolveCoopDefenseItemDrop,
  summariseEquippedCoopDefenseItems,
  type CoopDefenseItemDropTarget,
} from './CoopDefenseItemsModel';
import {
  ensureCoopDefenseItemCellTexture,
  resolveCoopDefenseItemEmptyIconTexture,
  resolveCoopDefenseItemIconTexture,
} from './coopDefenseItemIcons';
import { attachHoverEffect } from './uiHover';
import {
  ensureGlossyButtonTexture,
  ensureFlatPanelTexture,
  ensureModalPanelTexture,
} from './uiTextures';
import { UiContextMenu } from './UiContextMenu';
import { UiTooltip } from './UiTooltip';
import { BORDER, INTENT, RADIUS, SPACE, SURFACE, TEXT, textStyle } from './uiTheme';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';
import { getLocale, t } from '../i18n';
import { getItemSlotName } from '../i18n/itemPresentation';

/**
 * Item-Menue der Lobby im Stil klassischer Action-Rollenspiele: links eine Ausruestungspuppe
 * (Helm ueber Ruestung ueber Stiefel, Handschuhe daneben), rechts alle vier Kategorien als
 * 2x5-Raster nebeneinander.
 *
 * Die Zellen zeigen nur Symbol, Seltenheitsrahmen und Stufe. Die genauen Werte liefert der
 * Mouse-Over, die Aktionen ein kleines Menue beim Klick; Ausruesten und Ablegen geht zusaetzlich
 * per Drag & Drop. Geoeffnet wird ausschliesslich aus der Lobby.
 */

export interface CoopDefenseItemsOverlayState {
  readonly items: readonly CoopDefenseItem[];
  readonly equippedItemIds: CoopDefenseEquippedItemIds;
  readonly pendingRewardCount: number;
}

const CX = GAME_WIDTH / 2;
const CY = GAME_HEIGHT / 2;

const PANEL_W = 1660;
const PANEL_H = 980;
const PANEL_TOP = CY - PANEL_H / 2;
const PANEL_BOTTOM = CY + PANEL_H / 2;
const PANEL_LEFT = CX - PANEL_W / 2;
const PANEL_RIGHT = CX + PANEL_W / 2;
const CONTENT_PAD = 34;

const TITLE_Y = PANEL_TOP + 50;
const REWARD_HINT_Y = TITLE_Y + 38;

const SECTION_TOP = PANEL_TOP + 110;
const SECTION_BOTTOM = PANEL_BOTTOM - 96;
const SECTION_H = SECTION_BOTTOM - SECTION_TOP;
const SECTION_CY = SECTION_TOP + SECTION_H / 2;
const SECTION_TITLE_Y = SECTION_TOP + 30;

// ── Ausruestungspuppe ────────────────────────────────────────────────────────
const DOLL_W = 500;
const DOLL_LEFT = PANEL_LEFT + CONTENT_PAD;
const DOLL_CX = DOLL_LEFT + DOLL_W / 2;
const DOLL_CELL = 120;
const DOLL_ROW_STRIDE = 150;
const DOLL_TOP_Y = SECTION_TOP + 116;

/**
 * Feste Plaetze der Puppe. Rechts neben der Ruestung bleibt bewusst Raum frei, damit spaeter
 * weitere Slots (Ringe, Amulett) ohne Umbau danebenpassen.
 */
const DOLL_POSITIONS: Readonly<Record<CoopDefenseItemSlot, { x: number; y: number }>> = {
  helmet: { x: DOLL_CX, y: DOLL_TOP_Y },
  gloves: { x: DOLL_CX - 142, y: DOLL_TOP_Y + DOLL_ROW_STRIDE },
  armor: { x: DOLL_CX, y: DOLL_TOP_Y + DOLL_ROW_STRIDE },
  boots: { x: DOLL_CX, y: DOLL_TOP_Y + DOLL_ROW_STRIDE * 2 },
};

const SUMMARY_TITLE_Y = DOLL_TOP_Y + DOLL_ROW_STRIDE * 2 + 104;
const SUMMARY_START_Y = SUMMARY_TITLE_Y + 34;
const SUMMARY_LINE_H = 18;
const SUMMARY_COLUMN_GAP = 24;
const SUMMARY_COLUMN_W = (DOLL_W - 92 - SUMMARY_COLUMN_GAP) / 2;
const MAX_SUMMARY_LINES = 12;
const SPECIAL_TITLE_Y = SUMMARY_START_Y + Math.ceil(MAX_SUMMARY_LINES / 2) * SUMMARY_LINE_H + 20;
const SPECIAL_START_Y = SPECIAL_TITLE_Y + 24;
const SPECIAL_LINE_H = 18;
const MAX_SPECIAL_EFFECT_LINES = 8;
const EMPTY_SLOT_ICON_ALPHA = 0.1;

// ── Inventarraster ───────────────────────────────────────────────────────────
const GRID_LEFT = DOLL_LEFT + DOLL_W + 28;
const GRID_W = PANEL_RIGHT - CONTENT_PAD - GRID_LEFT;
const GRID_CX = GRID_LEFT + GRID_W / 2;

const CELL = 104;
const CELL_GAP = 12;
const GRID_COLUMNS = 2;
const GRID_ROWS = 5;
const COLUMN_W = CELL * GRID_COLUMNS + CELL_GAP;
const COLUMN_GAP = 45;
const COLUMNS_LEFT = GRID_CX - (COLUMN_W * 4 + COLUMN_GAP * 3) / 2;
const COLUMN_TITLE_Y = SECTION_TOP + 58;
const CELL_TOP_Y = SECTION_TOP + 104;
const GRID_HINT_Y = CELL_TOP_Y + GRID_ROWS * (CELL + CELL_GAP) + 34;

const FOOTER_Y = PANEL_BOTTOM - 46;
const FOOTER_BTN_W = 260;
const FOOTER_BTN_H = 50;
const SORT_BTN_W = 240;

const TEX_PANEL = '_cdio_panel';
const TEX_SECTION_DOLL = '_cdio_section_doll';
const TEX_SECTION_GRID = '_cdio_section_grid';
const TEX_FOOTER = '_cdio_footer';
const TEX_SORT = '_cdio_sort';

/** Eine Item-Zelle: Rahmen in Seltenheitsfarbe, Symbol, Stufenmarke. */
interface ItemCell {
  readonly container: Phaser.GameObjects.Container;
  readonly frame: Phaser.GameObjects.Image;
  readonly icon: Phaser.GameObjects.Image;
  readonly level: Phaser.GameObjects.Text;
  readonly slot: CoopDefenseItemSlot;
  readonly size: number;
  /** `true` fuer die Plaetze der Ausruestungspuppe. */
  readonly equipmentSlot: boolean;
  item: CoopDefenseItem | null;
  hovered: boolean;
}

export class CoopDefenseItemsOverlay {
  private container: Phaser.GameObjects.Container | null = null;
  private dollCells = new Map<CoopDefenseItemSlot, ItemCell>();
  private stashCells: ItemCell[] = [];
  private columnTitles = new Map<CoopDefenseItemSlot, Phaser.GameObjects.Text>();
  private columnHighlights = new Map<CoopDefenseItemSlot, Phaser.GameObjects.Rectangle>();
  private summaryLines: Phaser.GameObjects.Text[] = [];
  private specialEffectLines: Phaser.GameObjects.Text[] = [];
  private specialEffectsTitle: Phaser.GameObjects.Text | null = null;
  private summaryEmpty: Phaser.GameObjects.Text | null = null;
  private sortLabel: Phaser.GameObjects.Text | null = null;
  private rewardHint: Phaser.GameObjects.Text | null = null;

  private tooltip: UiTooltip | null = null;
  private contextMenu: UiContextMenu | null = null;
  private ghost: Phaser.GameObjects.Container | null = null;
  private ghostFrame: Phaser.GameObjects.Image | null = null;
  private ghostIcon: Phaser.GameObjects.Image | null = null;

  /** Ablageziele je Drop-Zone; die Zonen selbst sind Rahmen bzw. unsichtbare Spaltenflaechen. */
  private dropTargets = new Map<Phaser.GameObjects.GameObject, CoopDefenseItemDropTarget>();

  private visible = false;
  private sortMode: CoopDefenseItemSortMode = 'rarity';
  /** Zweiter Klick auf Zerlegen bestaetigt; verhindert versehentliche Verluste. */
  private pendingSalvageUid: string | null = null;
  /** Nach einem Zug darf das folgende `pointerup` kein Aktionsmenue oeffnen. */
  private dragJustEnded = false;
  private previousDragThreshold: number | null = null;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getState: () => CoopDefenseItemsOverlayState,
    private readonly onEquip: (uid: string) => void,
    private readonly onUnequip: (slot: CoopDefenseItemSlot) => void,
    private readonly onSalvage: (uid: string) => void,
    private readonly onOpenPendingReward: () => void,
    private readonly onClose: () => void,
  ) {}

  build(): void {
    this.destroy();
    const objects: Phaser.GameObjects.GameObject[] = [];

    objects.push(
      this.scene.add.rectangle(CX, CY, GAME_WIDTH, GAME_HEIGHT, COLORS.GREY_10, 0.86)
        .setScrollFactor(0)
        .setInteractive(),
    );
    objects.push(
      this.scene.add.image(
        CX,
        CY,
        ensureModalPanelTexture(this.scene, TEX_PANEL, PANEL_W, PANEL_H, SURFACE.modal, BORDER.default),
      ).setScrollFactor(0).setInteractive(),
    );
    objects.push(
      this.scene.add.text(CX, TITLE_Y, t('ui.items.title'), textStyle('display'))
        .setOrigin(0.5).setScrollFactor(0),
    );

    this.rewardHint = this.scene.add.text(CX, REWARD_HINT_Y, '', textStyle('label', {
      color: TEXT.accent,
    })).setOrigin(0.5).setScrollFactor(0).setInteractive({ useHandCursor: true });
    this.rewardHint.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
      if (this.getState().pendingRewardCount > 0) this.onOpenPendingReward();
    });
    objects.push(this.rewardHint);

    this.buildDollSection(objects);
    this.buildGridSection(objects);
    this.buildFooter(objects);

    // Tooltip, Aktionsmenue und Zieh-Schemen liegen als letzte Kinder ueber allem im Overlay,
    // bleiben aber unter Ergebnis- und Belohnungs-Layer – die Depth-Leiter aendert sich nicht.
    this.tooltip = new UiTooltip(this.scene, 340);
    objects.push(this.tooltip.build());
    objects.push(this.buildGhost());

    this.container = this.scene.add.container(0, 0, objects)
      .setDepth(DEPTH.OVERLAY + 3)
      .setVisible(false);
    promoteToClarityCamera(this.scene, this.container);
    this.contextMenu = new UiContextMenu(this.scene, this.container);
  }

  show(): void {
    if (!this.container) this.build();
    this.visible = true;
    this.pendingSalvageUid = null;
    // Ohne Mindestdistanz startet Phaser das Ziehen schon beim Druecken; ein einfacher Klick
    // wuerde dann nie das Aktionsmenue erreichen.
    if (this.previousDragThreshold === null) {
      this.previousDragThreshold = this.scene.input.dragDistanceThreshold;
    }
    this.scene.input.dragDistanceThreshold = 8;
    this.container!.setVisible(true);
    this.refresh();
  }

  hide(): void {
    this.visible = false;
    this.pendingSalvageUid = null;
    this.closeTransientLayers();
    if (this.previousDragThreshold !== null) {
      this.scene.input.dragDistanceThreshold = this.previousDragThreshold;
      this.previousDragThreshold = null;
    }
    this.container?.setVisible(false);
  }

  isOpen(): boolean {
    return this.visible;
  }

  /** Nach jeder Aenderung von aussen aufrufen; liest den Stand ueber `getState()` neu. */
  refresh(): void {
    if (!this.visible) return;
    const state = this.getState();

    this.rewardHint?.setText(state.pendingRewardCount === 1
      ? t('ui.items.openReward')
      : state.pendingRewardCount > 1
        ? t('ui.items.openRewards', { count: state.pendingRewardCount })
        : '');
    this.sortLabel?.setText(this.sortMode === 'rarity' ? t('ui.items.sortRarity') : t('ui.items.sortLevel'));

    const columns = buildCoopDefenseInventoryGrid(state.items, state.equippedItemIds, this.sortMode);
    columns.forEach((column, columnIndex) => {
      const dollCell = this.dollCells.get(column.slot);
      if (dollCell) this.renderCell(dollCell, column.equipped);

      this.columnTitles.get(column.slot)?.setText(
        `${getItemSlotName(column.slot, getLocale()).toUpperCase()}  ${column.used}/${column.capacity}`,
      );

      column.cells.forEach((item, cellIndex) => {
        this.renderCell(this.stashCells[columnIndex * column.cells.length + cellIndex], item);
      });
    });

    this.renderSummary(getEquippedCoopDefenseItems(state.items, state.equippedItemIds));
  }

  destroy(): void {
    this.closeTransientLayers();
    this.tooltip?.destroy();
    this.tooltip = null;
    this.contextMenu?.destroy();
    this.contextMenu = null;
    this.container?.destroy(true);
    this.container = null;
    this.dollCells = new Map();
    this.stashCells = [];
    this.columnTitles = new Map();
    this.columnHighlights = new Map();
    this.dropTargets = new Map();
    this.summaryLines = [];
    this.specialEffectLines = [];
    this.specialEffectsTitle = null;
    this.summaryEmpty = null;
    this.sortLabel = null;
    this.rewardHint = null;
    this.ghost = null;
    this.ghostFrame = null;
    this.ghostIcon = null;
    this.visible = false;
    this.pendingSalvageUid = null;
    if (this.previousDragThreshold !== null) {
      this.scene.input.dragDistanceThreshold = this.previousDragThreshold;
      this.previousDragThreshold = null;
    }
  }

  // ── Aufbau ────────────────────────────────────────────────────────────────

  private buildDollSection(objects: Phaser.GameObjects.GameObject[]): void {
    objects.push(
      this.scene.add.image(DOLL_CX, SECTION_CY, ensureFlatPanelTexture(
        this.scene, TEX_SECTION_DOLL, DOLL_W, SECTION_H, SURFACE.raised, BORDER.subtle,
        { radius: RADIUS.lg, fillAlpha: 0.96, strokeAlpha: 0.85 },
      )).setScrollFactor(0),
      this.scene.add.text(DOLL_CX, SECTION_TITLE_Y, t('ui.items.equipped'), textStyle('subtitle'))
        .setOrigin(0.5).setScrollFactor(0),
    );

    for (const slot of COOP_DEFENSE_ITEM_SLOTS) {
      const position = DOLL_POSITIONS[slot];
      const cell = this.buildCell(slot, position.x, position.y, DOLL_CELL, true);
      this.dollCells.set(slot, cell);
      this.registerDropZone(cell.frame, { slot, kind: 'equipment' });
      objects.push(cell.container);
      objects.push(
        this.scene.add.text(position.x, position.y + DOLL_CELL / 2 + SPACE.md, getItemSlotName(slot, getLocale()).toUpperCase(), textStyle('section'))
          .setOrigin(0.5).setScrollFactor(0),
      );
    }

    objects.push(
      this.scene.add.rectangle(DOLL_CX, SUMMARY_TITLE_Y - 20, DOLL_W - 80, 1, COLORS.GREY_5, 0.55)
        .setScrollFactor(0),
      this.scene.add.text(DOLL_CX, SUMMARY_TITLE_Y, t('ui.items.totalStats'), textStyle('section'))
        .setOrigin(0.5).setScrollFactor(0),
    );
    this.summaryEmpty = this.scene.add.text(DOLL_CX, SUMMARY_START_Y + SPACE.xs, t('ui.items.emptyEquipped'), textStyle('body', {
      color: TEXT.disabled,
    })).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.summaryEmpty);

    for (let index = 0; index < MAX_SUMMARY_LINES; index++) {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const columnLeft = DOLL_CX - DOLL_W / 2 + 46 + column * (SUMMARY_COLUMN_W + SUMMARY_COLUMN_GAP);
      const y = SUMMARY_START_Y + row * SUMMARY_LINE_H;
      const label = this.scene.add.text(columnLeft, y, '', textStyle('caption', {
        color: TEXT.muted,
      })).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false).setWordWrapWidth(SUMMARY_COLUMN_W - 64);
      const value = this.scene.add.text(columnLeft + SUMMARY_COLUMN_W, y, '', textStyle('caption', {
        color: TEXT.primary,
      })).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);
      this.summaryLines.push(label, value);
      objects.push(label, value);
    }

    this.specialEffectsTitle = this.scene.add.text(DOLL_CX, SPECIAL_TITLE_Y, t('ui.items.specialEffects'), textStyle('section'))
      .setOrigin(0.5).setScrollFactor(0).setVisible(false);
    objects.push(this.specialEffectsTitle);
    for (let index = 0; index < MAX_SPECIAL_EFFECT_LINES; index++) {
      const column = index % 2;
      const row = Math.floor(index / 2);
      const columnLeft = DOLL_CX - DOLL_W / 2 + 46 + column * (SUMMARY_COLUMN_W + SUMMARY_COLUMN_GAP);
      const line = this.scene.add.text(columnLeft, SPECIAL_START_Y + row * SPECIAL_LINE_H, '', textStyle('caption', {
        color: TEXT.accent,
      })).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);
      this.specialEffectLines.push(line);
      objects.push(line);
    }
  }

  private buildGridSection(objects: Phaser.GameObjects.GameObject[]): void {
    objects.push(
      this.scene.add.image(GRID_CX, SECTION_CY, ensureFlatPanelTexture(
        this.scene, TEX_SECTION_GRID, GRID_W, SECTION_H, SURFACE.raised, BORDER.subtle,
        { radius: RADIUS.lg, fillAlpha: 0.96, strokeAlpha: 0.85 },
      )).setScrollFactor(0),
      this.scene.add.text(GRID_CX, SECTION_TITLE_Y, t('ui.items.inventory'), textStyle('subtitle'))
        .setOrigin(0.5).setScrollFactor(0),
      this.scene.add.text(GRID_CX, GRID_HINT_Y, t('ui.items.instructions'), textStyle('caption'))
        .setOrigin(0.5).setScrollFactor(0),
    );

    const columnH = GRID_ROWS * (CELL + CELL_GAP) + 30;
    COOP_DEFENSE_ITEM_SLOTS.forEach((slot, columnIndex) => {
      const columnLeft = COLUMNS_LEFT + columnIndex * (COLUMN_W + COLUMN_GAP);
      const columnCx = columnLeft + COLUMN_W / 2;
      const columnCy = CELL_TOP_Y + columnH / 2 - 22;

      // Ablagezone der Spalte: unsichtbar, liegt unter den Zellen und faengt nur Drops ab. Die
      // Fuellung ist durchsichtig, die Objekt-Alpha bleibt aber 1 – sonst wuerde Phaser die
      // Flaeche gar nicht erst treffen.
      const zone = this.scene.add.rectangle(columnCx, columnCy, COLUMN_W + 24, columnH, 0x000000, 0)
        .setScrollFactor(0)
        .setInteractive();
      this.registerDropZone(zone, { slot, kind: 'stash' });
      objects.push(zone);

      const highlight = this.scene.add.rectangle(columnCx, columnCy, COLUMN_W + 24, columnH)
        .setStrokeStyle(2, COLORS.GOLD_2, 0.9)
        .setScrollFactor(0)
        .setVisible(false);
      this.columnHighlights.set(slot, highlight);
      objects.push(highlight);

      const title = this.scene.add.text(columnCx, COLUMN_TITLE_Y, '', textStyle('section'))
        .setOrigin(0.5).setScrollFactor(0);
      this.columnTitles.set(slot, title);
      objects.push(title);

      for (let index = 0; index < GRID_COLUMNS * GRID_ROWS; index++) {
        const column = index % GRID_COLUMNS;
        const row = Math.floor(index / GRID_COLUMNS);
        const cell = this.buildCell(
          slot,
          columnLeft + CELL / 2 + column * (CELL + CELL_GAP),
          CELL_TOP_Y + CELL / 2 + row * (CELL + CELL_GAP),
          CELL,
          false,
        );
        this.stashCells.push(cell);
        objects.push(cell.container);
      }
    });
  }

  private buildFooter(objects: Phaser.GameObjects.GameObject[]): void {
    const sortX = PANEL_LEFT + CONTENT_PAD + SORT_BTN_W / 2;
    const sortButton = this.scene.add.image(
      sortX, FOOTER_Y,
      ensureGlossyButtonTexture(this.scene, TEX_SORT, SORT_BTN_W, FOOTER_BTN_H, INTENT.secondary.fill, INTENT.secondary.stroke),
    ).setScrollFactor(0).setInteractive({ useHandCursor: true });
    this.sortLabel = this.scene.add.text(sortX, FOOTER_Y, '', textStyle('labelSm', {
      color: INTENT.secondary.label,
    })).setOrigin(0.5).setScrollFactor(0);
    sortButton.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
      this.sortMode = this.sortMode === 'rarity' ? 'itemLevel' : 'rarity';
      this.closeTransientLayers();
      this.refresh();
    });
    attachHoverEffect(this.scene, sortButton, this.sortLabel);
    objects.push(sortButton, this.sortLabel);

    const closeX = PANEL_RIGHT - CONTENT_PAD - FOOTER_BTN_W / 2;
    const closeButton = this.scene.add.image(
      closeX, FOOTER_Y,
      ensureGlossyButtonTexture(this.scene, TEX_FOOTER, FOOTER_BTN_W, FOOTER_BTN_H, INTENT.neutral.fill, INTENT.neutral.stroke),
    ).setScrollFactor(0).setInteractive({ useHandCursor: true });
    const closeLabel = this.scene.add.text(closeX, FOOTER_Y, t('ui.items.close'), textStyle('label', {
      color: INTENT.neutral.label,
    })).setOrigin(0.5).setScrollFactor(0);
    closeButton.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
      this.hide();
      this.onClose();
    });
    attachHoverEffect(this.scene, closeButton, closeLabel);
    objects.push(closeButton, closeLabel);
  }

  private buildGhost(): Phaser.GameObjects.Container {
    this.ghostFrame = this.scene.add.image(0, 0, ensureCoopDefenseItemCellTexture(
      this.scene, CELL, CELL, COLORS.GOLD_2, 'hot',
    )).setScrollFactor(0);
    this.ghostIcon = this.scene.add.image(0, 0, resolveCoopDefenseItemIconTexture(this.scene, 'armor', 1, CELL))
      .setDisplaySize(CELL * 0.68, CELL * 0.68)
      .setScrollFactor(0);
    this.ghost = this.scene.add.container(0, 0, [this.ghostFrame, this.ghostIcon])
      .setScrollFactor(0)
      .setAlpha(0.85)
      .setVisible(false);
    return this.ghost;
  }

  private buildCell(
    slot: CoopDefenseItemSlot,
    x: number,
    y: number,
    size: number,
    equipmentSlot: boolean,
  ): ItemCell {
    const frame = this.scene.add.image(0, 0, ensureCoopDefenseItemCellTexture(
      this.scene, size, size, COLORS.GREY_6, 'empty',
    )).setScrollFactor(0).setInteractive();
    const icon = this.scene.add.image(0, 0, resolveCoopDefenseItemEmptyIconTexture(this.scene, slot, size))
      .setDisplaySize(size * 0.68, size * 0.68)
      .setScrollFactor(0);
    const level = this.scene.add.text(size / 2 - SPACE.sm, size / 2 - SPACE.sm, '', textStyle('numS', {
      color: TEXT.primary,
    })).setOrigin(1, 1).setScrollFactor(0);

    const cell: ItemCell = {
      container: this.scene.add.container(x, y, [frame, icon, level]).setScrollFactor(0),
      frame,
      icon,
      level,
      slot,
      size,
      equipmentSlot,
      item: null,
      hovered: false,
    };

    this.attachCellHandlers(cell);
    return cell;
  }

  /**
   * Ein Ablageziel braucht beides: den Eintrag fuer die Aufloesung **und** das `dropZone`-Flag.
   * Ohne das Flag sammelt Phaser die Flaeche gar nicht erst ein und `drop` bleibt still aus.
   */
  private registerDropZone(
    target: Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle,
    dropTarget: CoopDefenseItemDropTarget,
  ): void {
    if (target.input) target.input.dropZone = true;
    this.dropTargets.set(target, dropTarget);
  }

  private attachCellHandlers(cell: ItemCell): void {
    cell.frame.on('pointerover', (pointer: Phaser.Input.Pointer) => {
      cell.hovered = true;
      this.applyCellTexture(cell);
      if (!cell.item || this.contextMenu?.isOpen()) return;
      this.showCellTooltip(cell, pointer);
    });
    cell.frame.on('pointermove', (pointer: Phaser.Input.Pointer) => this.tooltip?.move(pointer));
    cell.frame.on('pointerout', () => {
      cell.hovered = false;
      this.applyCellTexture(cell);
      this.tooltip?.hide();
    });

    // Zellen sind ziehbar, deshalb entscheidet erst das Loslassen ueber den Klick: nach einem
    // echten Zug darf kein Aktionsmenue aufgehen.
    cell.frame.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
      // Ein Zug kann ausserhalb jeder Zelle enden; die Sperre loest sich deshalb hier wieder,
      // nicht erst beim naechsten Loslassen ueber einer Zelle.
      this.dragJustEnded = false;
    });
    cell.frame.on('pointerup', (pointer: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
      if (this.dragJustEnded) {
        this.dragJustEnded = false;
        return;
      }
      if (cell.item) {
        // Die Koordinaten sofort kopieren: Phaser aktualisiert das Pointer-Objekt beim Klick
        // auf die Menuezeile. Die Bestaetigung muss trotzdem am urspruenglichen Anker bleiben.
        this.openCellMenu(
          cell,
          toDesignSpace(this.scene.scale, pointer.x) + 8,
          toDesignSpace(this.scene.scale, pointer.y) + 8,
        );
      }
    });

    cell.frame.on('dragstart', () => this.handleDragStart(cell));
    cell.frame.on('drag', (pointer: Phaser.Input.Pointer) => this.moveGhost(pointer));
    cell.frame.on('drop', (_pointer: Phaser.Input.Pointer, zone: Phaser.GameObjects.GameObject) => {
      this.handleDrop(cell, zone);
    });
    cell.frame.on('dragend', () => this.handleDragEnd(cell));
  }

  // ── Darstellung ───────────────────────────────────────────────────────────

  private renderCell(cell: ItemCell | undefined, item: CoopDefenseItem | null): void {
    if (!cell) return;
    cell.item = item;
    const iconTexture = item
      ? resolveCoopDefenseItemIconTexture(this.scene, cell.slot, item.itemLevel, cell.size)
      : resolveCoopDefenseItemEmptyIconTexture(this.scene, cell.slot, cell.size);
    cell.icon
      .setTexture(iconTexture)
      .setDisplaySize(cell.size * 0.68, cell.size * 0.68)
      // Die Empty-Assets tragen bereits ihre bewusst starke Alpha-Transparenz.
      // Nur der generische Fallback wird wie bisher zusaetzlich abgeschwaecht.
      .setAlpha(item ? 1 : EMPTY_SLOT_ICON_ALPHA);
    cell.level.setText(item ? `L${item.itemLevel}` : '');
    this.applyCellTexture(cell);
    this.scene.input.setDraggable(cell.frame, !!item);
  }

  private applyCellTexture(cell: ItemCell): void {
    const variant = cell.item ? (cell.hovered ? 'hot' : 'rest') : 'empty';
    cell.frame.setTexture(ensureCoopDefenseItemCellTexture(
      this.scene, cell.size, cell.size, getCoopDefenseItemCellColor(cell.item), variant,
    ));
  }

  private renderSummary(equippedItems: readonly CoopDefenseItem[]): void {
    const lines = summariseEquippedCoopDefenseItems(equippedItems);
    const specialEffects = listEquippedCoopDefenseSpecialEffects(equippedItems);
    this.summaryEmpty?.setVisible(lines.length === 0 && specialEffects.length === 0);
    for (let index = 0; index < MAX_SUMMARY_LINES; index++) {
      const label = this.summaryLines[index * 2];
      const value = this.summaryLines[index * 2 + 1];
      const line = lines[index];
      label.setVisible(!!line).setText(line?.label ?? '');
      value.setVisible(!!line).setText(line?.text ?? '');
    }
    this.specialEffectsTitle?.setVisible(specialEffects.length > 0);
    this.specialEffectLines.forEach((line, index) => {
      const effect = specialEffects[index];
      line.setVisible(!!effect).setText(effect?.text ?? '');
    });
  }

  private showCellTooltip(cell: ItemCell, pointer: Phaser.Input.Pointer): void {
    if (!cell.item) return;
    const state = this.getState();
    const equippedUid = state.equippedItemIds[cell.slot];
    const equipped = state.items.find((entry) => entry.uid === equippedUid) ?? null;
    const content = buildCoopDefenseItemTooltip(cell.item, equipped, cell.equipmentSlot);
    this.tooltip?.show(content.title, content.titleColor, content.lines, pointer);
  }

  // ── Aktionen ──────────────────────────────────────────────────────────────

  private openCellMenu(cell: ItemCell, x: number, y: number): void {
    const item = cell.item;
    if (!item || !this.contextMenu) return;
    this.tooltip?.hide();

    const rarity = getCoopDefenseItemRarityDefinition(item.rarity);
    const confirming = this.pendingSalvageUid === item.uid;
    const salvageXp = getCoopDefenseItemSalvageXp(item);

    this.contextMenu.open({
      x,
      y,
      title: `${getItemSlotName(cell.slot, getLocale())} · ${t('ui.items.level')} ${item.itemLevel}`,
      titleColor: rarity.color,
      onClose: () => {
        this.pendingSalvageUid = null;
      },
      entries: [
        cell.equipmentSlot
          ? {
            label: t('ui.items.drop'),
            color: COLORS.GREY_1,
            onPick: () => {
              this.onUnequip(cell.slot);
              this.refresh();
            },
          }
          : {
            label: t('ui.items.equip'),
            color: COLORS.GREEN_2,
            onPick: () => {
              this.onEquip(item.uid);
              this.refresh();
            },
          },
        {
          label: confirming
            ? `${t('ui.items.confirmSalvage')} +${salvageXp} XP`
            : `${t('ui.items.salvage')} +${salvageXp} XP`,
          color: confirming ? COLORS.RED_1 : COLORS.GREY_2,
          keepOpen: !confirming,
          onPick: () => {
            if (!confirming) {
              // Erster Klick fragt nach; erst der zweite zerlegt wirklich.
              this.pendingSalvageUid = item.uid;
              this.openCellMenu(cell, x, y);
              return;
            }
            this.pendingSalvageUid = null;
            // Getragene Teile lassen sich nicht direkt zerlegen; die Persistenz verweigert das
            // bewusst. Deshalb erst ablegen, dann zerlegen.
            if (cell.equipmentSlot) this.onUnequip(cell.slot);
            this.onSalvage(item.uid);
            this.refresh();
          },
        },
      ],
    });
  }

  // ── Ziehen und Ablegen ────────────────────────────────────────────────────

  private handleDragStart(cell: ItemCell): void {
    if (!cell.item) return;
    this.tooltip?.hide();
    this.contextMenu?.close();

    this.ghostFrame?.setTexture(ensureCoopDefenseItemCellTexture(
      this.scene, CELL, CELL, getCoopDefenseItemCellColor(cell.item), 'hot',
    ));
    this.ghostIcon?.setTexture(resolveCoopDefenseItemIconTexture(this.scene, cell.slot, cell.item.itemLevel, CELL))
      .setDisplaySize(CELL * 0.68, CELL * 0.68);
    this.ghost?.setPosition(cell.container.x, cell.container.y).setVisible(true);
    cell.container.setAlpha(0.35);

    // Nur die Kategorie des gezogenen Teils nimmt es an; die gueltige Seite wird hervorgehoben.
    if (cell.equipmentSlot) this.columnHighlights.get(cell.slot)?.setVisible(true);
    else this.dollCells.get(cell.slot)?.frame.setTint(COLORS.GOLD_2);
  }

  private moveGhost(pointer: Phaser.Input.Pointer): void {
    this.ghost?.setPosition(
      toDesignSpace(this.scene.scale, pointer.x),
      toDesignSpace(this.scene.scale, pointer.y),
    );
  }

  private handleDrop(cell: ItemCell, zone: Phaser.GameObjects.GameObject): void {
    const item = cell.item;
    const target = this.dropTargets.get(zone);
    if (!item || !target) return;

    const action = resolveCoopDefenseItemDrop({ item, equipped: cell.equipmentSlot }, target);
    if (action === 'equip') this.onEquip(item.uid);
    else if (action === 'unequip') this.onUnequip(cell.slot);
    else return;
    this.refresh();
  }

  private handleDragEnd(cell: ItemCell): void {
    this.dragJustEnded = true;
    this.ghost?.setVisible(false);
    cell.container.setAlpha(1);
    this.columnHighlights.forEach((highlight) => highlight.setVisible(false));
    this.dollCells.forEach((dollCell) => dollCell.frame.clearTint());
  }

  private closeTransientLayers(): void {
    this.tooltip?.hide();
    this.contextMenu?.close();
    this.ghost?.setVisible(false);
    this.columnHighlights.forEach((highlight) => highlight.setVisible(false));
    this.dollCells.forEach((cell) => {
      cell.frame.clearTint();
      cell.container.setAlpha(1);
    });
    this.stashCells.forEach((cell) => cell.container.setAlpha(1));
  }
}
