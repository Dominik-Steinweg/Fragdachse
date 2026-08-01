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
  resolveCoopDefenseItemDrop,
  summariseEquippedCoopDefenseItems,
  type CoopDefenseItemDropTarget,
} from './CoopDefenseItemsModel';
import {
  ensureCoopDefenseItemCellTexture,
  resolveCoopDefenseItemIconTexture,
} from './coopDefenseItemIcons';
import { attachHoverEffect } from './uiHover';
import {
  ensureGlossyButtonTexture,
  ensureModalPanelTexture,
  ensureTintedSectionTexture,
} from './uiTextures';
import { UiContextMenu } from './UiContextMenu';
import { UiTooltip } from './UiTooltip';
import { promoteToClarityCamera } from '../scenes/arena/ClarityCameraRegistry';

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
  readonly hasPendingReward: boolean;
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
const SUMMARY_LINE_H = 26;
const MAX_SUMMARY_LINES = 8;

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
        ensureModalPanelTexture(this.scene, TEX_PANEL, PANEL_W, PANEL_H, COLORS.GREY_7, COLORS.GOLD_1),
      ).setScrollFactor(0).setInteractive(),
    );
    objects.push(
      this.scene.add.text(CX, TITLE_Y, 'AUSRUESTUNG', {
        fontFamily: 'monospace', fontSize: '38px', fontStyle: 'bold', color: toCssColor(COLORS.GOLD_1),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    this.rewardHint = this.scene.add.text(CX, REWARD_HINT_Y, '', {
      fontFamily: 'monospace', fontSize: '17px', fontStyle: 'bold', color: toCssColor(COLORS.GOLD_2),
    }).setOrigin(0.5).setScrollFactor(0).setInteractive({ useHandCursor: true });
    this.rewardHint.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event?.stopPropagation();
      if (this.getState().hasPendingReward) this.onOpenPendingReward();
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

    this.rewardHint?.setText(state.hasPendingReward ? '● Offene Belohnung – hier auswaehlen' : '');
    this.sortLabel?.setText(this.sortMode === 'rarity' ? 'SORTIERUNG: SELTENHEIT' : 'SORTIERUNG: STUFE');

    const columns = buildCoopDefenseInventoryGrid(state.items, state.equippedItemIds, this.sortMode);
    columns.forEach((column, columnIndex) => {
      const dollCell = this.dollCells.get(column.slot);
      if (dollCell) this.renderCell(dollCell, column.equipped);

      this.columnTitles.get(column.slot)?.setText(
        `${getCoopDefenseItemSlotDefinition(column.slot).label.toUpperCase()}  ${column.used}/${column.capacity}`,
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
      this.scene.add.image(DOLL_CX, SECTION_CY, ensureTintedSectionTexture(
        this.scene, TEX_SECTION_DOLL, DOLL_W, SECTION_H, COLORS.GOLD_3, COLORS.GREY_9,
      )).setScrollFactor(0),
      this.scene.add.text(DOLL_CX, SECTION_TITLE_Y, 'AUSGERUESTET', {
        fontFamily: 'monospace', fontSize: '22px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
      }).setOrigin(0.5).setScrollFactor(0),
    );

    for (const slot of COOP_DEFENSE_ITEM_SLOTS) {
      const position = DOLL_POSITIONS[slot];
      const cell = this.buildCell(slot, position.x, position.y, DOLL_CELL, true);
      this.dollCells.set(slot, cell);
      this.registerDropZone(cell.frame, { slot, kind: 'equipment' });
      objects.push(cell.container);
      objects.push(
        this.scene.add.text(position.x, position.y + DOLL_CELL / 2 + 13, getCoopDefenseItemSlotDefinition(slot).label.toUpperCase(), {
          fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_4),
        }).setOrigin(0.5).setScrollFactor(0),
      );
    }

    objects.push(
      this.scene.add.rectangle(DOLL_CX, SUMMARY_TITLE_Y - 20, DOLL_W - 80, 1, COLORS.GREY_5, 0.55)
        .setScrollFactor(0),
      this.scene.add.text(DOLL_CX, SUMMARY_TITLE_Y, 'GESAMTWERTE', {
        fontFamily: 'monospace', fontSize: '16px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_3),
      }).setOrigin(0.5).setScrollFactor(0),
    );
    this.summaryEmpty = this.scene.add.text(DOLL_CX, SUMMARY_START_Y + 6, 'Nichts ausgeruestet.', {
      fontFamily: 'monospace', fontSize: '15px', color: toCssColor(COLORS.GREY_5),
    }).setOrigin(0.5).setScrollFactor(0);
    objects.push(this.summaryEmpty);

    for (let index = 0; index < MAX_SUMMARY_LINES; index++) {
      const y = SUMMARY_START_Y + index * SUMMARY_LINE_H;
      const label = this.scene.add.text(DOLL_CX - DOLL_W / 2 + 46, y, '', {
        fontFamily: 'monospace', fontSize: '15px', color: toCssColor(COLORS.GREY_3),
      }).setOrigin(0, 0.5).setScrollFactor(0).setVisible(false);
      const value = this.scene.add.text(DOLL_CX + DOLL_W / 2 - 46, y, '', {
        fontFamily: 'monospace', fontSize: '15px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
      }).setOrigin(1, 0.5).setScrollFactor(0).setVisible(false);
      this.summaryLines.push(label, value);
      objects.push(label, value);
    }
  }

  private buildGridSection(objects: Phaser.GameObjects.GameObject[]): void {
    objects.push(
      this.scene.add.image(GRID_CX, SECTION_CY, ensureTintedSectionTexture(
        this.scene, TEX_SECTION_GRID, GRID_W, SECTION_H, COLORS.BLUE_3, COLORS.GREY_9,
      )).setScrollFactor(0),
      this.scene.add.text(GRID_CX, SECTION_TITLE_Y, 'INVENTAR', {
        fontFamily: 'monospace', fontSize: '22px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
      }).setOrigin(0.5).setScrollFactor(0),
      this.scene.add.text(GRID_CX, GRID_HINT_Y, 'Mouse-Over zeigt die Werte · Klick oeffnet das Menue · Ziehen ruestet aus und ab', {
        fontFamily: 'monospace', fontSize: '14px', color: toCssColor(COLORS.GREY_4),
      }).setOrigin(0.5).setScrollFactor(0),
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

      const title = this.scene.add.text(columnCx, COLUMN_TITLE_Y, '', {
        fontFamily: 'monospace', fontSize: '16px', fontStyle: 'bold', color: toCssColor(COLORS.GOLD_1),
      }).setOrigin(0.5).setScrollFactor(0);
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
      ensureGlossyButtonTexture(this.scene, TEX_SORT, SORT_BTN_W, FOOTER_BTN_H, COLORS.GREY_6),
    ).setScrollFactor(0).setInteractive({ useHandCursor: true });
    this.sortLabel = this.scene.add.text(sortX, FOOTER_Y, '', {
      fontFamily: 'monospace', fontSize: '16px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
    }).setOrigin(0.5).setScrollFactor(0);
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
      ensureGlossyButtonTexture(this.scene, TEX_FOOTER, FOOTER_BTN_W, FOOTER_BTN_H, COLORS.GOLD_3),
    ).setScrollFactor(0).setInteractive({ useHandCursor: true });
    const closeLabel = this.scene.add.text(closeX, FOOTER_Y, 'SCHLIESSEN', {
      fontFamily: 'monospace', fontSize: '18px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_10),
    }).setOrigin(0.5).setScrollFactor(0);
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
    this.ghostIcon = this.scene.add.image(0, 0, resolveCoopDefenseItemIconTexture(this.scene, 'armor', CELL))
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
    const icon = this.scene.add.image(0, 0, resolveCoopDefenseItemIconTexture(this.scene, slot, size))
      .setDisplaySize(size * 0.68, size * 0.68)
      .setScrollFactor(0);
    const level = this.scene.add.text(size / 2 - 8, size / 2 - 8, '', {
      fontFamily: 'monospace', fontSize: '13px', fontStyle: 'bold', color: toCssColor(COLORS.GREY_1),
    }).setOrigin(1, 1).setScrollFactor(0);

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
      if (cell.item) this.openCellMenu(cell, pointer);
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
    cell.icon.setAlpha(item ? 1 : 0.28);
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
    const lines = summariseEquippedCoopDefenseItems(equippedItems).slice(0, MAX_SUMMARY_LINES);
    this.summaryEmpty?.setVisible(lines.length === 0);
    for (let index = 0; index < MAX_SUMMARY_LINES; index++) {
      const label = this.summaryLines[index * 2];
      const value = this.summaryLines[index * 2 + 1];
      const line = lines[index];
      label.setVisible(!!line).setText(line?.label ?? '');
      value.setVisible(!!line).setText(line?.text ?? '');
    }
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

  private openCellMenu(cell: ItemCell, pointer: Phaser.Input.Pointer): void {
    const item = cell.item;
    if (!item || !this.contextMenu) return;
    this.tooltip?.hide();

    const rarity = getCoopDefenseItemRarityDefinition(item.rarity);
    const confirming = this.pendingSalvageUid === item.uid;
    const salvageXp = getCoopDefenseItemSalvageXp(item);

    this.contextMenu.open({
      x: toDesignSpace(this.scene.scale, pointer.x) + 8,
      y: toDesignSpace(this.scene.scale, pointer.y) + 8,
      title: `${getCoopDefenseItemSlotDefinition(cell.slot).label} · Stufe ${item.itemLevel}`,
      titleColor: rarity.color,
      onClose: () => {
        this.pendingSalvageUid = null;
      },
      entries: [
        cell.equipmentSlot
          ? {
            label: 'ABLEGEN',
            color: COLORS.GREY_1,
            onPick: () => {
              this.onUnequip(cell.slot);
              this.refresh();
            },
          }
          : {
            label: 'AUSRUESTEN',
            color: COLORS.GREEN_2,
            onPick: () => {
              this.onEquip(item.uid);
              this.refresh();
            },
          },
        {
          label: confirming ? `WIRKLICH? +${salvageXp} XP` : `ZERLEGEN +${salvageXp} XP`,
          color: confirming ? COLORS.RED_1 : COLORS.GREY_2,
          keepOpen: !confirming,
          onPick: () => {
            if (!confirming) {
              // Erster Klick fragt nach; erst der zweite zerlegt wirklich.
              this.pendingSalvageUid = item.uid;
              this.openCellMenu(cell, pointer);
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
    this.ghostIcon?.setTexture(resolveCoopDefenseItemIconTexture(this.scene, cell.slot, CELL))
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
